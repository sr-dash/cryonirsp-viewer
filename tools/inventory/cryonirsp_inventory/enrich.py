"""
Derive structural and geometric detail from a downloaded metadata ASDF.

The ASDF carries the full FITS header table and the array shape, so all of
this is available without transferring a single science frame.

Cryo-NIRSP datasets are *not* a fixed shape: DNAXIS runs from 3 to 5 and the
axis ordering differs between the two arms and between raster, repeated-map
and sit-and-stare programmes.  Axis roles are therefore derived from the
DTYPEn labels rather than assumed.
"""

from __future__ import annotations

import logging
import warnings
from pathlib import Path

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astropy.wcs import WCS

log = logging.getLogger(__name__)

SPECTRAL = "SPECTRAL"
SPATIAL = "SPATIAL"
TEMPORAL = "TEMPORAL"
STOKES = "STOKES"

#: Nominal solar radius in arcsec, used only if SOLARRAD is missing.
DEFAULT_SOLAR_RADIUS_ARCSEC = 960.0


def _header_value(header, key, default=None):
    """Read a keyword from an astropy Row, tolerating missing columns."""
    try:
        value = header[key]
    except (KeyError, IndexError):
        return default
    if value is None:
        return default
    if isinstance(value, np.generic):
        value = value.item()
    return value


def _axis_labels(header) -> list[str]:
    """Return the DTYPEn labels in FITS axis order."""
    dnaxis = int(_header_value(header, "DNAXIS", 0) or 0)
    return [str(_header_value(header, f"DTYPE{i}", "")) for i in range(1, dnaxis + 1)]


def describe_axes(array_shape, header, arm: str) -> dict:
    """
    Assign a role to each dataset axis.

    ``array_shape`` is in numpy order; reversing it gives FITS/DTYPEn order.
    Roles are assigned by label, with two arm-specific rules:

    * On the spectrograph the raster is a second *spatial* axis, so a
      temporal axis is read by its position relative to it: one *before* the
      raster axis counts repeated measurements at a slit position, one
      *after* it counts repeated maps.  (Checked against CNNMEAS and
      CNNMAPS, which match the corresponding axis lengths.)
    * The Context Imager has no spatial raster axis -- it steps in tandem
      with the spectrograph -- so when it carries two temporal axes they are
      (measurement, scan step), and when it carries only one that axis is
      the scan/frame axis unless the header reports repeated measurements.
    """
    lengths = list(int(n) for n in array_shape)[::-1]
    labels = _axis_labels(header)

    if len(labels) != len(lengths):
        log.warning(
            "DNAXIS=%d disagrees with array shape %s; axis roles may be unreliable",
            len(labels),
            array_shape,
        )
        labels = labels[: len(lengths)] + [""] * max(0, len(lengths) - len(labels))

    roles: list[str | None] = [None] * len(lengths)
    axes: dict[str, int | None] = {
        "n_wavelength": None,
        "n_along_slit": None,
        "n_image_x": None,
        "n_image_y": None,
        "n_scan_steps": None,
        "n_measurements": None,
        "n_maps": None,
        "n_stokes": None,
    }

    n_measurements_header = int(_header_value(header, "CNNMEAS", 0) or 0)
    spatial_seen = 0
    temporal_seen = 0
    n_temporal = labels.count(TEMPORAL)

    # On the spectrograph the raster is the second spatial axis; temporal
    # axes are then read as measurements before it and maps after it.
    spatial_indices = [i for i, label in enumerate(labels) if label == SPATIAL]
    scan_axis_index = spatial_indices[1] if len(spatial_indices) > 1 else None

    for index, (label, length) in enumerate(zip(labels, lengths)):
        if label == SPECTRAL:
            axes["n_wavelength"] = length
            roles[index] = "wavelength"

        elif label == SPATIAL:
            spatial_seen += 1
            if arm == "SP":
                if spatial_seen == 1:
                    axes["n_along_slit"] = length
                    roles[index] = "along_slit"
                else:
                    axes["n_scan_steps"] = length
                    roles[index] = "scan_step"
            else:
                if spatial_seen == 1:
                    axes["n_image_x"] = length
                    roles[index] = "image_x"
                else:
                    axes["n_image_y"] = length
                    roles[index] = "image_y"

        elif label == TEMPORAL:
            temporal_seen += 1
            if arm == "SP":
                before_raster = scan_axis_index is None or index < scan_axis_index
                if before_raster and axes["n_measurements"] is None:
                    axes["n_measurements"] = length
                    roles[index] = "measurement"
                elif axes["n_maps"] is None:
                    axes["n_maps"] = length
                    roles[index] = "map"
                else:
                    roles[index] = "repeat"
            elif n_temporal == 1 and n_measurements_header <= 1:
                # Single temporal axis on a CI dataset with no repeated
                # measurements: the axis counts scan steps / frames.
                axes["n_scan_steps"] = length
                roles[index] = "scan_step"
            elif temporal_seen == 1:
                axes["n_measurements"] = length
                roles[index] = "measurement"
            elif temporal_seen == 2:
                axes["n_scan_steps"] = length
                roles[index] = "scan_step"
            else:
                axes["n_maps"] = length
                roles[index] = "map"

        elif label == STOKES:
            axes["n_stokes"] = length
            roles[index] = "stokes"

        else:
            roles[index] = "unknown"

    # A role with no axis of its own is a degenerate axis of length one:
    # one Stokes state, one measurement, one map, one scan position.  The
    # extent axes (slit, wavelength, image) stay None when the arm has none.
    for key in ("n_stokes", "n_measurements", "n_maps", "n_scan_steps"):
        if axes[key] is None:
            axes[key] = 1

    header_counts = {
        "CNNUMSCN": _header_value(header, "CNNUMSCN"),
        "CNNMEAS": _header_value(header, "CNNMEAS"),
        "CNNMAPS": _header_value(header, "CNNMAPS"),
        "CNMODNST": _header_value(header, "CNMODNST"),
    }

    return {
        "axes": axes,
        "axis_labels": labels,
        "axis_lengths": lengths,
        "axis_roles": roles,
        "header_counts": header_counts,
    }


