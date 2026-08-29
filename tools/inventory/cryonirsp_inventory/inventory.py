"""
On-disk representation of the Cryo-NIRSP inventory.

The inventory is a single JSON document keyed on Product ID.  Every stage
(search / fetch / enrich) reads it, adds to it and writes it back, so the
pipeline is resumable and each stage can be re-run on its own.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import __version__

#: Default inventory filename, relative to the dataset root.
DEFAULT_INVENTORY = "cryonirsp_inventory.json"

#: Sub-directory holding the downloaded Level-1 metadata tree.
LEVEL1_DIRNAME = "Level-1"

#: Per-dataset sidecar written next to each metadata ASDF.
SIDECAR_NAME = "dataset.json"


@dataclass
class Inventory:
    """Product-keyed Cryo-NIRSP inventory."""

    products: dict[str, dict] = field(default_factory=dict)
    generated: str | None = None
    version: str = __version__

    def __len__(self) -> int:
        return len(self.products)

    def __iter__(self):
        return iter(self.products.values())

    def stamp(self) -> None:
        self.generated = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "generated": self.generated,
            "instrument": "CRYO-NIRSP",
            "n_products": len(self.products),
            "products": self.products,
        }

    def select(
        self,
        arm: str | None = None,
        analysis_class: str | None = None,
        coronal_forbidden: bool | None = None,
        experiment_id: str | None = None,
        with_metadata: bool | None = None,
        embargoed: bool | None = None,
        tag: str | None = None,
    ) -> list[dict]:
        """
        Filter products on the classification fields.

        ``embargoed`` selects on the ACTIVE dataset's embargo flag: ``False``
        keeps only released data, ``True`` only data still under embargo.

        ``tag`` selects on an observing-day tag slug, e.g. ``coronal_cavity``
        or ``psp_encounter``.
        """
        selected = []

        for product in self.products.values():
            classification = product.get("classification") or {}

            if arm is not None and classification.get("arm") != arm:
                continue
            if (
                analysis_class is not None
                and classification.get("analysis_class") != analysis_class
            ):
                continue
            if (
                coronal_forbidden is not None
                and bool(classification.get("is_coronal_forbidden_line"))
                is not coronal_forbidden
            ):
                continue
            if experiment_id is not None and product.get("experiment_id") != experiment_id:
                continue
            if embargoed is not None:
                access = product.get("access") or {}
                if bool(access.get("embargoed")) is not embargoed:
                    continue
            if tag is not None:
                day = product.get("observing_day") or {}
                if tag not in (day.get("tag_names") or []):
                    continue
            if with_metadata is not None:
                has_metadata = bool((product.get("metadata") or {}).get("asdf_path"))
                if has_metadata is not with_metadata:
                    continue

            selected.append(product)

        return selected


def load_inventory(path: str | Path) -> Inventory:
    """Load an inventory, returning an empty one if the file does not exist."""
    path = Path(path)
    if not path.exists():
        return Inventory()

    with path.open() as handle:
        payload = json.load(handle)

    return Inventory(
        products=payload.get("products", {}),
        generated=payload.get("generated"),
        version=payload.get("version", __version__),
    )


def save_inventory(inventory: Inventory, path: str | Path) -> Path:
    """Write the inventory to ``path`` atomically."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    inventory.stamp()

    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w") as handle:
        json.dump(inventory.to_dict(), handle, indent=1, default=str)
    temporary.replace(path)

    return path


#: Which identifier forms the top level of the metadata tree.  For
#: Cryo-NIRSP the two are currently interchangeable -- every proposal has
#: exactly one experiment and the suffixes match (pid_2_71 <-> eid_2_71) --
#: but the DKIST data model allows one proposal to hold many experiments, so
#: the experiment is the finer level and is the default.
GROUP_BY_KEYS = {
    "experiment": ("experiment_id", "unknown-experiment"),
    "proposal": ("proposal_id", "unknown-proposal"),
}

DEFAULT_GROUP_BY = "experiment"


def dataset_directory(
    root: str | Path,
    product: dict,
    dataset_id: str | None = None,
    group_by: str = DEFAULT_GROUP_BY,
) -> Path:
    """
    Return ``<root>/Level-1/<experiment or proposal id>/<product id>/<dataset id>``.

    Products are stable across recalibrations, so the product directory
    persists while a new dataset directory appears underneath it for each new
    calibration.
    """
    try:
        key, fallback = GROUP_BY_KEYS[group_by]
    except KeyError:
        raise ValueError(
            f"group_by must be one of {sorted(GROUP_BY_KEYS)}, not {group_by!r}"
        ) from None

    dataset_id = dataset_id or product.get("active_dataset_id")
    return (
        Path(root)
        / LEVEL1_DIRNAME
        / str(product.get(key) or fallback)
        / str(product["product_id"])
        / str(dataset_id or "unknown-dataset")
    )


