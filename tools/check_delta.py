#!/usr/bin/env python3
"""Compare a freshly built site inventory against the one in the repo.

The monthly job runs unattended. The danger is not a crash — a crash is
loud and stops the pipeline. The danger is a run that succeeds and quietly
produces a *worse* inventory: the upstream search returns half the archive,
the summary page changes shape and every tag vanishes, the media host is
down and 982 products silently lose their imagery.

This does not validate the schema; tools/validate_inventory.py does that.
This asks a different question: is the new file a plausible successor to the
old one?

    python3 tools/check_delta.py OLD.json NEW.json

Exit codes:
    0  the change looks like a month's growth
    1  something regressed enough that a person should look
    2  a file could not be read
"""

import argparse
import json
import sys
from collections import Counter

# A month can add products, and a recalibration can move a dataset id, but
# the archive does not shrink. A little slack absorbs the odd withdrawal.
MAX_PRODUCT_LOSS = 5

# Whole dimensions vanishing means an upstream format changed, not that the
# Sun stopped doing anything interesting.
DIMENSIONS = [
    ("tag vocabulary", lambda d: {t for r in d.values() for t in (r.get("tag_names") or [])}),
    ("spectral lines", lambda d: {r["spectral_line"] for r in d.values() if r.get("spectral_line")}),
    ("filter passbands", lambda d: {r["filter_passband"] for r in d.values() if r.get("filter_passband")}),
    ("target classes", lambda d: {r["object"] for r in d.values() if r.get("object")}),
    ("observing modes", lambda d: {r["mode_key"] for r in d.values() if r.get("mode_key")}),
]

# Coverage that should not collapse. Each is (label, predicate, slack).
COVERAGE = [
    ("with context media", lambda r: bool(r.get("context_movie")), 20),
    ("with footprint geometry", lambda r: r.get("spatial_bounds_arcsec") is not None, 20),
    ("carrying tags", lambda r: bool(r.get("tag_names")), 40),
]


def load(path):
    with open(path) as fh:
        payload = json.load(fh)
    return payload.get("datasets", payload), payload


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--summary-file", help="also write a markdown summary here")
    args = ap.parse_args()

    try:
        old, _ = load(args.old)
        new, meta = load(args.new)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    lines = []
    problems = []

    def say(s):
        lines.append(s)
        print(s)

    # ---- counts ----
    delta = len(new) - len(old)
    say(f"products        {len(old)} -> {len(new)}  ({delta:+d})")
    if delta < -MAX_PRODUCT_LOSS:
        problems.append(f"archive shrank by {-delta} products (tolerance {MAX_PRODUCT_LOSS})")

    added = set(new) - set(old)
    removed = set(old) - set(new)
    if added:
        say(f"new datasets    {len(added)}  e.g. {', '.join(sorted(added)[:5])}")
    if removed:
        say(f"gone datasets   {len(removed)}  e.g. {', '.join(sorted(removed)[:5])}")

    # A recalibration replaces a dataset id but keeps the product, so a
    # disappearing id is only a problem if its product went too.
    old_products = {r.get("product_id") for r in old.values()}
    new_products = {r.get("product_id") for r in new.values()}
    lost_products = old_products - new_products
    if lost_products:
        problems.append(f"{len(lost_products)} products disappeared entirely, "
                        f"e.g. {', '.join(sorted(p for p in lost_products if p)[:5])}")

    # ---- vocabularies ----
    for label, extract in DIMENSIONS:
        a, b = extract(old), extract(new)
        if not b and a:
            problems.append(f"{label} is now empty (was {len(a)})")
            say(f"{label:15s} {len(a)} -> 0   EMPTY")
            continue
        gone = a - b
        fresh = b - a
        note = ""
        if gone:
            note += f"  lost: {', '.join(sorted(gone)[:4])}"
        if fresh:
            note += f"  new: {', '.join(sorted(fresh)[:4])}"
        say(f"{label:15s} {len(a)} -> {len(b)}{note}")
        # Losing more than half a vocabulary is a format change, not a month.
        if a and len(b) < len(a) / 2:
            problems.append(f"{label} more than halved ({len(a)} -> {len(b)})")

    # ---- coverage ----
    for label, pred, slack in COVERAGE:
        a = sum(1 for r in old.values() if pred(r))
        b = sum(1 for r in new.values() if pred(r))
        say(f"{label:22s} {a} -> {b}  ({b - a:+d})")
        if b < a - slack:
            problems.append(f"{label} fell by {a - b} (tolerance {slack})")

    # ---- aliases: an old id must never stop resolving ----
    old_aliases = set(json.load(open(args.old)).get("dataset_aliases", {}))
    new_all = set(new) | set(json.load(open(args.new)).get("dataset_aliases", {}))
    dropped = old_aliases - new_all
    say(f"resolvable ids  {len(old_aliases)} old aliases, {len(dropped)} no longer resolve")
    if dropped:
        problems.append(f"{len(dropped)} previously resolvable dataset ids would break, "
                        f"e.g. {', '.join(sorted(dropped)[:5])}")

    say("")
    if problems:
        say("REGRESSIONS — a person should look at this run:")
        for p in problems:
            say(f"  - {p}")
    else:
        say("No regressions. This looks like a month of growth.")

    if args.summary_file:
        with open(args.summary_file, "w") as fh:
            fh.write("### Inventory delta\n\n```\n" + "\n".join(lines) + "\n```\n")

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
