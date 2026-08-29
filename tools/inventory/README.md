# Cryo-NIRSP Level-1 dataset inventory

A metadata-only inventory of every DKIST Cryo-NIRSP Level-1 dataset, built from
the DKIST Data Center search API via sunpy/Fido. It classifies each dataset by
instrument arm and observed line, tracks the stable Product ID alongside the
current and superseded Dataset IDs, and downloads only the metadata ASDF files.

No science frames are transferred at any point.

## Why this replaces the old script

The old `generate_cryo_meta.py` walked a directory of already-downloaded data
and inferred everything from paths and a fixed 5-D array shape. Two things
broke that:

* The data centre now issues a **Product ID** that is stable across
  recalibrations, plus a **Dataset ID** that changes each time a product is
  recalibrated. Path-derived IDs no longer identify anything durable.
* Cryo-NIRSP datasets are not one shape. `DNAXIS` ranges from 3 to 6 across
  eleven distinct axis layouts, and the order differs by arm and by observing
  programme, so `n_wave = NAXIS1, n_along_slit = NAXIS2` is only sometimes
  right. Axis roles are now derived from the `DTYPEn` labels instead of
  assumed.

## Install

Requires `dkist >= 1.17`, `sunpy`, `astropy`, `numpy`. `cn_specfit` is
optional — when it is importable, its line registry is used directly so the
two never drift apart.

## Usage

The four stages are independent and resumable; each reads and rewrites
`cryonirsp_inventory.json`.

```bash
./cryonirsp-inventory search
```

```bash
./cryonirsp-inventory fetch
```

```bash
./cryonirsp-inventory enrich --jobs 8
```

```bash
./cryonirsp-inventory tags
```

```bash
./cryonirsp-inventory report --csv cryonirsp_inventory.csv
```

Every stage accepts `--arm`, `--analysis-class`, `--coronal-only`,
`--experiment`, `--tag`, `--exclude-embargoed` and `--limit`, so you can work
on one class at a time:

```bash
./cryonirsp-inventory fetch --analysis-class coronal_forbidden_spectropolarimetry
```

```bash
./cryonirsp-inventory report --coronal-only --arm SP --list
```

## Directory layout

Metadata lands in a tree keyed on the identifiers that never change, so the
product directory persists across recalibrations and a new dataset directory
appears beneath it each time:

```
CryoNIRSP-Datasets/
├── cryonirsp_inventory.json          # the inventory
├── cryonirsp_inventory.csv           # flat view, one row per product
└── Level-1/
    └── <experiment id>/
        └── <product id>/
            └── <active dataset id>/
                ├── CRYO-NIRSP_L1_<date>_<dataset id>_metadata.asdf
                └── dataset.json      # this product's inventory record
```

## Experiment ID vs Proposal ID

The DKIST data model nests **proposal -> experiment -> product -> dataset**: a
proposal is the accepted observing-time request, an experiment is a group of
observations sharing one scientific goal, and one proposal may hold several
experiments.

For Cryo-NIRSP that last part has not happened yet. Across all 1002 products
there are 45 proposals and 45 experiments in strict 1:1 correspondence, with
matching suffixes throughout (`eid_2_71` <-> `pid_2_71`, zero exceptions) --
including the 36 products with a second contributing programme, where the
experiment and proposal lists move together. **Grouping by experiment and
grouping by proposal therefore produce the identical partition today**; it is
a naming choice, not a structural one.

The tree is keyed on the experiment by default, because the experiment is the
finer level in the data model: if DKIST ever issues several experiments under
one proposal, an experiment-keyed tree subdivides correctly whereas a
proposal-keyed one would silently merge distinct science goals. Note that the
data centre's own object store uses the proposal (`pid_2_71/AJZQZ/...`), so
`--group-by proposal` is available if you want to mirror the archive:

```bash
./cryonirsp-inventory fetch --group-by proposal
```

Both identifiers are recorded on every product (`experiment_id`,
`proposal_id`, plus the full contributing lists), so either grouping can be
reconstructed from the inventory without re-downloading.

## Classification

### Instrument arm