#: Flat columns written by :func:`write_csv`, in order.
CSV_COLUMNS = [
    "product_id",
    "access_status",
    "active_dataset_id",
    "archived_dataset_ids",
    "experiment_id",
    "proposal_id",
    "arm",
    "observing_mode",
    "analysis_class",
    "analysis_tool",
    "is_context_imager",
    "is_coronal_forbidden_line",
    "primary_line",
    "line_wavelength_nm",
    "stokes_parameters",
    "start_time",
    "end_time",
    "duration_s",
    "target_types",
    "observing_date_hst",
    "tags",
    "tag_categories",
    "known_issues",
    "data_issues",
    "publications",
    "n_calibrations",
    "dataset_size_gib",
    "number_of_frames",
    "embargoed",
    "embargo_end_date",
    "frames_downloadable",
    "average_spatial_sampling_arcsec",
    "average_spectral_sampling_nm",
    "average_temporal_sampling_s",
    "exposure_time_s",
    "n_stokes",
    "n_scan_steps",
    "n_measurements",
    "n_maps",
    "n_along_slit",
    "n_wavelength",
    "array_shape",
    "is_truncated",
    "planned_scan_positions",
    "delivered_scan_positions",
    "slit_length_arcsec",
    "slit_position_angle_deg",
    "scan_step_arcsec",
    "bounding_box",
    "metadata_path",
]


def _flatten(product: dict) -> dict:
    """Flatten one product record into the CSV column set."""
    classification = product.get("classification") or {}
    active = product.get("active") or {}
    structure = product.get("structure") or {}
    metadata = product.get("metadata") or {}
    primary = classification.get("primary_line") or {}
    day = product.get("observing_day") or {}
    axes = structure.get("axes") or {}
    geometry = structure.get("geometry") or {}

    duration = None
    if structure.get("duration_s") is not None:
        duration = structure["duration_s"]

    return {
        "product_id": product.get("product_id"),
        "access_status": (product.get("access") or {}).get("status"),
        "active_dataset_id": product.get("active_dataset_id"),
        "archived_dataset_ids": ";".join(product.get("archived_dataset_ids") or []),
        "experiment_id": product.get("experiment_id"),
        "proposal_id": product.get("proposal_id"),
        "arm": classification.get("arm"),
        "observing_mode": classification.get("observing_mode"),
        "analysis_class": classification.get("analysis_class"),
        "analysis_tool": classification.get("analysis_tool"),
        "is_context_imager": classification.get("is_context_imager"),
        "is_coronal_forbidden_line": classification.get("is_coronal_forbidden_line"),
        "primary_line": primary.get("ion"),
        "line_wavelength_nm": primary.get("wavelength_nm"),
        "stokes_parameters": classification.get("stokes_parameters"),
        "start_time": active.get("start_time"),
        "end_time": active.get("end_time"),
        "duration_s": duration,
        "target_types": ";".join(active.get("target_types") or []),
        "observing_date_hst": day.get("observing_date_hst"),
        "tags": ";".join(day.get("tag_names") or []),
        "tag_categories": ";".join(
            sorted({t["category"] for t in (day.get("tags") or [])})
        ),
        "known_issues": ";".join(day.get("known_issues") or []),
        "data_issues": ";".join(day.get("data_issues") or []),
        "publications": ";".join(
            pub["label"] for pub in (day.get("publications") or []) if pub.get("label")
        ),
        "n_calibrations": product.get("n_calibrations"),
        "dataset_size_gib": active.get("dataset_size_gib"),
        "number_of_frames": active.get("number_of_frames"),
        "embargoed": (product.get("access") or {}).get("embargoed"),
        "embargo_end_date": (product.get("access") or {}).get("embargo_end_date"),
        "frames_downloadable": (product.get("access") or {}).get("frames_downloadable"),
        "average_spatial_sampling_arcsec": active.get("average_spatial_sampling_arcsec"),
        "average_spectral_sampling_nm": active.get("average_spectral_sampling_nm"),
        "average_temporal_sampling_s": active.get("average_temporal_sampling_s"),
        "exposure_time_s": active.get("exposure_time_s"),
        "n_stokes": axes.get("n_stokes"),
        "n_scan_steps": axes.get("n_scan_steps"),
        "n_measurements": axes.get("n_measurements"),
        "n_maps": axes.get("n_maps"),
        "n_along_slit": axes.get("n_along_slit"),
        "n_wavelength": axes.get("n_wavelength"),
        "array_shape": (
            "x".join(str(n) for n in structure["array_shape"])
            if structure.get("array_shape")
            else None
        ),
        "is_truncated": structure.get("is_truncated"),
        "planned_scan_positions": structure.get("planned_scan_positions"),
        "delivered_scan_positions": structure.get("delivered_scan_positions"),
        "slit_length_arcsec": geometry.get("slit_length_arcsec"),
        "slit_position_angle_deg": geometry.get("slit_position_angle_deg"),
        "scan_step_arcsec": geometry.get("scan_step_arcsec"),
        "bounding_box": active.get("bounding_box"),
        "metadata_path": metadata.get("asdf_path"),
    }


def write_csv(inventory: Inventory, path: str | Path, products=None) -> Path:
    """
    Write a flat, spreadsheet-friendly view of the inventory.

    ``products`` restricts the output to a selection; omit it to write every
    product.  Passing the selection matters when the caller filtered on
    something like ``--exclude-embargoed`` -- the CSV must not quietly widen
    it back out to the whole inventory.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if products is None:
        products = inventory.products.values()
    rows = [_flatten(product) for product in products]
    rows.sort(key=lambda r: (str(r["start_time"] or ""), str(r["product_id"])))

    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    return path


def write_sidecar(product: dict, directory: str | Path) -> Path:
    """Write the per-dataset ``dataset.json`` next to a metadata ASDF."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / SIDECAR_NAME

    with path.open("w") as handle:
        json.dump(product, handle, indent=1, default=str)

    return path
