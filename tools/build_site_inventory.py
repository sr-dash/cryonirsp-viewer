#!/usr/bin/env python3
"""Transform the generator's inventory into the site's published data file.

The generator (CryoNIRSP-Datasets/cryonirsp_inventory.json) is product-centric,
deeply nested, ~8 MB, and contains bare NaN literals that JSON.parse refuses.
The site needs a flat, valid, minified file in the shape data/SCHEMA.md
describes. This script is the seam between the two.

    python3 tools/build_site_inventory.py \
        ~/NSO/Work/GIT-Projects/CryoNIRSP-Datasets/cryonirsp_inventory.json \
        -o data/cryonirsp_dataset_details.json

One site record per product, representing that product's ACTIVE dataset.
Superseded dataset IDs are carried in inactive_dataset_ids so that an old
dataset ID still finds its product through search and direct lookup.

Media filenames are derived from the observation date and only emitted when
the file actually exists locally, so the published inventory can never point
at a movie that is not there.
"""

import argparse
import json
import math
import os
import re
import sys
from collections import Counter, OrderedDict

SCHEMA_VERSION = "1.0"

# Constant for every Cryo-NIRSP L1 dataset. The generator dropped these
# because they never vary; the site still displays them.
CONSTANTS = {
    "collection_id": "CRYONIRSP-L1",
    "observatory": "Haleakala High Altitude Observatory Site",
    "telescope": "Daniel K. Inouye Solar Telescope",
    "observer": "NSF-DKIST",
}

IMAGE_PATTERN = "daily_context_{date}.jpg"
MOVIE_PATTERN = "cn_daily_movie_{date}.mp4"
POSTER_PATTERN = "cn_daily_movie_{date}.jpg"


# --------------------------------------------------------------------------
# JSON hygiene
# --------------------------------------------------------------------------

