/* =====================================================
   MOTION

   Small helpers for the things CSS cannot do on its own:
   counting a number up, and knowing whether to bother.

   Everything here is a no-op when the viewer has asked for
   reduced motion — the CSS is switched off by a media
   query, and these are switched off by the same query read
   from script, so the two can never disagree.
===================================================== */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

export const wantsMotion = () => !REDUCED.matches;

// Cubic ease-out. Split out so the interpolation can be checked without
// a frame loop — requestAnimationFrame is suspended in a hidden tab, which
// makes the animated path untestable in the usual way.
export const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

// Value shown at progress p. Pure.
export function tweenValue(from, to, p) {
    return Math.round(from + (to - from) * easeOutCubic(Math.min(1, Math.max(0, p))));
}

// Count from one value to another. Used for facet counts and the result
// total, which change on every keystroke — a number that slides is
// readable as "this went down", where a number that snaps is just new.
//
// The caller renders the final value into the markup first and this only
// overwrites it, so if the frame loop never runs — a hidden tab, reduced
// motion — the reader still sees the right number, just without the count.
export function tweenNumber(el, from, to, duration = 320) {
    const target = Number(to) || 0;
    const start = Number(from);

    if (!wantsMotion() || !Number.isFinite(start) || start === target) {
        el.textContent = target.toLocaleString();
        return;
    }

    // Long distances would need a long duration to look smooth; instead
    // keep the duration short and let the easing carry it.
    const t0 = performance.now();

    const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        el.textContent = tweenValue(start, target, p).toLocaleString();
        if (p < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
}

// Previous facet counts, so a re-render can animate from what was on
// screen rather than from zero. Keyed group:value.
const lastCounts = new Map();

export function rememberCount(key, value) { lastCounts.set(key, value); }
export function recallCount(key) { return lastCounts.get(key); }

// Run the number tweens for a freshly rendered subtree.
export function animateCounts(root) {
    root.querySelectorAll('[data-count-key]').forEach((el) => {
        const key = el.dataset.countKey;
        const to = Number(el.dataset.count);
        const from = recallCount(key);
        tweenNumber(el, from === undefined ? to : from, to);
        rememberCount(key, to);
    });
}
