#!/usr/bin/env python3
"""Refresh citation counts from ADS, and notice papers that should be reviewed.

    export ADS_TOKEN=...          # or leave ~/.ads/dev_key in place
    python3 tools/refresh_ads.py              # counts only
    python3 tools/refresh_ads.py --discover   # counts, and look for new papers

Two jobs, deliberately separate, because only one of them can be trusted to
run unattended.

Refreshing a citation count is arithmetic: the paper is already in the list,
ADS knows its current count, nothing is being decided. That runs monthly
without anyone watching.

Deciding whether a new paper belongs is a judgement — dkist-bib exists because
"mentions DKIST" and "analyses DKIST data" are different claims, and only a
person reading the paper can tell them apart. So discovery never adds anything
to the published list. It appends to a review queue and stops, and the curated
record in dkist-bib stays where the judgement lives.

Nothing here removes a paper, a count, or a queue entry. A refresh that loses
data is worse than no refresh, and an unattended one that can lose data is
worse still.
"""

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.adsabs.harvard.edu/v1"

PUBS = pathlib.Path("data/dkist_publications.json")
QUEUE = pathlib.Path("data/publications_pending.json")

# The screening queries, kept the same as dkist-bib/candidates.py so that what
# this notices and what that pipeline notices are the same pool. The year
# range is computed rather than written down: a hardcoded end year quietly
# stops finding anything the January after it passes.
def queries(from_year):
    this_year = dt.date.today().year
    base = f"property:refereed year:{from_year}-{this_year}"
    return {
        "mention": f'{base} full:(DKIST OR "Inouye Solar Telescope" OR "Daniel K. Inouye")',
        "ack": f'{base} ack:("Inouye Solar Telescope" OR DKIST)',
        "instr": f'{base} full:("Visible Broadband Imager" OR "Visible Spectro-Polarimeter"'
                 f' OR "Cryogenic Near-Infrared Spectro-Polarimeter"'
                 f' OR "Diffraction-Limited Near-Infrared Spectropolarimeter"'
                 f' OR "Cryo-NIRSP" OR "DL-NIRSP" OR "Visible Tunable Filter")',
    }


def token():
    """The ADS token, from the environment or the file the other tools use.

    The environment comes first so CI can supply it as a secret without a file
    on disk; the file is what makes the script work locally with no setup.
    """
    t = os.environ.get("ADS_TOKEN", "").strip()
    if t:
        return t
    path = pathlib.Path(os.path.expanduser("~/.ads/dev_key"))
    if path.exists():
        return path.read_text().strip()
    print("error: no ADS token. Set ADS_TOKEN or create ~/.ads/dev_key\n"
          "       https://ui.adsabs.harvard.edu/user/settings/token", file=sys.stderr)
    sys.exit(2)


def get(path, tok, **params):
    url = f"{API}/{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        # Never echo the token, and ADS does not put it in the body anyway.
        print(f"error: ADS returned {e.code} for {path}: {detail}", file=sys.stderr)
        raise


def search_all(q, tok, fl, sort="date desc"):
    out, start = [], 0
    while True:
        r = get("search/query", tok, q=q, fl=fl, rows=2000, start=start, sort=sort)["response"]
        out += r["docs"]
        start += len(r["docs"])
        if start >= r["numFound"] or not r["docs"]:
            return out


# -----------------------------------------------------------------------
# citations
# -----------------------------------------------------------------------

def refresh_citations(db, tok, chunk=40):
    """Ask ADS for the current count of every bibcode already in the list."""
    codes = [p["bibcode"] for p in db["papers"]]
    found = {}

    for i in range(0, len(codes), chunk):
        part = codes[i:i + chunk]
        q = " OR ".join(f'bibcode:"{c}"' for c in part)
        for d in search_all(q, tok, fl="bibcode,citation_count", sort="bibcode asc"):
            if d.get("citation_count") is not None:
                found[d["bibcode"]] = int(d["citation_count"])

    moved, missing = [], []
    for p in db["papers"]:
        new = found.get(p["bibcode"])
        if new is None:
            missing.append(p["bibcode"])
            continue
        if new != p["citations"]:
            moved.append((p["bibcode"], p["citations"], new))
            p["citations"] = new

    # Everything derived from a count has to move with it, or the headline
    # figure and the chart quietly disagree with the list underneath them.
    db["counts"]["citations"] = sum(p["citations"] for p in db["papers"])
    for row in db["by_year"]:
        row["citations"] = sum(p["citations"] for p in db["papers"]
                               if p["year"] == row["year"])

    db["citations_as_of"] = dt.date.today().isoformat()
    return moved, missing


