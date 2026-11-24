/* =====================================================
   PUBLICATIONS

   One JSON file, built offline by tools/build_publications.py
   from the curated dkist-bib record. Nothing here talks to
   ADS: a citation count is only as fresh as the last refresh,
   and the page says when that was rather than implying it is
   live.

   Every control writes itself into the URL, so a filtered
   view — "Cryo-NIRSP papers, most cited first" — is a link
   someone can send.
===================================================== */

import { esc, escURL } from './escape.js';
import { initTheme } from './theme.js';

const SRC = 'data/dkist_publications.json';
const ADS = 'https://ui.adsabs.harvard.edu/abs/';

const state = {
    db: null,
    q: '',
    ins: null,        // instrument name, or null for all
    group: 'all',     // all | data | instrument
    year: null,       // number, or null
    sort: 'year',     // year | cites | author
    dir: null         // 'asc' | 'desc'; null means the field's natural order
};

// Which way round a field reads when you first pick it. Dates and citations
// are interesting from the top; a list of names is only useful alphabetically.
const NATURAL = { year: 'desc', cites: 'desc', author: 'asc' };

const SORT_KEY = {
    year:   (p) => p.year,
    cites:  (p) => p.citations,
    author: (p) => p.first_author
};

// The arrow says which way; these say what that means, for the tooltip and
// for anyone on a screen reader, where a rotated glyph says nothing at all.
const DIR_WORDS = {
    year:   { desc: 'Newest first',      asc: 'Oldest first' },
    cites:  { desc: 'Most cited first',  asc: 'Least cited first' },
    author: { asc:  'A to Z',            desc: 'Z to A' }
};

const direction = () => state.dir || NATURAL[state.sort];

const $ = (s) => document.querySelector(s);

// -----------------------------------------------------
// URL <-> state
// -----------------------------------------------------

function readURL() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    state.ins = p.get('instrument') || null;
    state.group = ['data', 'instrument'].includes(p.get('group')) ? p.get('group') : 'all';
    const y = parseInt(p.get('year'), 10);
    state.year = Number.isFinite(y) ? y : null;
    state.sort = ['year', 'cites', 'author'].includes(p.get('sort')) ? p.get('sort') : 'year';
    state.dir = ['asc', 'desc'].includes(p.get('dir')) ? p.get('dir') : null;
}

function writeURL() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.ins) p.set('instrument', state.ins);
    if (state.group !== 'all') p.set('group', state.group);
    if (state.year) p.set('year', String(state.year));
    if (state.sort !== 'year') p.set('sort', state.sort);
    // Only when it differs from the natural order, so the common case keeps
    // a clean URL and a shared link does not pin something nobody chose.
    if (state.dir && state.dir !== NATURAL[state.sort]) p.set('dir', state.dir);
    const url = p.toString() ? `?${p}` : location.pathname;
    history.replaceState({}, '', url);
}

// -----------------------------------------------------
// selection
// -----------------------------------------------------

function matches(p) {
    if (state.group !== 'all' && p.group !== state.group) return false;
    if (state.ins && !p.instruments.includes(state.ins)) return false;
    if (state.year && p.year !== state.year) return false;
    if (state.q) {
        const needle = state.q.toLowerCase();
        const hay = [
            p.title, p.first_author, p.bibcode, p.journal, p.usage,
            p.authors.join(' '), p.instruments.join(' '), p.ids_cited.join(' ')
        ].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
    }
    return true;
}

function selected() {
    const rows = state.db.papers.filter(matches);
    const key = SORT_KEY[state.sort];
    const sign = direction() === 'asc' ? 1 : -1;

    return rows.sort((a, b) => {
        const ka = key(a), kb = key(b);
        const primary = typeof ka === 'string' ? ka.localeCompare(kb)
                      : (ka < kb ? -1 : ka > kb ? 1 : 0);
        if (primary) return primary * sign;
        // Ties break the same way whichever direction is showing, so flipping
        // the arrow reverses the list rather than reshuffling it.
        return b.citations - a.citations || b.year - a.year;
    });
}

// -----------------------------------------------------
// citation strings
// -----------------------------------------------------