def check_consistency(structure: dict) -> dict:
    """
    Cross-check the derived axis roles, and detect truncated observations.

    ``axis_counts_consistent`` multiplies out every non-extent axis and
    compares it with the number of frames in the dataset; it holds for every
    dataset in the archive and is the real check that the roles are right.

    ``CNNUMSCN`` is *not* usable for that: it records the number of scan
    positions the programme asked for, which exceeds the number delivered
    whenever an observation was cut short.  That difference is reported
    separately as ``is_truncated`` -- a property of the observation, not an
    error in the metadata.
    """
    axes = structure["axes"]
    n_frames = structure.get("n_frames")

    expected = (
        (axes.get("n_scan_steps") or 1)
        * (axes.get("n_measurements") or 1)
        * (axes.get("n_maps") or 1)
        * (axes.get("n_stokes") or 1)
    )

    result = {
        "expected_frames": expected,
        "axis_counts_consistent": (None if n_frames is None else expected == n_frames),
        "planned_scan_positions": None,
        "delivered_scan_positions": (axes.get("n_scan_steps") or 1) * (axes.get("n_maps") or 1),
        "is_truncated": None,
    }

    planned = structure.get("header_counts", {}).get("CNNUMSCN")
    if planned:
        result["planned_scan_positions"] = int(planned)
        result["is_truncated"] = result["delivered_scan_positions"] < int(planned)

    if result["axis_counts_consistent"] is False:
        log.warning(
            "axis roles do not multiply out to the frame count: %d != %s",
            expected,
            n_frames,
        )

    return result


def _celestial_axes(wcs: WCS) -> tuple[int | None, int | None]:
    """Return the (longitude, latitude) pixel axis indices of a frame WCS."""
    longitude = latitude = None
    for index, ctype in enumerate(wcs.wcs.ctype):
        if str(ctype).startswith("HPLN"):
            longitude = index
        elif str(ctype).startswith("HPLT"):
            latitude = index
    return longitude, latitude


def _sky_from_world(world) -> SkyCoord | None:
    """Pull the SkyCoord out of a high-level WCS world result."""
    if isinstance(world, SkyCoord):
        return world
    if isinstance(world, (list, tuple)):
        for item in world:
            if isinstance(item, SkyCoord):
                return item
    return None


