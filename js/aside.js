/* =====================================================
   SPATIAL + TEMPORAL PICKERS

   The disk is the differentiator: 99% of this archive sits
   at or above the limb, and every record ships a footprint
   polygon. Drag an arc to filter by position angle.
===================================================== */

import { matches } from './query.js';
import { esc } from './views.js';

const SECTORS = 24;                 // 15 degrees each
const R_BINS = [0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.6];

const CX = 150, CY = 150, DISK = 68, RING = 3, OUT = 74;

const polar = (r, deg) => {
    const a = deg * Math.PI / 180;
    return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};

function wedgePath(i, frac) {
    const a0 = i * 15 + 1.1, a1 = (i + 1) * 15 - 1.1;
    const rin = DISK + RING;
    const rout = rin + OUT * Math.pow(frac, 0.62);
    const [x0, y0] = polar(rin, a0), [x1, y1] = polar(rin, a1);
    const [x2, y2] = polar(rout, a1), [x3, y3] = polar(rout, a0);
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${rin},${rin} 0 0 0 ${x1.toFixed(1)},${y1.toFixed(1)} `
         + `L${x2.toFixed(1)},${y2.toFixed(1)} A${rout.toFixed(1)},${rout.toFixed(1)} 0 0 1 ${x3.toFixed(1)},${y3.toFixed(1)} Z`;
}

function selectionPath(range) {
    const [a, b] = range;
    const span = a <= b ? b - a : 360 - a + b;
    if (span >= 359) return `M${CX},${CY} m-${DISK},0 a${DISK},${DISK} 0 1,0 ${DISK * 2},0 a${DISK},${DISK} 0 1,0 -${DISK * 2},0`;
    const [x0, y0] = polar(DISK, a), [x1, y1] = polar(DISK, b);
    return `M${CX},${CY} L${x0.toFixed(1)},${y0.toFixed(1)} A${DISK},${DISK} 0 ${span > 180 ? 1 : 0} 0 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
}

