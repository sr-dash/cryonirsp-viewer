# Cryo-NIRSP inventory contract

The site reads exactly one data file — `data/cryonirsp_dataset_details.json` — and renders the whole
archive from it. This document is the contract that file must satisfy. It exists so that regenerating
the inventory is a routine swap rather than a careful one-off.

Machine-readable version: [`inventory.schema.json`](inventory.schema.json).
Checker: `python3 tools/validate_inventory.py data/cryonirsp_dataset_details.json`.

**This file is generated, not hand-edited.** The upstream generator
(`CryoNIRSP-Datasets/cryonirsp_inventory.json`) is product-centric, deeply nested, ~8 MB, and
contains bare `NaN` literals that `JSON.parse` rejects outright. `tools/build_site_inventory.py`
transforms it into the flat, valid, minified shape described here:

```bash
python3 tools/build_site_inventory.py \
    ~/NSO/Work/GIT-Projects/CryoNIRSP-Datasets/cryonirsp_inventory.json \
    -o data/cryonirsp_dataset_details.json
```

One site record per **product**, representing that product's **active** dataset. This is the change
that matters most: the data centre now issues a stable Product ID plus a Dataset ID that changes on
every recalibration, so a dataset ID is no longer a durable identifier.

---

## 1. Envelope

Two shapes are accepted. Prefer the first for anything new.

```jsonc
// Preferred — the wrapper carries provenance and the alias index
{
  "schema_version": "1.0",
  "generated_at": "2026-08-28T22:41:29Z",
  "source": "cryonirsp_inventory 1.0.0 (1002 products) via tools/build_site_inventory.py",
  "dataset_aliases": { "PQLYUM": "SMPJNK", ... },   // superseded id -> current id
  "datasets":        { "SMPJNK": { /* record */ }, ... }
}
```

`dataset_aliases` maps every superseded dataset ID to the dataset that replaced it. Today that is
1692 old IDs across 918 products — including all 793 IDs the previous version of this site
published, so no existing link or citation goes dead. `resolveDataset()` in `js/adapt.js` consults
it, and the deep links `?dataset=`, `?product=` and `#ID` all route through that. An alias must
never collide with a live dataset ID; the validator errors if one does.

```jsonc
// Legacy — a bare map, still loads
{ "PQLYUM": { /* record */ }, ... }
```

The map is keyed by `dataset_id`, and **the key must equal the record's own `dataset_id`**. The site
uses both interchangeably.

`generated_at` matters: without it the "Last updated" line on the landing page falls back to the
HTTP `Last-Modified` header, which on GitHub Pages tracks deploys rather than the inventory build, so
a CSS-only commit advances the archive's stated freshness.

---

## 2. Field tiers

Every field is one of three tiers. The tier says what happens when the field changes, not how
important the science is.

### Tier A — renaming or retyping breaks the page

Nine fields. A failure here is not an empty card: it collapses the tree into one
`UNKNOWN_PROGRAM` node, zeroes every counter, or throws mid-render and leaves the detail panel blank.
All are required and non-null.

| Field | Type | Drives |
|---|---|---|
| `dataset_id` | string | Map key, tree label, search |
| `observingProgramExecutionId` | string | Top tree level |
| `product_id` | string | Second tree level, DKIST Data Center deep link |
| `dataset_type` | `"polarimetric"` \| `"spectrometric"` | Counters, type filter, badge CSS class |
| `is_context_imager` | boolean | CONTEXT counter and filter |
| `start_time` | timestamp | Sort key, tree date, search text, detail header |
| `end_time` | timestamp | Detail header |
| `waveband` | string | Product subtitle, tree row, search, detail card |
| `metadata_file` | string | Detail card (basename only) |

**`dataset_type` is a closed set.** Adding a third value is a site change, not a data change — the
counters filter on these two literals and the value is also interpolated as a CSS class name.

**The numeric fields must be JSON numbers, not numeric strings.** `"0.4711"` where `0.4711` is
expected used to throw mid-template and blank the panel. The adapter now coerces, but the validator
still flags it — the coercion is a safety net, not a licence.

### Tier A′ — geometry, required only once enriched

`solar_radius_arcsec`, `stepWidth_arcsec`, `slitSampling_arcsec`, `spatial_bounds_arcsec`.

These were tier A when every record carried them. Under the new generator they are **conditional**,
for two independent reasons, and the site guards all four so absence degrades to "N/A" or an empty
footprint panel rather than breaking:

