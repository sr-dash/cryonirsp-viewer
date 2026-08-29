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
| fetch | **0 files** | ~25 MB, <1 min | 1,002 files, 1 GB, ~6 min |
| enrich | nothing to do | ~6 min | ~65 min |
| tags, build, validate | <1 min | <1 min | <1 min |
| **total** | **~3 min** | **~10 min** | **~75 min** |

The last column only happens if the `inventory-state` release is missing —
the very first run, or if someone deletes it — or when a `rebuild` dispatch
asks for it deliberately. It is a one-off, not a monthly cost.

The job limit is 6 hours. Even the full rebuild has four times the headroom it
needs, which is the margin that makes this safe to leave alone: the worst
case still finishes.

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

**`share.nso.edu` is not reliably up.** The media step is allowed to fail; the
build then references only what the release already holds. New observing days
simply arrive without imagery until a later run picks them up.

**Pinned dependencies rot.** `dkist`, `sunpy` and `astropy` all move. Pinned
deliberately so a breaking change is a failed run rather than a quietly
different inventory. Bump roughly quarterly, then dispatch a `rebuild`.

**Media grows about 600 MB a year** at the current rate of roughly twenty
observing days. Releases have no practical size cap, but it is worth a look
every few years.