def clean(value):
    """Recursively replace NaN/Infinity with None.

    Python's json.dump writes these as bare literals by default. They are not
    valid JSON and JSON.parse throws on the first one, which would leave the
    site with an empty archive and a console error.
    """
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def zulu(ts):
    """Normalise a timestamp to RFC 3339 with an explicit UTC designator."""
    if not ts or not isinstance(ts, str):
        return None
    ts = ts.strip().replace(" ", "T")
    if re.search(r"(Z|[+-]\d{2}:?\d{2})$", ts):
        # Already zoned; canonicalise +00:00 to Z.
        return re.sub(r"\+00:?00$", "Z", ts)
    return ts + "Z"


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return None if (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else v
    return None


def first(*values):
    for v in values:
        if v is not None:
            return v
    return None


def dig(obj, *path):
    """Safe nested get — the generator leaves whole subtrees absent."""
    for key in path:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


# --------------------------------------------------------------------------
# Derivations
# --------------------------------------------------------------------------

def waveband_key(primary_line, fit_line):
    """Prefer the generator's fit_line; fall back to species + wavelength."""
    if fit_line:
        return fit_line
    ion = dig(primary_line, "ion")
    nm = num(dig(primary_line, "wavelength_nm"))
    if not ion:
        return None
    species = re.sub(r"\s+", "", ion).lower()
    return f"{species}_{int(nm)}" if nm is not None else species


def dataset_type(classification):
    """The site's closed set, derived from the generator's richer model.

    full_stokes is the honest discriminator: 'spectropolarimetry' and
    'context_imaging_polarimetry' both carry IQUV.
    """
    return "polarimetric" if classification.get("full_stokes") else "spectrometric"


def dataset_shape(structure):
    """Prefer the 5-D cn_specfit shape the old site displayed."""
    shape = dig(structure, "cn_specfit_shape", "shape")
    if isinstance(shape, list) and shape:
        return [int(v) for v in shape if isinstance(v, (int, float))]
    for candidate in ("axis_lengths", "array_shape"):
        shape = dig(structure, candidate)
        if isinstance(shape, list) and shape:
            return [int(v) for v in shape if isinstance(v, (int, float))]
    return None


def duration_seconds(structure, start, end):
    """structure.duration_s when enriched, else the active window."""
    d = num(dig(structure, "duration_s"))
    if d is not None:
        return d
    if start and end:
        from datetime import datetime
        try:
            fmt = "%Y-%m-%dT%H:%M:%S.%f" if "." in start else "%Y-%m-%dT%H:%M:%S"
            t0 = datetime.strptime(start.rstrip("Z"), fmt)
            t1 = datetime.strptime(end.rstrip("Z"), fmt)
            return (t1 - t0).total_seconds()
        except ValueError:
            return None
    return None


def position_angle(reference):
    """Position angle of the reference pointing, degrees CCW from solar west."""
    if not isinstance(reference, list) or len(reference) < 2:
        return None
    x, y = num(reference[0]), num(reference[1])
    if x is None or y is None:
        return None
    return math.degrees(math.atan2(y, x)) % 360.0


def media_for(date_compact, available):
    """Only reference media that actually exists locally."""
    image = IMAGE_PATTERN.format(date=date_compact)
    movie = MOVIE_PATTERN.format(date=date_compact)
    poster = POSTER_PATTERN.format(date=date_compact)
    return (
        image if image in available["images"] else None,
        movie if movie in available["movies"] else None,
        poster if poster in available["movies"] else None,
    )


# --------------------------------------------------------------------------
# Record construction
# --------------------------------------------------------------------------

def build_record(product, available, stats):
    active = product.get("active") or {}
    classification = product.get("classification") or {}
    structure = product.get("structure") or {}
    geometry = dig(structure, "geometry") or {}
    configuration = dig(structure, "configuration") or {}
    axes = dig(structure, "axes") or {}
    metadata = product.get("metadata") or {}

    dataset_id = product.get("active_dataset_id") or active.get("dataset_id")
    if not dataset_id:
        stats["skipped_no_active"] += 1
        return None, None

    start = zulu(active.get("start_time"))
    end = zulu(active.get("end_time"))

    if not start:
        stats["skipped_no_start"] += 1
        return None, None

    date_compact = start[:10].replace("-", "")
    image, movie, poster = media_for(date_compact, available)
    if image:
        stats["with_media"] += 1
    else:
        stats["without_media"] += 1

    primary_line = classification.get("primary_line") or {}

    if structure:
        stats["enriched"] += 1
    else:
        stats["unenriched"] += 1

    # Superseded dataset IDs, newest-first as the generator ordered them.
    archived_ids = [
        a for a in (product.get("archived_dataset_ids") or []) if isinstance(a, str)
    ]

    # Status per archived ID, so the UI can distinguish DEPRECATED from REMOVED.
    archived_status = {}
    for entry in product.get("archived") or []:
        if isinstance(entry, dict) and entry.get("dataset_id"):
            archived_status[entry["dataset_id"]] = entry.get("status")

    record = OrderedDict()

    # ---- identity (tier A) ----
    record["dataset_id"] = dataset_id
    record["product_id"] = product.get("product_id")
    record["observingProgramExecutionId"] = product.get("observing_program_execution_id")
    record["collection_id"] = CONSTANTS["collection_id"]

    # ---- classification (tier A) ----
    record["dataset_type"] = dataset_type(classification)
    record["is_context_imager"] = bool(classification.get("is_context_imager"))

    # ---- time (tier A) ----
    record["start_time"] = start
    record["end_time"] = end
    record["duration_seconds"] = duration_seconds(structure, start, end)

    # ---- spectral (tier A) ----
    # The spectrograph disperses a line; the context imager images through a
    # narrowband filter. The generator reports both as primary_line, which
    # merged 403 He I imager frames into the 52 real He I spectrograph
    # observations. They are different measurements and are split here.
    arm = classification.get("arm")
    key = waveband_key(primary_line, classification.get("fit_line"))

    record["waveband"] = primary_line.get("raw")
    record["line_wave"] = num(primary_line.get("wavelength_nm"))
    record["waveband_key"] = key
    record["spectral_line"] = key if arm == "SP" else None
    record["filter_passband"] = key if arm == "CI" else None

    # Observing mode, named the way the instrument team names it. The
    # polarimetric context-imager mode is named for the passband it was taken
    # in, because 42 of those 183 products are Fe XIII, not He I.
    mode = classification.get("observing_mode")
    if mode == "context_imaging":
        record["mode_key"] = "ci"
    elif mode == "context_imaging_polarimetry":
        record["mode_key"] = f"ci_pol_{key}" if key else "ci_pol"
    else:
        record["mode_key"] = mode

    # ---- geometry (tier A when enriched) ----
    record["solar_radius_arcsec"] = first(
        num(geometry.get("solar_radius_arcsec")),
        num(configuration.get("solar_radius_arcsec")),
    )
    record["stepWidth_arcsec"] = num(geometry.get("scan_step_arcsec"))
    record["slitSampling_arcsec"] = num(geometry.get("slit_sampling_arcsec"))
    record["spatial_bounds_arcsec"] = clean(geometry.get("spatial_bounds_arcsec"))

    # The generator measures radial distance to the reference pointing, not to
    # the polygon centroid — the two differ by ~0.07 R-sun. Carry its value
    # rather than letting the site re-derive a subtly different quantity.
    record["radial_distance"] = num(geometry.get("radial_distance_solar_radii"))
    record["reference_pointing_arcsec"] = clean(geometry.get("reference_pointing_arcsec"))
    record["position_angle_deg"] = position_angle(geometry.get("reference_pointing_arcsec"))
    record["slit_angle_deg"] = num(geometry.get("slit_position_angle_deg"))

    # ---- provenance (tier B) ----
    record["instrument"] = product.get("instrument")
    record["instrument_name"] = product.get("instrument")
    record["observatory"] = CONSTANTS["observatory"]
    record["telescope"] = CONSTANTS["telescope"]
    record["observer"] = CONSTANTS["observer"]
    record["object"] = first(
        configuration.get("object"),
        (active.get("target_types") or [None])[0],
    )
    record["metadata_file"] = first(
        metadata.get("asdf_filename"),
        os.path.basename(active.get("asdf_filename") or "") or None,
    )

    # ---- shape (tier B) ----
    shape = dataset_shape(structure)
    record["dataset_shape"] = shape
    record["dataset_shape_str"] = " \u00d7 ".join(str(v) for v in shape) if shape else None
    record["n_scanSteps"] = num(axes.get("n_scan_steps"))
    record["n_measAtStep"] = num(axes.get("n_measurements"))
    record["n_stokes"] = num(axes.get("n_stokes"))
    record["n_alongSlit"] = num(axes.get("n_along_slit"))
    record["n_wavelength"] = num(axes.get("n_wavelength"))

    # ---- archive lineage ----
    record["inactive_dataset_ids"] = archived_ids
    record["archived_status"] = archived_status or None
    record["dataset_status"] = active.get("status")

    # ---- media (tier B) ----
    record["context_image"] = image
    record["context_movie"] = movie
    record["context_movie_thumbnail"] = poster

    # ---- new in v1.0.0: product context ----
    # experiment_description is operator-authored free text. It is escaped at
    # render time (js/utils.js esc()); see data/SCHEMA.md section 6.
    record["experiment_id"] = product.get("experiment_id")
    record["proposal_id"] = product.get("proposal_id")
    record["experiment_description"] = product.get("experiment_description")
    record["observing_mode"] = classification.get("observing_mode")
    record["arm"] = classification.get("arm")
    record["stokes_parameters"] = classification.get("stokes_parameters")
    record["analysis_class"] = classification.get("analysis_class")
    record["is_fittable"] = classification.get("is_fittable")
    record["preview_url"] = active.get("preview_url")
    record["quality_report_filename"] = active.get("quality_report_filename")
    record["dataset_size_gib"] = num(active.get("dataset_size_gib"))
    record["number_of_frames"] = num(active.get("number_of_frames"))
    # The generator now publishes an access block; prefer it over the
    # per-dataset flags it was derived from. The lift date is what the site
    # actually needs: a static page cannot trust a stored boolean to stay
    # true, but it can compare a date to now.
    access = product.get("access") or {}
    record["access_status"] = access.get("status")
    record["embargoed"] = first(access.get("embargoed"), active.get("embargoed"))
    record["downloadable"] = first(access.get("frames_downloadable"), active.get("downloadable"))
    record["metadata_available"] = access.get("metadata_available")
    record["embargo_end_date"] = zulu(
        first(access.get("embargo_end_date"), active.get("embargo_end_date")))
    record["calibration_workflow_version"] = active.get("calibration_workflow_version")

    # ---- observing-day annotations (inventory 2026-08-29) ----
    # These come from the daily summary page and describe the OBSERVING DAY,
    # so every product taken that day carries them. Kept as-is rather than
    # flattened: the category groups the facet rail, and the url makes a tag
    # a link out to the coordinating mission or the summary itself.
    day = product.get("observing_day") or {}
    tags = [t for t in (day.get("tags") or []) if isinstance(t, dict) and t.get("tag")]

    record["observing_date_hst"] = day.get("observing_date_hst")
    record["tags"] = [
        {
            "tag": t.get("tag"),
            "label": t.get("label"),
            "category": t.get("category"),
            "url": t.get("url"),
        }
        for t in tags
    ]
    record["tag_names"] = sorted({t["tag"] for t in record["tags"]})
    record["tag_categories"] = sorted({t["category"] for t in record["tags"] if t.get("category")})
    record["publications"] = [
        p for p in (day.get("publications") or []) if isinstance(p, dict) and p.get("label")
    ]
    record["known_issues"] = [i for i in (day.get("known_issues") or []) if isinstance(i, str)]
    record["data_issues"] = [i for i in (day.get("data_issues") or []) if isinstance(i, str)]
    record["summary_source"] = day.get("source")

    return dataset_id, clean(record)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="the generator's cryonirsp_inventory.json")
    ap.add_argument("-o", "--output", default="data/cryonirsp_dataset_details.json")
    ap.add_argument("--image-dir", default="cn_daily_context_figures")
    ap.add_argument("--movie-dir", default="cn_daily_movies")
    ap.add_argument("--pretty", action="store_true",
                    help="indent the output (default is minified for publishing)")
    ap.add_argument("--check-against", metavar="PUBLISHED",
                    help="compare the rebuild to an existing published file and exit non-zero "
                         "if the DATASET CONTENT differs; writes nothing. Provenance fields "
                         "(generated_at, source) are ignored, because the generator stamps a new "
                         "build time on every run and a byte comparison would report drift that "
                         "does not exist.")
    args = ap.parse_args()

    try:
        with open(args.source) as fh:
            raw = fh.read()
    except FileNotFoundError:
        print(f"error: no such file: {args.source}", file=sys.stderr)
        return 2

    nan_count = len(re.findall(r"\bNaN\b", raw))

    try:
        # Python accepts the bare NaN literals that JSON.parse rejects.
        source = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"error: {args.source} is not parseable: {exc}", file=sys.stderr)
        return 2

    products = source.get("products")
    if not isinstance(products, dict):
        print("error: source has no 'products' object", file=sys.stderr)
        return 2

    available = {
        "images": set(os.listdir(args.image_dir)) if os.path.isdir(args.image_dir) else set(),
        "movies": set(os.listdir(args.movie_dir)) if os.path.isdir(args.movie_dir) else set(),
    }
    if not available["images"]:
        print(f"warning: no images found in {args.image_dir}", file=sys.stderr)
    if not available["movies"]:
        print(f"warning: no movies found in {args.movie_dir}", file=sys.stderr)

    stats = Counter()
    datasets = OrderedDict()
    aliases = {}

    for product in products.values():
        key, record = build_record(product, available, stats)
        if not record:
            continue
        if key in datasets:
            stats["duplicate_dataset_id"] += 1
            continue
        datasets[key] = record
        # Every superseded ID resolves to the product that replaced it.
        for old in record["inactive_dataset_ids"]:
            if old not in aliases:
                aliases[old] = key

    # An alias must never shadow a live dataset ID.
    aliases = {k: v for k, v in aliases.items() if k not in datasets}

    payload = OrderedDict()
    payload["schema_version"] = SCHEMA_VERSION
    payload["generated_at"] = zulu(source.get("generated")) or None
    payload["source"] = (
        f"cryonirsp_inventory {source.get('version', '?')} "
        f"({source.get('n_products', len(products))} products) "
        f"via tools/build_site_inventory.py"
    )
    payload["dataset_aliases"] = aliases
    payload["datasets"] = datasets

    if args.check_against:
        try:
            with open(args.check_against) as fh:
                published = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError) as exc:
            print(f"error: cannot read {args.check_against}: {exc}", file=sys.stderr)
            return 2

        drift = []
        if set(published.get("datasets", {})) != set(datasets):
            only_new = set(datasets) - set(published.get("datasets", {}))
            only_old = set(published.get("datasets", {})) - set(datasets)
            drift.append(f"dataset ids differ (+{len(only_new)} / -{len(only_old)})")
        else:
            changed = [k for k in datasets
                       if datasets[k] != published["datasets"][k]]
            if changed:
                drift.append(f"{len(changed)} records changed, e.g. {changed[:3]}")

        if published.get("dataset_aliases", {}) != aliases:
            drift.append("alias index differs")

        if drift:
            print("STALE — rebuilding produces different content:")
            for d in drift:
                print(f"  {d}")
            return 1

        print(f"CURRENT — {args.check_against} matches a fresh rebuild "
              f"({len(datasets)} datasets, {len(aliases)} aliases).")
        print("           provenance fields (generated_at, source) not compared")
        return 0

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w") as fh:
        if args.pretty:
            json.dump(payload, fh, indent=1, allow_nan=False)
        else:
            json.dump(payload, fh, separators=(",", ":"), allow_nan=False)

    size = os.path.getsize(args.output)

    print(f"source     {args.source}")
    print(f"           {len(products)} products, {nan_count} NaN literals neutralised")
    print(f"output     {args.output}  ({size / 1e6:.2f} MB"
          f"{', pretty' if args.pretty else ', minified'})")
    print(f"datasets   {len(datasets)}")
    print(f"aliases    {len(aliases)} superseded dataset IDs resolve to their product")
    print(f"enriched   {stats['enriched']} with structure, "
          f"{stats['unenriched']} awaiting enrichment")
    print(f"media      {stats['with_media']} with context media, "
          f"{stats['without_media']} without")

    sp = sum(1 for r in datasets.values() if r.get("spectral_line"))
    ci = sum(1 for r in datasets.values() if r.get("filter_passband"))
    print(f"arms       {sp} spectrograph (spectral line), {ci} context imager (filter)")

    tagged = sum(1 for r in datasets.values() if r.get("tag_names"))
    vocab = sorted({t for r in datasets.values() for t in (r.get("tag_names") or [])})
    print(f"tags       {tagged} products carry observing-day tags, "
          f"{len(vocab)} distinct tags")
    for key, label in (("publications", "publications"),
                       ("known_issues", "known issues"),
                       ("data_issues", "data issues")):
        n = sum(1 for r in datasets.values() if r.get(key))
        if n:
            print(f"           {n} with {label}")
    for key in ("skipped_no_active", "skipped_no_start", "duplicate_dataset_id"):
        if stats[key]:
            print(f"SKIPPED    {stats[key]} ({key})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
