/* =====================================================
   APP — state, routing, wiring
===================================================== */

import { loadArchive, resolve, LINE_SHORT } from './data.js';
import { emptyQuery, runQuery, toggleFacet, toParams, fromParams,
         parseInput, describe, isEmpty, GROUPS } from './query.js';
import { renderRail, renderResults, renderDetail, LABELS, esc } from './views.js';
import { renderAside, wireDisk, R_BINS } from './aside.js';
import { renderLanding } from './landing.js';
import { initTheme } from './theme.js';
import { animateCounts, tweenNumber, recallCount, rememberCount } from './motion.js';

const PAGE_SIZE = 60;

const state = {
    archive: null,
    query: emptyQuery(),
    view: 'search',       // 'landing' | 'search'
    results: 'table',     // 'table' | 'grid'
    sort: 'date',
    limit: PAGE_SIZE,
    active: null,
    rows: [],
    // Set per update: entrance animations run when the RESULT SET changed,
    // not when the page was merely extended or a record opened.
    animate: true
};

const $ = (s) => document.querySelector(s);

// -----------------------------------------------------
// boot
// -----------------------------------------------------

(async function start() {
    try {
        state.archive = await loadArchive();
    } catch (err) {
        console.error(err);
        $('#main').innerHTML =
            `<div class="empty">Could not load the inventory.<br>
             <span style="font-size:12px;opacity:.7">${esc(err.message)}</span></div>`;
        return;
    }

    initTheme();
    readURL();
    wireChrome();
    render();
})();

// -----------------------------------------------------
// URL <-> state
// -----------------------------------------------------

function readURL() {
    const p = new URLSearchParams(location.search);

    const wanted = p.get('dataset') || p.get('product') || location.hash.replace('#', '');
    if (wanted) {
        const rec = resolve(state.archive, wanted);
        if (rec) { state.active = rec; state.view = 'search'; }
    }

    state.query = fromParams(p);
    if (p.get('view') === 'grid') state.results = 'grid';
    if (p.get('sort')) state.sort = p.get('sort');

    const hasQuery = !isEmpty(state.query);
    state.view = (wanted || hasQuery || p.get('view') === 'search') ? 'search' : 'landing';
}

