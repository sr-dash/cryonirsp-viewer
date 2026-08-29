/* =====================================================
   VIEWS

   All markup is built here. Every value that reaches the
   DOM goes through esc() — the inventory carries
   operator-authored experiment_description on all 1,002
   records.
===================================================== */

import { LINE_COLOR, LINE_SHORT, TARGET_LABEL, MODE_LABEL, TAG_CATEGORY_LABEL,
         fmtDuration, fmtSize, utcStamp, fmtDate } from './data.js';
import { GROUPS, facetCounts } from './query.js';

const E = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => E[c]);

// A URL bound for href. The tag and publication links come from the daily
// summary page, so they are third-party data: anything that is not plain
// http(s) or a same-origin relative path is dropped rather than rendered,
// which keeps a javascript: URL from ever reaching an attribute.
export const escURL = (v) => {
    if (v === null || v === undefined) return '';
    const u = String(v).trim();
    if (u.startsWith('//')) return '';           // protocol-relative: off-site
    return (/^https?:\/\//i.test(u) || /^[\w./?=&#%-]+$/.test(u)) ? esc(u) : '';
};

const lineColor = (k) => LINE_COLOR[k] || 'var(--dim)';

// A small lock beside the identifier, carrying the lift date in its tooltip.
// Density matters more than a whole column here: 157 of 1,002 are embargoed
// and the date only matters once you care about one of them.
// A data issue is a caveat on the frames themselves, so it earns a mark in
// the list. Known issues do not — there are 94 of them and they are
// operational notes, not warnings about the data.
function issueGlyph(r) {
    if (!r.dataIssues.length) return '';
    const title = r.dataIssues.join(' · ');
    return `<svg class="flag" viewBox="0 0 24 24" width="11" height="11" fill="none"
                 stroke="currentColor" stroke-width="2.2" aria-label="Data issue"><title>${esc(title)}</title>
              <path d="M12 8v5M12 17h.01M10.3 3.9 2.4 18a1.6 1.6 0 0 0 1.4 2.4h16.4a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0z"/>
            </svg>`;
}

function lockGlyph(r) {
    if (!r.embargoed) return '';
    const when = fmtDate(r.embargoEnd);
    const days = r.liftsInDays;
    const title = days !== null && days > 0
        ? `Embargoed until ${when} — ${days} day${days === 1 ? '' : 's'}`
        : 'Embargoed';
    return `<svg class="lock" viewBox="0 0 24 24" width="11" height="11" fill="none"
                 stroke="currentColor" stroke-width="2.2" aria-label="Embargoed"><title>${esc(title)}</title>
              <rect x="4" y="10.5" width="16" height="10" rx="1.6"/>
              <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1"/>
            </svg>`;
}

// -----------------------------------------------------
// FACET DEFINITIONS  (order is deliberate: most useful first)
// -----------------------------------------------------

export const FACETS = {
    line:   ['hei_1083', 'fexiii_1074', 'fexiii_1079', 'six_1430'],
    target: ['activecorona', 'unknown', 'prominence', 'quietcorona', 'coronalhole'],
    mode:   ['spectroscopy', 'context_imaging', 'spectropolarimetry', 'context_imaging_polarimetry'],
    stokes: ['I', 'IQUV'],
    rbin:   ['near', 'far', 'limb', 'disk'],
    use:    ['fit', 'ctx'],
    avail:  ['public', 'embargoed', 'soon'],

    // Ordered by category so the rail reads as four ideas, not thirteen
    // unrelated switches. Categories are selectable in their own right.
    tag: [
        'solar_feature',
        'coronal_cavity', 'cme', 'coronal_waves', 'coronal_rain',
        'polar_crown_cavity', 'post_flare_loops',
        'coordinated_observation',
        'psp_encounter', 'solar_orbiter', 'mlso_kcor_ucomp', 'vla_radio',
        'eclipse',
        'total_solar_eclipse', 'day_after_eclipse',
        'reference',
        'presentation'
    ],

    note: ['publication', 'known_issue', 'data_issue', 'untagged']
};

// Which of the tag values are category headings rather than tags.
export const TAG_CATEGORIES = new Set(Object.keys(TAG_CATEGORY_LABEL));

export const LABELS = {
    line: LINE_SHORT,
    target: TARGET_LABEL,
    mode: MODE_LABEL,
    stokes: { I: 'Stokes I only', IQUV: 'Full Stokes IQUV' },
    rbin: {
        near: 'Near off-limb 1.05–1.3',
        far:  'Far off-limb >1.3',
        limb: 'At the limb 0.95–1.05',
        disk: 'On disk <0.95'
    },
    use:   { fit: 'Line fitting (cn-specfit)', ctx: 'Context imagery' },
    avail: { public: 'Available now', embargoed: 'Embargoed', soon: 'Embargo lifts within 90 days' },

    tag: Object.assign({
        coronal_cavity: 'Coronal cavity',
        cme: 'CME',
        coronal_waves: 'Coronal waves',
        coronal_rain: 'Coronal rain',
        polar_crown_cavity: 'Polar crown cavity',
        post_flare_loops: 'Post-flare loops',
        psp_encounter: 'Parker Solar Probe encounter',
        solar_orbiter: 'Solar Orbiter quadrature',
        mlso_kcor_ucomp: 'MLSO K-Cor / UCoMP',
        vla_radio: 'VLA radio',
        total_solar_eclipse: 'Total solar eclipse',
        day_after_eclipse: 'Day after eclipse',
        presentation: 'Presentation or poster'
    }, TAG_CATEGORY_LABEL),

    note: {
        publication: 'Has a publication',
        known_issue: 'Has a known issue',
        data_issue: 'Has a data issue',
        untagged: 'No observing-day tags'
    }
};

// -----------------------------------------------------
// FACET RAIL
// -----------------------------------------------------

export function renderRail(el, records, q) {
    const groups = GROUPS.map((g) => {
        const values = FACETS[g.id];
        const counts = facetCounts(records, q, g.id, values);
        const sel = q.facets[g.id] || [];

        const items = values.map((v, vi) => {
            const on = sel.includes(v);
            const n = counts[v] || 0;

            // A category heading inside the tag group: still selectable — it
            // matches every tag beneath it — but set apart so thirteen tags
            // read as four ideas.
            if (g.id === 'tag' && TAG_CATEGORIES.has(v)) {
                return `
                <button class="facet cat${n === 0 && !on ? ' zero' : ''}" style="--i:${vi}"
                        aria-pressed="${on}"
                        data-group="${esc(g.id)}" data-value="${esc(v)}"
                        ${n === 0 && !on ? 'disabled' : ''}>
                    <span class="lbl">${esc(LABELS[g.id][v] || v)}</span>
                    <span class="n" data-count-key="${esc(g.id)}:${esc(v)}" data-count="${n}">${n.toLocaleString()}</span>
                </button>`;
            }

            const dot = g.id === 'line' ? lineColor(v) : (on ? 'var(--accent)' : 'var(--faint)');
            return `
                <button class="facet${n === 0 && !on ? ' zero' : ''}${g.id === 'tag' ? ' sub' : ''}" style="--i:${vi}"
                        aria-pressed="${on}"
                        data-group="${esc(g.id)}" data-value="${esc(v)}"
                        ${n === 0 && !on ? 'disabled' : ''}>
                    <span class="dot" style="background:${esc(dot)}"></span>
                    <span class="lbl">${esc(LABELS[g.id][v] || v)}</span>
                    <span class="n" data-count-key="${esc(g.id)}:${esc(v)}" data-count="${n}">${n.toLocaleString()}</span>
                </button>`;
        }).join('');

        return `
            <div class="fgroup">
                <h3>${esc(g.name)}<span>${g.id === 'tag' ? '13 tags' : values.length}</span></h3>
                <div class="fitems">${items}</div>
            </div>`;
    }).join('');

    el.innerHTML = `
        <div class="rail-head">
            <div class="eyebrow">Refine</div>
            <button class="linkish" id="clearAll">clear all</button>
        </div>
        ${groups}
        <div style="border-top:1px solid var(--line); padding-top:14px;
                    font-family:var(--f-mono); font-size:10px; color:var(--faint); line-height:1.7;">
            counts update against the rest<br>of the query
        </div>`;
}

// -----------------------------------------------------
// RESULTS
// -----------------------------------------------------

const COLUMNS = [
    { id: 'id',   label: 'Dataset' },
    { id: 'prod', label: 'Product · target', sort: null },
    { id: 'date', label: 'Observed' },
    { id: 'line', label: 'Line' },
    { id: 'r',    label: 'r · PA' },
    { id: 'dur',  label: 'Duration' },
    { id: 'size', label: 'Size' },
    { id: 'cal',  label: 'Cal' }
];

export function renderResults(el, rows, opts) {
    const { view, sort, limit, activeId } = opts;

    if (!rows.length) {
        el.innerHTML = `<div class="empty">Nothing matches this query. Loosen a facet, or clear the arc on the disk.</div>`;
        return;
    }

    if (view === 'grid') {
        el.innerHTML = `<div class="grid">${rows.slice(0, limit).map((r, i) => `
            <button class="card" style="--i:${i}" data-id="${esc(r.id)}">
                <div class="thumb">${r.poster
                    ? `<img loading="lazy" src="${esc(r.poster)}" alt="">`
                    : ''}</div>
                <div class="meta" style="border-top-color:${esc(lineColor(r.line))}">
                    <div class="id">${esc(r.id)}${lockGlyph(r)}</div>
                    <div class="sub">${esc(TARGET_LABEL[r.target] || r.target)} · ${esc(r.date)}</div>
                </div>
            </button>`).join('')}</div>
            ${rows.length > limit ? `<div class="more"><button class="linkish" id="showMore">show more — ${(rows.length - limit).toLocaleString()} remaining</button></div>` : ''}`;
        return;
    }

    const head = `
        <div class="thead">
            <div></div>
            ${COLUMNS.map((c) => `<div><button data-sort="${esc(c.id)}" class="${sort === c.id ? 'on' : ''}">${esc(c.label)}</button></div>`).join('')}
        </div>`;

    const body = rows.slice(0, limit).map((r, i) => `
        <button class="row${r.id === activeId ? ' on' : ''}" style="--i:${i}" data-id="${esc(r.id)}">
            <span class="stripe" style="background:${esc(lineColor(r.line))}"></span>
            <span class="id">${esc(r.id)}${lockGlyph(r)}${issueGlyph(r)}</span>
            <span>
                <span class="prod">${esc(r.product)}</span>
                <span class="tgt">${esc(TARGET_LABEL[r.target] || r.target)} <em>· ${esc(MODE_LABEL[r.mode] || r.mode || '')}</em></span>
            </span>
            <span class="m">${esc(r.date)}</span>
            <span class="m" style="color:${esc(lineColor(r.line))}">${esc(LINE_SHORT[r.line] || r.lineLabel || '')}</span>
            <span class="m">${r.r !== null ? `${r.r.toFixed(2)} · ${String(Math.round(r.pa)).padStart(3, '0')}°` : '—'}</span>
            <span class="m">${esc(fmtDuration(r.durationSeconds))}</span>
            <span class="m">${esc(fmtSize(r.sizeGiB))}</span>
            <span class="cal${r.superseded.length ? ' has' : ''}">${r.superseded.length}</span>
        </button>`).join('');

    el.innerHTML = head + body +
        (rows.length > limit
            ? `<div class="more"><button class="linkish" id="showMore">show more — ${(rows.length - limit).toLocaleString()} remaining</button></div>`
            : `<div class="more" style="color:var(--faint);font-family:var(--f-mono);font-size:10.5px;">end of results</div>`);
}

// -----------------------------------------------------
// DETAIL DRAWER
// -----------------------------------------------------

export function renderDetail(el, r) {
    if (!r) { el.innerHTML = ''; return; }

    const kv = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;

    const lineage = [
        `<div class="lin active"><span>${esc(r.id)}</span><span class="st">ACTIVE · ${esc(r.calVersion || '')}</span></div>`,
        ...r.superseded.map((id) =>
            `<div class="lin"><span>${esc(id)}</span><span class="st">${esc(r.supersededStatus[id] || 'SUPERSEDED')}</span></div>`)
    ].join('');

    el.innerHTML = `
        <div class="dhead">
            <div>
                <div class="id">${esc(r.id)}</div>
                <div class="sub">${esc(r.product)} · ${esc(r.program)}</div>
            </div>
            <button class="xbtn" id="closeDrawer" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
        </div>

        <div class="dbody">
            <div class="dsec" style="--i:0">
                <div class="kv">
                    ${kv('Spectral line', LINE_SHORT[r.line] || r.lineLabel || '—')}
                    ${kv('Target', TARGET_LABEL[r.target] || r.target)}
                    ${kv('Mode', MODE_LABEL[r.mode] || r.mode || '—')}
                    ${kv('Stokes', r.stokes || '—')}
                </div>
            </div>

            <div class="dsec" style="--i:1">
                <h4>Observation</h4>
                <div class="kv">
                    ${kv('Start', utcStamp(r.start))}
                    ${kv('End', utcStamp(r.end))}
                    ${kv('Duration', fmtDuration(r.durationSeconds))}
                    ${kv('Scan steps', r.scanSteps ?? '—')}
                    ${kv('Shape', r.shape || '—')}
                    ${kv('Frames', r.frames !== null ? r.frames.toLocaleString() : '—')}
                    ${kv('Size', fmtSize(r.sizeGiB))}
                </div>
            </div>

            <div class="dsec" style="--i:2">
                <h4>Availability</h4>
                ${availabilityBlock(r)}
            </div>

            ${observingDayBlock(r)}

            <div class="dsec" style="--i:3">
                <h4>Pointing</h4>
                <div class="kv">
                    ${kv('Radial distance', r.r !== null ? `${r.r.toFixed(3)} R☉` : '—')}
                    ${kv('Position angle', r.pa !== null ? `${r.pa.toFixed(1)}°` : '—')}
                    ${kv('Scan step', r.stepWidth !== null ? `${r.stepWidth.toFixed(4)}″` : 'N/A')}
                    ${kv('Slit sampling', r.slitSampling !== null ? `${r.slitSampling.toFixed(4)}″` : 'N/A')}
                </div>
                ${r.bounds ? `<div style="margin-top:14px;">${footprintSVG(r)}</div>` : ''}
            </div>

            ${r.description ? `
            <div class="dsec" style="--i:4">
                <h4>Experiment ${esc(r.experiment || '')}</h4>
                <div class="prose">${esc(r.description)}</div>
            </div>` : ''}

            <div class="dsec" style="--i:5">
                <h4>Calibration lineage — ${r.superseded.length} superseded</h4>
                <div class="lineage">${lineage}</div>
            </div>

            ${(r.image || r.movie) ? `
            <div class="dsec" style="--i:6">
                <h4>Context media</h4>
                <div class="media">
                    ${r.image ? `<figure>
                        <a href="${esc(r.image)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${esc(r.image)}" alt="Daily context image"></a>
                        <figcaption>daily context · ${esc(r.date)}</figcaption>
                    </figure>` : ''}
                    ${r.movie ? `<figure>
                        <video controls preload="none" poster="${esc(r.poster || '')}"><source src="${esc(r.movie)}" type="video/mp4"></video>
                        <figcaption>daily movie · ${esc(r.date)}</figcaption>
                    </figure>` : ''}
                </div>
            </div>` : ''}

            <div class="dsec" style="--i:7">
                <h4>Archive</h4>
                <div class="kv">
                    ${kv('Metadata file', r.metadataFile || '—')}
                    ${kv('Proposal', r.proposal || '—')}
                </div>
                <div style="margin-top:12px; display:flex; gap:16px; font-family:var(--f-mono); font-size:12px;">
                    <a href="https://dkist.data.nso.edu/product/${encodeURIComponent(r.product)}" target="_blank" rel="noopener noreferrer">Data Center product →</a>
                    ${r.previewUrl ? `<a href="${esc(r.previewUrl)}" target="_blank" rel="noopener noreferrer">Preview movie →</a>` : ''}
                </div>
            </div>
        </div>`;
}

// Everything the daily summary says about the day this was observed.
// Issues first: they are a caveat on the data, not a footnote.
function observingDayBlock(r) {
    const hasAnything = r.tags.length || r.publications.length
        || r.knownIssues.length || r.dataIssues.length;
    if (!hasAnything) return '';

    const issues = [
        ...r.dataIssues.map((i) => ({ cls: 'data', k: 'Data issue', v: i })),
        ...r.knownIssues.map((i) => ({ cls: '', k: 'Known issue', v: i }))
    ].map((i) => `
        <div class="issue ${i.cls}">
            <div class="k">${esc(i.k)}</div>
            <div class="v">${esc(i.v)}</div>
        </div>`).join('');

    const tags = r.tags.map((t) => {
        const inner = `
            <span class="cat">${esc(TAG_CATEGORY_LABEL[t.category] || t.category || '')}</span>
            <span>${esc(t.label || t.tag)}</span>
            ${t.url ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>` : ''}`;
        return t.url
            ? `<a class="tag" href="${escURL(t.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
            : `<span class="tag">${inner}</span>`;
    }).join('');

    const pubs = r.publications.map((p) => p.url
        ? `<a class="pub" href="${escURL(p.url)}" target="_blank" rel="noopener noreferrer">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>
             ${esc(p.label)}
           </a>`
        : `<span class="pub">${esc(p.label)}</span>`).join('');

    return `
        <div class="dsec" style="--i:2">
            <h4>Observing day${r.observingDate ? ` — ${esc(r.observingDate)} HST` : ''}</h4>
            ${issues}
            ${tags ? `<div class="tagset"${issues ? ' style="margin-top:10px"' : ''}>${tags}</div>` : ''}
            ${pubs ? `<div class="pubs" style="margin-top:10px">${pubs}</div>` : ''}
            <div style="margin-top:10px; font-size:11.5px; color:var(--dim); line-height:1.5;">
                These notes describe the whole observing day, so every product
                taken on ${esc(r.observingDate || 'this date')} carries them.${r.summarySource
                    ? ` <a href="${escURL(r.summarySource)}" target="_blank" rel="noopener noreferrer">Daily summary</a>.` : ''}
            </div>
        </div>`;
}


