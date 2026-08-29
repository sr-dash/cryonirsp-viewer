"""
Download Cryo-NIRSP *metadata* ASDF files -- and nothing else.

``Fido.fetch`` on a DKIST search result downloads only the dataset's metadata
ASDF (a few MB), never the science frames; the frames are a separate Globus
transfer via ``dkist.net.transfer_complete_datasets``.  So this stage is safe
to run over the whole archive.

Files land in the stable product tree::

    <root>/Level-1/<experiment id>/<product id>/<dataset id>/<name>_metadata.asdf
"""

from __future__ import annotations

import logging
from pathlib import Path

from sunpy.net import Fido
from sunpy.net import attrs as a

import dkist.net  # noqa: F401  (registers the DKIST client with Fido)

from .inventory import DEFAULT_GROUP_BY, GROUP_BY_KEYS, dataset_directory, write_sidecar

log = logging.getLogger(__name__)

#: Datasets requested per Fido call.  The search is one HTTP request per
#: batch, so batching keeps the archive-wide run to a sensible request count.
DEFAULT_BATCH_SIZE = 40


def _existing_asdf(directory: Path) -> Path | None:
    """Return an already-downloaded metadata ASDF in ``directory``, if any."""
    if not directory.is_dir():
        return None
    for candidate in sorted(directory.glob("*_metadata.asdf")):
        if candidate.stat().st_size > 0:
            return candidate
    return None


def _record_metadata(product: dict, path: Path, root: Path) -> None:
    """Attach the downloaded metadata file to a product record."""
    product["metadata"] = {
        "asdf_path": str(path.relative_to(root)),
        "asdf_filename": path.name,
        "size_bytes": path.stat().st_size,
        "dataset_id": product.get("active_dataset_id"),
        "product_id": product.get("product_id"),
    }


def fetch_metadata(
    products,
    root: str | Path,
    batch_size: int = DEFAULT_BATCH_SIZE,
    overwrite: bool = False,
    sidecar: bool = True,
    progress: bool = False,
    group_by: str = DEFAULT_GROUP_BY,
) -> dict:
    """
    Download the metadata ASDF of each product's ACTIVE dataset.

    Parameters
    ----------
    products
        Product records from the inventory.
    root
        Dataset root; the tree is written under ``<root>/Level-1``.
    batch_size
        Number of datasets requested per Fido call.
    overwrite
        Re-download files that are already present.
    sidecar
        Also write a ``dataset.json`` describing the product in each
        dataset directory.
    progress
        Show parfive's download progress bars.
    group_by
        Top level of the tree: ``"experiment"`` or ``"proposal"``.

    Returns
    -------
    dict
        Counts of ``downloaded``, ``skipped`` and ``failed`` datasets, plus
        the list of failures.
    """
    root = Path(root)
    summary = {"downloaded": 0, "skipped": 0, "failed": 0, "errors": []}

    pending: list[dict] = []

    for product in products:
        dataset_id = product.get("active_dataset_id")
        if not dataset_id:
            log.warning("product %s has no ACTIVE dataset; skipping", product["product_id"])
            summary["skipped"] += 1
            continue

        # Nothing downstream opens the ASDF of a product that has already
        # been enriched: enrich skips it on the structure block, and the
        # metadata block was recorded when it was first fetched. On a
        # monthly schedule the runner starts with no local tree, so without
        # this the pipeline would re-download the whole archive every month
        # to read none of it.
        if not overwrite and product.get("structure") and product.get("metadata"):
            summary["skipped"] += 1
            summary["already_enriched"] = summary.get("already_enriched", 0) + 1
            continue

        directory = dataset_directory(root, product, group_by=group_by)
        existing = _existing_asdf(directory)

        if existing is not None and not overwrite:
            _record_metadata(product, existing, root)
            if sidecar:
                write_sidecar(product, directory)
            summary["skipped"] += 1
            continue

        pending.append(product)

    log.info(
        "%d datasets to download, %d already present (%d of them already enriched, "
        "so their metadata files are never needed again)",
        len(pending), summary["skipped"], summary.get("already_enriched", 0),
    )

    for start in range(0, len(pending), batch_size):
        batch = pending[start : start + batch_size]
        by_dataset_id = {p["active_dataset_id"]: p for p in batch}

        query = a.dkist.Dataset(batch[0]["active_dataset_id"])
        for product in batch[1:]:
            query = query | a.dkist.Dataset(product["active_dataset_id"])

        results = Fido.search(query)

        # Each dataset directory is unique, so a single templated path
        # routes every file in the batch to the right place.
        group_field = {
            "experiment": "{primary_experiment_id}",
            "proposal": "{primary_proposal_id}",
        }[group_by]
        template = str(
            root / "Level-1" / group_field / "{product_id}" / "{dataset_id}" / "{file}"
        )

        downloaded = Fido.fetch(results, path=template, progress=progress)

        for error in downloaded.errors:
            log.error("download failed: %s", error)
            summary["errors"].append(str(error))

        found = set()
        for filename in downloaded:
            path = Path(filename)
            dataset_id = path.parent.name
            product = by_dataset_id.get(dataset_id)
            if product is None:
                log.warning("downloaded an unexpected dataset: %s", dataset_id)
                continue
            _record_metadata(product, path, root)
            if sidecar:
                write_sidecar(product, path.parent)
            found.add(dataset_id)
            summary["downloaded"] += 1

        missing = set(by_dataset_id) - found
        for dataset_id in missing:
            log.error("no metadata file returned for dataset %s", dataset_id)
            summary["failed"] += 1
            summary["errors"].append(f"no metadata file returned for {dataset_id}")

        log.info(
            "batch %d-%d: %d downloaded, %d failed",
            start + 1,
            start + len(batch),
            len(found),
            len(missing),
        )

    return summary