// Et al. past two authors: a byline is for recognising a paper, not for
// crediting everyone who wrote it. The BibTeX carries the full list.
function byline(p) {
    const names = p.authors.length ? p.authors : [p.first_author];
    const short = names.map((n) => n.split(',')[0].trim());
    if (short.length === 1) return short[0];
    if (short.length === 2) return `${short[0]} & ${short[1]}`;
    return `${short[0]} et al.`;
}

function citationText(p) {
    const bits = [byline(p), p.year ? `(${p.year})` : '', p.title];
    const where = [p.journal_full || p.journal, p.volume, p.pages]
        .filter(Boolean).join(', ');
    return [bits.filter(Boolean).join(' '), where, `${ADS}${p.bibcode}`]
        .filter(Boolean).join('. ') + '.';
}

// -----------------------------------------------------
// clipboard + download
// -----------------------------------------------------

function flash(btn, label) {
    const was = btn.textContent;
    btn.textContent = label;
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = was; btn.classList.remove('done'); }, 1400);
}

async function copy(text, btn, label) {
    try {
        await navigator.clipboard.writeText(text);
        flash(btn, label);
    } catch (e) {
        // Clipboard is permission-gated and fails outright in some contexts.
        // Selecting the text is a worse experience but beats a dead button.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash(btn, label); }
        catch (e2) { flash(btn, 'press ⌘C'); }
        ta.remove();
    }
}

