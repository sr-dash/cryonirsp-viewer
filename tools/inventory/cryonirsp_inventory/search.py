"""
Query the DKIST Data Center for Cryo-NIRSP datasets and group them by product.

Dataset IDs change every time a dataset is recalibrated; the Product ID does
not.  The inventory is therefore keyed on Product ID, with the single ACTIVE
dataset recorded alongside the DEPRECATED/REMOVED ones it superseded.
"""

from __future__ import annotations

import logging

import astropy.units as u
import numpy as np
from astropy.time import Time
from sunpy.net import Fido
from sunpy.net import attrs as a

import dkist.net  # noqa: F401  (registers the DKIST client with Fido)

from .classify import classify_product

log = logging.getLogger(__name__)

INSTRUMENT = "CRYO-NIRSP"

#: Dataset statuses to query.  ACTIVE is the current calibration of a
#: product; DEPRECATED and REMOVED are its superseded calibrations.
ALL_STATUSES = ("ACTIVE", "DEPRECATED", "REMOVED")

STATUS_ACTIVE = "ACTIVE"

#: Maximum page size the search API accepts.
MAX_PAGE_SIZE = 300


def _normalise(value):
    """Convert an astropy/numpy search result value into a JSON-safe object."""
    if isinstance(value, Time):
        return value.isot if value.isscalar else value.isot.tolist()
    if isinstance(value, u.Quantity):
        magnitude = value.value
        return magnitude.tolist() if hasattr(magnitude, "tolist") else float(magnitude)
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.str_):
        return str(value)
    return value


def _search_status(status: str, extra_attrs=(), page_size: int = MAX_PAGE_SIZE) -> list[dict]:
    """Page through every Cryo-NIRSP dataset with the given status."""
    rows: list[dict] = []
    page = 1
    total = None

    while True:
        # NOTE: the instrument name is matched case-sensitively by the API --
        # a.Instrument("cryo-nirsp") silently returns zero results.
        results = Fido.search(
            a.Instrument(INSTRUMENT),
            a.dkist.Status(status),
            a.dkist.PageSize(page_size),
            a.dkist.Page(page),
            *extra_attrs,
        )
        if not len(results):
            break

        table = results[0]
        if not len(table):
            break

        total = table.total_available_results
        columns = table.colnames
        rows.extend({name: _normalise(row[name]) for name in columns} for row in table)

        log.info("%s: %d/%s datasets", status, len(rows), total)

        if total is None or len(rows) >= total:
            break
        page += 1

    return rows


def search_cryonirsp(
    statuses=ALL_STATUSES,
    extra_attrs=(),
    page_size: int = MAX_PAGE_SIZE,
) -> list[dict]:
    """
    Return every Cryo-NIRSP dataset record for the requested statuses.

    ``a.dkist.Status("any")`` is deliberately *not* used: it expands into an
    OR query whose branches come back as separate result tables, which is
    easy to truncate by accident.  Each status is paged through explicitly.
    """
    rows: list[dict] = []
    for status in statuses:
        rows.extend(_search_status(status, extra_attrs=extra_attrs, page_size=page_size))
    return rows


#: Access status of a product's science frames.
ACCESS_EMBARGOED = "embargoed"
ACCESS_RELEASED = "released"


def access_record(row: dict) -> dict:
    """
    Describe who can currently get at a product's science frames.

    The metadata of an embargoed dataset is served by the data centre like
    any other -- the embargo covers the frames.  That makes it easy to treat
    such a product as public, so the status is recorded explicitly on every
    product rather than left as a flag to be looked up.
    """
    embargoed = bool(row.get("Embargoed"))
    return {
        "status": ACCESS_EMBARGOED if embargoed else ACCESS_RELEASED,
        "embargoed": embargoed,
        "embargo_end_date": row.get("Embargo End Date"),
        "frames_downloadable": bool(row.get("Downloadable")),
        "metadata_available": True,
    }


