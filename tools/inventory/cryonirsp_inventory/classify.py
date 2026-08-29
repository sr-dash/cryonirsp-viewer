"""
Classification rules for Cryo-NIRSP Level-1 datasets.

Two things are decided here, both from data-centre inventory fields alone
(no file downloads required):

1. Which *arm* produced the dataset -- the Context Imager (CI) or the
   spectrograph (SP).
2. Whether the observed line is a *coronal forbidden* line, which is what
   separates the coronal magnetometry datasets from the He I 1083 nm
   chromospheric/prominence ones.
"""

from __future__ import annotations

import re

# --------------------------------------------------------------------------
# Arm identification
# --------------------------------------------------------------------------
#
# The calibration workflow name is the authoritative arm marker in the
# inventory: the data centre runs a separate pipeline per arm.  It has been
# cross-checked against the CNARMID header keyword ("CI"/"SP") and against
# the presence of a spectral axis, and all three agree on every dataset.

CI_WORKFLOW = "l0_to_l1_cryonirsp_ci"
SP_WORKFLOW = "l0_to_l1_cryonirsp_sp"

ARM_CI = "CI"
ARM_SP = "SP"


def classify_arm(row: dict) -> tuple[str, str]:
    """
    Return ``(arm, evidence)`` for one inventory row.

    ``arm`` is ``"CI"`` (Context Imager) or ``"SP"`` (spectrograph).
    """
    workflow = str(row.get("Calibration Workflow Name") or "")

    if workflow == CI_WORKFLOW:
        return ARM_CI, "workflow"
    if workflow == SP_WORKFLOW:
        return ARM_SP, "workflow"

    # Fall back on the spectral-axis flag if the data centre ever renames a
    # workflow.  A Context Imager frame is spatial-spatial and has no
    # spectral axis; every spectrograph dataset has one.
    has_spectral = row.get("Has Spectral Axis")
    if has_spectral is not None:
        return (ARM_SP if bool(has_spectral) else ARM_CI), "has_spectral_axis"

    return "UNKNOWN", "none"


# --------------------------------------------------------------------------
# Spectral lines
# --------------------------------------------------------------------------

_ROMAN = {
    "I": 1, "V": 5, "X": 10, "L": 50,
    "C": 100, "D": 500, "M": 1000,
}

# Ionisation stage at or above which a line is treated as coronal.  Every
# Cryo-NIRSP coronal line (Mg VIII, Si IX, Si X, Fe XI, S XI, Fe XIII) sits
# at or above stage 8; every chromospheric/photospheric one (He I, Ca II,
# Fe I, Na I) sits far below it.
CORONAL_STAGE_THRESHOLD = 8

# Explicit table for the lines Cryo-NIRSP actually observes.  ``forbidden``
# marks magnetic-dipole transitions between fine-structure levels of the
# ground term -- the coronal emission lines used for coronal magnetometry.
KNOWN_LINES = {
    ("Fe", 11): {"wavelength_nm": 789.2, "forbidden": True, "regime": "corona"},
    ("Fe", 13): {"wavelength_nm": 1074.7, "forbidden": True, "regime": "corona"},
    ("He", 1): {"wavelength_nm": 1083.0, "forbidden": False, "regime": "chromosphere"},
    ("Si", 10): {"wavelength_nm": 1430.1, "forbidden": True, "regime": "corona"},
    ("S", 11): {"wavelength_nm": 1920.7, "forbidden": True, "regime": "corona"},
    ("Mg", 8): {"wavelength_nm": 3028.0, "forbidden": True, "regime": "corona"},
    ("Si", 9): {"wavelength_nm": 3934.3, "forbidden": True, "regime": "corona"},
}

# Fe XIII is a doublet (1074.7 and 1079.8 nm); both members share the ion
# entry above, and the exact wavelength comes from the parsed line string.

_LINE_RE = re.compile(
    r"^\s*(?P<element>[A-Z][a-z]?)\s+(?P<stage>[IVXLCDM]+)\s*"
    r"(?:\(\s*(?P<wavelength>[0-9.]+)\s*(?P<unit>nm|A|angstrom)?\s*\))?\s*$",
    re.IGNORECASE,
)


