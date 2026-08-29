"""
Observing-day tags from NSO's Cryo-NIRSP Daily Data Summaries.

The page at

    https://share.nso.edu/shared/dkist/tschad/CryoNIRSP_Daily_Data_Summaries.html

annotates each Cryo-NIRSP observing day with the solar features that were
present, the facilities that observed alongside DKIST, publications that used
the data, and known instrument problems.  None of that is in the data centre's
inventory, and it is exactly what makes a dataset findable for a given science
question, so it is folded into this inventory.

Dates on that page are **Hawaii observing dates**, not UTC.  Cryo-NIRSP
observes 17:00-01:00 UTC, so a run that continues past midnight UTC still
belongs to the previous Hawaii day; mapping on the UTC date instead would
misfile 20 datasets across four dates.  Hawaii does not use daylight saving,
so the offset is a constant UTC-10.  See :data:`HAWAII_UTC_OFFSET_HOURS`.
"""

from __future__ import annotations

import html
import logging
import re
import urllib.request
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

DAILY_SUMMARY_URL = (
    "https://share.nso.edu/shared/dkist/tschad/CryoNIRSP_Daily_Data_Summaries.html"
)

#: DKIST is on Hawaii Standard Time, which has no daylight saving.
HAWAII_UTC_OFFSET_HOURS = -10

#: Section headings used on the page.
SECTION_HEADINGS = (
    "Experiments",
    "Events/Features",
    "Publications",
    "Known Issues",
    "Data Issues",
)

#: Sentinel joining a link's label to its href while parsing.
_LINK_SEP = "\x00"


# --------------------------------------------------------------------------
# Tag vocabulary
# --------------------------------------------------------------------------
#
# The page's labels are free text and vary in case and wording ("Coronal
# cavity" / "Coronal Cavity"), so they are normalised to a stable slug that
# can be filtered on.  The raw label is always kept alongside it.
#
# ``category`` separates the two things worth searching for independently:
# what the Sun was doing (``solar_feature``) and who else was watching
# (``coordinated_observation``).

TAG_RULES: tuple[tuple[str, str, str], ...] = (
    # (regex against the lowercased label, slug, category)
    (r"polar crown cavity", "polar_crown_cavity", "solar_feature"),
    (r"coronal cavity", "coronal_cavity", "solar_feature"),
    (r"coronal wave", "coronal_waves", "solar_feature"),
    (r"coronal rain", "coronal_rain", "solar_feature"),
    (r"post.?flare loop", "post_flare_loops", "solar_feature"),
    (r"\bcme\b|coronal mass ejection", "cme", "solar_feature"),
    (r"prominence", "prominence", "solar_feature"),
    (r"flare", "flare", "solar_feature"),
    (r"day after eclipse", "day_after_eclipse", "eclipse"),
    (r"eclipse", "total_solar_eclipse", "eclipse"),
    (r"psp encounter|parker solar probe", "psp_encounter", "coordinated_observation"),
    (r"solar orbiter", "solar_orbiter", "coordinated_observation"),
    (r"mlso|kcor|ucomp", "mlso_kcor_ucomp", "coordinated_observation"),
    (r"\bvla\b", "vla_radio", "coordinated_observation"),
    (r"\beis\b|hinode", "hinode", "coordinated_observation"),
    (r"\biris\b", "iris", "coordinated_observation"),
    (r"see .*poster|see .*talk|see .*presentation", "presentation", "reference"),
)


def normalise_tag(label: str) -> tuple[str, str]:
    """
    Map a free-text label onto ``(slug, category)``.

    Unrecognised labels get a slug derived from the text itself and the
    category ``other``, so a new annotation on the page is still searchable
    rather than silently dropped.
    """
    text = label.strip().lower()

    for pattern, slug, category in TAG_RULES:
        if re.search(pattern, text):
            return slug, category

    slug = re.sub(r"[^a-z0-9]+", "_", text).strip("_")[:60]
    return (slug or "unknown"), "other"


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