The **calibration workflow name** is the arm marker: `l0_to_l1_cryonirsp_ci`
for the Context Imager, `l0_to_l1_cryonirsp_sp` for the spectrograph. It has
been cross-checked against the `CNARMID` header keyword, against the data
centre's `Has Spectral Axis` flag, and against NSO's published
Products-to-Datasets table (see below); all four agree on every dataset. The
enrichment stage re-checks `CNARMID` and reports
`structure.arm_agrees_with_header`.

The table stops at the arm — `CRYO-NIRSP/SP` covers both spectroscopy and
spectro-polarimetry — so that split is made here from the Stokes parameters
and verified against the Stokes axis of the metadata ASDF.

### Coronal forbidden lines

A line is treated as a coronal forbidden line when its ion appears in the
table in `classify.py`, or — for a line not yet listed — when its ionisation
stage is 8 or higher, which in the Cryo-NIRSP passband only happens for
magnetic-dipole coronal lines. This separates Fe XIII 1074.7/1079.8 nm and
Si X 1430 nm from the He I 1083 nm chromosphere and prominence observations.

### Axis roles

On the **spectrograph** the raster is a second *spatial* axis, so a temporal
axis is read by its position relative to it: before the raster axis it counts
repeated measurements at a slit position, after it it counts repeated maps.
This was checked across the full archive: `n_maps` matches `CNNMAPS`, and the
axis lengths multiply out to the exact frame count on all 1002 datasets.

On the **Context Imager** there is no spatial raster axis (it steps in tandem
with the spectrograph), so two temporal axes are read as (measurement, scan
step), and a single one as the scan/frame axis unless the header reports
repeated measurements.

### Analysis class

Arm, Stokes parameters and line combine into an `analysis_class` that routes a
dataset to a fitting tool:

| analysis_class | tool |
| --- | --- |
| `coronal_forbidden_spectroscopy` | cn-specfit |
| `coronal_forbidden_spectropolarimetry` | cn-polfit |
| `context_imager` | — |
| `other_spectroscopy`, `other_spectropolarimetry` | — (He I 1083 nm) |

`classification.fit_line` additionally names the `cn_specfit.lines`
registry key (`fexiii_1074`, `fexiii_1079`, `six_1430`) whose rest wavelength
falls inside the dataset bandpass, applying the same 0.2 nm edge margin as
`cn_specfit.lines.identify_line`. It can be passed straight to either tool.

## What the enrichment stage adds

Read from the metadata ASDF alone, with no science frames:

* `array_shape`, `axis_labels`, `axis_lengths`, `axis_roles` — the DTYPE
  labels mapped onto roles (`wavelength`, `along_slit`, `scan_step`,
  `measurement`, `map`, `stokes`, `image_x`, `image_y`).
* `axes` — the named counts, including `n_measurements` for programmes that
  repeat observations at each slit position, and `n_maps` for repeated
  rasters. A role with no axis of its own is a degenerate axis and counts 1.
* `axis_counts_consistent` — `n_scan_steps * n_measurements * n_maps *
  n_stokes == n_frames`, an independent check that the axis roles were
  assigned correctly. It holds for all 1002 datasets.
* `is_truncated`, `planned_scan_positions`, `delivered_scan_positions` —
  `CNNUMSCN` records the scan positions the programme *asked for*, which for
  97 datasets exceeds the number actually delivered. Those observations were
  cut short; the metadata is not wrong. Worth knowing before fitting a
  raster that is shorter than the programme intended.
* `geometry` — slit length, sampling and position angle; imager field of view
  and plate scale; median raster step with its spread; the scanned
  field-of-view corner polygon (`spatial_bounds_arcsec`, same corner order as
  `cn_specfit.dataset.Coordinates.spatial_bounds`); and the radial distance of
  the pointing in solar radii.
* `configuration` — modulator, slit, grating, filter, exposure and pointing
  keywords.
* `cn_specfit_shape` (spectrograph only) — the shape cn-specfit would derive
  from the L1 FITS headers, i.e. `(n_stokes, max(CNCURSCN), max(CNCMEAS),
  NAXIS2, NAXIS1)`, with `agrees_with_asdf` flagging where it differs from the
  ASDF axes. It differs for repeated-map programmes, where `CNCURSCN` keeps
  counting across maps instead of restarting.

