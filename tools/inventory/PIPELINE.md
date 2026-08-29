# The monthly pipeline

`.github/workflows/monthly-inventory.yml` rebuilds the archive on the 3rd of
each month and opens a pull request. It never pushes to `main`.

## Why it is cheap

The pipeline is incremental, and that is a property of the code rather than a
convention:

- `fetch.py` skips a product that already carries **both** a `structure` and a
  `metadata` block — nothing downstream will ever open its ASDF again
- `fetch.py` also skips any ASDF already on disk
- `cli.py:161` skips products that already carry a `structure` block

The first of those is what makes a monthly run cheap. A runner starts with no
`Level-1/` tree, so without it every run would re-download the entire 1 GB
archive in order to read none of it. With the state restored, a run with
nothing new to do transfers **zero** metadata files.

Three cases, and the difference between them is only whether the state was
restored:

| | state restored, nothing new | state restored, a month of data | no state at all |
|---|---|---|---|
| search | ~1 min | ~1 min | ~1 min |
| fetch | **0 files** | ~25 MB, <1 min | 1,002 files, 1 GB, ~8 min |
| enrich | nothing to do | ~15 min | does not fit in one run |
| tags, build, validate | <1 min | <1 min | <1 min |
| **total** | **~3 min** | **~20 min** | **several runs** |

**Enrichment on a shared runner is about five times slower than on a
laptop** — roughly 3 products per minute against 15 locally, and the
difference is not just the worker count.

That number only matters for a full rebuild, which is not something this
pipeline should ever do on a schedule. A month brings at most a couple of
hundred new datasets, so the normal run is around an hour at worst and
usually minutes.

Enrichment runs in chunks against a 100 minute budget and uploads state after
every chunk, so no run can overrun and a run that is cut short costs one chunk
rather than everything before it. If the backlog exceeds 200 products the run
says so loudly — either the saved state was lost or something changed upstream
— and still does only what fits, rather than silently attempting five hours of
work.

### Rebuilding on purpose

`workflow_dispatch` takes two knobs:

- **`recent: N`** re-enriches the N most recently observed products. This is
  how to exercise the pipeline against real data without rebuilding anything:
  the newest observations are where an upstream format change shows up first.
  100 takes about half an hour.
- **`rebuild: true`** clears every structure block and starts over. Five hours
  of runner time spread across several runs. Worth doing after a dependency
  bump so the whole archive is read by one set of versions, and not otherwise.

The `inventory-state` release was seeded from a complete, verified local
inventory, so no run has ever had to build the archive from nothing and none
should need to.

## State

Two kinds, and the distinction matters.

**`cryonirsp_inventory.json` is real state** — it is what makes the run
incremental. It lives as a release asset on the `inventory-state` tag, not in
git: at 11 MB it would make every pull request unreviewable, and an
unreviewable PR defeats the reason for opening one.

**`Level-1/` is disposable.** It is only read to enrich a product that has no
structure block yet. Losing it costs time, never correctness.

If the state asset is missing the run rebuilds from scratch and succeeds. That
is the designed fallback, not a failure.

## What stops a bad run reaching the site

Four gates, in order:

1. **JSON.parse** — the generator writes bare `NaN`, which Python accepts and
   browsers reject outright. A single one would empty the archive.
2. **The contract** (`validate_inventory.py`) — schema, types, media
   resolution, and every tier-A rule.
3. **The delta** (`check_delta.py`) — a different question: is this a
   plausible successor to last month? It fails on a shrinking archive, an
   emptied vocabulary, collapsed coverage, or dataset ids that used to
   resolve and no longer would.
4. **A person** — the PR title says outright when the delta check flagged
   something.

Gates 1 and 2 stop the run. Gate 3 does not: it still opens the PR, but
titled so it cannot be merged absent-mindedly.

## Running it by hand

Everything works locally; the workflow only automates it.

```bash
pip install -r tools/inventory/requirements.txt
python3 tools/inventory/cryonirsp-inventory search
python3 tools/inventory/cryonirsp-inventory fetch
python3 tools/inventory/cryonirsp-inventory enrich --jobs 8
python3 tools/inventory/cryonirsp-inventory tags

python3 tools/build_site_inventory.py cryonirsp_inventory.json \
    -o data/cryonirsp_dataset_details.json \
    --image-dir cn_daily_context_figures --movie-dir cn_daily_movies

python3 tools/validate_inventory.py data/cryonirsp_dataset_details.json
python3 tools/check_delta.py <previous>.json data/cryonirsp_dataset_details.json
```

`workflow_dispatch` runs the same thing on demand, with a `rebuild` toggle
that passes `--overwrite` and re-enriches everything. Use it after bumping the
pinned dependencies, so the whole archive is read by the same versions.

## The things that will eventually break

Written down because none of them announce themselves.

**Scheduled workflows are disabled after 60 days without repository
activity.** A monthly cron on a quiet repo sits close to that line, and it is
not settled whether the workflow's own commits reset the timer. This is the
most likely way the automation dies silently. If a month goes by with no PR,
check whether the schedule was switched off before looking anywhere else.

**The tag scraper parses someone else's HTML.** When that page changes shape
the tags become zero rather than raising. The delta check is what catches it.

**Uploading media needs a token this workflow does not have by default.**
The figures and movies live in a release on `sr-dash/cryonirsp-media`, a
separate repository, because 2.5 GB of imagery has no business in the site
repo's release list. The default job token can *read* that release, since it
is public, but it cannot write to another repository. Without a `MEDIA_TOKEN`
secret carrying write access there, a run that finds new imagery will say so
and carry on without uploading it — those observing days show as awaiting
imagery until someone syncs the media by hand. Everything else about the run
is unaffected.

**`share.nso.edu` is not reliably up.** The media step is allowed to fail; the
build then references only what the release already holds. New observing days
simply arrive without imagery until a later run picks them up.

**Pinned dependencies rot.** `dkist`, `sunpy` and `astropy` all move. Pinned
deliberately so a breaking change is a failed run rather than a quietly
different inventory. Bump roughly quarterly, then dispatch a `rebuild`.

**Media grows about 600 MB a year** at the current rate of roughly twenty
observing days. Releases have no practical size cap, but it is worth a look
every few years.
