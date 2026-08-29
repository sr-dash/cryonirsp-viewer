/* =====================================================
   QUERY MODEL

   One object describes a search. It serialises to the URL,
   so every result set is a link. Facets are multi-select;
   within a group values OR together, across groups they AND.
===================================================== */

export const GROUPS = [
    { id: 'line',   name: 'Spectral line',   field: 'line' },
    { id: 'target', name: 'Target',          field: 'target' },
    { id: 'mode',   name: 'Observing mode',  field: 'mode' },
    { id: 'stokes', name: 'Polarisation',    field: 'stokes' },
    { id: 'rbin',   name: 'Radial position', field: 'rbin' },
    { id: 'use',    name: 'Ready for',       field: null },
    { id: 'avail',  name: 'Availability',    field: null }
];

export function emptyQuery() {
    return {
        text: '',
        facets: {},          // groupId -> [values]
        pa: null,            // [from, to] degrees, may wrap
        r: null,             // [min, max] solar radii
        months: null         // [fromMonth, toMonth] as YYYY-MM
    };
}

// -----------------------------------------------------
// predicates
// -----------------------------------------------------

function inPA(pa, range) {
    if (pa === null) return false;
    const [a, b] = range;
    return a <= b ? (pa >= a && pa <= b) : (pa >= a || pa <= b);
}

function matchesUse(rec, values) {
    return values.some((v) =>
        (v === 'fit' && rec.fittable) ||
        (v === 'ctx' && rec.contextImager));
}

function matchesAvail(rec, values) {
    return values.some((v) =>
        (v === 'public' && !rec.embargoed) ||
        (v === 'embargoed' && rec.embargoed) ||
        (v === 'soon' && rec.embargoed && rec.liftsInDays !== null && rec.liftsInDays <= 90));
}

// Every predicate except the one named by `skip`. Used to compute
// facet counts that reflect the rest of the query — so a count tells
// you what selecting that value would actually give you.
export function matches(rec, q, skip) {
    if (q.text) {
        const terms = q.text.toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.every((t) => rec.haystack.includes(t))) return false;
    }

    for (const g of GROUPS) {
        if (g.id === skip) continue;
        const sel = q.facets[g.id];
        if (!sel || !sel.length) continue;

        if (g.id === 'use') { if (!matchesUse(rec, sel)) return false; continue; }
        if (g.id === 'avail') { if (!matchesAvail(rec, sel)) return false; continue; }
        if (!sel.includes(rec[g.field])) return false;
    }

    if (skip !== 'pa' && q.pa && !inPA(rec.pa, q.pa)) return false;

    if (skip !== 'r' && q.r) {
        if (rec.r === null || rec.r < q.r[0] || rec.r > q.r[1]) return false;
    }

    if (skip !== 'months' && q.months) {
        if (!rec.month || rec.month < q.months[0] || rec.month > q.months[1]) return false;
    }

    return true;
}

export function runQuery(records, q) {
    return records.filter((r) => matches(r, q, null));
}

export function isEmpty(q) {
    return !q.text
        && !q.pa && !q.r && !q.months
        && Object.keys(q.facets).every((k) => !q.facets[k].length);
}

// -----------------------------------------------------
// facet counts, computed against the rest of the query
// -----------------------------------------------------

export function facetCounts(records, q, groupId, values) {
    const pool = records.filter((r) => matches(r, q, groupId));
    const counts = {};
    values.forEach((v) => { counts[v] = 0; });

    const g = GROUPS.find((x) => x.id === groupId);

    pool.forEach((rec) => {
        if (groupId === 'use') {
            if (rec.fittable && 'fit' in counts) counts.fit++;
            if (rec.contextImager && 'ctx' in counts) counts.ctx++;
        } else if (groupId === 'avail') {
            if (rec.embargoed) {
                if ('embargoed' in counts) counts.embargoed++;
                if ('soon' in counts && rec.liftsInDays !== null && rec.liftsInDays <= 90) counts.soon++;
            } else if ('public' in counts) counts.public++;
        } else {
            const v = rec[g.field];
            if (v in counts) counts[v]++;
        }
    });

    return counts;
}