def _pointing(header) -> tuple[float | None, float | None]:
    """
    Return the (Tx, Ty) sky position of a frame's first pixel, in arcsec.

    This has to go through the WCS rather than read CRVAL: as the
    spectrograph rasters, CRVAL stays put at the telescope pointing and it
    is CRPIX along the scan axis that moves.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            wcs = WCS(header)
        except Exception as error:  # pragma: no cover - malformed headers
            log.warning("could not build a frame WCS: %s", error)
            return None, None

        sky = _sky_from_world(wcs.pixel_to_world(*([0] * wcs.naxis)))

    if sky is None:
        return None, None
    return float(sky.Tx.to_value("arcsec")), float(sky.Ty.to_value("arcsec"))


def _frame_geometry(header, arm: str) -> dict:
    """
    Measure the slit (SP) or image (CI) footprint from a single frame WCS.

    Two world-coordinate evaluations per celestial axis are enough: the
    frame WCS is linear along the slit and across the imager.
    """
    geometry: dict[str, float | None] = {
        "slit_length_arcsec": None,
        "slit_sampling_arcsec": None,
        "slit_position_angle_deg": None,
        "image_width_arcsec": None,
        "image_height_arcsec": None,
        "image_sampling_x_arcsec": None,
        "image_sampling_y_arcsec": None,
        "reference_pointing_arcsec": None,
        "solar_radius_arcsec": None,
        "radial_distance_solar_radii": None,
    }

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            wcs = WCS(header)
        except Exception as error:  # pragma: no cover - malformed headers
            log.warning("could not build a frame WCS: %s", error)
            return geometry

        longitude_axis, latitude_axis = _celestial_axes(wcs)
        if longitude_axis is None or latitude_axis is None:
            return geometry

        naxis = [int(_header_value(header, f"NAXIS{i + 1}", 1) or 1) for i in range(wcs.naxis)]

        def sky_at(pixel):
            return _sky_from_world(wcs.pixel_to_world(*pixel))

        def extent(axis):
            """Angular length and position angle along one pixel axis."""
            n = naxis[axis]
            if n < 2:
                return None, None, None
            start = [0] * wcs.naxis
            end = [0] * wcs.naxis
            end[axis] = n - 1
            first, last = sky_at(start), sky_at(end)
            if first is None or last is None:
                return None, None, None
            dx = (last.Tx - first.Tx).to_value("arcsec")
            dy = (last.Ty - first.Ty).to_value("arcsec")
            length = float(np.hypot(dx, dy))
            return length, length / (n - 1), float(np.degrees(np.arctan2(dy, dx)))

        if arm == "SP":
            # The spectrograph frame is (wavelength, along-slit); only one
            # celestial axis has length > 1 and that is the slit.
            slit_axis = latitude_axis if naxis[latitude_axis] > 1 else longitude_axis
            length, sampling, angle = extent(slit_axis)
            geometry["slit_length_arcsec"] = length
            geometry["slit_sampling_arcsec"] = sampling
            geometry["slit_position_angle_deg"] = angle
        else:
            width, sampling_x, _ = extent(longitude_axis)
            height, sampling_y, _ = extent(latitude_axis)
            geometry["image_width_arcsec"] = width
            geometry["image_height_arcsec"] = height
            geometry["image_sampling_x_arcsec"] = sampling_x
            geometry["image_sampling_y_arcsec"] = sampling_y

    tx, ty = _pointing(header)
    solar_radius = float(
        _header_value(header, "SOLARRAD", DEFAULT_SOLAR_RADIUS_ARCSEC)
        or DEFAULT_SOLAR_RADIUS_ARCSEC
    )
    geometry["solar_radius_arcsec"] = solar_radius

    if tx is not None and ty is not None:
        geometry["reference_pointing_arcsec"] = [float(tx), float(ty)]
        geometry["radial_distance_solar_radii"] = float(np.hypot(tx, ty) / solar_radius)

    return geometry


def _slit_endpoints(header, arm: str) -> np.ndarray | None:
    """(2, 2) Tx/Ty of the two ends of the slit (SP) or image row (CI)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            wcs = WCS(header)
        except Exception:  # pragma: no cover - malformed headers
            return None

        longitude_axis, latitude_axis = _celestial_axes(wcs)
        if longitude_axis is None or latitude_axis is None:
            return None

        naxis = [int(_header_value(header, f"NAXIS{i + 1}", 1) or 1) for i in range(wcs.naxis)]
        if arm == "SP":
            axis = latitude_axis if naxis[latitude_axis] > 1 else longitude_axis
        else:
            axis = longitude_axis

        if naxis[axis] < 2:
            return None

        start = [0] * wcs.naxis
        end = [0] * wcs.naxis
        end[axis] = naxis[axis] - 1

        first = _sky_from_world(wcs.pixel_to_world(*start))
        last = _sky_from_world(wcs.pixel_to_world(*end))

    if first is None or last is None:
        return None

    return np.array(
        [
            [first.Tx.to_value("arcsec"), last.Tx.to_value("arcsec")],
            [first.Ty.to_value("arcsec"), last.Ty.to_value("arcsec")],
        ]
    )


