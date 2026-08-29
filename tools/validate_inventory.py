#!/usr/bin/env python3
"""Validate a Cryo-NIRSP inventory against the viewer's data contract.

The contract lives in data/SCHEMA.md; this script is its executable form.
No third-party dependencies — it runs anywhere python3 does.

    python3 tools/validate_inventory.py data/cryonirsp_dataset_details.json

    # also check that every referenced context image exists in the repo
    python3 tools/validate_inventory.py data/new_inventory.json \
        --image-dir cn_daily_context_figures

    # ...and that every movie exists in the media release
    python3 tools/validate_inventory.py data/new_inventory.json \
        --image-dir cn_daily_context_figures \
        --movie-manifest media-assets.txt

Exit codes:
    0  no errors (warnings may still be present)
    1  one or more errors — the site would render wrong
    2  the file could not be read or parsed
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

# --------------------------------------------------------------------------
# The contract. Mirrors data/SCHEMA.md §2.
# --------------------------------------------------------------------------

TIER_A_STRINGS = [
    "dataset_id",
    "product_id",
    "observingProgramExecutionId",
    "waveband",
    "metadata_file",
]

# Numeric fields that must be JSON numbers WHEN PRESENT. They are not
# required: geometry comes from the ASDF enrichment pass, which lags the
# search pass, and the CI arm has no slit to sample. The site guards every
# one of them, so absence degrades to "N/A" rather than breaking.
TIER_A_NUMBERS = []

CONDITIONAL_NUMBERS = [
    "solar_radius_arcsec",
    "stepWidth_arcsec",
    "slitSampling_arcsec",
]

TIER_A_TIMES = ["start_time", "end_time"]

DATASET_TYPES = {"polarimetric", "spectrometric"}

TIER_B = [
    "collection_id", "instrument", "instrument_name", "observatory",
    "observer", "object", "line_wave", "duration_seconds", "dataset_shape",
    "n_scanSteps", "n_measAtStep", "inactive_dataset_ids",
    "context_image", "context_movie", "context_movie_thumbnail",
]

# Absolute paths on the generating host — see SCHEMA.md §2.
DISCOURAGED_PATHS = [
    "dataset_path", "spatial_npz", "context_image_path",
    "context_movie_path", "context_movie_thumbnail_path",
]

# Pre-formatted display strings the site now derives itself.
PREFORMATTED = {
    "duration": "duration_seconds",
    "dataset_shape_str": "dataset_shape",
}

TS_ZONED = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$"
)
TS_NAIVE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$"
)


class Report:
    """Collects issues grouped by kind, keeping a few examples of each."""

    def __init__(self, max_examples=5):
        self.buckets = {"error": {}, "warn": {}}
        self.counts = {"error": Counter(), "warn": Counter()}
        self.max_examples = max_examples

    def _add(self, name, kind, detail):
        self.counts[name][kind] += 1
        examples = self.buckets[name].setdefault(kind, [])
        if len(examples) < self.max_examples:
            examples.append(detail)

    def error(self, kind, detail):
        self._add("error", kind, detail)

    def warn(self, kind, detail):
        self._add("warn", kind, detail)

    def total(self, name):
        return sum(self.counts[name].values())

    def kinds(self, name):
        return self.counts[name].most_common()

    def render(self, name, title):
        """One block per issue kind, most frequent first."""
        if not self.counts[name]:
            return ""

        out = ["-" * 72,
               f"{title} \u2014 {self.total(name)} across {len(self.counts[name])} kinds",
               "-" * 72]

        for kind, n in self.kinds(name):
            out.append(f"  {kind}  ({n}x)")
            examples = self.buckets[name][kind]
            for detail in examples:
                out.append(f"      {detail}")
            hidden = n - len(examples)
            if hidden:
                out.append(f"      ... and {hidden} more")
            out.append("")

        return "\n".join(out)



# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def unwrap(payload, rep):
    """Return (records, meta) for either envelope shape."""
    meta = {}

    if not isinstance(payload, dict):
        rep.error("envelope", "top level is not a JSON object")
        return {}, meta

    if "datasets" in payload:
        meta = {
            "schema_version": payload.get("schema_version"),
            "generated_at": payload.get("generated_at"),
            "source": payload.get("source"),
        }
        records = payload["datasets"]
        aliases = payload.get("dataset_aliases")
        if isinstance(aliases, dict):
            meta["n_aliases"] = len(aliases)
            shadowed = set(aliases) & set(records if isinstance(records, dict) else [])
            if shadowed:
                rep.error(
                    "aliases:shadow",
                    f"{len(shadowed)} alias IDs collide with live dataset IDs, "
                    f"e.g. {sorted(shadowed)[:3]} — lookup would be ambiguous",
                )

        if not meta["schema_version"]:
            rep.warn("envelope", "wrapper present but schema_version is missing")
        if not meta["generated_at"]:
            rep.warn(
                "envelope",
                "wrapper present but generated_at is missing — "
                "'Last updated' will fall back to the HTTP header",
            )
    else:
        records = payload
        rep.warn(
            "envelope",
            "bare map with no schema_version/generated_at — "
            "prefer the wrapped envelope (SCHEMA.md §1)",
        )

    if not isinstance(records, dict):
        rep.error("envelope", "datasets is not a keyed object")
        return {}, meta

    return records, meta


def check_timestamp(rep, key, field, value):
    if not isinstance(value, str):
        rep.error(f"{field}:type", f"{key}: {field} is {type(value).__name__}, expected string")
        return None

    if TS_ZONED.match(value):
        return value

    if TS_NAIVE.match(value):
        rep.warn(
            f"{field}:naive",
            f"{key}: {field}={value!r} has no timezone — assumed UTC (SCHEMA.md §3)",
        )
        return value

    rep.error(f"{field}:format", f"{key}: {field}={value!r} is not a recognisable timestamp")
    return None


def check_record(key, rec, rep):
    """Validate one dataset record. Returns a summary dict or None."""
    if not isinstance(rec, dict):
        rep.error("record", f"{key}: record is {type(rec).__name__}, expected object")
        return None

    # ---- tier A: identity and strings ----
    for field in TIER_A_STRINGS:
        v = rec.get(field)
        if v is None or v == "":
            rep.error(f"{field}:missing", f"{key}: required field {field} is missing or empty")
        elif not isinstance(v, str):
            rep.error(f"{field}:type", f"{key}: {field} is {type(v).__name__}, expected string")

    if rec.get("dataset_id") != key:
        rep.error(
            "dataset_id:key",
            f"{key}: map key does not match dataset_id={rec.get('dataset_id')!r}",
        )

    # ---- tier A: closed enum ----
    dtype = rec.get("dataset_type")
    if dtype not in DATASET_TYPES:
        rep.error(
            "dataset_type",
            f"{key}: dataset_type={dtype!r} is not one of {sorted(DATASET_TYPES)} — "
            "counters and the type filter would silently read zero",
        )

    # ---- tier A: real boolean ----
    ci = rec.get("is_context_imager")
    if not isinstance(ci, bool):
        rep.error(
            "is_context_imager",
            f"{key}: is_context_imager is {type(ci).__name__} ({ci!r}), expected boolean",
        )

    # ---- tier A: numbers must be numbers ----
    for field in TIER_A_NUMBERS:
        v = rec.get(field)
        if v is None:
            rep.error(f"{field}:missing", f"{key}: required numeric field {field} is missing")
        elif not is_number(v):
            rep.error(
                f"{field}:type",
                f"{key}: {field}={v!r} is {type(v).__name__}, expected number — "
                ".toFixed() would throw (SCHEMA.md §2)",
            )

    # ---- conditional numerics: type-check when present ----
    for field in CONDITIONAL_NUMBERS:
        v = rec.get(field)
        if v is None:
            rep.warn(f"{field}:absent", f"{key}: {field} not available (renders as N/A)")
        elif not is_number(v):
            rep.error(
                f"{field}:type",
                f"{key}: {field}={v!r} is {type(v).__name__}, expected number — "
                ".toFixed() would throw (SCHEMA.md §2)",
            )

    # ---- tier A: timestamps ----
    start = None
    for field in TIER_A_TIMES:
        v = rec.get(field)
        if v is None:
            rep.error(f"{field}:missing", f"{key}: required field {field} is missing")
        else:
            parsed = check_timestamp(rep, key, field, v)
            if field == "start_time":
                start = parsed

    # ---- tier A: footprint polygon ----
    sb = rec.get("spatial_bounds_arcsec")
    if sb is None:
        rep.warn("spatial_bounds:absent",
                 f"{key}: no spatial_bounds_arcsec — footprint panel renders empty")
    elif not (isinstance(sb, list) and len(sb) == 2
              and all(isinstance(a, list) for a in sb)):
        rep.error(
            "spatial_bounds:shape",
            f"{key}: spatial_bounds_arcsec must be [xs[], ys[]] — footprint will not draw",
        )
    else:
        xs, ys = sb
        if len(xs) != len(ys):
            rep.error(
                "spatial_bounds:length",
                f"{key}: spatial_bounds_arcsec arrays differ in length ({len(xs)} vs {len(ys)})",
            )
        elif len(xs) < 3:
            rep.error(
                "spatial_bounds:length",
                f"{key}: spatial_bounds_arcsec has {len(xs)} points, need at least 3",
            )
        else:
            if not all(is_number(v) for v in xs + ys):
                rep.error(
                    "spatial_bounds:type",
                    f"{key}: spatial_bounds_arcsec contains non-numeric values",
                )
            elif (xs[0], ys[0]) != (xs[-1], ys[-1]):
                rep.warn(
                    "spatial_bounds:open",
                    f"{key}: footprint ring is not closed (first point != last)",
                )

    # ---- tier B presence ----
    for field in TIER_B:
        if field not in rec:
            rep.warn(f"{field}:absent", f"{key}: optional field {field} not present")

    # ---- hygiene ----
    for field in DISCOURAGED_PATHS:
        v = rec.get(field)
        if isinstance(v, str) and v.startswith("/"):
            rep.warn(
                f"{field}:abspath",
                f"{key}: {field} is an absolute host path — drop it from the published copy",
            )

    for legacy, preferred in PREFORMATTED.items():
        if rec.get(legacy) is not None and rec.get(preferred) is None:
            rep.warn(
                f"{legacy}:only",
                f"{key}: {legacy} present without {preferred} — "
                "the site must fall back to the generator's formatting (SCHEMA.md §4)",
            )

    inactive = rec.get("inactive_dataset_ids")
    if isinstance(inactive, str):
        rep.warn(
            "inactive:string",
            f"{key}: inactive_dataset_ids is a bare string, expected an array",
        )

    if rec.get("waveband_key") is None:
        rep.warn("waveband_key:absent", f"{key}: no waveband_key — derived from the label instead")

    return {
        "type": dtype,
        "context": bool(ci) if isinstance(ci, bool) else False,
        "date": start[:10] if isinstance(start, str) else None,
        "waveband": rec.get("waveband"),
        "program": rec.get("observingProgramExecutionId"),
        "product": rec.get("product_id"),
        "enriched": rec.get("spatial_bounds_arcsec") is not None,
        "free_text": bool(rec.get("experiment_description")),
        "aliases": len(rec.get("inactive_dataset_ids") or []),
        "image": rec.get("context_image"),
        "movie": rec.get("context_movie"),
        "poster": rec.get("context_movie_thumbnail"),
    }


def check_media(summaries, image_dir, movie_manifest, rep, media_names=None):
    """Verify every referenced media file actually resolves."""
    if media_names is not None:
        for s in summaries:
            if s["image"] and s["image"] not in media_names:
                rep.error("media:image-missing",
                          f"context_image {s['image']!r} is not in the media manifest")
    elif image_dir:
        if not os.path.isdir(image_dir):
            rep.error("media:image-dir", f"image dir not found: {image_dir}")
        else:
            present = set(os.listdir(image_dir))
            for s in summaries:
                if s["image"] and s["image"] not in present:
                    rep.error(
                        "media:image-missing",
                        f"context_image {s['image']!r} not found in {image_dir}",
                    )

    if movie_manifest:
        if not os.path.isfile(movie_manifest):
            rep.error("media:manifest", f"movie manifest not found: {movie_manifest}")
        else:
            with open(movie_manifest) as fh:
                assets = {line.strip() for line in fh if line.strip()}
            for s in summaries:
                for field in ("movie", "poster"):
                    name = s[field]
                    if name and name not in assets:
                        rep.error(
                            f"media:{field}-missing",
                            f"context {field} {name!r} is not in the media release manifest — "
                            "re-cut the release tag (SCHEMA.md §5)",
                        )


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def render_summary(summaries, meta, path):
    total = len(summaries)
    types = Counter(s["type"] for s in summaries)
    dates = sorted(d for d in (s["date"] for s in summaries) if d)
    wavebands = Counter(s["waveband"] for s in summaries)

    lines = []
    lines.append(f"file             {path}")
    size = os.path.getsize(path)
    lines.append(f"size             {size / 1e6:.2f} MB")
    if meta.get("schema_version"):
        lines.append(f"schema_version   {meta['schema_version']}")
    if meta.get("generated_at"):
        lines.append(f"generated_at     {meta['generated_at']}")
    if meta.get("source"):
        lines.append(f"source           {meta['source']}")
    if meta.get("n_aliases") is not None:
        lines.append(f"alias index      {meta['n_aliases']} old dataset IDs resolvable")
    lines.append(f"datasets         {total}")
    if dates:
        lines.append(f"date range       {dates[0]} -> {dates[-1]}  ({len(set(dates))} observing dates)")
    lines.append(f"programs         {len({s['program'] for s in summaries})}")
    lines.append(f"products         {len({s['product'] for s in summaries})}")
    lines.append(
        "types            "
        + ", ".join(f"{k}={v}" for k, v in sorted(types.items(), key=lambda x: str(x[0])))
    )
    lines.append(f"context imager   {sum(1 for s in summaries if s['context'])}")
    lines.append(f"with media       {sum(1 for s in summaries if s['movie'])}")
    enriched = sum(1 for s in summaries if s["enriched"])
    lines.append(f"with footprint   {enriched}  ({total - enriched} awaiting ASDF enrichment)")
    aliased = sum(s["aliases"] for s in summaries)
    lines.append(f"superseded ids   {aliased} across {sum(1 for s in summaries if s['aliases'])} products")
    free = sum(1 for s in summaries if s["free_text"])
    if free:
        lines.append(f"free text        {free} records carry experiment_description (must be escaped)")
    lines.append("wavebands        " + ", ".join(f"{k} ({v})" for k, v in wavebands.most_common()))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(
        description="Validate a Cryo-NIRSP inventory against the viewer's data contract.",
    )
    ap.add_argument("inventory", help="path to the inventory JSON")
    ap.add_argument("--image-dir", help="directory that must contain every context_image")
    ap.add_argument("--movie-manifest",
                    help="file listing the media release's asset names, one per line")
    ap.add_argument("--media-manifest", metavar="FILE",
                    help="one list covering BOTH images and movies. CI has no media on "
                         "disk, so it passes the release's asset list here instead of a "
                         "directory that does not exist.")
    ap.add_argument("--strict", action="store_true",
                    help="treat warnings as errors")
    ap.add_argument("--max-examples", type=int, default=5,
                    help="examples to print per issue kind (default 5)")
    ap.add_argument("--summary-file",
                    help="also write the summary block here (used for the CI job summary)")
    args = ap.parse_args()

    try:
        with open(args.inventory) as fh:
            payload = json.load(fh)
    except FileNotFoundError:
        print(f"error: no such file: {args.inventory}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"error: {args.inventory} is not valid JSON: {exc}", file=sys.stderr)
        return 2

    # One manifest answers for both kinds; the filename families differ by prefix.
    if args.media_manifest:
        args.movie_manifest = args.media_manifest
        args.image_dir = None
        try:
            with open(args.media_manifest) as fh:
                media_names = {line.strip() for line in fh if line.strip()}
        except FileNotFoundError:
            print(f"error: no such manifest: {args.media_manifest}", file=sys.stderr)
            return 2
    else:
        media_names = None

    rep = Report(max_examples=args.max_examples)

    records, meta = unwrap(payload, rep)

    summaries = []
    for key, rec in records.items():
        s = check_record(key, rec, rep)
        if s:
            summaries.append(s)

    check_media(summaries, args.image_dir, args.movie_manifest, rep, media_names)

    if not summaries:
        rep.error("empty", "no valid dataset records found")

    # ---- output ----
    summary = render_summary(summaries, meta, args.inventory) if summaries else "(no records)"

    print("=" * 72)
    print("INVENTORY SUMMARY")
    print("=" * 72)
    print(summary)
    print()

    warn_block = rep.render("warn", "WARNINGS")
    error_block = rep.render("error", "ERRORS")

    if warn_block:
        print(warn_block)

    if error_block:
        print(error_block)

    if args.summary_file:
        with open(args.summary_file, "w") as fh:
            fh.write("### Inventory validation\n\n```\n" + summary + "\n```\n\n")
            fh.write(f"- errors: **{rep.total('error')}** "
                     f"across {len(rep.kinds('error'))} kinds\n")
            fh.write(f"- warnings: **{rep.total('warn')}** "
                     f"across {len(rep.kinds('warn'))} kinds\n")

    failed = rep.total("error") > 0 or (args.strict and rep.total("warn") > 0)

    print(f"errors {rep.total('error')} / warnings {rep.total('warn')}")
    print("FAILED — the site would render incorrectly." if failed
          else "OK — inventory satisfies the contract.")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