# -----------------------------------------------------------------------
# discovery
# -----------------------------------------------------------------------

def discover(db, tok, from_year):
    """Find refereed papers naming DKIST that are in neither the list nor the queue."""
    known = {p["bibcode"] for p in db["papers"]}

    # Papers dkist-bib has already read and decided against. They are not
    # candidates; offering them again every month would bury the two or three
    # that are genuinely new under eight hundred that are not.
    screened = set()
    screened_file = PUBS.parent / "publications_screened.json"
    if screened_file.exists():
        screened = set(json.loads(screened_file.read_text())["bibcodes"])
    else:
        print("  WARNING: no screening baseline; every unlisted paper in the "
              "pool will be reported", file=sys.stderr)

    queue = {"schema_version": "1.0", "candidates": []}
    if QUEUE.exists():
        queue = json.loads(QUEUE.read_text())
    queued = {c["bibcode"] for c in queue["candidates"]}

    fl = "bibcode,title,year,first_author,pub,citation_count,doctype"
    pool = {}
    for name, q in queries(from_year).items():
        docs = search_all(q, tok, fl=fl)
        print(f"  {name:8s} {len(docs)} refereed papers")
        for d in docs:
            pool.setdefault(d["bibcode"], d).setdefault("hits", []).append(name)

    today = dt.date.today().isoformat()
    fresh = []
    for code, d in pool.items():
        if code in known or code in queued or code in screened:
            continue
        fresh.append({
            "bibcode": code,
            "title": (d.get("title") or [""])[0],
            "year": d.get("year", ""),
            "first_author": d.get("first_author", ""),
            "pub": d.get("pub", ""),
            "citation_count": d.get("citation_count", 0),
            "hits": d["hits"],
            "first_seen": today,
        })

    fresh.sort(key=lambda c: (-int(c["year"] or 0), c["first_author"]))
    queue["candidates"].extend(fresh)          # append; never prune
    queue["updated"] = today
    queue["screened_pool"] = len(pool)
    queue["note"] = (
        "Refereed papers whose full text or acknowledgments name DKIST, which are "
        "not yet in data/dkist_publications.json. Mentioning DKIST is not using its "
        "data: each of these needs reading before it is added. The curated decision "
        "belongs in dkist-bib/manifest.py, not here. Entries are appended and never "
        "removed automatically — delete one by hand once it has been judged."
    )
    return queue, fresh, len(pool)


# -----------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--discover", action="store_true",
                    help="also look for refereed papers not yet in the list")
    ap.add_argument("--from-year", type=int, default=2020,
                    help="earliest year to screen for new papers (default 2020)")
    ap.add_argument("--pubs", default=str(PUBS))
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change and write nothing")
    args = ap.parse_args()

    pubs_path = pathlib.Path(args.pubs)
    if not pubs_path.exists():
        print(f"error: {pubs_path} not found — run tools/build_publications.py first",
              file=sys.stderr)
        return 2

    db = json.loads(pubs_path.read_text())
    tok = token()
    before = db["counts"]["citations"]

    print(f"refreshing {len(db['papers'])} papers against ADS")
    moved, missing = refresh_citations(db, tok)

    for code, old, new in sorted(moved, key=lambda m: m[2] - m[1], reverse=True)[:12]:
        print(f"    {code}  {old} -> {new}  ({new - old:+d})")
    if len(moved) > 12:
        print(f"    ... and {len(moved) - 12} more")
    print(f"  {len(moved)} counts moved; total {before} -> {db['counts']['citations']} "
          f"({db['counts']['citations'] - before:+d})")
    if missing:
        print(f"  WARNING: ADS returned no count for {len(missing)}: "
              f"{', '.join(missing[:4])}", file=sys.stderr)

    queue = fresh = None
    if args.discover:
        print("screening for papers not yet in the list")
        queue, fresh, pool = discover(db, tok, args.from_year)
        print(f"  pool {pool}; {len(fresh)} new candidates for review")
        for c in fresh[:8]:
            print(f"    {c['bibcode']}  {c['year']}  {c['first_author']}  {c['title'][:52]}")
        if len(fresh) > 8:
            print(f"    ... and {len(fresh) - 8} more")

    if args.dry_run:
        print("dry run — nothing written")
        return 0

    db["refreshed_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pubs_path.write_text(json.dumps(db, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {pubs_path}")

    if queue is not None:
        QUEUE.write_text(json.dumps(queue, indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {QUEUE} ({len(queue['candidates'])} awaiting review)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