def _scan_geometry(headers, n_scan_steps: int | None, arm: str) -> dict:
    """
    Measure the raster step size and the scanned field-of-view corners.

    The raster step is not perfectly uniform, so the median separation is
    reported along with its spread rather than just the first step.
    """
    result = {
        "scan_step_arcsec": None,
        "scan_step_std_arcsec": None,
        "scan_step_min_arcsec": None,
        "scan_step_max_arcsec": None,
        "scan_extent_arcsec": None,
        "n_scan_positions": None,
        "spatial_bounds_arcsec": None,
    }

    if "CNCURSCN" not in headers.colnames:
        return result

    # One frame per scan step, the first one recorded at it.  CNCURSCN keeps
    # counting across repeated maps, so stop after one map's worth of
    # positions rather than folding the fly-back into the statistics.
    by_step: dict[int, int] = {}
    for index, header in enumerate(headers):
        step = _header_value(header, "CNCURSCN")
        if step is None:
            continue
        step = int(step)
        if step in by_step or (n_scan_steps and step > n_scan_steps):
            continue
        by_step[step] = index

    if not by_step:
        return result

    steps = sorted(by_step)

    # Corners of the scanned field of view, as a closed polygon in the same
    # corner order as cn_specfit.dataset.Coordinates.spatial_bounds.
    first_slit = _slit_endpoints(headers[by_step[steps[0]]], arm)
    last_slit = _slit_endpoints(headers[by_step[steps[-1]]], arm)
    if first_slit is not None and last_slit is not None:
        result["spatial_bounds_arcsec"] = [
            [
                first_slit[axis][0],
                first_slit[axis][1],
                last_slit[axis][1],
                last_slit[axis][0],
                first_slit[axis][0],
            ]
            for axis in (0, 1)
        ]

    if len(steps) < 2:
        return result

    positions = []
    for step in steps:
        tx, ty = _pointing(headers[by_step[step]])
        if tx is not None and ty is not None:
            positions.append((tx, ty))

    if len(positions) < 2:
        return result

    positions = np.array(positions)
    separations = np.hypot(*np.diff(positions, axis=0).T)

    result["n_scan_positions"] = len(positions)
    result["scan_step_arcsec"] = float(np.median(separations))
    result["scan_step_std_arcsec"] = float(np.std(separations))
    result["scan_step_min_arcsec"] = float(np.min(separations))
    result["scan_step_max_arcsec"] = float(np.max(separations))
    result["scan_extent_arcsec"] = float(np.hypot(*(positions[-1] - positions[0])))
    return result


def _timing(headers) -> dict:
    """Start/end/duration and mean cadence from the frame time stamps."""
    result = {
        "date_beg": None,
        "date_end": None,
        "duration_s": None,
        "mean_frame_cadence_s": None,
        "n_frames": len(headers),
    }

    column = "DATE-BEG" if "DATE-BEG" in headers.colnames else "DATE-AVG"
    if column not in headers.colnames:
        return result

    values = [str(v) for v in headers[column] if v is not None]
    if not values:
        return result

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        times = Time(values).unix

    start, end = float(np.min(times)), float(np.max(times))
    result["date_beg"] = Time(start, format="unix").isot
    result["date_end"] = Time(end, format="unix").isot
    result["duration_s"] = end - start
    if len(times) > 1:
        result["mean_frame_cadence_s"] = (end - start) / (len(times) - 1)

    return result


#: Instrument configuration keywords copied into the inventory verbatim.
CONFIG_KEYS = {
    "arm_id": "CNARMID",
    "task": "CNTASK",
    "observing_mode": "CNOPMODE",
    "scan_pattern": "CNPSCPAT",
    "modulator_id": "CNMODID",
    "modulator_states": "CNMODNST",
    "modulator_spin_mode": "CNSPINMD",
    "slit_width_um": "CNSLITW",
    "slit_name": "CNSLITNP",
    "grating_position_deg": "CNGRTPOS",
    "grating_grooves_per_mm": "CNGRTDIS",
    "grating_order": "CNGRTORD",
    "grating_central_wavelength_nm": "CNCENWAV",
    "filter_name": "CNFILTNP",
    "ci_filter_name": "CNCI2NP",
    "ci_nd_filter_name": "CNCI1NP",
    "exposure_time_ms": "CNEXPOS",
    "n_coadds": "CNNCOADD",
    "line_wavelength_nm": "LINEWAV",
    "waveband": "WAVEBAND",
    "wavelength_min_nm": "WAVEMIN",
    "wavelength_max_nm": "WAVEMAX",
    "frame_exposure_s": "XPOSURE",
    "total_exposure_s": "TEXPOSUR",
    "telescope_elevation_deg": "ELEV_ANG",
    "telescope_azimuth_deg": "TAZIMUTH",
    "coude_table_angle_deg": "TTBLANGL",
    "object": "OBJECT",
    "header_version": "HEADVERS",
    # Also read by cn_specfit.dataset.CryoNIRSPDataset.
    "dataset_id_header": "DSETID",
    "experiment_id_header": "EXPER_ID",
    "observing_program_id_header": "OBSPR_ID",
    "camera_fps": "CAM_FPS",
    "n_science_frames": "CNNSCI",
    "n_non_destructive_reads": "CNNNDR",
    "solar_radius_arcsec": "SOLARRAD",
}