// -----------------------------------------------------
// toggling
// -----------------------------------------------------

export function toggleFacet(q, groupId, value) {
    const cur = q.facets[groupId] || [];
    const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : cur.concat([value]);
    return { ...q, facets: { ...q.facets, [groupId]: next } };
}

// -----------------------------------------------------
// URL round-trip
// -----------------------------------------------------

export function toParams(q) {
    const p = new URLSearchParams();
    if (q.text) p.set('q', q.text);
    Object.keys(q.facets).forEach((g) => {
        if (q.facets[g] && q.facets[g].length) p.set(g, q.facets[g].join(','));
    });
    if (q.pa) p.set('pa', `${Math.round(q.pa[0])}-${Math.round(q.pa[1])}`);
    if (q.r) p.set('r', `${q.r[0].toFixed(2)}-${q.r[1].toFixed(2)}`);
    if (q.months) p.set('months', `${q.months[0]}..${q.months[1]}`);
    return p;
}

export function fromParams(params) {
    const q = emptyQuery();
    q.text = params.get('q') || '';

    GROUPS.forEach((g) => {
        const v = params.get(g.id);
        if (v) q.facets[g.id] = v.split(',').filter(Boolean);
    });

    const pa = params.get('pa');
    if (pa && /^\d+-\d+$/.test(pa)) q.pa = pa.split('-').map(Number);

    const r = params.get('r');
    if (r && /^[\d.]+-[\d.]+$/.test(r)) q.r = r.split('-').map(Number);

    const m = params.get('months');
    if (m && m.includes('..')) q.months = m.split('..');

    return q;
}

// -----------------------------------------------------
// token syntax:  line:hei_1083  target:prominence
//                after:2024-03  before:2025-10
//                r>1.1  r<1.3   pa:150-210
// Anything unrecognised stays as free text.
// -----------------------------------------------------

const FIELD_TO_GROUP = {
    line: 'line', target: 'target', mode: 'mode',
    stokes: 'stokes', pos: 'rbin', available: 'avail', avail: 'avail'
};

export function parseInput(text, q) {
    let next = { ...q, facets: { ...q.facets } };
    const rest = [];

    text.split(/\s+/).filter(Boolean).forEach((tok) => {
        let m;

        if ((m = tok.match(/^(\w+):(.+)$/))) {
            const [, field, value] = m;
            const group = FIELD_TO_GROUP[field];
            if (group) {
                const cur = next.facets[group] || [];
                if (!cur.includes(value)) next.facets[group] = cur.concat([value]);
                return;
            }
            if (field === 'after')  { next.months = [value, next.months ? next.months[1] : '9999-99']; return; }
            if (field === 'before') { next.months = [next.months ? next.months[0] : '0000-00', value]; return; }
            if (field === 'pa' && /^\d+-\d+$/.test(value)) { next.pa = value.split('-').map(Number); return; }
        }

        if ((m = tok.match(/^r([<>])([\d.]+)$/))) {
            const v = Number(m[2]);
            const cur = next.r || [0, 3];
            next.r = m[1] === '>' ? [v, cur[1]] : [cur[0], v];
            return;
        }

        rest.push(tok);
    });

    next.text = rest.join(' ');
    return next;
}

// Human-readable tokens for the query bar.
export function describe(q, labels) {
    const out = [];
    GROUPS.forEach((g) => {
        (q.facets[g.id] || []).forEach((v) => {
            out.push({ group: g.id, value: v, label: (labels[g.id] && labels[g.id][v]) || v });
        });
    });
    if (q.pa) out.push({ group: 'pa', value: 'pa', label: `${Math.round(q.pa[0])}°–${Math.round(q.pa[1])}°` });
    if (q.r) out.push({ group: 'r', value: 'r', label: `${q.r[0].toFixed(2)}–${q.r[1].toFixed(2)} R☉` });
    if (q.months) {
        const [a, b] = q.months;
        const open0 = a === '0000-00', open1 = b === '9999-99';
        out.push({
            group: 'months', value: 'months',
            label: open1 ? `from ${a}` : open0 ? `up to ${b}` : (a === b ? a : `${a} → ${b}`)
        });
    }
    return out;
}
