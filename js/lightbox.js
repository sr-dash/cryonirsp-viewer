/* =====================================================
   LIGHTBOX

   The context media is served from a GitHub release, which
   sends Content-Disposition: attachment. Linking to it makes
   the browser download the file instead of showing it, which
   is not what clicking a thumbnail should do. So the preview
   happens here instead, and downloading is a labelled action
   rather than a surprise.

   The movie keeps playing where it left off when enlarged,
   and hands back its position when closed — enlarging should
   not restart what you were already watching.
===================================================== */

import { esc, escURL } from './views.js';

let root = null;
let lastFocus = null;
let onCloseReturn = null;

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

function ensure() {
    if (root) return root;
    root = document.getElementById('lightbox');
    return root;
}

export function isOpen() {
    return !!(root && root.classList.contains('open'));
}

// -----------------------------------------------------
// open
//
//   kind     'image' | 'video'
//   src      the media URL
//   caption  shown under the frame
//   startAt  seconds to resume a video from
//   wasPlaying whether to keep playing after the handover
// -----------------------------------------------------

export function open({ kind, src, caption, download, startAt = 0, wasPlaying = false, onClose }) {
    const el = ensure();
    if (!el || !src) return;

    lastFocus = document.activeElement;
    onCloseReturn = onClose || null;

    const media = kind === 'video'
        ? `<video id="lbMedia" controls playsinline preload="metadata" src="${escURL(src)}"></video>`
        : `<img id="lbMedia" src="${escURL(src)}" alt="${esc(caption || 'Context image')}">`;

    el.innerHTML = `
        <div class="lb-backdrop" data-lb-close></div>
        <div class="lb-frame" role="dialog" aria-modal="true" aria-label="${esc(caption || 'Media preview')}">
            <div class="lb-stage">${media}</div>
            <div class="lb-bar">
                <span class="lb-caption">${esc(caption || '')}</span>
                <span class="lb-actions">
                    ${kind === 'video'
                        ? `<button class="lb-btn" id="lbFull">Full screen</button>` : ''}
                    <a class="lb-btn" href="${escURL(download || src)}" download>Download</a>
                    <button class="lb-btn" data-lb-close aria-label="Close preview">Close</button>
                </span>
            </div>
        </div>`;

    el.classList.add('open');
    el.hidden = false;
    document.body.classList.add('lb-locked');

    const node = el.querySelector('#lbMedia');

    if (kind === 'video' && node) {
        // Pick up exactly where the inline player was.
        const resume = () => {
            if (startAt > 0 && Number.isFinite(node.duration)) {
                try { node.currentTime = Math.min(startAt, node.duration - 0.1); } catch (e) { /* ignore */ }
            }
            if (wasPlaying) node.play().catch(() => {});
        };
        if (node.readyState >= 1) resume();
        else node.addEventListener('loadedmetadata', resume, { once: true });

        const full = el.querySelector('#lbFull');
        if (full) full.addEventListener('click', () => {
            (node.requestFullscreen || node.webkitEnterFullscreen || (() => {})).call(node);
        });
    }

    // Focus the close control so Escape and Tab behave for keyboard users.
    const closeBtn = el.querySelector('[data-lb-close].lb-btn');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
}

// -----------------------------------------------------
// close
// -----------------------------------------------------

export function close() {
    if (!isOpen()) return;

    const node = root.querySelector('#lbMedia');
    let handback = null;

    if (node && node.tagName === 'VIDEO') {
        handback = { time: node.currentTime || 0, playing: !node.paused && !node.ended };
        node.pause();
    }

    root.classList.remove('open');
    document.body.classList.remove('lb-locked');

    const clear = () => { if (!isOpen()) root.innerHTML = ''; };
    if (REDUCED.matches) clear();
    else setTimeout(clear, 180);

    if (onCloseReturn) { try { onCloseReturn(handback); } catch (e) { /* ignore */ } }
    onCloseReturn = null;

    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
}

// -----------------------------------------------------
// wiring — one delegated listener, installed once
// -----------------------------------------------------

export function initLightbox() {
    ensure();

    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-lb-close]')) { close(); return; }

        const opener = e.target.closest('[data-media]');
        if (!opener) return;

        e.preventDefault();

        const kind = opener.dataset.media;
        const src = opener.dataset.src;
        const caption = opener.dataset.caption;

        if (kind === 'video') {
            // Hand the inline player's position over, and take it back on close.
            const inline = opener.closest('figure')?.querySelector('video');
            const startAt = inline ? inline.currentTime : 0;
            const wasPlaying = inline ? (!inline.paused && !inline.ended) : false;
            if (inline) inline.pause();

            open({
                kind, src, caption, startAt, wasPlaying,
                onClose: (back) => {
                    if (!inline || !back) return;
                    try { inline.currentTime = back.time; } catch (err) { /* ignore */ }
                    if (back.playing) inline.play().catch(() => {});
                }
            });
            return;
        }

        open({ kind, src, caption });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
    }, true);
}
