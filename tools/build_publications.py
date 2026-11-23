#!/usr/bin/env python3
r"""Build the publications page's data file from the dkist-bib outputs.

    python3 tools/build_publications.py ~/NSO/03-Projects/code/dkist-bib \
        -o data/dkist_publications.json

dkist-bib is the curated record: which refereed papers actually analyse DKIST
data, which instrument each used, and which dataset IDs they cite. That
curation is a human judgement and stays there. This script only flattens its
outputs into one file the browser can read, the same division of labour as
tools/build_site_inventory.py and the inventory generator.

Three inputs, because each knows something the others do not:

    bib/all_dkist_data.bib   canonical BibTeX from ADS's own exporter, which
                             is what the page hands out for citation
    bib/publications.csv     the curation: group, instruments, usage note,
                             the dataset IDs a paper cites
    bib/meta.json            ADS metadata, and the authoritative citation
                             counts as of the last refresh

Joining the first two needs care: BibTeX keys cannot carry an ampersand, so
ADS's exporter writes 2025A&A...701A..77B as 2025AA...701A..77B. Four of the
sixty-three entries differ from their bibcode that way, and matching on the
raw string silently drops them.
"""

import argparse
import csv
import datetime as dt
import json
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bibparse  # noqa: E402  (vendored; see its docstring)

# The bibstem badge the CSV carries is the right length for a chip. These are
# only for the full name shown on hover, and cover the venues DKIST work
# actually appears in — adding one is harmless, missing one just means the
# badge stands alone.
VENUE_FULL = {
    "A&A": "Astronomy & Astrophysics",
    "AN": "Astronomische Nachrichten",
    "ApJ": "The Astrophysical Journal",
    "ApJL": "The Astrophysical Journal Letters",
    "FrASS": "Frontiers in Astronomy and Space Sciences",
    "JATIS": "Journal of Astronomical Telescopes, Instruments, and Systems",
    "MNRAS": "Monthly Notices of the Royal Astronomical Society",
    "NatAs": "Nature Astronomy",
    "NatCo": "Nature Communications",
    "Natur": "Nature",
    "SciA": "Science Advances",
    "SoPh": "Solar Physics",
}

# Cryo-NIRSP first: this is its archive, and a reader who came here for it
# should not have to hunt past four other instruments to find its papers.
# The rest follow by paper count, which is a fact rather than a preference.
INSTRUMENT_FIRST = "Cryo-NIRSP"


def bib_key(bibcode):
    """The BibTeX key ADS writes for a bibcode.

    Ampersands are not legal in a citation key, so the exporter drops them.
    Nothing else about the bibcode changes.
    """
    return bibcode.replace("&", "")


def split_list(value):
    return [v.strip() for v in (value or "").split(";") if v.strip()]