function downloadBib(rows, name) {
    const header = [
        '% DKIST refereed publications',
        `% ${rows.length} entries, exported ${new Date().toISOString().slice(0, 10)}`,
        `% citation counts as of ${state.db.citations_as_of}`,
        '% https://sr-dash.github.io/cryonirsp-viewer/publications.html',
        ''
    ].join('\n');
    const body = rows.map((p) => p.bibtex).filter(Boolean).join('\n\n');
    const blob = new Blob([header + '\n' + body + '\n'], { type: 'application/x-bibtex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// -----------------------------------------------------
// chart
// -----------------------------------------------------

const C = { w: 900, h: 260, l: 34, r: 40, t: 14, b: 26 };

function chart(series) {
    if (!series.length) return '';

    const iw = C.w - C.l - C.r;
    const ih = C.h - C.t - C.b;
    const step = iw / series.length;
    const bw = Math.min(38, step * 0.56);

    const maxBar = Math.max(1, ...series.map((d) => d.total));
    const maxCum = Math.max(1, ...series.map((d) => d.cumulative));

    const yBar = (v) => C.t + ih - (v / maxBar) * ih;
    const yCum = (v) => C.t + ih - (v / maxCum) * ih;
    const xMid = (i) => C.l + step * i + step / 2;

    // Horizontal guides at whole numbers that divide the range sensibly.
    const tickStep = maxBar <= 5 ? 1 : maxBar <= 12 ? 2 : maxBar <= 30 ? 5 : 10;
    let guides = '';
    for (let v = 0; v <= maxBar; v += tickStep) {
        guides += `<line class="ax-line" x1="${C.l}" y1="${yBar(v).toFixed(1)}"
                   x2="${C.l + iw}" y2="${yBar(v).toFixed(1)}" stroke-opacity="0.5"/>
                   <text class="ax-text" x="${C.l - 7}" y="${(yBar(v) + 3.5).toFixed(1)}"
                   text-anchor="end">${v}</text>`;
    }

    const bars = series.map((d, i) => {
        const x = (xMid(i) - bw / 2).toFixed(1);
        const hData = (d.data / maxBar) * ih;
        const hInst = (d.instrument / maxBar) * ih;
        const yData = (C.t + ih - hData).toFixed(1);
        const yInst = (C.t + ih - hData - hInst).toFixed(1);
        const sel = state.year === d.year ? ' sel' : '';
        const label = `${d.year}: ${d.total} refereed `
            + `(${d.data} using data, ${d.instrument} instrument), `
            + `${d.cumulative} to date, ${d.citations} citations`;
        return `<g class="yr-group${sel}" data-year="${d.year}">
            <title>${esc(label)}</title>
            ${hInst > 0.3 ? `<rect class="bar-instr" x="${x}" y="${yInst}" width="${bw.toFixed(1)}" height="${hInst.toFixed(1)}"/>` : ''}
            ${hData > 0.3 ? `<rect class="bar-data" x="${x}" y="${yData}" width="${bw.toFixed(1)}" height="${hData.toFixed(1)}"/>` : ''}
            <rect class="bar-hit" x="${(xMid(i) - step / 2).toFixed(1)}" y="${C.t}"
                  width="${step.toFixed(1)}" height="${ih}"/>
            <text class="ax-text${sel}" x="${xMid(i).toFixed(1)}" y="${C.h - 8}"
                  text-anchor="middle">${d.year}</text>
        </g>`;
    }).join('');

    const path = series.map((d, i) =>
        `${i ? 'L' : 'M'}${xMid(i).toFixed(1)},${yCum(d.cumulative).toFixed(1)}`).join(' ');
    const dots = series.map((d, i) =>
        `<circle class="cum-dot" cx="${xMid(i).toFixed(1)}" cy="${yCum(d.cumulative).toFixed(1)}" r="2.2"/>`).join('');

    return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${C.w} ${C.h}" role="img"
           aria-label="Refereed DKIST publications per year, split into papers using the data and papers describing the telescope and its instruments, with the running total.">
        ${guides}
        ${bars}
        <path class="cum-line" d="${path}"/>
        ${dots}
        <text class="ax-text" x="${C.l + iw + 8}" y="${(yCum(maxCum) + 3.5).toFixed(1)}">${maxCum}</text>
      </svg>
    </div>
    <div class="chart-legend">
      <span><i class="d"></i> papers using DKIST data</span>
      <span><i class="i"></i> instrument &amp; observatory papers</span>
      <span><i class="c"></i> running total (right axis)</span>
      <span>click a year to filter</span>
    </div>`;
}

// -----------------------------------------------------
// render
// -----------------------------------------------------

function paperHTML(p) {
    const ads = ADS + encodeURIComponent(p.bibcode);
    // Only six of the eighty-three dataset IDs these papers cite belong to
    // this archive; the rest are ViSP and VBI. Linking those would promise a
    // page that is not there, so they are stated rather than offered.
    const open = Object.entries(p.ids_resolved || {});
    const ids = open.length ? `
        <div class="cited-ids">
          <span class="lbl">Cited in this paper, held here &mdash; ${open.length}${
            open.length < p.ids_cited.length
              ? ` of ${p.ids_cited.length}` : ''}</span>
          ${open.map(([id, kind]) =>
            `<a href="./?${kind}=${encodeURIComponent(id)}"
                title="Open ${esc(id)} in the archive">${esc(id)}</a>`).join('')}
        </div>`
      : p.ids_cited.length ? `
        <div class="cited-ids none">
          <span>Cites ${p.ids_cited.length} DKIST dataset
            ${p.ids_cited.length === 1 ? 'ID' : 'IDs'} — none of them held in this archive.</span>
        </div>` : '';

    return `
    <article class="paper" data-bibcode="${esc(p.bibcode)}">
      <div class="cites">
        <div class="n${p.citations ? '' : ' zero'}">${p.citations}</div>
        <div class="k">cited</div>
      </div>
      <div>
        <h3><a href="${escURL(ads)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a></h3>
        <p class="byline">
          ${esc(byline(p))}
          ${p.n_authors > 2 ? `<span class="pub-aside">&middot; ${p.n_authors} authors</span>` : ''}
          <span class="yr">${p.year}</span>
          <span class="venue" title="${esc(p.journal_full || p.journal)}">${esc(p.journal)}</span>
        </p>
        ${p.usage ? `<p class="usage">${esc(p.usage)}</p>` : ''}
        <div class="paper-meta">
          <span class="tag grp">${p.group === 'data' ? 'uses data' : 'instrument'}</span>
          ${p.instruments.map((i) => `<span class="tag ins">${esc(i)}</span>`).join('')}
          <span class="paper-tools">
            <button class="tool" data-copy="bib">BibTeX</button>
            <button class="tool" data-copy="cite">Citation</button>
            ${p.doi ? `<a class="tool" href="${escURL('https://doi.org/' + p.doi)}"
                 target="_blank" rel="noopener noreferrer">DOI</a>` : ''}
            <a class="tool" href="${escURL(ads)}" target="_blank" rel="noopener noreferrer">ADS</a>
          </span>
        </div>
        ${ids}
      </div>
    </article>`;
}

function render() {
    const db = state.db;
    const rows = selected();
    const c = db.counts;

    const insChips = db.instruments.map((i) =>
        `<button class="chip${state.ins === i.name ? ' on' : ''}" data-ins="${esc(i.name)}">
            ${esc(i.name)} <span class="n">${i.n}</span></button>`).join('');

    $('#pubs').innerHTML = `
    <div class="pubs-inner">

      <header class="pub-head">
        <div>
          <div class="eyebrow kicker">The refereed record</div>
          <h1>What came of<br>the <em>observations.</em></h1>
          <p class="pub-lede">
            ${c.total} refereed papers that use data from the Daniel K. Inouye Solar
            Telescope or describe the telescope and its instruments, grouped by
            instrument, with citation counts from NASA ADS. ${c.citing_dataset_ids}
            cite specific dataset IDs; ${c.linking_here} of those cite Cryo-NIRSP
            data you can open directly in <a href="./?view=search">the archive</a>.
          </p>
        </div>
        <div class="pub-figures">
          <div><div class="n">${c.total}</div><div class="k">Papers</div></div>
          <div><div class="n">${c.data}</div><div class="k">Using data</div></div>
          <div><div class="n">${c.citations.toLocaleString()}</div><div class="k">Citations</div></div>
          <div><div class="n">${db.instruments.length}</div><div class="k">Instruments</div></div>
        </div>
      </header>

      <section class="pub-chart">
        <div class="pub-sechead">
          <h2>The data papers arrive after the instrument papers</h2>
          <div class="pub-aside">${db.by_year[0].year}&ndash;${db.by_year[db.by_year.length - 1].year}</div>
        </div>
        ${chart(db.by_year)}
      </section>

      <div class="pub-controls">
        <label class="pub-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
          <input id="pq" type="text" value="${esc(state.q)}" autocomplete="off" spellcheck="false"
                 placeholder="title, author, bibcode, dataset ID…" aria-label="Search publications">
        </label>
        <div class="chips">
          <button class="chip${state.group === 'all' ? ' on' : ''}" data-group="all">All</button>
          <button class="chip${state.group === 'data' ? ' on' : ''}" data-group="data">Uses data <span class="n">${c.data}</span></button>
          <button class="chip${state.group === 'instrument' ? ' on' : ''}" data-group="instrument">Instrument <span class="n">${c.instrument}</span></button>
        </div>
        <div class="chips">${insChips}</div>
        <div class="pub-actions">
          <div class="sortbox">
            <svg class="sort-ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 6h14M4 12h9M4 18h5"/>
            </svg>
            <select id="psort" aria-label="Sort publications by">
              <option value="year"${state.sort === 'year' ? ' selected' : ''}>Date</option>
              <option value="cites"${state.sort === 'cites' ? ' selected' : ''}>Citations</option>
              <option value="author"${state.sort === 'author' ? ' selected' : ''}>First author</option>
            </select>
            <button class="dirbtn${direction() === 'asc' ? ' asc' : ''}" id="pdir"
                    title="${esc(DIR_WORDS[state.sort][direction()])} — click to reverse"
                    aria-label="${esc(DIR_WORDS[state.sort][direction()])}. Click to reverse the order.">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14M6 13l6 6 6-6"/>
              </svg>
            </button>
          </div>
          <button class="btn-sm primary" id="pdl">Download .bib</button>
        </div>
      </div>

      <div class="pub-count" id="pcount"></div>
      <div class="pub-list" id="plist"></div>

      <p class="pub-note">
        Citation counts from NASA ADS, as of <strong>${esc(db.citations_as_of)}</strong>.
        Inclusion is a judgement, not a search: a paper is listed when it analyses
        DKIST data directly or describes the facility. Papers that only mention the
        telescope, forward-model its observables, or anticipate its data are
        deliberately excluded, so this list is smaller than an ADS full-text search
        for &ldquo;DKIST&rdquo; and means something more specific.
      </p>
      <p class="pub-note">
        Something missing or miscategorised? The curated record lives in
        <span class="mono">dkist-bib</span> &mdash;
        <a href="mailto:sdash@nso.edu?subject=DKIST%20publications%20list">tell me</a>
        and it goes in at the next refresh.
      </p>
    </div>`;

    renderList(rows);
    wire();
}

function renderList(rows) {
    const total = state.db.papers.length;
    const bits = [];
    if (state.group !== 'all') bits.push(state.group === 'data' ? 'using data' : 'instrument papers');
    if (state.ins) bits.push(state.ins);
    if (state.year) bits.push(String(state.year));
    if (state.q) bits.push(`matching “${state.q}”`);

    $('#pcount').innerHTML = rows.length === total
        ? `${total} papers`
        : `${rows.length} of ${total} papers${bits.length ? ' — ' + esc(bits.join(' · ')) : ''}
           <button class="tool" id="pclear" style="margin-left:10px">clear</button>`;

    $('#plist').innerHTML = rows.length
        ? rows.map(paperHTML).join('')
        : `<div class="pub-empty">Nothing matches that. <button class="tool" id="pclear2">Clear the filters</button></div>`;
}

// -----------------------------------------------------
// wiring
// -----------------------------------------------------

function update() {
    writeURL();
    render();
}

function reset() {
    state.q = ''; state.ins = null; state.group = 'all'; state.year = null;
    update();
}

function wire() {
    const q = $('#pq');
    if (q) {
        q.addEventListener('input', () => {
            state.q = q.value.trim();
            writeURL();
            renderList(selected());
            wireList();
        });
    }

    const sort = $('#psort');
    if (sort) sort.addEventListener('change', () => {
        state.sort = sort.value;
        // A new field starts in its own natural order rather than inheriting
        // the last one's: "A to Z" carried over onto citations is nonsense.
        state.dir = null;
        update();
    });

    const dir = $('#pdir');
    if (dir) dir.addEventListener('click', () => {
        state.dir = direction() === 'asc' ? 'desc' : 'asc';
        update();
    });

    const dl = $('#pdl');
    if (dl) dl.addEventListener('click', () => {
        const rows = selected();
        const tag = [state.group !== 'all' ? state.group : '', state.ins, state.year]
            .filter(Boolean).join('-').replace(/[^\w-]/g, '').toLowerCase();
        downloadBib(rows, `dkist-publications${tag ? '-' + tag : ''}.bib`);
    });

    document.querySelectorAll('[data-group]').forEach((b) =>
        b.addEventListener('click', () => { state.group = b.dataset.group; update(); }));

    document.querySelectorAll('[data-ins]').forEach((b) =>
        b.addEventListener('click', () => {
            state.ins = state.ins === b.dataset.ins ? null : b.dataset.ins;
            update();
        }));

    document.querySelectorAll('.yr-group').forEach((g) =>
        g.addEventListener('click', () => {
            const y = parseInt(g.dataset.year, 10);
            state.year = state.year === y ? null : y;
            update();
        }));

    wireList();
}

function wireList() {
    document.querySelectorAll('#pclear, #pclear2').forEach((b) =>
        b.addEventListener('click', reset));

    document.querySelectorAll('.paper [data-copy]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const code = btn.closest('.paper').dataset.bibcode;
            const p = state.db.papers.find((x) => x.bibcode === code);
            if (!p) return;
            if (btn.dataset.copy === 'bib') copy(p.bibtex, btn, 'copied');
            else copy(citationText(p), btn, 'copied');
        });
    });
}

// -----------------------------------------------------
// boot
// -----------------------------------------------------

async function boot() {
    initTheme();
    readURL();

    try {
        const res = await fetch(SRC, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        state.db = await res.json();
    } catch (e) {
        $('#pubs').innerHTML = `
        <div class="pubs-inner"><p class="pub-note">
          The publication list could not be loaded (${esc(e.message)}).
          The underlying record is <a href="${SRC}">${SRC}</a>.
        </p></div>`;
        return;
    }

    render();

    window.addEventListener('popstate', () => { readURL(); render(); });
}

boot();
