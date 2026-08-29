/* =====================================================
   LANDING

   Every number on this page is a filter entry point —
   nothing here is decoration.
===================================================== */

import { LINE_COLOR, LINE_SHORT } from './data.js';
import { esc } from './views.js';

const CX = 300, CY = 300, DISK = 132, RING = 3, OUT = 116;

const polar = (r, deg) => {
    const a = deg * Math.PI / 180;
    return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};

const LINE_NOTE = {
    hei_1083:    'Chromospheric triplet. Prominences and filaments against the limb.',
    fexiii_1074: 'Forbidden coronal line. The magnetometry workhorse — paired with 1079.8.',
    fexiii_1079: 'The ratio partner. Line-ratio density diagnostics of the same plasma.',
    six_1430:    'Rarely attempted. The deepest infrared in this archive.'
};

// Ionisation stage is a capital roman numeral, upright: He I, Fe XIII, Si X.
const ION = {
    hei_1083:    ['He I', '1083.0 nm'],
    fexiii_1074: ['Fe XIII', '1074.7 nm'],
    fexiii_1079: ['Fe XIII', '1079.8 nm'],
    six_1430:    ['Si X', '1430.0 nm']
};

export function renderLanding(el, records, meta) {
    const total = records.length;

    // ---- pointing rose ----
    const sectors = new Array(24).fill(0);
    records.forEach((r) => { if (r.pa !== null) sectors[Math.floor(r.pa / 15) % 24]++; });
    const maxSec = Math.max(1, ...sectors);

    const wedges = sectors.map((n, i) => {
        if (!n) return '';
        const a0 = i * 15 + 1.2, a1 = (i + 1) * 15 - 1.2;
        const rin = DISK + RING;
        const rout = rin + OUT * Math.pow(n / maxSec, 0.62);
        const [x0, y0] = polar(rin, a0), [x1, y1] = polar(rin, a1);
        const [x2, y2] = polar(rout, a1), [x3, y3] = polar(rout, a0);
        return `<path class="rose-wedge" data-pa="${i * 15}" style="--i:${i}"
            d="M${x0.toFixed(1)},${y0.toFixed(1)} A${rin},${rin} 0 0 0 ${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} A${rout.toFixed(1)},${rout.toFixed(1)} 0 0 1 ${x3.toFixed(1)},${y3.toFixed(1)} Z"
            fill="var(--accent)" fill-opacity="0.62"><title>PA ${i * 15}°–${i * 15 + 15}° · ${n} products</title></path>`;
    }).join('');

    const gaps = sectors.map((n, i) => n === 0 ? i : -1).filter((i) => i >= 0);
    const gapLabel = gaps.length
        ? `PA ${gaps[0] * 15}°–${(gaps[gaps.length - 1] + 1) * 15}°`
        : null;

    // ---- per-line counts ----
    const lineCounts = {};
    records.forEach((r) => { lineCounts[r.line] = (lineCounts[r.line] || 0) + 1; });
    const lineOrder = Object.keys(lineCounts).sort((a, b) => lineCounts[b] - lineCounts[a]);

    // ---- coverage ----
    const monthCounts = {};
    records.forEach((r) => { if (r.month) monthCounts[r.month] = (monthCounts[r.month] || 0) + 1; });
    const months = Object.keys(monthCounts).sort();
    const maxMonth = Math.max(1, ...Object.values(monthCounts));
    const busiest = months.reduce((a, m) => monthCounts[m] > monthCounts[a] ? m : a, months[0]);

    const nights = new Set(records.map((r) => r.date)).size;
    const programs = new Set(records.map((r) => r.program)).size;
    const bytes = records.reduce((a, r) => a + (r.sizeGiB || 0), 0);
    const superseded = records.reduce((a, r) => a + r.superseded.length, 0);
    const offLimb = records.filter((r) => r.rbin === 'near' || r.rbin === 'far').length;

    el.innerHTML = `
    <div class="landing-inner">

      <div class="hero">
        <div>
          <div class="eyebrow kicker">Coronal infrared spectropolarimetry</div>
          <h1>Every place the<br>corona has been<br><em>measured.</em></h1>
          <p class="lede">
            ${total.toLocaleString()} Level-1 products from the Daniel K. Inouye Solar Telescope,
            in ${lineOrder.length} infrared lines. Search by where the slit pointed, which line it
            sampled, and when — not by guessing an identifier.
          </p>

          <div class="cta">
            <button class="btn primary" data-go="search">
              Search the archive
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h13M12 5l7 7-7 7"/></svg>
            </button>
            <button class="btn ghost" data-go="search" data-facet="line">Browse by spectral line</button>
          </div>

          <div class="figures">
            <div><div class="n">${total.toLocaleString()}</div><div class="k">Products</div></div>
            <div><div class="n">${nights}</div><div class="k">Observing nights</div></div>
            <div><div class="n">${programs}</div><div class="k">Programs</div></div>
            <div><div class="n">${(bytes / 1024).toFixed(1)}<small> TiB</small></div><div class="k">Catalogued</div></div>
          </div>
        </div>

        <div class="rose">
          <svg viewBox="0 0 600 600" role="img" aria-label="Pointing coverage by position angle">
            <defs>
              <radialGradient id="halo"><stop offset="55%" stop-color="var(--accent)" stop-opacity="0.14"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></radialGradient>
              <radialGradient id="disk"><stop offset="0%" stop-color="var(--sunk)"/><stop offset="100%" stop-color="var(--panel)"/></radialGradient>
            </defs>
            <circle cx="300" cy="300" r="250" fill="url(#halo)"/>
            <circle cx="300" cy="300" r="176" fill="none" stroke="var(--line)" stroke-dasharray="2 5"/>
            <circle cx="300" cy="300" r="220" fill="none" stroke="var(--line)" stroke-dasharray="2 5"/>
            <g>${wedges}</g>
            <circle cx="300" cy="300" r="132" fill="url(#disk)" stroke="var(--edge)"/>
            <circle cx="300" cy="300" r="132" fill="none" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.4"/>
            <text x="300" y="152" text-anchor="middle" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="10" fill="var(--dim)">N</text>
            <text x="448" y="304" text-anchor="middle" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="10" fill="var(--dim)">W</text>
            <text x="152" y="304" text-anchor="middle" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="10" fill="var(--dim)">E</text>
          </svg>
          <div class="caption">
            <b>Pointing coverage, all ${total.toLocaleString()} products</b>
            Spoke length = observations per 15° sector.
            ${Math.round(100 * offLimb / total)}% sit above the limb.
            ${gapLabel ? `Never observed: ${gapLabel}.` : ''}
          </div>
        </div>
      </div>

      <div class="lines">
        <div class="sec-head">
          <h2>${lineOrder.length === 4 ? 'Four lines, one instrument' : 'Spectral lines'}</h2>
          <div class="aside-note">colour encodes the line everywhere in the archive</div>
        </div>
        <div class="linecards">
          ${lineOrder.map((k) => {
            const [ion, nm] = ION[k] || ['', ''];
            return `
            <button class="linecard" data-go="search" data-line="${esc(k)}" style="border-top-color:${esc(LINE_COLOR[k] || 'var(--dim)')}">
              <div class="ion">${esc(ion)}</div>
              <div class="nm" style="color:${esc(LINE_COLOR[k] || 'var(--dim)')}">${esc(nm)}</div>
              <div class="n">${lineCounts[k].toLocaleString()}</div>
              <div class="desc">${esc(LINE_NOTE[k] || '')}</div>
            </button>`;
          }).join('')}
        </div>
      </div>

      <div class="coverage">
        <div class="panel">
          <div class="sec-head">
            <h2>Observing runs cluster — this is campaigns, not a survey</h2>
            <div class="aside-note">${months.length} active months · click a bar</div>
          </div>
          <div class="cov-bars">
            ${months.map((m, i) => `<div class="b" data-month="${esc(m)}" title="${esc(m)} · ${monthCounts[m]} products"
                 style="height:${Math.max(2, 100 * monthCounts[m] / maxMonth)}%; --i:${i};${m === busiest ? 'background:var(--accent);opacity:1;' : ''}"></div>`).join('')}
          </div>
          <div class="cov-axis">
            <span>${esc(months[0])}</span>
            <span style="color:var(--accent-ink)">${esc(busiest)} &middot; ${monthCounts[busiest]} products</span>
            <span>${esc(months[months.length - 1])}</span>
          </div>
        </div>
      </div>

      <div class="foot">
        <p>
          Context imagery and daily movies courtesy of Tom Schad (NSO). Level-1 data are distributed
          by the <a href="https://dkist.data.nso.edu/" target="_blank" rel="noopener noreferrer">DKIST Data Center</a>;
          this archive indexes and cross-references them. Every superseded dataset ID still resolves.
        </p>
        <div class="stamp">
          <div>Inventory ${meta.generatedAt ? esc(meta.generatedAt.slice(0, 10)) : '—'}</div>
          <div>${superseded.toLocaleString()} superseded IDs indexed</div>
        </div>
      </div>
    </div>`;
}