function writeURL(replace) {
    const p = toParams(state.query);
    if (state.view === 'search' && isEmpty(state.query)) p.set('view', 'search');
    if (state.results !== 'table') p.set('view', state.results);
    if (state.sort !== 'date') p.set('sort', state.sort);
    if (state.active) p.set('dataset', state.active.id);

    const url = p.toString() ? `?${p}` : location.pathname;
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

// -----------------------------------------------------
// render
// -----------------------------------------------------

function sortRows(rows) {
    const s = state.sort;
    const by = {
        date: (a, b) => b.time - a.time,
        id:   (a, b) => a.id.localeCompare(b.id),
        line: (a, b) => (a.line || '').localeCompare(b.line || '') || b.time - a.time,
        r:    (a, b) => (b.r ?? -1) - (a.r ?? -1),
        dur:  (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1),
        size: (a, b) => (b.sizeGiB ?? -1) - (a.sizeGiB ?? -1),
        cal:  (a, b) => b.superseded.length - a.superseded.length,
        prod: (a, b) => (a.product || '').localeCompare(b.product || '')
    };
    return rows.slice().sort(by[s] || by.date);
}

function render() {
    const landing = $('#landing'), shell = $('#shell');

    document.querySelectorAll('[data-nav]').forEach((b) =>
        b.classList.toggle('on', b.dataset.nav === state.view));

    if (state.view === 'landing') {
        landing.hidden = false;
        shell.hidden = true;
        renderLanding(landing, state.archive.records, state.archive.meta);
        return;
    }

    landing.hidden = true;
    shell.hidden = false;

    state.rows = sortRows(runQuery(state.archive.records, state.query));

    const rail = $('#rail'), aside = $('#aside'), results = $('#results');

    renderRail(rail, state.archive.records, state.query);
    renderAside(aside, state.archive.records, state.query);
    wireDisk($('#disk'), onDiskChange);

    renderQueryBar();

    const total = state.rows.length;
    $('#count').innerHTML =
        `<b id="countN">${total.toLocaleString()}</b>
         <span>${total === state.archive.records.length
            ? 'products — the whole archive'
            : `of ${state.archive.records.length.toLocaleString()} products`}</span>`;

    tweenNumber($('#countN'), recallCount('result:total'), total);
    rememberCount('result:total', total);

    renderResults(results, state.rows, {
        view: state.results, sort: state.sort,
        limit: state.limit, activeId: state.active && state.active.id
    });

    // Restarting a CSS animation on a re-created subtree needs the class
    // applied after the nodes exist; toggling it off first lets a repeated
    // query (same filters, new sort) replay rather than sit still.
    results.classList.toggle('enter', state.animate);
    rail.classList.toggle('enter', state.animate);

    animateCounts(rail);
    animateCounts(aside);

    renderDetail($('#drawer'), state.active);
    $('#drawer').classList.toggle('open', !!state.active);
    $('#scrim').classList.toggle('on', !!state.active);
}

function renderQueryBar() {
    const chips = describe(state.query, LABELS).map((t) => `
        <button class="token" data-drop-group="${esc(t.group)}" data-drop-value="${esc(t.value)}">
            <span class="k">${esc(t.group)}:</span>
            <span style="color:${t.group === 'line' ? 'var(--' + t.value + ')' : 'var(--text)'}">${esc(t.label)}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="2.6"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>`).join('');

    $('#tokens').innerHTML = chips;
    if ($('#qinput').value !== state.query.text) $('#qinput').value = state.query.text;

    $('#activeChips').innerHTML = '';
}

// -----------------------------------------------------
// interactions
// -----------------------------------------------------

function update(mutate, opts = {}) {
    mutate();
    if (!opts.keepLimit) state.limit = PAGE_SIZE;
    // Extending the page or opening a record leaves the result set alone;
    // restaggering rows the reader is already reading would be noise.
    state.animate = opts.animate !== false && !opts.keepLimit;
    writeURL(opts.replace);
    render();
}

function onDiskChange(range, live) {
    state.query = { ...state.query, pa: range };
    if (live) {
        // Cheap path while dragging: repaint the disk and count only.
        state.rows = sortRows(runQuery(state.archive.records, state.query));
        renderAside($('#aside'), state.archive.records, state.query);
        wireDisk($('#disk'), onDiskChange);
        // Mid-drag the count must track the pointer exactly — a tween here
        // would lag behind the arc the reader is dragging.
        const n = state.rows.length;
        $('#count').innerHTML = `<b id="countN">${n.toLocaleString()}</b><span>of ${state.archive.records.length.toLocaleString()} products</span>`;
        rememberCount('result:total', n);
        return;
    }
    update(() => {});
}

function wireChrome() {
    // nav
    document.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-nav]');
        if (nav) { update(() => { state.view = nav.dataset.nav; state.active = null; }); return; }

        const go = e.target.closest('[data-go]');
        if (go) {
            update(() => {
                state.view = go.dataset.go;
                if (go.dataset.line) state.query = toggleFacet(state.query, 'line', go.dataset.line);
                if (go.dataset.month) state.query = { ...state.query, months: [go.dataset.month, go.dataset.month] };
            });
            return;
        }

        // landing histogram + rose
        const covBar = e.target.closest('.cov-bars .b');
        if (covBar) {
            update(() => {
                state.view = 'search';
                state.query = { ...state.query, months: [covBar.dataset.month, covBar.dataset.month] };
            });
            return;
        }
        const rose = e.target.closest('.rose-wedge');
        if (rose) {
            const a = Number(rose.dataset.pa);
            update(() => { state.view = 'search'; state.query = { ...state.query, pa: [a, a + 15] }; });
            return;
        }

        // facets
        const facet = e.target.closest('.facet');
        if (facet) { update(() => { state.query = toggleFacet(state.query, facet.dataset.group, facet.dataset.value); }); return; }

        if (e.target.closest('#clearAll')) { update(() => { state.query = emptyQuery(); }); return; }

        // token removal
        const drop = e.target.closest('[data-drop-group]');
        if (drop) {
            const g = drop.dataset.dropGroup;
            update(() => {
                if (g === 'pa') state.query = { ...state.query, pa: null };
                else if (g === 'r') state.query = { ...state.query, r: null };
                else if (g === 'months') state.query = { ...state.query, months: null };
                else state.query = toggleFacet(state.query, g, drop.dataset.dropValue);
            });
            return;
        }

        // sort
        const sort = e.target.closest('[data-sort]');
        if (sort) { update(() => { state.sort = sort.dataset.sort; }); return; }

        // result views
        const rv = e.target.closest('[data-results]');
        if (rv) { update(() => { state.results = rv.dataset.results; }); return; }

        // rows
        const row = e.target.closest('.row, .card');
        if (row) { update(() => { state.active = state.archive.byId.get(row.dataset.id.toUpperCase()); }, { keepLimit: true, animate: false }); return; }

        if (e.target.closest('#showMore')) { update(() => { state.limit += PAGE_SIZE; }, { keepLimit: true, replace: true }); return; }

        if (e.target.closest('#closeDrawer') || e.target.id === 'scrim') {
            update(() => { state.active = null; }, { keepLimit: true, animate: false });
            return;
        }

        // radial + month histograms
        const rbar = e.target.closest('[data-rbin]');
        if (rbar) {
            const i = Number(rbar.dataset.rbin);
            update(() => { state.query = { ...state.query, r: [R_BINS[i], R_BINS[i + 1]] }; });
            return;
        }
        const mbar = e.target.closest('#mhist [data-month]');
        if (mbar) {
            update(() => { state.query = { ...state.query, months: [mbar.dataset.month, mbar.dataset.month] }; });
            return;
        }

        // copy link
        if (e.target.closest('#copyLink')) {
            navigator.clipboard.writeText(location.href).then(() => {
                const b = $('#copyLink');
                const was = b.textContent;
                b.textContent = 'copied';
                setTimeout(() => { b.textContent = was; }, 1400);
            });
        }
    });

    // query input
    let timer;
    $('#qinput').addEventListener('input', (e) => {
        clearTimeout(timer);
        const raw = e.target.value;
        timer = setTimeout(() => {
            update(() => { state.query = parseInput(raw, state.query); state.view = 'search'; }, { replace: true });
        }, 220);
    });

    $('#qinput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(timer);
            update(() => { state.query = parseInput(e.target.value, state.query); state.view = 'search'; });
        }
        if (e.key === 'Escape') { e.target.blur(); }
    });

    // hint keys insert a prefix
    document.addEventListener('click', (e) => {
        const k = e.target.closest('.keys span');
        if (!k) return;
        const inp = $('#qinput');
        inp.value = (inp.value ? inp.value + ' ' : '') + k.textContent;
        inp.focus();
    });

    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            update(() => { state.view = 'search'; });
            $('#qinput').focus();
        }
        if (e.key === 'Escape' && state.active) update(() => { state.active = null; }, { keepLimit: true, animate: false });
    });

    window.addEventListener('popstate', () => { readURL(); render(); });
}
