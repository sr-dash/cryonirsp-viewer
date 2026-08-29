/* =====================================================
   THEME

   Dark is this design's default. An explicit choice wins
   and persists; with no choice the OS setting decides, and
   the page follows it live if the viewer changes it.
===================================================== */

const KEY = 'cryonirsp_theme';
const root = document.documentElement;

function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function currentTheme() {
    return root.getAttribute('data-theme') || systemTheme();
}

function apply(choice) {
    if (choice) root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');

    const btn = document.getElementById('themeToggle');
    if (btn) {
        const now = currentTheme();
        btn.setAttribute('aria-label', now === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
        btn.setAttribute('title', choice ? `${now} (click to switch)` : `following system (${now})`);
    }
}

export function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    apply(saved === 'light' || saved === 'dark' ? saved : null);

    // Follow the OS while no explicit choice has been made.
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (!root.hasAttribute('data-theme')) apply(null);
    });

    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        apply(next);
        try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    });
}