def as_int(value, default=0):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def load_bibtex(path):
    """Map bib key -> the raw BibTeX entry text, kept exactly as ADS wrote it.

    The page offers this for download and for the clipboard, so it must stay
    byte-for-byte what a reference manager expects. The parsed form is used
    only for the fields the CSV does not carry.
    """
    text = path.read_text()
    raw = {}
    # Split on entry starts while keeping them, so each chunk is one entry.
    parts = re.split(r"(?m)^(?=@[A-Za-z]+\{)", text)
    for chunk in parts:
        chunk = chunk.strip()
        if not chunk.startswith("@"):
            continue
        m = re.match(r"@[A-Za-z]+\{([^,]+),", chunk)
        if m:
            raw[m.group(1).strip()] = chunk
    return raw, {e["key"]: e for e in bibparse.parse_bib(text)}


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bib_dir", help="the dkist-bib checkout")
    ap.add_argument("-o", "--out", default="data/dkist_publications.json")
    ap.add_argument("--inventory", default="data/cryonirsp_dataset_details.json",
                    help="the site inventory, used to work out which of the "
                         "dataset IDs a paper cites can actually be opened here")
    ap.add_argument("--check-against", metavar="FILE",
                    help="compare against an existing file, ignoring the build "
                         "stamp, and exit non-zero if the content differs")
    args = ap.parse_args()

    root = pathlib.Path(os.path.expanduser(args.bib_dir))
    bib_file = root / "bib" / "all_dkist_data.bib"
    csv_file = root / "bib" / "publications.csv"
    meta_file = root / "bib" / "meta.json"

    for f in (bib_file, csv_file, meta_file):
        if not f.exists():
            print(f"error: {f} not found — is {root} the dkist-bib directory?",
                  file=sys.stderr)
            return 2

    raw_bibtex, parsed = load_bibtex(bib_file)
    meta = json.loads(meta_file.read_text())
    rows = list(csv.DictReader(csv_file.open()))

    # Most of the dataset IDs these papers cite belong to ViSP and VBI, which
    # this archive does not hold: of eighty-three cited IDs, six are ours.
    # Linking all of them would send the reader to a search that finds
    # nothing, so work out here which ones actually open and let the page
    # render the rest as what they are — a fact about the paper, not a link.
    #
    # Three spellings resolve: the current dataset ID, a superseded one the
    # alias index still answers for, and the stable product ID, which is what
    # a careful paper cites precisely because recalibration moves the other.
    resolvable = {}
    inv_path = pathlib.Path(args.inventory)
    if inv_path.exists():
        inv = json.loads(inv_path.read_text())
        for ds in inv.get("datasets", {}):
            resolvable[ds] = "dataset"
        for alias in inv.get("dataset_aliases", {}):
            resolvable.setdefault(alias, "dataset")
        for rec in inv.get("datasets", {}).values():
            pid = rec.get("product_id")
            if pid:
                resolvable.setdefault(pid, "product")
    else:
        print(f"warning: {inv_path} not found — no paper will link into the "
              f"archive", file=sys.stderr)

    papers = []
    missing_bibtex = []

    for r in rows:
        bibcode = r["bibcode"].strip()
        key = bib_key(bibcode)
        entry = parsed.get(key, {})
        m = meta.get(bibcode, {})

        if key not in raw_bibtex:
            missing_bibtex.append(bibcode)

        # Citation counts: meta.json is the ADS record and the CSV was built
        # from it, so they agree — but meta.json is the one a refresh updates,
        # so prefer it and let the CSV stand in if a paper is not in it yet.
        citations = as_int(m.get("citation_count"), as_int(r.get("citations")))

        journal = (r.get("journal") or "").strip()
        ids_cited = split_list(r.get("ids_cited_in_paper"))

        papers.append({
            "bibcode": bibcode,
            "year": as_int(r.get("year")),
            "first_author": (r.get("first_author") or m.get("first_author") or "").strip(),
            "authors": entry.get("authors", []),
            "n_authors": as_int(r.get("n_authors"), m.get("author_count") or 0),
            "title": (entry.get("title") or "").strip()
                     or " ".join(m.get("title") or []).strip(),
            "journal": journal,
            "journal_full": VENUE_FULL.get(journal, ""),
            # Volume and pages only matter for the plain-text citation the page
            # offers beside the BibTeX. ADS does not always supply both.
            "volume": (entry.get("volume") or "").strip(),
            "pages": (entry.get("pages") or "").strip(),
            "citations": citations,
            "doi": (r.get("doi") or "").split(";")[0].strip(),
            "group": (r.get("group") or "").strip(),
            "instruments": split_list(r.get("instruments")),
            "usage": (r.get("usage") or "").strip(),
            "ids_cited": ids_cited,
            # {id: "dataset"|"product"} for the ones this archive can open.
            "ids_resolved": {i: resolvable[i] for i in ids_cited if i in resolvable},
            "products_high": as_int(r.get("products_high")),
            "products_medium": as_int(r.get("products_medium")),
            "products_low": as_int(r.get("products_low")),
            "bibtex": raw_bibtex.get(key, ""),
        })

    papers.sort(key=lambda p: (-p["year"], -p["citations"], p["first_author"]))

    # ---- instrument facet ----
    counts = {}
    for p in papers:
        for ins in p["instruments"]:
            counts[ins] = counts.get(ins, 0) + 1
    order = sorted(counts, key=lambda i: (i != INSTRUMENT_FIRST, -counts[i], i))
    instruments = [{"name": i, "n": counts[i]} for i in order]

    # ---- yearly series ----
    # Refereed papers per year, split by what the paper is: one that analyses
    # DKIST data, or one describing the telescope and its instruments. Both
    # are DKIST publications; conflating them would overstate the science
    # output, and dropping the instrument papers would understate the effort.
    years = sorted({p["year"] for p in papers if p["year"]})
    by_year, running = [], 0
    for y in range(years[0], years[-1] + 1) if years else []:
        ofy = [p for p in papers if p["year"] == y]
        running += len(ofy)
        by_year.append({
            "year": y,
            "data": sum(1 for p in ofy if p["group"] == "data"),
            "instrument": sum(1 for p in ofy if p["group"] == "instrument"),
            "total": len(ofy),
            "cumulative": running,
            "citations": sum(p["citations"] for p in ofy),
        })

    # The citation counts are only as fresh as the last ADS refresh, and a
    # citation count with no date on it invites the reader to assume it is
    # current. dkist-bib stamps that; fall back to the file's own mtime.
    stamp_file = root / "bib" / "meta.json"
    citations_as_of = dt.datetime.fromtimestamp(
        stamp_file.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%d")

    payload = {
        "schema_version": "1.0",
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "citations_as_of": citations_as_of,
        "source": f"dkist-bib ({len(rows)} curated papers) via tools/build_publications.py",
        "counts": {
            "total": len(papers),
            "data": sum(1 for p in papers if p["group"] == "data"),
            "instrument": sum(1 for p in papers if p["group"] == "instrument"),
            "citations": sum(p["citations"] for p in papers),
            "citing_dataset_ids": sum(1 for p in papers if p["ids_cited"]),
            # Papers with at least one ID this archive can actually open —
            # a much smaller number, and the only honest one to advertise.
            "linking_here": sum(1 for p in papers if p["ids_resolved"]),
        },
        "instruments": instruments,
        "by_year": by_year,
        "papers": papers,
    }

    if args.check_against:
        def body(obj):
            return {k: v for k, v in obj.items()
                    if k not in ("generated_at", "source")}
        try:
            existing = json.loads(pathlib.Path(args.check_against).read_text())
        except (OSError, json.JSONDecodeError) as exc:
            print(f"error: cannot read {args.check_against}: {exc}", file=sys.stderr)
            return 2
        if body(existing) != body(payload):
            print(f"{args.check_against} is out of date", file=sys.stderr)
            return 1
        print(f"{args.check_against} is current ({len(papers)} papers)")
        return 0

    out = pathlib.Path(args.out)
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")

    c = payload["counts"]
    print(f"wrote {out}")
    print(f"  papers          {c['total']}  ({c['data']} data, {c['instrument']} instrument)")
    print(f"  citations       {c['citations']}  as of {citations_as_of}")
    print(f"  instruments     " + ", ".join(f"{i['name']} {i['n']}" for i in instruments))
    print(f"  citing data ids {c['citing_dataset_ids']}")
    if missing_bibtex:
        print(f"  WARNING: no BibTeX entry for {len(missing_bibtex)}: "
              f"{', '.join(missing_bibtex[:5])}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