def roman_to_int(roman: str) -> int | None:
    """Convert a Roman numeral ionisation stage to an integer."""
    roman = roman.upper()
    total = 0
    previous = 0
    for char in reversed(roman):
        value = _ROMAN.get(char)
        if value is None:
            return None
        total += value if value >= previous else -value
        previous = max(previous, value)
    return total or None


def describe_spectral_line(text: str) -> dict:
    """
    Parse a data-centre spectral line string such as ``"Fe XIII (1074.7 nm)"``.

    Returns a dict with the element, ionisation stage, wavelength in nm, and
    whether the line is a coronal forbidden line.
    """
    raw = str(text).strip()
    match = _LINE_RE.match(raw)

    if match is None:
        return {
            "raw": raw,
            "element": None,
            "ion_stage": None,
            "ion": None,
            "wavelength_nm": None,
            "is_forbidden": None,
            "regime": "unknown",
        }

    element = match.group("element").capitalize()
    stage = roman_to_int(match.group("stage"))
    wavelength = match.group("wavelength")
    wavelength_nm = float(wavelength) if wavelength else None

    known = KNOWN_LINES.get((element, stage), {})

    if wavelength_nm is None:
        wavelength_nm = known.get("wavelength_nm")

    if "forbidden" in known:
        is_forbidden = known["forbidden"]
        regime = known["regime"]
    elif stage is not None:
        # Unlisted line: fall back on the ionisation stage.  A stage this
        # high is only populated at coronal temperatures, and the only such
        # lines in the Cryo-NIRSP passband are forbidden ones.
        is_forbidden = stage >= CORONAL_STAGE_THRESHOLD
        regime = "corona" if is_forbidden else "lower_atmosphere"
    else:
        is_forbidden = None
        regime = "unknown"

    ion = f"{element} {match.group('stage').upper()}" if stage else element

    return {
        "raw": raw,
        "element": element,
        "ion_stage": stage,
        "ion": ion,
        "wavelength_nm": wavelength_nm,
        "is_forbidden": is_forbidden,
        "regime": regime,
    }


# --------------------------------------------------------------------------
# cn-specfit / cn-polfit line registry
# --------------------------------------------------------------------------
#
# cn-specfit fits a fixed registry of coronal lines and cn-polfit adds the
# atomic data for the same three.  Reporting the registry key in the
# inventory means a selected product can be handed straight to either tool
# as ``--line <key>``.
#
# The registry is imported from cn_specfit when it is installed so the two
# never drift apart; the fallback mirrors it for standalone use.

FALLBACK_FIT_LINES = {
    "fexiii_1074": 1074.65,
    "fexiii_1079": 1079.8,
    "six_1430": 1430.10,
}

#: Margin (nm) a line must clear at both bandpass edges, matching
#: ``cn_specfit.lines.CoronalLine.covered_by``.
BANDPASS_MARGIN_NM = 0.2


def fit_line_registry() -> tuple[dict[str, float], str]:
    """Return ``({name: rest wavelength nm}, source)`` for the fittable lines."""
    try:
        from cn_specfit.lines import LINE_REGISTRY
    except Exception:
        return dict(FALLBACK_FIT_LINES), "fallback"

    return (
        {name: float(line.rest_wavelength) for name, line in LINE_REGISTRY.items()},
        "cn_specfit",
    )


def match_fit_line(
    wavelength_min_nm: float | None,
    wavelength_max_nm: float | None,
) -> dict:
    """
    Identify which cn-specfit registry line the dataset bandpass covers.

    Mirrors ``cn_specfit.lines.identify_line``: a line counts as covered when
    its rest wavelength sits inside the bandpass with a margin at each edge.
    """
    registry, source = fit_line_registry()
    result = {
        "fit_line": None,
        "fit_line_candidates": [],
        "fit_line_source": source,
        "is_fittable": False,
    }

    if wavelength_min_nm is None or wavelength_max_nm is None:
        return result

    low = float(wavelength_min_nm) + BANDPASS_MARGIN_NM
    high = float(wavelength_max_nm) - BANDPASS_MARGIN_NM

    covered = [name for name, rest in registry.items() if low < rest < high]

    result["fit_line_candidates"] = sorted(covered)
    # More than one match is ambiguous, exactly as cn-specfit treats it.
    result["fit_line"] = covered[0] if len(covered) == 1 else None
    result["is_fittable"] = len(covered) == 1

    return result