export function renderAside(el, records, q) {
    // Pointing histogram, respecting every other part of the query.
    const poolPA = records.filter((r) => matches(r, q, 'pa'));
    const sectors = new Array(SECTORS).fill(0);
    poolPA.forEach((r) => { if (r.pa !== null) sectors[Math.floor(r.pa / 15) % SECTORS]++; });
    const maxSec = Math.max(1, ...sectors);

    const wedges = sectors.map((n, i) => n === 0 ? '' : {
        i, n,
        d: wedgePath(i, n / maxSec),
        on: !q.pa || inRange(i * 15 + 7.5, q.pa)
    }).filter(Boolean).map((w) => `
        <path class="wedge" data-sector="${w.i}" d="${w.d}" style="--i:${w.i}"
              fill="var(--accent)" fill-opacity="${w.on ? 0.65 : 0.16}"></path>`).join('');

    const paCount = q.pa ? poolPA.filter((r) => inRange(r.pa, q.pa)).length : poolPA.length;

    // Radial histogram
    const poolR = records.filter((r) => matches(r, q, 'r'));
    const rCounts = new Array(R_BINS.length - 1).fill(0);
    poolR.forEach((rec) => {
        if (rec.r === null) return;
        for (let i = 0; i < R_BINS.length - 1; i++) {
            if (rec.r >= R_BINS[i] && rec.r < R_BINS[i + 1]) { rCounts[i]++; break; }
        }
    });
    const maxR = Math.max(1, ...rCounts);

    // Month histogram
    const poolM = records.filter((r) => matches(r, q, 'months'));
    const months = [...new Set(records.map((r) => r.month).filter(Boolean))].sort();
    const mCounts = {};
    poolM.forEach((r) => { if (r.month) mCounts[r.month] = (mCounts[r.month] || 0) + 1; });
    const maxM = Math.max(1, ...Object.values(mCounts));

    el.innerHTML = `
        <section>
            <h3>Where it pointed<span>${q.pa ? 'filtered' : 'all'}</span></h3>
            <div class="note">Drag across the disk to keep a sector. Click the middle to clear.</div>

            <svg id="disk" viewBox="0 0 300 300">
                <circle cx="${CX}" cy="${CY}" r="${DISK + RING + OUT}" fill="none" stroke="var(--line)" stroke-dasharray="2 5"/>
                <g id="wedges">${wedges}</g>
                ${q.pa ? `<path class="sel-arc" d="${selectionPath(q.pa)}" fill="var(--accent)" fill-opacity="0.13" stroke="var(--accent)" stroke-opacity="0.5"/>` : ''}
                <circle cx="${CX}" cy="${CY}" r="${DISK}" fill="var(--sunk)" stroke="var(--edge)"/>
                <circle cx="${CX}" cy="${CY}" r="${DISK}" fill="none" stroke="var(--accent)" stroke-opacity="0.45" stroke-width="1.2"/>
                <text x="${CX}" y="${CY - DISK - 8}" text-anchor="middle" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="9" fill="var(--dim)">N</text>
                <text x="${CX + DISK + 14}" y="${CY + 3}" text-anchor="middle" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="9" fill="var(--dim)">W</text>
                <text x="${CX - DISK - 14}" y="${CY + 3}" text-anchor="middle" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="9" fill="var(--dim)">E</text>
            </svg>

            <div class="readout">
                <span>${q.pa ? `PA ${Math.round(q.pa[0])}°–${Math.round(q.pa[1])}°` : 'all position angles'}</span>
                <b data-count-key="pa:total" data-count="${paCount}">${paCount.toLocaleString()}</b>
            </div>
        </section>

        <section>
            <h3>Height above the limb<span>R☉</span></h3>
            <div class="hist" id="rhist">
                ${rCounts.map((n, i) => {
                    const lo = R_BINS[i], hi = R_BINS[i + 1];
                    const on = !q.r || (lo >= q.r[0] - 1e-9 && hi <= q.r[1] + 1e-9);
                    return `<div class="bar${on ? ' on' : ''}" data-rbin="${i}"
                                 title="${lo}–${hi} R☉ · ${n}"
                                 style="height:${Math.max(2, 100 * n / maxR)}%; --i:${i}"></div>`;
                }).join('')}
            </div>
            <div class="axis">
                <span>${R_BINS[0]}</span>
                <span>${q.r ? `${q.r[0].toFixed(2)}–${q.r[1].toFixed(2)} selected` : 'all heights'}</span>
                <span>${R_BINS[R_BINS.length - 1]}</span>
            </div>
        </section>

        <section>
            <h3>Observing window<span>${months.length} months</span></h3>
            <div class="hist" id="mhist" style="height:44px;">
                ${months.map((m, i) => {
                    const n = mCounts[m] || 0;
                    const on = !q.months || (m >= q.months[0] && m <= q.months[1]);
                    return `<div class="bar${on ? ' on' : ''}" data-month="${esc(m)}"
                                 title="${esc(m)} · ${n}"
                                 style="height:${Math.max(2, 100 * n / maxM)}%; --i:${i}"></div>`;
                }).join('')}
            </div>
            <div class="axis">
                <span>${esc(months[0] || '')}</span>
                <span>${q.months ? `${esc(q.months[0])} → ${esc(q.months[1])}` : 'all dates'}</span>
                <span>${esc(months[months.length - 1] || '')}</span>
            </div>
        </section>`;

    return { months };
}

function inRange(pa, [a, b]) {
    return a <= b ? (pa >= a && pa <= b) : (pa >= a || pa <= b);
}

// -----------------------------------------------------
// drag interaction on the disk
// -----------------------------------------------------

export function wireDisk(svg, onChange) {
    if (!svg) return;

    const angleAt = (evt) => {
        const box = svg.getBoundingClientRect();
        const x = (evt.clientX - box.left) / box.width * 300 - CX;
        const y = (evt.clientY - box.top) / box.height * 300 - CY;
        const rad = Math.hypot(x, y);
        return { deg: (Math.atan2(-y, x) * 180 / Math.PI + 360) % 360, rad };
    };

    let from = null;

    svg.addEventListener('pointerdown', (e) => {
        const { deg, rad } = angleAt(e);
        if (rad < DISK * 0.55) { onChange(null); return; }   // centre clears
        from = deg;
        svg.setPointerCapture(e.pointerId);
    });

    svg.addEventListener('pointermove', (e) => {
        if (from === null) return;
        const { deg } = angleAt(e);
        onChange(normalise(from, deg), true);
    });

    const finish = (e) => {
        if (from === null) return;
        const { deg } = angleAt(e);
        const span = Math.abs(deg - from);
        // A click, not a drag: select the single 15° sector under the cursor.
        onChange(span < 3 ? [Math.floor(from / 15) * 15, Math.floor(from / 15) * 15 + 15] : normalise(from, deg));
        from = null;
    };

    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', () => { from = null; });
}

function normalise(a, b) {
    // Keep the arc the user swept, in the direction they swept it.
    const cw = (a - b + 360) % 360;
    const ccw = (b - a + 360) % 360;
    return ccw <= cw ? [a, b] : [b, a];
}

export { R_BINS };