def _flatten(markup: str) -> str:
    """Turn one table cell into plain text, keeping each link's href."""
    text = re.sub(
        r"<a[^>]*href=['\"]([^'\"]*)['\"][^>]*>(.*?)</a>",
        lambda m: m.group(2) + _LINK_SEP + m.group(1),
        markup,
        flags=re.S,
    )
    text = re.sub(r"</?br\s*/?>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    # Bullets are not always preceded by a line break.
    return text.replace("•", "\n•")


def _split_item(item: str) -> tuple[str, str | None]:
    """Split a bullet into ``(label, url)``."""
    label, _, url = item.partition(_LINK_SEP)
    label = label.lstrip("•").strip().strip('"').strip()
    return label, (url.strip() or None)


def parse_daily_summaries(markup: str) -> dict[str, dict]:
    """
    Parse the daily summaries page into ``{observing_date: sections}``.

    Dates are the page's own Hawaii observing dates.
    """
    days: dict[str, dict] = {}

    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", markup, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 2:
            continue

        date = None
        sections: dict[str, list] = {}
        heading = None

        for line in (x.strip() for x in _flatten(cells[0]).split("\n")):
            if not line:
                continue
            if date is None and re.fullmatch(r"\d{4}-\d{2}-\d{2}", line):
                date = line
                continue
            if line.endswith(":") and line[:-1] in SECTION_HEADINGS:
                heading = line[:-1]
                sections.setdefault(heading, [])
                continue
            if heading:
                sections[heading].append(line)

        if date is None:
            continue

        days[date] = sections

    return days


def build_day_records(days: dict[str, dict]) -> dict[str, dict]:
    """Turn parsed sections into the record attached to each product."""
    records = {}

    for date, sections in days.items():
        tags = []
        for item in sections.get("Events/Features", []):
            label, url = _split_item(item)
            if not label:
                continue
            slug, category = normalise_tag(label)
            tags.append({"tag": slug, "label": label, "category": category, "url": url})

        publications = []
        for item in sections.get("Publications", []):
            label, url = _split_item(item)
            if label:
                publications.append({"label": label, "url": url})

        def plain(name):
            return [label for label, _ in map(_split_item, sections.get(name, [])) if label]

        records[date] = {
            "observing_date_hst": date,
            "tags": tags,
            "tag_names": sorted({t["tag"] for t in tags}),
            "publications": publications,
            "known_issues": plain("Known Issues"),
            "data_issues": plain("Data Issues"),
            "experiment_ids": [
                label.lower() for label in plain("Experiments") if label.lower().startswith("eid_")
            ],
        }

    return records


# --------------------------------------------------------------------------
# Applying to the inventory
# --------------------------------------------------------------------------


def observing_date(start_time: str) -> str | None:
    """
    Hawaii observing date for a UTC start time.

    Cryo-NIRSP observes across local midday, so a run continuing past
    00:00 UTC belongs to the previous Hawaii date.
    """
    if not start_time:
        return None
    try:
        moment = datetime.fromisoformat(str(start_time).replace("Z", ""))
    except ValueError:
        log.warning("could not parse start time %r", start_time)
        return None
    return (moment + timedelta(hours=HAWAII_UTC_OFFSET_HOURS)).date().isoformat()


def fetch_daily_summaries(url: str = DAILY_SUMMARY_URL) -> str:
    """Download the daily summaries page (or read it from a local path)."""
    from pathlib import Path

    path = Path(url)
    if path.exists():
        return path.read_text(encoding="utf-8", errors="replace")

    with urllib.request.urlopen(url) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def apply_tags(products, records: dict[str, dict], source: str = DAILY_SUMMARY_URL) -> dict:
    """
    Attach the observing-day record to each product.

    Returns counts of products tagged, days matched, and days on the page
    with no product in the inventory.
    """
    summary = {"products": 0, "annotated": 0, "days_matched": set(), "days_unmatched": []}
    seen_dates = set()

    for product in products:
        summary["products"] += 1
        date = observing_date((product.get("active") or {}).get("start_time"))
        if date is None:
            continue
        seen_dates.add(date)

        record = records.get(date)
        if record is None:
            product["observing_day"] = {
                "observing_date_hst": date,
                "source": source,
                "on_summary_page": False,
                "tags": [],
                "tag_names": [],
                "publications": [],
                "known_issues": [],
                "data_issues": [],
            }
            continue

        product["observing_day"] = {
            **{k: v for k, v in record.items() if k != "experiment_ids"},
            "source": source,
            "on_summary_page": True,
        }
        summary["days_matched"].add(date)
        if record["tag_names"] or record["known_issues"] or record["data_issues"]:
            summary["annotated"] += 1

    summary["days_unmatched"] = sorted(set(records) - seen_dates)
    summary["days_matched"] = len(summary["days_matched"])
    return summary