def cn_specfit_shape(headers, header0, n_stokes: int) -> dict:
    """
    The dataset shape as ``cn_specfit`` would derive it from the L1 FITS files.

    cn-specfit assembles its cube from the header keywords rather than from
    the ASDF -- ``n_scan_steps = max(CNCURSCN)``, ``n_measurements =
    max(CNCMEAS)``, ``n_along_slit = NAXIS2``, ``n_wave = NAXIS1`` -- so it
    is recorded alongside the ASDF-derived axes.  The two disagree for
    repeated-map programmes, where CNCURSCN keeps counting across maps
    instead of restarting; ``agrees_with_asdf`` flags those.
    """
    def axis_max(key):
        if key not in headers.colnames:
            return None
        values = [v for v in headers[key] if v is not None]
        return int(np.max(values)) if values else None

    n_scan_steps = axis_max("CNCURSCN")
    n_measurements = axis_max("CNCMEAS")
    n_along_slit = _header_value(header0, "NAXIS2")
    n_wave = _header_value(header0, "NAXIS1")

    shape = [
        n_stokes,
        n_scan_steps,
        n_measurements,
        int(n_along_slit) if n_along_slit else None,
        int(n_wave) if n_wave else None,
    ]

    return {
        "order": ["n_stokes", "n_scan_steps", "n_measurements", "n_along_slit", "n_wave"],
        "shape": shape,
    }


def enrich_from_asdf(asdf_path: str | Path, arm: str) -> dict:
    """
    Read one metadata ASDF and return the structural/geometric record.

    ``arm`` is the classification from the search stage; the value found in
    the headers (CNARMID) is reported back so the two can be cross-checked.
    """
    import dkist  # imported lazily: loading dkist is slow

    asdf_path = Path(asdf_path)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        dataset = dkist.load_dataset(str(asdf_path))

    headers = dataset.headers
    header0 = headers[0]
    array_shape = tuple(int(n) for n in dataset.data.shape)

    structure = describe_axes(array_shape, header0, arm)
    structure["array_shape"] = list(array_shape)
    structure["dnaxis"] = int(_header_value(header0, "DNAXIS", len(array_shape)) or 0)

    configuration = {
        name: _header_value(header0, key) for name, key in CONFIG_KEYS.items()
    }
    structure["configuration"] = configuration

    header_arm = str(configuration.get("arm_id") or "") or None
    structure["header_arm"] = header_arm
    structure["arm_agrees_with_header"] = (header_arm == arm) if header_arm else None
    if header_arm and header_arm != arm:
        log.warning(
            "%s: classified as %s but CNARMID says %s", asdf_path.name, arm, header_arm
        )

    if arm == "SP":
        expected = cn_specfit_shape(headers, header0, structure["axes"]["n_stokes"] or 1)
        axes = structure["axes"]
        asdf_shape = [
            axes["n_stokes"],
            axes["n_scan_steps"],
            axes["n_measurements"],
            axes["n_along_slit"],
            axes["n_wavelength"],
        ]
        expected["asdf_shape"] = asdf_shape
        expected["agrees_with_asdf"] = expected["shape"] == asdf_shape
        structure["cn_specfit_shape"] = expected

    geometry = _frame_geometry(header0, arm)
    geometry.update(_scan_geometry(headers, structure["axes"].get("n_scan_steps"), arm))
    structure["geometry"] = geometry

    structure.update(_timing(headers))
    structure.update(check_consistency(structure))

    # Stokes values actually present, for polarimetric datasets.
    if "STOKES" in headers.colnames:
        structure["stokes_present"] = sorted({str(v) for v in headers["STOKES"]})

    return structure
