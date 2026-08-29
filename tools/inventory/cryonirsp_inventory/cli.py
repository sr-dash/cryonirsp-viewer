"""Command line interface for building the Cryo-NIRSP dataset inventory."""

from __future__ import annotations

import argparse
import logging
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from .classify import ANALYSIS_TOOL
from .enrich import enrich_from_asdf
from .fetch import DEFAULT_BATCH_SIZE, fetch_metadata
from .inventory import (
    DEFAULT_GROUP_BY,
    DEFAULT_INVENTORY,
    GROUP_BY_KEYS,
    load_inventory,
    save_inventory,
    write_csv,
)
from .search import ALL_STATUSES, build_products, search_cryonirsp
from .tags import (
    DAILY_SUMMARY_URL,
    apply_tags,
    build_day_records,
    fetch_daily_summaries,
    parse_daily_summaries,
)

log = logging.getLogger("cryonirsp_inventory")


def _inventory_path(args) -> Path:
    return Path(args.inventory or Path(args.root) / DEFAULT_INVENTORY)


# --------------------------------------------------------------------------
# search
# --------------------------------------------------------------------------


def cmd_search(args) -> int:
    log.info("querying the DKIST Data Center for %s datasets", ", ".join(args.statuses))

    rows = search_cryonirsp(statuses=tuple(args.statuses))
    log.info("retrieved %d dataset records", len(rows))

    products = build_products(rows)
    log.info("grouped into %d products", len(products))

    path = _inventory_path(args)
    inventory = load_inventory(path)

    # Preserve anything the fetch/enrich stages have already recorded.
    for product_id, product in products.items():
        existing = inventory.products.get(product_id)
        if existing:
            if existing.get("active_dataset_id") == product["active_dataset_id"]:
                product["metadata"] = existing.get("metadata")
                product["structure"] = existing.get("structure")
            else:
                log.info(
                    "product %s was recalibrated: %s -> %s",
                    product_id,
                    existing.get("active_dataset_id"),
                    product["active_dataset_id"],
                )
        inventory.products[product_id] = product

    save_inventory(inventory, path)
    log.info("wrote %s", path)
    _print_summary(inventory)
    return 0


# --------------------------------------------------------------------------
# fetch
# --------------------------------------------------------------------------


def _selected(inventory, args):
    embargoed = None
    if getattr(args, "exclude_embargoed", False):
        embargoed = False
    elif getattr(args, "embargoed_only", False):
        embargoed = True

    return inventory.select(
        arm=args.arm,
        analysis_class=args.analysis_class,
        coronal_forbidden=args.coronal_only or None,
        experiment_id=args.experiment,
        embargoed=embargoed,
        tag=getattr(args, "tag", None),
    )


def cmd_fetch(args) -> int:
    path = _inventory_path(args)
    inventory = load_inventory(path)

    if not len(inventory):
        log.error("inventory %s is empty; run the search stage first", path)
        return 1

    products = _selected(inventory, args)
    if args.limit:
        products = products[: args.limit]

    log.info("fetching metadata for %d of %d products", len(products), len(inventory))

    summary = fetch_metadata(
        products,
        root=args.root,
        batch_size=args.batch_size,
        overwrite=args.overwrite,
        progress=args.progress,
        group_by=args.group_by,
    )

    save_inventory(inventory, path)

    log.info(
        "downloaded %d, already present %d, failed %d",
        summary["downloaded"],
        summary["skipped"],
        summary["failed"],
    )
    for error in summary["errors"][:10]:
        log.error("  %s", error)

    return 1 if summary["failed"] else 0


# --------------------------------------------------------------------------
# enrich
# --------------------------------------------------------------------------


def _enrich_one(job):
    """Worker: ``(product_id, asdf_path, arm) -> (product_id, structure, error)``."""
    product_id, asdf_path, arm = job
    try:
        return product_id, enrich_from_asdf(asdf_path, arm), None
    except Exception as error:  # noqa: BLE001 - reported per dataset
        return product_id, None, f"{type(error).__name__}: {error}"