function availabilityBlock(r) {
    if (r.embargoState === 'embargoed') {
        const d = r.liftsInDays;
        return `
            <div class="avail embargoed">
                <div class="avail-head">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2">
                      <rect x="4" y="10.5" width="16" height="10" rx="1.6"/><path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1"/>
                    </svg>
                    <span>Embargoed &mdash; not yet downloadable</span>
                </div>
                <div class="avail-body">
                    Becomes public on <b>${esc(fmtDate(r.embargoEnd))}</b>${d !== null && d > 0
                        ? `, in ${d} day${d === 1 ? '' : 's'}` : ''}.
                    Metadata and context imagery are open now; the science frames are not.
                </div>
            </div>`;
    }

    if (r.embargoState === 'lapsed') {
        return `
            <div class="avail lapsed">
                <div class="avail-head"><span>Available &mdash; embargo has expired</span></div>
                <div class="avail-body">
                    The inventory still flags this as embargoed, but the period ended on
                    <b>${esc(fmtDate(r.embargoEnd))}</b>. Rebuild the inventory to clear the flag.
                </div>
            </div>`;
    }

    if (r.embargoState === 'released') {
        return `
            <div class="avail open">
                <div class="avail-head"><span>Available now</span></div>
                <div class="avail-body">Released from embargo on <b>${esc(fmtDate(r.embargoEnd))}</b>.</div>
            </div>`;
    }

    return `
        <div class="avail open">
            <div class="avail-head"><span>Available now</span></div>
            <div class="avail-body">Never embargoed.</div>
        </div>`;
}


function footprintSVG(r) {
    const rs = r.solarRadius || 963.1;
    const xs = r.bounds[0], ys = r.bounds[1];
    const pts = xs.map((x, i) => `${(x / rs).toFixed(4)},${(-ys[i] / rs).toFixed(4)}`).join(' ');
    return `
        <svg viewBox="-1.6 -1.6 3.2 3.2" style="width:190px;height:190px;background:var(--sunk);border:1px solid var(--line);">
            <circle cx="0" cy="0" r="1" fill="var(--sunk)"/>
            <circle cx="0" cy="0" r="1" fill="none" stroke="${lineColor(r.line)}" stroke-opacity="0.45" stroke-width="0.012"/>
            <line x1="-1.5" y1="0" x2="1.5" y2="0" stroke="var(--line)" stroke-width="0.006"/>
            <line x1="0" y1="-1.5" x2="0" y2="1.5" stroke="var(--line)" stroke-width="0.006"/>
            <polygon points="${pts}" fill="${lineColor(r.line)}" fill-opacity="0.3" stroke="${lineColor(r.line)}" stroke-width="0.014"/>
        </svg>`;
}
