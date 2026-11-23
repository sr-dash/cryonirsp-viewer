#!/usr/bin/env python3
r"""BibTeX parsing and LaTeX decoding for ADS records.

Lifted verbatim from the author's homepage repository, where it has been
rendering a publication list against real ADS exports for long enough to have
collected the awkward cases: accented names, \ensuremath wrappers, letter
macros whose terminating space is punctuation rather than a space, inline
maths that has to survive as readable text because nothing here loads MathJax.

    source: sr-dash.github.io/scripts/bib_to_data.py

Copied rather than imported because this repository has to build on a CI
runner that checks out nothing else. Kept as a faithful copy so that any
divergence is visible in a diff: fix a parsing bug upstream first, then bring
it across. Nothing site-specific belongs in this file.
"""

import re

JOURNAL_MACROS = {
    r"\apj": "The Astrophysical Journal",
    r"\mnras": "Monthly Notices of the Royal Astronomical Society",
    r"\grl": "Geophysical Research Letters",
    r"\aap": "Astronomy & Astrophysics",
    r"\solphys": "Solar Physics",
    "rnaas": "Research Notes of the AAS",
}

# The publication list labels each entry with a short venue, taken from the
# bibcode rather than a hand-maintained journal map: characters 4-8 of an ADS
# bibcode are the bibstem, so a new paper is labelled correctly the first time
# the sync appends it. Only the few bibstems that read badly are aliased.
BIBSTEM_ALIAS = {
    "GeoRL": "GRL",
    "AGUFM": "AGU",
    "IAUS": "IAU",
    "asi": "ASI",
    "shin": "SHINE",
}

LATEX_LITERALS = {
    "textquoteright": "\u2019", "textquoteleft": "\u2018",
    "textquotedblright": "\u201d", "textquotedblleft": "\u201c",
    "textendash": "\u2013", "textemdash": "\u2014", "textdegree": "\u00b0",
    "ldots": "\u2026", "dots": "\u2026",
    "aa": "\u00e5", "AA": "\u00c5", "o": "\u00f8", "O": "\u00d8", "ss": "\u00df",
    "ae": "\u00e6", "AE": "\u00c6",
    # Abstracts come straight from ADS and lean on these far more than titles
    # do, almost always wrapped in \ensuremath.
    "sim": "\u223c", "approx": "\u2248", "times": "\u00d7", "pm": "\u00b1",
    "mp": "\u2213", "deg": "\u00b0", "leq": "\u2264", "geq": "\u2265",
    "lesssim": "\u2272", "gtrsim": "\u2273", "ll": "\u226a", "gg": "\u226b",
    "sun": "\u2609", "earth": "\u2295", "odot": "\u2609", "oplus": "\u2295",
    "alpha": "\u03b1", "beta": "\u03b2", "gamma": "\u03b3", "delta": "\u03b4",
    "epsilon": "\u03b5", "theta": "\u03b8", "kappa": "\u03ba", "lambda": "\u03bb",
    "mu": "\u03bc", "nu": "\u03bd", "pi": "\u03c0", "rho": "\u03c1",
    "sigma": "\u03c3", "tau": "\u03c4", "phi": "\u03c6", "chi": "\u03c7",
    "omega": "\u03c9", "Omega": "\u03a9", "Delta": "\u0394", "Phi": "\u03a6",
    "rightarrow": "\u2192", "to": "\u2192", "prime": "\u2032",
}
# Macros that spell part of a word, so the space LaTeX uses to terminate them
# is punctuation and goes away: M\o ller, A\aa ngstr\o m. Everything else in
# LATEX_LITERALS is a symbol standing on its own in a sentence.
LETTER_MACROS = {"aa", "AA", "o", "O", "ss", "ae", "AE"}

LATEX_ACCENTS = {
    "'": dict(a="\u00e1", e="\u00e9", i="\u00ed", o="\u00f3", u="\u00fa", y="\u00fd",
              c="\u0107", n="\u0144", s="\u015b", z="\u017a",
              A="\u00c1", E="\u00c9", I="\u00cd", O="\u00d3", U="\u00da"),
    "`": dict(a="\u00e0", e="\u00e8", i="\u00ec", o="\u00f2", u="\u00f9",
              A="\u00c0", E="\u00c8", I="\u00cc", O="\u00d2", U="\u00d9"),
    '"': dict(a="\u00e4", e="\u00eb", i="\u00ef", o="\u00f6", u="\u00fc", y="\u00ff",
              A="\u00c4", E="\u00cb", I="\u00cf", O="\u00d6", U="\u00dc"),
    "^": dict(a="\u00e2", e="\u00ea", i="\u00ee", o="\u00f4", u="\u00fb",
              A="\u00c2", E="\u00ca", I="\u00ce", O="\u00d4", U="\u00db"),
    "~": dict(a="\u00e3", n="\u00f1", o="\u00f5", A="\u00c3", N="\u00d1", O="\u00d5"),
    "c": dict(c="\u00e7", s="\u015f", C="\u00c7"),
    "v": dict(s="\u0161", c="\u010d", z="\u017e", r="\u0159",
              S="\u0160", C="\u010c", Z="\u017d"),
    "H": dict(o="\u0151", u="\u0171"),
    "=": dict(a="\u0101", e="\u0113", i="\u012b", o="\u014d", u="\u016b"),
    ".": dict(z="\u017c", e="\u0117", Z="\u017b"),
}