def cmd_enrich(args) -> int:
    path = _inventory_path(args)
    inventory = load_inventory(path)
    root = Path(args.root)

    jobs = []
    candidates = []
    for product in _selected(inventory, args):
        metadata = product.get("metadata") or {}
        asdf_path = metadata.get("asdf_path")
        if not asdf_path:
            continue
        if product.get("structure") and not args.overwrite:
            continue
        candidates.append(product)

    # --recent re-reads the most recently OBSERVED products rather than the
    # first N the inventory happens to list. That is what you want when
    # exercising the pipeline against a bounded slice: the newest data is
    # where a change in the upstream format will show up first.
    if getattr(args, "recent", None):
        candidates.sort(
            key=lambda p: ((p.get("active") or {}).get("start_time") or ""),
            reverse=True,
        )
        candidates = candidates[: args.recent]

    for product in candidates:
        jobs.append(
            (
                product["product_id"],
                str(root / (product.get("metadata") or {})["asdf_path"]),
                (product.get("classification") or {}).get("arm", "SP"),
            )
        )

    if args.limit:
        jobs = jobs[: args.limit]

    log.info("enriching %d datasets with %d workers", len(jobs), args.jobs)

    done = failed = 0

    if args.jobs <= 1:
        results = (_enrich_one(job) for job in jobs)
        for product_id, structure, error in results:
            done, failed = _record(inventory, product_id, structure, error, done, failed)
    else:
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(_enrich_one, job) for job in jobs]
            for n, future in enumerate(as_completed(futures), start=1):
                product_id, structure, error = future.result()
                done, failed = _record(inventory, product_id, structure, error, done, failed)
                if n % 25 == 0:
                    log.info("  %d/%d", n, len(jobs))
                    save_inventory(inventory, path)

    save_inventory(inventory, path)
    log.info("enriched %d datasets, %d failed", done, failed)
    return 1 if failed else 0


def _record(inventory, product_id, structure, error, done, failed):
    if error:
        log.error("%s: %s", product_id, error)
        return done, failed + 1
    inventory.products[product_id]["structure"] = structure
    return done + 1, failed


# --------------------------------------------------------------------------
# tags
# --------------------------------------------------------------------------


def cmd_tags(args) -> int:
    path = _inventory_path(args)
    inventory = load_inventory(path)

    if not len(inventory):
        log.error("inventory %s is empty; run the search stage first", path)
        return 1

    log.info("reading observing-day notes from %s", args.url)
    records = build_day_records(parse_daily_summaries(fetch_daily_summaries(args.url)))
    log.info("parsed %d observing days", len(records))

    if not records:
        log.error("no observing days found on the page")
        return 1

    summary = apply_tags(list(inventory), records, source=args.url)
    save_inventory(inventory, path)

    log.info(
        "tagged %d products across %d observing days (%d carry notes)",
        summary["products"],
        summary["days_matched"],
        summary["annotated"],
    )
    if summary["days_unmatched"]:
        log.warning(
            "%d day(s) on the page have no dataset in the inventory: %s",
            len(summary["days_unmatched"]),
            ", ".join(summary["days_unmatched"][:10]),
        )

    _print_tag_summary(inventory)
    return 0


def _print_tag_summary(inventory, products=None) -> None:
    from collections import Counter

    products = list(inventory) if products is None else list(products)
    tagged = [p for p in products if (p.get("observing_day") or {}).get("tag_names")]

    counts = Counter()
    categories = Counter()
    for product in products:
        day = product.get("observing_day") or {}
        for entry in day.get("tags") or []:
            counts[entry["tag"]] += 1
            categories[entry["category"]] += 1

    print()
    print(f"  Observing-day tags: {len(tagged)} of {len(products)} products tagged")
    if categories:
        print("    by category")
        for category, count in categories.most_common():
            print(f"      {category:26s} {count:5d}")
    if counts:
        print("    by tag")
        for tag, count in counts.most_common():
            print(f"      {tag:26s} {count:5d}")

    issues = [p for p in products if (p.get("observing_day") or {}).get("known_issues")]
    data_issues = [p for p in products if (p.get("observing_day") or {}).get("data_issues")]
    if issues or data_issues:
        print("    flagged problems")
        for label, group in (("known issues", issues), ("data issues", data_issues)):
            if not group:
                continue
            what = Counter(
                note
                for p in group
                for note in (p["observing_day"]["known_issues" if group is issues else "data_issues"])
            )
            for note, count in what.most_common():
                print(f"      {label}: {note} ({count} products)")

    published = [p for p in products if (p.get("observing_day") or {}).get("publications")]
    if published:
        papers = Counter(
            pub["label"]
            for p in published
            for pub in p["observing_day"]["publications"]
        )
        print(f"    used in publications: {len(published)} products")
        for paper, count in papers.most_common():
            print(f"      {paper:26s} {count:5d}")


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------