- **Enrichment lags.** Geometry comes from reading each ASDF metadata file, a pass that runs after
  the search pass. Mid-run the inventory legitimately has geometry for only part of the archive.
- **The CI arm has no slit.** `slitSampling_arcsec` is absent for all 454 context-imager products by
  physics, not by omission, and `stepWidth_arcsec` for 130 that do not raster.

**When present**, the rules still hold: numbers must be JSON numbers, and `spatial_bounds_arcsec`
must be two parallel arrays of equal length forming a closed ring. The validator errors on a
malformed value and only warns on an absent one.

### Tier B — missing is fine, the UI shows N/A

Fifteen fields, every one with a fallback. Rename or drop them and the page keeps rendering; it just
gets quieter.

`collection_id`, `instrument`, `instrument_name`, `observatory`, `observer`, `object`, `line_wave`,
`duration_seconds`, `dataset_shape`, `n_scanSteps`, `n_measAtStep`, `inactive_dataset_ids`,
`context_image`, `context_movie`, `context_movie_thumbnail`.

Nullable in practice today: the three media fields (18 records) and `inactive_dataset_ids` (11).

### Tier C — shipped but not read

Keep them if they cost nothing; they are candidates for other consumers. Two sub-groups matter:

- **Keep and prefer:** `duration_seconds`, `dataset_shape`, `n_stokes`, `n_alongSlit`,
  `n_wavelength`, `date_avg`. These are the structured forms of data the page used to read only as
  pre-formatted strings.
- **Drop from the published copy:** `dataset_path`, `spatial_npz`, `context_image_path`,
  `context_movie_path`, `context_movie_thumbnail_path`. Absolute paths on the generating host. They
  publish the internal layout `/data/sdash/CRYONIRSP-L1/…` to the open web and account for roughly
  340 KB of the payload. The validator warns on these.

---

## 3. Timestamps

**Emit RFC 3339 with an explicit `Z`:** `2022-10-19T19:22:18.319500Z`.

The current file uses `"2022-10-19 19:22:18.319500"` for `start_time` / `end_time` — space-separated,
no offset — while `date_avg` in the same record is proper ISO. JavaScript's `new Date()` reads the
naive form as **local** time, so the detail panel printed a time labelled "UTC" that was off by the
reader's offset, and the tree date (a plain string slice) could disagree with the search index by a
day. For a reader in Boulder or on Haleakalā — the two places most likely to use this site — that is
a wrong date, not a cosmetic one.

The adapter normalises naive timestamps by appending `Z`, **interpreting them as UTC**. That
assumption is correct for DKIST metadata but it is an assumption; the validator warns whenever it has
to make it. Emitting the `Z` yourself removes the guess.

**Display format.** Times render as `2022-10-19 19:22:18 UTC`, with day-of-year as a muted
secondary (`DOY 292`). The original site rendered year-day-of-year as the primary form
(`2022-292 19:22:18 UTC`) — a real solar-physics convention, but one that reads as a malformed date.
`utcStamp()` and `dayOfYear()` in `js/utils.js` are the only two places this is decided.

---

## 4. Display strings belong to the page, not the data

`duration` (`"12m 6s"`), `dataset_shape_str` (`"1 × 401 × 1 × 1865 × 904"`) and the numeric half of
`waveband` were formatted by the generator. That put presentation in the data layer: a cosmetic
change on the generator side — `"726s"`, an ASCII `x` separator, a different waveband label — changed
the website with no code review.

The site now derives these itself:

| Prefer | Falls back to | Format produced |
|---|---|---|
| `duration_seconds` | `duration` | `1h 4m 12s`, `12m 6s`, `7s` (seconds truncated) |
| `dataset_shape` | `dataset_shape_str` | `1 × 401 × 1 × 1865 × 904` (U+00D7, spaced) |
| `waveband_key` | derived from `waveband` + `line_wave` | filter key, e.g. `fexiii_1074` |

Send both forms during the transition. Once the structured field is present everywhere, the string
becomes tier C.

`waveband_key` is supplied by the generator as `classification.fit_line` where one exists
(`fexiii_1074`, `fexiii_1079`, `six_1430`); the build step derives it from
`classification.primary_line` otherwise, which covers the 455 He I products that have no fit line.

---

## 5. Context media