def _literal(m: re.Match) -> str:
    """Expand one \\macro, keeping the space that terminated it where it counts.

    LaTeX swallows the space after a control word, which is right for a letter
    macro spelling part of a name (M\\o ller). It is wrong for a symbol in
    running prose, where "\\Omega \\approx 2.7" has to stay three tokens wide.
    """
    value = LATEX_LITERALS.get(m[1])
    if value is None:
        return m[0]
    return value + (" " if m[2] and m[1] not in LETTER_MACROS else "")


def decode_latex(value: str) -> str:
    """Turn the LaTeX in an ADS record into the plain text the page shows.

    Nothing on the publications page loads MathJax, so inline math has to
    survive as readable text rather than as markup: superscripts keep their
    caret and lose their braces, and the $ delimiters go.
    """
    out = re.sub(r"\\ensuremath\s*\{([^{}]*)\}", r"\1", value)
    out = re.sub(r"\^\{([^{}]*)\}", r"^\1", out)
    out = re.sub(r"_\{([^{}]*)\}", r"_\1", out)
    out = re.sub(r"\{?\\([`'\"^~=.])\s*\{?([a-zA-Z])\}?\}?",
                 lambda m: LATEX_ACCENTS.get(m[1], {}).get(m[2], m[2]), out)
    out = re.sub(r"\{?\\([cvHrudbk])\s*\{([a-zA-Z])\}\}?",
                 lambda m: LATEX_ACCENTS.get(m[1], {}).get(m[2], m[2]), out)
    out = re.sub(r"\{?\\([a-zA-Z]+)(\s*)\}?", _literal, out)
    out = re.sub(r"\\([&%$_#{}])", r"\1", out)
    # Drop the $ that delimited inline math, now that its contents are plain.
    return re.sub(r"\$([^$]*)\$", r"\1", out)


def short_venue(key: str, venue: str) -> str:
    """A badge-sized label for the venue, from the bibcode where possible."""
    stem = key[4:9].replace(".", "").strip() if re.match(r"^\d{4}\S", key) else ""
    if stem:
        return BIBSTEM_ALIAS.get(stem, stem)
    # No usable bibcode: initials of the significant words in the venue name.
    skip = {"the", "of", "and", "for", "on", "in", "a", "an"}
    initials = "".join(w[0] for w in re.findall(r"[A-Za-z]+", venue)
                       if w.lower() not in skip)
    return initials[:5].upper()


def parse_bib(text: str):
    entries = []
    parts = re.split(r"@([a-zA-Z]+)\s*\{", text)
    for i in range(1, len(parts), 2):
        kind, body = parts[i].upper(), parts[i + 1]
        key = body.split(",")[0].strip()
        fields = {}
        for line in re.split(r",\s*\n", body):
            if "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip().lower(), v.strip()
            if (v.startswith("{") and v.endswith("}")) or (v.startswith('"') and v.endswith('"')):
                v = v[1:-1].strip()
            fields[k] = decode_latex(v).replace("{", "").replace("}", "").replace("~", " ")
        if not fields.get("title"):
            continue

        venue = fields.get("journal") or fields.get("booktitle") or ""
        venue = JOURNAL_MACROS.get(venue.lower(), JOURNAL_MACROS.get(venue, venue))

        authors = [a.strip() for a in re.sub(r"\s+", " ", fields.get("author", "")).split(" and ") if a.strip()]

        entries.append(dict(
            key=key,
            kind="article" if kind == "ARTICLE" else "proceedings",
            title=fields["title"].strip('"'),
            authors=authors,
            venue=venue,
            short_venue=short_venue(key, venue),
            abstract=re.sub(r"\s+", " ", fields.get("abstract", "")).strip(),
            year=(fields.get("year") or "").strip(),
            volume=fields.get("volume", ""),
            number=fields.get("number", ""),
            pages=fields.get("pages", ""),
            doi=fields.get("doi", ""),
            adsurl=fields.get("adsurl", ""),
            citations=int(fields["citation_count"]) if fields.get("citation_count", "").isdigit() else 0,
        ))
    entries.sort(key=lambda e: (-int(e["year"] or 0), e["title"]))
    return entries