# --------------------------------------------------------------------------
# Observing mode / analysis class
# --------------------------------------------------------------------------

MODE_CONTEXT_IMAGING = "context_imaging"
MODE_CONTEXT_IMAGING_POL = "context_imaging_polarimetry"
MODE_SPECTROSCOPY = "spectroscopy"
MODE_SPECTROPOLARIMETRY = "spectropolarimetry"

# Downstream routing: which fitting code a dataset is a candidate for.
CLASS_CONTEXT_IMAGER = "context_imager"
CLASS_CORONAL_SPEC = "coronal_forbidden_spectroscopy"
CLASS_CORONAL_POL = "coronal_forbidden_spectropolarimetry"
CLASS_OTHER_SPEC = "other_spectroscopy"
CLASS_OTHER_POL = "other_spectropolarimetry"

ANALYSIS_TOOL = {
    CLASS_CORONAL_SPEC: "cn-specfit",
    CLASS_CORONAL_POL: "cnpolfit",
}


def classify_mode(arm: str, stokes: str | None) -> str:
    """Map arm + Stokes parameters onto an observing mode."""
    full_stokes = str(stokes or "I").upper() == "IQUV"

    if arm == ARM_CI:
        return MODE_CONTEXT_IMAGING_POL if full_stokes else MODE_CONTEXT_IMAGING
    return MODE_SPECTROPOLARIMETRY if full_stokes else MODE_SPECTROSCOPY


def classify_product(row: dict) -> dict:
    """
    Classify one inventory row (arm, mode, lines, downstream analysis class).

    ``row`` is a normalised DKIST search result row.
    """
    arm, evidence = classify_arm(row)

    stokes = row.get("Stokes Parameters")
    mode = classify_mode(arm, stokes)

    lines = [describe_spectral_line(line) for line in (row.get("Spectral Lines") or [])]
    forbidden_lines = [line for line in lines if line["is_forbidden"]]
    has_forbidden = bool(forbidden_lines)

    # The primary line is the forbidden one when present -- a handful of
    # datasets record both a coronal line and He I in the same passband.
    primary = (forbidden_lines or lines or [None])[0]

    if arm == ARM_CI:
        analysis_class = CLASS_CONTEXT_IMAGER
    elif mode == MODE_SPECTROPOLARIMETRY:
        analysis_class = CLASS_CORONAL_POL if has_forbidden else CLASS_OTHER_POL
    else:
        analysis_class = CLASS_CORONAL_SPEC if has_forbidden else CLASS_OTHER_SPEC

    # Which line cn-specfit/cn-polfit would fit in this bandpass.  Only the
    # spectrograph produces a spectrum to fit.
    wavelength = row.get("Wavelength") or [None, None]
    fit = (
        match_fit_line(wavelength[0], wavelength[-1])
        if arm == ARM_SP
        else {
            "fit_line": None,
            "fit_line_candidates": [],
            "fit_line_source": None,
            "is_fittable": False,
        }
    )

    return {
        "arm": arm,
        "arm_evidence": evidence,
        "is_context_imager": arm == ARM_CI,
        "observing_mode": mode,
        "stokes_parameters": str(stokes) if stokes is not None else None,
        "full_stokes": bool(row.get("Full Stokes")),
        "has_spectral_axis": (
            None if row.get("Has Spectral Axis") is None else bool(row["Has Spectral Axis"])
        ),
        "spectral_lines": lines,
        "primary_line": primary,
        "is_coronal_forbidden_line": has_forbidden,
        "analysis_class": analysis_class,
        "analysis_tool": ANALYSIS_TOOL.get(analysis_class),
        **fit,
    }