The generator carries **no media fields at all** — the linkage is by observation date. The build step
derives `daily_context_YYYYMMDD.jpg` / `cn_daily_movie_YYYYMMDD.mp4` / `cn_daily_movie_YYYYMMDD.jpg`
from `start_time`, and **only emits a filename when that file actually exists locally**. The
published inventory therefore cannot reference a movie that is not there — the dangling-media class
of bug is designed out rather than validated against.

The record carries **bare filenames**; the site resolves them.

| Field | Resolved against |
|---|---|
| `context_image` | `MEDIA.imageBase` |
| `context_movie` | `MEDIA.movieBase` |
| `context_movie_thumbnail` | `MEDIA.movieBase` |

Both bases are defined once, at the top of [`../js/adapt.js`](../js/adapt.js). A value that already
starts with `http://`, `https://` or `/` is passed through untouched, so the inventory can override
per-record if it ever needs to.

**All media is served from one GitHub release** on `sr-dash/cryonirsp-media`, pinned by
`RELEASE_TAG` in [`../js/adapt.js`](../js/adapt.js). Nothing media-related is committed to this
repo: the movies are 2.5 GB, and the figures alone grow ~8 MB a year with git keeping every
regenerated version forever. `share.nso.edu` is the upstream **source**, not the serving host — it
is not reliably available.

The three filename families share one namespace without colliding:

| Family | Example | Count |
|---|---|---|
| context figure | `daily_context_20260813.jpg` | 84 |
| movie | `cn_daily_movie_20260813.mp4` | 84 |
| movie poster | `cn_daily_movie_20260813.jpg` | 84 |

**The release tag is a maintenance obligation.** A tag that does not contain a given date's file
renders a broken image or an empty player, with no error anywhere. `media-v1` is exactly that
failure: it predates every 2026 date and holds the pre-regeneration versions of the older ones.
When media is added:

```bash
gh release create media-vN \
    cn_daily_context_figures/*.jpg cn_daily_movies/* \
    --repo sr-dash/cryonirsp-media \
    --title "Cryo-NIRSP daily context media"
```

then bump `RELEASE_TAG`. CI reads the tag straight out of `adapt.js`, lists the release's real
assets, and fails the build if the published inventory references anything the release does not
contain.

Both media directories are kept locally and gitignored — `tools/build_site_inventory.py` uses them
as the existence oracle when deciding whether to emit a media filename, so a file that is not there
never reaches the published inventory in the first place.

Today: 84 dates have media, 88 dates have observations, 20 records carry null media (4 dates). Null
is handled correctly and is the right value for "no media" — an empty string is not.

---

## 6. Free text and escaping

Every value reaches the DOM through `innerHTML`. Machine-generated identifiers are safe; free text is
not. If the inventory grows a proposal title, an observer note, or an experiment description, an `&`
or a `<` corrupts the markup and anything operator-typed becomes an injection path on a public site.

That field now exists. `experiment_description` is operator-authored prose, present on all 1002
records (43 distinct texts, 325–1724 characters). `js/utils.js` provides `esc()`, `escAttr()` and
`escURL()`, and every interpolation in `details.js` and `tree.js` routes through them.

Of the 43 current descriptions, four contain `<` and one contains `&`. None corrupts the markup
today — every `<` happens to be followed by a digit (`<1`, `<10 mHz`), which the HTML parser treats
as literal text. The escaping is a guard against the next description, not a fix for a live break.

Adding a further free-text field is still a **coordinated change**: confirm it renders through
`esc()` before shipping it.

---

## 7. Scale

At 793 records / 2.6 MB pretty-printed (1.8 MB minified, 323 KB gzipped) the single-file approach is
fine. Around 3–5× that, split into a light index for the tree — `dataset_id`, program, product, date,
type, waveband, roughly 10% of the bytes — and fetch per-dataset detail on click.

Publish minified. The pretty copy is for humans and diffs, not for visitors.

---

## 8. Changing this contract

- **Tier B or C change** — bump `schema_version` minor. No site change needed.
- **Tier A change** (rename, retype, new `dataset_type` value, new required field) — bump major,
  update `inventory.schema.json`, update the mapping in `js/adapt.js`, and update this file. The
  adapter is the only place that should need editing; if a tier-A change forces edits in
  `details.js`, `tree.js` or `stats.js`, the adapter is not doing its job.
- Adding a **free-text** field — see §6 first.

The CI workflow (`.github/workflows/validate-inventory.yml`) enforces §1–§5 on every push and pull
request touching `data/`.