### Verification

#### Against NSO's Products-to-Datasets table

[`DKIST_Products_to_Datasets_Tables.html`](https://share.nso.edu/shared/dkist/tschad/DKIST_Products_to_Datasets_Tables.html)
publishes the instrument arm, active dataset and inactive dataset IDs per
product. It is an independent source for three of the things the search stage
derives, so the comparison is kept as a script:

```bash
python tools/crosscheck_nso_table.py
```

The two agree completely — same 1002 Cryo-NIRSP products with no product in
one and not the other, and 1002/1002 on each of arm (548 SP / 454 CI), active
dataset ID, the full set of archived dataset IDs, and observing program
execution ID. The SP spectroscopy/spectro-polarimetry split, which the table
does not carry, is consistent with the ASDF Stokes axis on all 548
spectrograph products (212 with `n_stokes = 4`, 336 with `n_stokes = 1`).

#### Against downloaded Level-1 FITS

The ASDF-derived geometry was checked against the Level-1 FITS files of three
fully downloaded datasets (VRWRHK, NMNABO, UGNAYO), computing the same
quantities through `astropy.wcs` from the FITS headers directly. The scanned
field-of-view corner coordinates, slit length, slit sampling, slit position
angle and scan extent agree exactly. The raster step agrees on the median; it
is reported as a median because the step is not perfectly uniform (VRWRHK
varies over 0.458–0.473 arcsec).

## Observing-day tags

The data centre's inventory says nothing about what the Sun was doing or who
else was watching. NSO's
[Cryo-NIRSP Daily Data Summaries](https://share.nso.edu/shared/dkist/tschad/CryoNIRSP_Daily_Data_Summaries.html)
annotates each observing day with exactly that, and the `tags` stage folds it
in:

```bash
./cryonirsp-inventory tags
```

371 of the 1002 products pick up at least one tag:

| category | tags |
| --- | --- |
| `solar_feature` | `coronal_cavity` (134), `cme` (69), `coronal_waves` (48), `coronal_rain` (46), `polar_crown_cavity` (37), `post_flare_loops` (12) |
| `coordinated_observation` | `mlso_kcor_ucomp` (93), `psp_encounter` (88), `solar_orbiter` (61), `vla_radio` (6) |
| `eclipse` | `total_solar_eclipse` (36), `day_after_eclipse` (25) |
| `reference` | `presentation` (87) |

The page's labels are free text and vary in case and wording, so each is
normalised to a stable slug while the original label and any link are kept:

```json
"observing_day": {
  "observing_date_hst": "2024-04-08",
  "tag_names": ["presentation", "total_solar_eclipse"],
  "tags": [
    {
      "tag": "total_solar_eclipse",
      "label": "Total Solar Eclipse in North America",
      "category": "eclipse",
      "url": null
    }
  ],
  "publications": [{"label": "Schad et al. 2024", "url": "https://ui.adsabs..."}],
  "known_issues": [],
  "data_issues": []
}
```

A label that matches no rule still gets a slug derived from its own text and
the category `other`, so a new annotation on the page is searchable rather
than silently dropped.

Filter on a tag at any stage:

```bash
./cryonirsp-inventory report --tag coronal_cavity --analysis-class coronal_forbidden_spectropolarimetry --list
```

```bash
./cryonirsp-inventory report --tag psp_encounter --exclude-embargoed
```

The CSV gains `observing_date_hst`, `tags`, `tag_categories`, `known_issues`,
`data_issues` and `publications` columns, and the tags are written into each
`dataset.json` sidecar.

### Instrument problems

The same page records days when the instrument misbehaved, which is worth
knowing before fitting:

* **Context Imager Readout Unstable** — 66 products (2026-05-25 to 05-28)
* **Context Imager Outage** — 28 products (2026-05-30, 06-08)
* **Field steering mirror timing offset issue** — 8 products (2023-07-07)

68 products are on days with an associated publication (Schad et al. 2024,
Molnar et al. 2026, Morton et al. 2025, Hahn et al. 2025, Wraback et al.
2026).

### Dates are Hawaii time, not UTC

The page's "Observing Calendar Date" is the **Hawaii observing date**.
Cryo-NIRSP observes 17:00–01:00 UTC, so a run that continues past midnight
UTC still belongs to the previous Hawaii day. Mapping on the UTC date instead
would misfile 20 datasets across four dates (2023-10-04, 2024-10-01,
2024-10-08, 2024-10-22), all of them the post-midnight tail of the previous
observing day.

Three independent checks confirm the convention:

* Grouping the inventory by Hawaii date gives 84 distinct dates — exactly the
  84 on the page, a perfect bijection with no date on either side unmatched.
  Grouping by UTC gives 88.
* Every page date's listed experiment IDs match the experiment IDs of the
  datasets on that Hawaii date, 84/84.
* The CME annotation reads "visible in CryoNIRSP near 2023-10-04T00:30 UTC"
  but is filed under **2023-10-03** — the page dating its own event by the
  Hawaii day.

Hawaii does not observe daylight saving, so the offset is a constant UTC-10.

## Embargoed datasets

157 of the 1002 products are still under embargo (release dates from
2026-11-20 to 2027-06-16). Their metadata is retrievable through sunpy like
any other dataset's, so they are kept in the inventory — but they are
**marked as embargoed, not treated as released data**.

Every product carries an explicit `access` block rather than a flag to be
looked up:

```json
"access": {
  "status": "embargoed",
  "embargoed": true,
  "embargo_end_date": "2027-01-30T00:17:33.227000",
  "frames_downloadable": false,
  "metadata_available": true
}
```

`status` is `embargoed` or `released`. It is the second column of the CSV
(`access_status`), it appears in the `report` summary and as an `EMBARGOED`
marker in `report --list`, and it is written into the `dataset.json` sidecar
in each dataset directory, so a file lifted out of the tree still says what
it is.

Their *science frames* are not on disk and were never requested. What is
there for an embargoed product is header metadata only — pointing, timing,
exposure and instrument configuration. There are **no FITS files anywhere
under `Level-1`** (only `.asdf` and `.json`), so no science pixels are
present, embargoed or otherwise. Reading `dataset.data` returns NaN for any
product, embargoed or not, because the frames were never downloaded.

To keep embargoed data out entirely, every stage takes the filter:

```bash
./cryonirsp-inventory fetch --exclude-embargoed
```

```bash
./cryonirsp-inventory report --exclude-embargoed --csv released_only.csv
```

`--embargoed-only` selects the complement, and `report` shows the embargo
count and release-date range. The CSV carries `embargoed` and
`embargo_end_date` per product.

`--exclude-embargoed` narrows the CSV too, not just the console summary.

One caution: the embargo governs the *frames*, but the proposal team's
exclusive-access period is a courtesy matter as well as a technical one. If
you republish this inventory or the CSV, filter to released data first — a
compiled listing is a different thing from a per-dataset lookup, and these
products should not be presented as though they were released.

## Downloading science frames

The inventory only ever fetches metadata. To pull the frames of a selection
afterwards, feed the dataset IDs to the DKIST transfer helper:

```python
import json, dkist.net

products = json.load(open("cryonirsp_inventory.json"))["products"]
ids = [
    p["active_dataset_id"]
    for p in products.values()
    if p["classification"]["analysis_class"] == "coronal_forbidden_spectropolarimetry"
]
dkist.net.transfer_complete_datasets(ids[:1], path="Level-1/{dataset_id}")
```

## Notes on the data centre API

* `a.Instrument("CRYO-NIRSP")` is matched **case-sensitively**;
  `a.Instrument("cryo-nirsp")` silently returns zero results.
* `a.dkist.Status("any")` expands into an OR query whose branches come back as
  *separate result tables*. Taking `results[0]` yields only the ACTIVE
  datasets. Each status is therefore queried and paged separately.
* Page size is capped at 300, so every query is paged.
* Metadata ASDFs are downloadable for embargoed datasets too — the embargo
  covers the science frames, not the metadata.