def _dataset_record(row: dict) -> dict:
    """Reduce a raw search row to the per-dataset fields worth keeping."""
    wavelength = row.get("Wavelength") or [None, None]

    return {
        "dataset_id": row.get("Dataset ID"),
        "status": row.get("Status"),
        "start_time": row.get("Start Time"),
        "end_time": row.get("End Time"),
        "creation_date": row.get("Creation Date"),
        "last_updated": row.get("Last Updated"),
        "calibration_workflow_name": row.get("Calibration Workflow Name"),
        "calibration_workflow_version": row.get("Calibration Workflow Version"),
        "header_specification_version": row.get("Header Specification Version"),
        "summit_software_version": row.get("Summit Software Version"),
        "recipe_run_id": row.get("Recipe Run ID"),
        "dataset_size_gib": row.get("Dataset Size"),
        "number_of_frames": row.get("Number of Frames"),
        "asdf_filename": row.get("asdf Filename"),
        "quality_report_filename": row.get("Quality Report Filename"),
        "preview_url": row.get("Preview URL"),
        "storage_bucket": row.get("Storage Bucket"),
        "embargoed": row.get("Embargoed"),
        "embargo_end_date": row.get("Embargo End Date"),
        "downloadable": row.get("Downloadable"),
        "is_manually_processed": row.get("Is Manually Processed"),
        "wavelength_min_nm": wavelength[0],
        "wavelength_max_nm": wavelength[-1],
        "exposure_time_s": row.get("Exposure Time"),
        "average_fried_parameter": row.get("Average Fried Parameter"),
        "average_polarimetric_accuracy": row.get("Average Polarimetric Accuracy"),
        "average_spatial_sampling_arcsec": row.get("Average Spatial Sampling"),
        "average_spectral_sampling_nm": row.get("Average Spectral Sampling"),
        "average_temporal_sampling_s": row.get("Average Temporal Sampling"),
        "bounding_box": row.get("Bounding Box"),
        "target_types": row.get("Target Types"),
    }


def build_products(rows: list[dict]) -> dict[str, dict]:
    """
    Group raw search rows into product-centric inventory records.

    Each record carries the classification, the ACTIVE dataset, and the
    archived (DEPRECATED/REMOVED) dataset IDs that share the Product ID.
    """
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        product_id = row.get("Product ID")
        if product_id is None:
            log.warning("skipping dataset %s: no Product ID", row.get("Dataset ID"))
            continue
        grouped.setdefault(product_id, []).append(row)

    products: dict[str, dict] = {}

    for product_id, product_rows in sorted(grouped.items()):
        active_rows = [r for r in product_rows if r.get("Status") == STATUS_ACTIVE]
        archived_rows = [r for r in product_rows if r.get("Status") != STATUS_ACTIVE]

        if len(active_rows) > 1:
            log.warning(
                "product %s has %d ACTIVE datasets; using the most recently created",
                product_id,
                len(active_rows),
            )
            active_rows.sort(key=lambda r: str(r.get("Creation Date") or ""))

        # Classification is a property of the product, so take it from the
        # ACTIVE calibration where there is one.
        reference_row = (active_rows or archived_rows)[-1]
        classification = classify_product(reference_row)

        active_row = active_rows[-1] if active_rows else None
        archived_rows.sort(key=lambda r: str(r.get("Creation Date") or ""), reverse=True)

        products[product_id] = {
            "product_id": product_id,
            "instrument": reference_row.get("Instrument"),
            "experiment_id": reference_row.get("Primary Experiment ID"),
            "experiment_ids": reference_row.get("Experiment IDs") or [],
            "proposal_id": reference_row.get("Primary Proposal ID"),
            "proposal_ids": reference_row.get("Proposal IDs") or [],
            "experiment_description": reference_row.get("Experiment Description"),
            "observing_program_execution_id": reference_row.get(
                "Observing Program Execution ID"
            ),
            "instrument_program_execution_id": reference_row.get(
                "Instrument Program Execution ID"
            ),
            "classification": classification,
            "access": access_record(active_row or reference_row),
            "active_dataset_id": active_row.get("Dataset ID") if active_row else None,
            "archived_dataset_ids": [r.get("Dataset ID") for r in archived_rows],
            "n_calibrations": len(product_rows),
            "active": _dataset_record(active_row) if active_row else None,
            "archived": [_dataset_record(r) for r in archived_rows],
            # Filled in by the fetch stage.
            "metadata": None,
            # Filled in by the enrich stage.
            "structure": None,
        }

    return products