def _print_summary(inventory, products=None, selection: str = "") -> None:
    from collections import Counter

    products = list(inventory) if products is None else list(products)
    if not products:
        print("no products match" if selection else "inventory is empty")
        return

    def classification(product, key):
        return (product.get("classification") or {}).get(key)

    print()
    print(f"Cryo-NIRSP Level-1 inventory: {len(products)} products{selection}")
    print(f"  generated  : {inventory.generated}")
    print()

    print("  By instrument arm")
    for arm, count in sorted(Counter(classification(p, "arm") for p in products).items()):
        label = {"CI": "Context Imager", "SP": "Spectrograph"}.get(arm, str(arm))
        print(f"    {str(arm):8s} {count:5d}   {label}")

    print()
    print("  By observing mode")
    for mode, count in sorted(
        Counter(classification(p, "observing_mode") for p in products).items()
    ):
        print(f"    {str(mode):32s} {count:5d}")

    print()
    print("  By analysis class")
    for klass, count in sorted(
        Counter(classification(p, "analysis_class") for p in products).items()
    ):
        tool = ANALYSIS_TOOL.get(klass)
        suffix = f"   -> {tool}" if tool else ""
        print(f"    {str(klass):40s} {count:5d}{suffix}")

    print()
    print("  By primary spectral line")
    lines = Counter(
        (classification(p, "primary_line") or {}).get("ion") for p in products
    )
    for ion, count in sorted(lines.items(), key=lambda kv: -kv[1]):
        print(f"    {str(ion):12s} {count:5d}")

    print()
    print("  cn-specfit / cn-polfit fittable line")
    for line, count in sorted(
        Counter(classification(p, "fit_line") for p in products).items(),
        key=lambda kv: -kv[1],
    ):
        print(f"    {str(line):12s} {count:5d}")

    print()
    print("  By access status")
    for status, count in sorted(
        Counter((p.get("access") or {}).get("status") for p in products).items()
    ):
        print(f"    {str(status):12s} {count:5d}")

    embargoed = [p for p in products if ((p.get("access") or {}).get("embargoed"))]
    if embargoed:
        dates = sorted(
            str((p.get("access") or {}).get("embargo_end_date") or "") for p in embargoed
        )
        print(
            f"    {len(embargoed)} product(s) are EMBARGOED: science frames are not "
            "available"
        )
        print(f"    embargo ends between {dates[0][:10]} and {dates[-1][:10]}")
        print("    their metadata is retrievable, but they are not released data")

    if any((p.get("observing_day") or {}).get("tag_names") for p in products):
        _print_tag_summary(inventory, products)

    archived = sum(len(p.get("archived_dataset_ids") or []) for p in products)
    fetched = sum(1 for p in products if (p.get("metadata") or {}).get("asdf_path"))
    enriched = sum(1 for p in products if p.get("structure"))

    print()
    print(f"  Active datasets      : {sum(1 for p in products if p.get('active_dataset_id'))}")
    print(f"  Archived datasets    : {archived}")
    print(f"  Metadata downloaded  : {fetched}")
    print(f"  Enriched             : {enriched}")
    print()


def _selection_label(args) -> str:
    """Describe the active filters, for the summary heading."""
    filters = []
    if args.arm:
        filters.append(f"arm={args.arm}")
    if args.analysis_class:
        filters.append(args.analysis_class)
    if args.coronal_only:
        filters.append("coronal forbidden only")
    if args.experiment:
        filters.append(args.experiment)
    if getattr(args, "exclude_embargoed", False):
        filters.append("released only")
    if getattr(args, "embargoed_only", False):
        filters.append("embargoed only")
    if getattr(args, "tag", None):
        filters.append(f"tag={args.tag}")
    return f"  [{', '.join(filters)}]" if filters else ""


def cmd_report(args) -> int:
    path = _inventory_path(args)
    inventory = load_inventory(path)

    label = _selection_label(args)
    products = _selected(inventory, args) if label else None
    _print_summary(inventory, products, label)

    if args.csv:
        csv_path = write_csv(inventory, args.csv, products)
        log.info(
            "wrote %s (%d products)",
            csv_path,
            len(inventory) if products is None else len(products),
        )

    if args.list:
        products = _selected(inventory, args)
        products.sort(key=lambda p: str((p.get("active") or {}).get("start_time") or ""))
        print(f"{'product':10s} {'dataset':9s} {'experiment':12s} {'arm':4s} "
              f"{'mode':28s} {'line':12s} {'start':20s} {'access':10s}")
        for product in products:
            c = product.get("classification") or {}
            active = product.get("active") or {}
            access = (product.get("access") or {}).get("status") or "unknown"
            print(
                f"{product['product_id']:10s} "
                f"{str(product.get('active_dataset_id')):9s} "
                f"{str(product.get('experiment_id')):12s} "
                f"{str(c.get('arm')):4s} "
                f"{str(c.get('observing_mode')):28s} "
                f"{str(c.get('fit_line') or (c.get('primary_line') or {}).get('ion')):12s} "
                f"{str(active.get('start_time'))[:19]:20s} "
                f"{'EMBARGOED' if access == 'embargoed' else 'released':10s}"
            )
        print(f"\n{len(products)} products")

    return 0


