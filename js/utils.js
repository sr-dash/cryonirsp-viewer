// =====================================================
// UTILITIES
// =====================================================


// -----------------------------------------------------
// HTML ESCAPING
//
// Every panel in this site is built with innerHTML. That
// was safe while the inventory carried only machine-made
// identifiers; v1.0.0 added experiment_description, which
// is operator-authored prose. Four of the 43 distinct
// descriptions contain a '<' ("low-frequency (f<10 mHz)")
// and one contains '&' — unescaped, the first swallows
// the rest of the card as a bogus tag.
//
// esc() is for text nodes, escAttr() for attribute values.
// See data/SCHEMA.md section 6.
// -----------------------------------------------------

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function esc(value){

    if(value === null || value === undefined)
        return '';

    return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}


// Attribute values additionally need backtick and equals
// neutralised for unquoted-attribute edge cases.
function escAttr(value){

    return esc(value).replace(/`/g, '&#96;').replace(/=/g, '&#61;');
}


// A URL destined for href/src. Anything that is not a
// plain http(s) or same-origin relative reference is
// dropped rather than rendered, so a malformed or hostile
// value can never become a javascript: link.
function escURL(value){

    if(value === null || value === undefined)
        return '';

    const s = String(value).trim();

    if(/^(https?:)?\/\//.test(s) || /^[\w./-]+$/.test(s))
        return esc(s);

    return '';
}


// -----------------------------------------------------
// SAFE CSS CLASS
//
// dataset_type is interpolated into a class attribute.
// Restrict it to the known set so an unexpected value
// cannot break out of the attribute or silently lose
// its styling without anyone noticing.
// -----------------------------------------------------

const KNOWN_DATASET_TYPES = ['polarimetric', 'spectrometric'];

function typeClass(datasetType){

    return KNOWN_DATASET_TYPES.includes(datasetType)
        ? datasetType
        : 'unknown-type';
}


// -----------------------------------------------------
// NUMBER FORMATTING
//
// Replaces the bare .toFixed() calls, which threw on a
// non-numeric value and blanked the entire panel.
// -----------------------------------------------------

function fixed(value, digits, suffix){

    if(value === null || value === undefined)
        return 'N/A';

    const n = Number(value);

    if(!Number.isFinite(n))
        return 'N/A';

    return n.toFixed(digits) + (suffix || '');
}


// -----------------------------------------------------
// UTC TIME FORMATTING
//
// The inventory guarantees an explicit Z, so these read
// the instant in UTC and can never drift by a timezone.
//
// The original site rendered year-day-of-year ("2022-292"),
// which is a real solar-physics convention but reads as a
// malformed date to everyone else. The calendar date is
// primary now; day-of-year is available separately for the
// callers that still want it.
// -----------------------------------------------------

function utcStamp(iso){

    if(!iso)
        return 'N/A';

    const t = new Date(iso);

    if(Number.isNaN(t.getTime()))
        return 'N/A';

    return `${t.toISOString().slice(0, 10)} `
         + `${t.toISOString().slice(11, 19)} UTC`;
}


// Day of year, 1-366. Returned as a string so callers can
// interpolate it without a null check.
function dayOfYear(iso){

    if(!iso)
        return '';

    const t = new Date(iso);

    if(Number.isNaN(t.getTime()))
        return '';

    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 0);

    const doy = Math.floor((t.getTime() - yearStart) / 86400000);

    return String(doy).padStart(3, '0');
}


// -----------------------------------------------------
// SORTING
//
// The sidebar's Newest / Oldest / Alphabetical control was
// wired to a change handler that re-rendered the tree, but
// renderTree() never read it — sorting was always
// newest-first. This makes the control real.
// -----------------------------------------------------

function currentSortMode(){

    const select = document.getElementById('sortMode');

    return select ? select.value : 'chronological_desc';
}


function sortComparator(a, b, mode){

    if(mode === 'alphabetical')
        return (a.dataset_id || '').localeCompare(b.dataset_id || '');

    // start_date is parsed once, in the adapter.
    const ta = a.start_date ? a.start_date.getTime() : 0;
    const tb = b.start_date ? b.start_date.getTime() : 0;

    return mode === 'chronological_asc'
        ? ta - tb
        : tb - ta;
}


// Programs are ordered by their most recent observation so
// the sort control affects the whole tree, not just the
// datasets inside each product.
function programComparator(groupedA, groupedB, mode){

    if(mode === 'alphabetical')
        return groupedA.key.localeCompare(groupedB.key);

    return mode === 'chronological_asc'
        ? groupedA.earliest - groupedB.earliest
        : groupedB.latest - groupedA.latest;
}
