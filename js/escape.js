/* =====================================================
   ESCAPING

   Both pages build HTML as strings, and both render text
   that came from somewhere else — dataset metadata from the
   Data Center, paper titles and links from ADS. Neither is
   hostile, neither is trusted.

   These live on their own rather than in views.js so the
   publications page can use them without importing the
   whole archive renderer, and so there is exactly one
   escURL to reason about rather than two that drift.
===================================================== */

const E = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (v) => v === null || v === undefined
    ? '' : String(v).replace(/[&<>"']/g, (c) => E[c]);

// A URL bound for href. Anything that is not plain http(s) or a same-origin
// relative path is dropped rather than rendered, which keeps a javascript:
// URL from ever reaching an attribute.
export const escURL = (v) => {
    if (v === null || v === undefined) return '';
    const u = String(v).trim();
    if (u.startsWith('//')) return '';           // protocol-relative: off-site
    return (/^https?:\/\//i.test(u) || /^[\w./?=&#%-]+$/.test(u)) ? esc(u) : '';
};
