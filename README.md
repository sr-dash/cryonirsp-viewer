# Cryo-NIRSP Archive — next

The Cryo-NIRSP Level-1 archive browser. A static site — plain ES modules, hand-written CSS, no
build step and no dependencies — deployed to GitHub Pages by copying files.

## Run it

```bash
python3 -m http.server 8801
```

Then open <http://localhost:8801/>. No build step, no dependencies — plain ES modules and static
files, the same deployment shape as `viewer/`.

Useful entry points:

| URL | What it shows |
|---|---|
| `/` | Landing: pointing rose, spectral lines, coverage timeline |
| `/?view=search` | The search page, unfiltered |
| `/?target=prominence&line=fexiii_1074` | A pre-filtered search — every query is a link |
| `/?pa=150-210` | Everything observed on the east limb |
| `/?avail=soon` | The 77 products whose embargo lifts within 90 days |
| `/?dataset=PQLYUM` | A **superseded** dataset ID, resolving to the product that replaced it |

## What changed, and why

The previous front end offered one substring box over a concatenated string, one four-option type
dropdown, and three sort modes. The inventory underneath carries seven dimensions worth faceting on
and a footprint polygon for every record, none of which was reachable.

**Faceted search.** Seven groups, 23 values, all multi-select. Counts are computed against the rest
of the query, so a number tells you what selecting it would actually give you — pick *Prominence*
and the line counts become 56 / 19 / 13 / 6, summing to the 94 prominence records.

**Query by pointing.** 99% of this archive sits at or above the limb — 64% above 1.05 R☉ — and
every record ships a footprint. Drag an arc across the disk to filter by position angle; click the
height histogram to filter by radial distance. The landing page's rose is the same control,
read-only.

**Structured query tokens.** `line:` `target:` `mode:` `stokes:` `available:` `after:` `before:` `pa:` `r>` `r<`,
with a bare-word fallback that searches experiment abstracts — 1,002 records carry one and nothing
searched them before.

**Every query is a URL.** Facets, arcs, date ranges and the open record all round-trip through the
query string, so a result set can go in a paper or an email. Back and forward work.

**Embargo is a date, not a flag.** 157 products are still restricted, lifting on nine distinct dates
between 82 and 290 days out. The page works the state out by comparing that date to *now* rather than
trusting the stored boolean — this is a static site whose inventory can be months old, so a boolean
would keep claiming an embargo that had already expired. When the 45 products dated 2026-11-25 come
free, the page shows them as available with no rebuild. A record whose flag and date disagree is
reported as lapsed rather than silently believed.

**Calibration lineage is visible.** The `Cal` column counts superseded dataset IDs; the detail panel
lists them with status. Any of the 1,692 old IDs resolves to its current product.

**Colour encodes the spectral line** in every view. The two Fe XIII lines are visual siblings —
same ion, the density-ratio pair. The hues are redefined for the light theme so the encoding stays
legible on a pale ground as well as a dark one, and none of the four is the interface accent, so a
swatch never has to compete with a button.

**Light and dark, on NSO's colours.** The palette is taken from nso.edu: their slate blue `#2B3843`,
their page ground `#ECF0F5`, and `#FFCC00` as the action colour. NSO publish only a light theme, so
the dark ramp extends their slate downward rather than inventing a different family — `#2B3843`
itself is the raised surface there.

Gold is a **fill, never text**, which is how NSO use it: on their site it is the CTA button
background with dark type on it, and as a label on a pale ground it fails contrast. `--accent-ink`
is the readable member of the same family, used for links and active labels. Every role in both
themes clears WCAG AA against its own ground. Dark is the default. The toggle in the masthead persists an explicit choice; with
no choice the OS setting decides and the page follows it live. The chosen theme is applied before
first paint, so there is no flash of the wrong one.

### Motion

Native CSS and one 72-line helper — no animation library, so the site still has no
`package.json` and still deploys by copying files. Two entrance keyframes and a shared easing
cover it: results and facets on a query change, histogram bars growing from their baseline, the
rose sweeping out from the disk on the landing page, drawer sections settling behind the panel.

Two rules keep it from becoming noise. Entrances run only when the **result set** changed — paging
with "show more" or opening a record leaves the rows alone, because restaggering something the
reader is already reading is not feedback. And counts are rendered at their final value first and
only then animated over, so when the frame loop is suspended — a hidden tab, or reduced motion —
the number is still right, it just does not count.

Everything is switched off wholesale by `prefers-reduced-motion`, which `js/motion.js` reads from
the same media query as the stylesheet so the two cannot disagree.

### One type rule

Mono was doing the body font's job across the whole UI, which is what made the typography read as
inconsistent. The rule now, applied everywhere:

| Face | Used for |
|---|---|
| Newsreader | page and section titles, the hero |
| Archivo | every label, button, column header, help string |
| JetBrains Mono | data only — identifiers, numbers, dates, coordinates, literal query syntax |

## Data

`data/cryonirsp_dataset_details.json` is generated, never hand-edited. Rebuild it from the upstream
inventory with:

```bash
python3 tools/build_site_inventory.py \
    ~/NSO/Work/GIT-Projects/CryoNIRSP-Datasets/cryonirsp_inventory.json \
    -o data/cryonirsp_dataset_details.json \
    --image-dir cn_daily_context_figures \
    --movie-dir cn_daily_movies
```

The two media directories are the existence oracle: a media filename is only written into the
inventory when the file is actually present, so the site cannot reference a movie that is not there.
They sit alongside this file and are gitignored — media is served from the `media-v2`
release on `sr-dash/cryonirsp-media`, pinned by `RELEASE_TAG` in `js/data.js`.

Validate a candidate inventory against the contract (`data/SCHEMA.md`):

```bash
python3 tools/validate_inventory.py data/cryonirsp_dataset_details.json
```

### Two geometry fields this repo added

The build step now carries `radial_distance` and `position_angle_deg` straight from the generator,
which measures both **to the reference pointing** rather than to the footprint centroid. Deriving
them in the browser instead gave a number about 0.07 R☉ higher, which would have put the same
observation at two different heights depending on which page you were reading. Both the site and the build step use it.

## Layout

```
index.html          shell, masthead, query bar, three-column body
css/tokens.css      palette, type, spectral-line colours
css/app.css         search UI
css/landing.css     landing page
js/data.js          loads the inventory, derives query fields — the only reader of raw records
js/query.js         the query model: predicates, facet counts, URL round-trip, token parsing
js/views.js         all markup, all escaping
js/aside.js         disk picker and histograms
js/landing.js       landing page
js/motion.js        number tweening and the reduced-motion check
js/app.js           state, routing, event wiring
```

Every value reaching the DOM goes through `esc()` — the inventory carries operator-authored
`experiment_description` on all 1,002 records.