# --------------------------------------------------------------------------
# argument parsing
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cryonirsp-inventory",
        description="Build a Cryo-NIRSP Level-1 dataset inventory from DKIST metadata.",
    )
    parser.add_argument(
        "--root",
        default=".",
        help="dataset root; the metadata tree is written to <root>/Level-1 (default: .)",
    )
    parser.add_argument(
        "--inventory",
        default=None,
        help=f"inventory JSON path (default: <root>/{DEFAULT_INVENTORY})",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")

    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_filters(sub):
        sub.add_argument("--arm", choices=["CI", "SP"], help="only this instrument arm")
        sub.add_argument("--analysis-class", help="only this analysis class")
        sub.add_argument(
            "--coronal-only",
            action="store_true",
            help="only datasets on a coronal forbidden line",
        )
        sub.add_argument("--experiment", help="only this experiment ID")
        embargo = sub.add_mutually_exclusive_group()
        embargo.add_argument(
            "--exclude-embargoed",
            action="store_true",
            help="skip datasets whose science frames are still under embargo",
        )
        embargo.add_argument(
            "--embargoed-only",
            action="store_true",
            help="only datasets still under embargo",
        )
        sub.add_argument(
            "--tag",
            help="only products whose observing day carries this tag "
            "(e.g. coronal_cavity, psp_encounter)",
        )
        sub.add_argument("--limit", type=int, help="stop after this many products")

    search = subparsers.add_parser("search", help="query the data centre and classify")
    search.add_argument(
        "--statuses",
        nargs="+",
        default=list(ALL_STATUSES),
        choices=list(ALL_STATUSES),
        help="dataset statuses to query (default: all three)",
    )
    search.set_defaults(func=cmd_search)

    fetch = subparsers.add_parser("fetch", help="download metadata ASDF files only")
    add_filters(fetch)
    fetch.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    fetch.add_argument("--overwrite", action="store_true", help="re-download existing files")
    fetch.add_argument("--progress", action="store_true", help="show download progress bars")
    fetch.add_argument(
        "--group-by",
        choices=sorted(GROUP_BY_KEYS),
        default=DEFAULT_GROUP_BY,
        help=(
            "top level of the metadata tree (default: experiment). For Cryo-NIRSP "
            "the two currently give the same partition."
        ),
    )
    fetch.set_defaults(func=cmd_fetch)

    enrich = subparsers.add_parser("enrich", help="read local ASDFs for structure/geometry")
    add_filters(enrich)
    enrich.add_argument("--jobs", type=int, default=8, help="parallel workers (default: 8)")
    enrich.add_argument("--overwrite", action="store_true", help="re-enrich existing entries")
    enrich.add_argument("--recent", type=int, metavar="N",
                        help="restrict to the N most recently observed products; with "
                             "--overwrite this re-enriches just that slice, which is how "
                             "to exercise the pipeline without rebuilding the archive")
    enrich.set_defaults(func=cmd_enrich)

    tags = subparsers.add_parser(
        "tags", help="attach observing-day tags from NSO's daily summaries"
    )
    tags.add_argument(
        "--url",
        default=DAILY_SUMMARY_URL,
        help="daily summaries page URL, or a local copy of it",
    )
    tags.set_defaults(func=cmd_tags)

    report = subparsers.add_parser("report", help="summarise the inventory")
    add_filters(report)
    report.add_argument("--csv", help="also write a flat CSV to this path")
    report.add_argument("--list", action="store_true", help="list the selected products")
    report.set_defaults(func=cmd_report)

    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    # The DKIST client chatters about its cached search values on every call.
    logging.getLogger("dkist").setLevel(logging.WARNING)
    logging.getLogger("parfive").setLevel(logging.WARNING)

    for name in (
        "arm",
        "analysis_class",
        "coronal_only",
        "experiment",
        "limit",
        "exclude_embargoed",
        "embargoed_only",
        "tag",
    ):
        if not hasattr(args, name):
            setattr(args, name, None)

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
