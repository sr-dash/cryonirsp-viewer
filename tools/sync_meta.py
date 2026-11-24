#!/usr/bin/env python3
"""Keep the figures in index.html's metadata equal to the inventory's.

    python3 tools/sync_meta.py              # rewrite
    python3 tools/sync_meta.py --check      # exit non-zero if stale

The description, the Open Graph and Twitter cards and the structured data all
quote counts: how many products, how many observing days, how many programmes,
which months. Those are the figures search engines and link previews show, and
they were written once by hand and then left behind by the archive — a page
claiming 1,002 products while serving 1,021.

Nobody is going to remember to edit four strings every month, so this derives
them and the monthly job runs it. The prose stays hand-written; only the
numbers inside it move.
"""

import argparse
import datetime as dt
import json
import pathlib
import re
import sys

INVENTORY = pathlib.Path("data/cryonirsp_dataset_details.json")
PAGE = pathlib.Path("index.html")

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def figures(inv):
    recs = list(inv["datasets"].values())
    starts = sorted(r["start_time"][:10] for r in recs if r.get("start_time"))
    first, last = starts[0], starts[-1]
    return {
        "products": len(recs),
        "days": len({s for s in starts}),
        # The same field the landing page counts (js/data.js maps it to
        # `program`), so the metadata and the page can never disagree.
        "programs": len({r.get("observingProgramExecutionId") for r in recs
                         if r.get("observingProgramExecutionId")}),
        "first_year": first[:4],
        "last_year": last[:4],
        "first_long": f"{MONTHS[int(first[5:7]) - 1]} {first[:4]}",
        "last_long": f"{MONTHS[int(last[5:7]) - 1]} {last[:4]}",
    }


def rewrite(text, f):
    """Replace each quoted figure by pattern, so the prose around it survives.

    Deliberately narrow: every pattern names the unit it counts, so a bare
    number elsewhere in the file is never touched.
    """
    n = f"{f['products']:,}"
    subs = [
        # "Search 1,002 DKIST Cryo-NIRSP Level-1 products"
        (r"(Search )[\d,]+( DKIST Cryo-NIRSP Level-1 products)", rf"\g<1>{n}\g<2>"),
        # "1,002 DKIST Level-1 products"
        (r"[\d,]+( DKIST Level-1 products)", rf"{n}\g<1>"),
        # "every DKIST Cryo-NIRSP Level-1 product: 1,002 products"
        (r"(Level-1 product: )[\d,]+( products)", rf"\g<1>{n}\g<2>"),
        (r"[\d,]+( observing programs)", rf"{f['programs']}\g<1>"),
        (r"[\d,]+( observing days)", rf"{f['days']}\g<1>"),
        # "between October 2022 and August 2026"
        (r"(between )\w+ \d{4}( and )\w+ \d{4}",
         rf"\g<1>{f['first_long']}\g<2>{f['last_long']}"),
        # "2022–2026", en dash or hyphen
        (r"\b\d{4}[–-]\d{4}\b", f"{f['first_year']}–{f['last_year']}"),
    ]
    for pattern, repl in subs:
        text = re.sub(pattern, repl, text)
    return text


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--inventory", default=str(INVENTORY))
    ap.add_argument("--page", default=str(PAGE))
    args = ap.parse_args()

    inv = json.loads(pathlib.Path(args.inventory).read_text())
    page = pathlib.Path(args.page)
    before = page.read_text()
    f = figures(inv)
    after = rewrite(before, f)

    summary = (f"{f['products']:,} products, {f['days']} observing days, "
               f"{f['programs']} programmes, {f['first_long']}–{f['last_long']}")

    if before == after:
        print(f"{page} metadata is current ({summary})")
        return 0

    if args.check:
        print(f"::error::{page} metadata is stale — run tools/sync_meta.py "
              f"(should read {summary})", file=sys.stderr)
        return 1

    page.write_text(after)
    print(f"updated {page}: {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
