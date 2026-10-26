// Shared UI building blocks: icons, posters, stars, sheets, toasts, nav bars.
import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';

// ---------- Global overlay bus (sheets, action sheets, toasts) ----------

const bus = new Set();
let overlays = [];
let toasts = [];
const emit = () => bus.forEach(fn => fn({ overlays, toasts }));
export const onOverlay = fn => { bus.add(fn); return () => bus.delete(fn); };

let seq = 0;
export function openSheet(render, opts = {}) {
  const id = ++seq;
  overlays = [...overlays, { id, kind: 'sheet', render, opts }];
  emit();
  return () => closeOverlay(id);
}

export function closeOverlay(id) {
  overlays = overlays.map(o => (o.id === id ? { ...o, closing: true } : o));
  emit();
  setTimeout(() => { overlays = overlays.filter(o => o.id !== id); emit(); }, 280);
}

export const closeTop = () => { const top = overlays.filter(o => !o.closing).at(-1); if (top) closeOverlay(top.id); };

/** iOS-style action sheet. actions: [{ label, onClick, destructive, icon }] */
export function actionSheet({ title, message, actions, onCancel }) {
  const id = ++seq;
  overlays = [...overlays, { id, kind: 'actions', title, message, actions, onCancel }];
  emit();
}

/** Simple confirm() replacement in action-sheet style. */
export function confirmSheet({ title, message, confirm = 'Delete', destructive = true }) {
  return new Promise(resolve => {
    actionSheet({ title, message, actions: [{ label: confirm, destructive, onClick: () => resolve(true) }], onCancel: () => resolve(false) });
  });
}

export function toast(text, { action, onAction, duration = 2800 } = {}) {
  const id = ++seq;
  toasts = [...toasts, { id, text, action, onAction }];
  emit();
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emit(); }, duration);
}

export function Overlays() {
  const [st, setSt] = useState({ overlays, toasts });
  useEffect(() => onOverlay(setSt), []);
  useEffect(() => {
    document.documentElement.classList.toggle('modal-open', st.overlays.some(o => !o.closing));
  }, [st.overlays]);
  return html`
    ${st.overlays.map(o => o.kind === 'sheet'
      ? html`<${Sheet} key=${o.id} o=${o} />`
      : html`<${ActionSheetView} key=${o.id} o=${o} />`)}
    <div class="toasts" aria-live="polite">
      ${st.toasts.map(t => html`
        <div class="toast" key=${t.id}>
          <span>${t.text}</span>
          ${t.action && html`<button class="toast-action" onClick=${t.onAction}>${t.action}</button>`}
        </div>`)}
    </div>`;
}

function Sheet({ o }) {
  const close = () => closeOverlay(o.id);
  const ref = useRef();
  const drag = useRef(null);
  // Swipe down on the grabber/header to dismiss, like a native sheet.
  const onStart = e => { drag.current = { y: e.touches[0].clientY, dy: 0 }; };
  const onMove = e => {
    if (!drag.current) return;
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    drag.current.dy = dy;
    ref.current.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!drag.current) return;
    const { dy } = drag.current;
    drag.current = null;
    ref.current.style.transform = '';
    if (dy > 110) close();
  };
  return html`
    <div class=${'sheet-wrap' + (o.closing ? ' closing' : '')} role="dialog" aria-modal="true">
      <div class="backdrop" onClick=${close}></div>
      <div class=${'sheet' + (o.opts.full ? ' full' : '')} ref=${ref}>
        <div class="sheet-grab" onTouchStart=${onStart} onTouchMove=${onMove} onTouchEnd=${onEnd}><span></span></div>
        ${o.render({ close, onDragStart: onStart, onDragMove: onMove, onDragEnd: onEnd })}
      </div>
    </div>`;
}

function ActionSheetView({ o }) {
  const close = (fn) => { closeOverlay(o.id); if (fn) setTimeout(fn, 10); };
  return html`
    <div class=${'sheet-wrap actions' + (o.closing ? ' closing' : '')} role="dialog" aria-modal="true">
      <div class="backdrop" onClick=${() => close(o.onCancel)}></div>
      <div class="action-sheet">
        <div class="action-group">
          ${(o.title || o.message) && html`<div class="action-head">
            ${o.title && html`<div class="action-title">${o.title}</div>`}
            ${o.message && html`<div class="action-msg">${o.message}</div>`}
          </div>`}
          ${o.actions.map(a => html`
            <button class=${'action-btn' + (a.destructive ? ' destructive' : '')} onClick=${() => close(a.onClick)}>
              ${a.icon && html`<span class="action-icon">${a.icon}</span>`}${a.label}
            </button>`)}
        </div>
        <button class="action-btn cancel" onClick=${() => close(o.onCancel)}>Cancel</button>
      </div>
    </div>`;
}

// ---------- Icons (SF Symbols–style strokes) ----------

const paths = {
  tv: 'M3.5 7.5h17a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18V9a1.5 1.5 0 0 1 1.5-1.5Zm4.5-4 4 4 4-4M8 21.5h8',
  calendar: 'M4.5 5h15A1.5 1.5 0 0 1 21 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-13A1.5 1.5 0 0 1 4.5 5ZM3 10h18M8 3v4M16 3v4',
  search: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm5.3 12.8L21 21',
  lists: 'M6 4h12M4 8h16M4.5 12h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-5A1.5 1.5 0 0 1 4.5 12Z',
  person: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 4.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM6 18.2c1.4-2 3.5-3 6-3s4.6 1 6 3',
  back: 'M15 4l-8 8 8 8',
  chevron: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bell: 'M12 3a5.5 5.5 0 0 1 5.5 5.5c0 4.5 2 6 2 6h-15s2-1.5 2-6A5.5 5.5 0 0 1 12 3Zm-2 15.5a2 2 0 0 0 4 0',
  bellOff: 'M12 3a5.5 5.5 0 0 1 5.5 5.5c0 4.5 2 6 2 6h-15s2-1.5 2-6A5.5 5.5 0 0 1 12 3Zm-2 15.5a2 2 0 0 0 4 0M3 3l18 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1',
  trash: 'M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5A1.5 1.5 0 0 0 8 21h8a1.5 1.5 0 0 0 1.5-1.5l1-12.5M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  sparkles: 'M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8ZM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9Z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
};

export function Icon({ name, size = 24, fill, class: cls = '', stroke = 2 }) {
  return html`<svg class=${'icon ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill=${fill || 'none'}
    stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d=${paths[name]} /></svg>`;
}

// ---------- Posters ----------

const hue = str => [...(str || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function Poster({ src, title, size = 'md', badge, onClick, href }) {
  const [failed, setFailed] = useState(false);
  const inner = src && !failed
    ? html`<img src=${src} alt=${title} loading="lazy" decoding="async" onError=${() => setFailed(true)} />`
    : html`<div class="poster-fallback" style=${`--h:${hue(title)}`}><span>${title}</span></div>`;
  const content = html`${inner}${badge}`;
  if (href) return html`<a class=${'poster ' + size} href=${href} aria-label=${title}>${content}</a>`;
  return html`<div class=${'poster ' + size} onClick=${onClick}>${content}</div>`;
}

// ---------- Stars (Letterboxd-style half stars, value 0-10) ----------

export function Stars({ value, onChange, size = 28, readonly }) {
  const ref = useRef();
  const [hover, setHover] = useState(null);
  const v = hover ?? value ?? 0;
  const fromEvent = e => {
    const r = ref.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return Math.max(1, Math.min(10, Math.ceil((x / r.width) * 10)));
  };
  const handlers = readonly ? {} : {
    onPointerMove: e => e.pointerType === 'mouse' && setHover(fromEvent(e)),
    onPointerLeave: () => setHover(null),
    onTouchMove: e => { e.preventDefault(); setHover(fromEvent(e)); },
    onTouchEnd: e => { if (hover != null) { e.preventDefault(); onChange(hover === value ? null : hover); setHover(null); } },
    onClick: e => { const n = fromEvent(e); onChange(n === value ? null : n); setHover(null); },
  };
  return html`
    <div class=${'stars' + (readonly ? ' readonly' : '')} ref=${ref} style=${`--s:${size}px`} role=${readonly ? 'img' : 'slider'}
      aria-label=${`Rating ${v / 2} of 5`} aria-valuemin="0" aria-valuemax="10" aria-valuenow=${v} ...${handlers}>
      ${[1, 2, 3, 4, 5].map(i => {
        const fill = v >= i * 2 ? 1 : v === i * 2 - 1 ? 0.5 : 0;
        return html`<span class="star" key=${i}>
          <svg viewBox="0 0 24 24" width=${size} height=${size}><path class="star-bg" d=${STAR} /></svg>
          <span class="star-fill" style=${`width:${fill * 100}%`}>
            <svg viewBox="0 0 24 24" width=${size} height=${size}><path d=${STAR} /></svg>
          </span>
        </span>`;
      })}
    </div>`;
}
const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9Z';

export const starText = v => (v ? '★'.repeat(Math.floor(v / 2)) + (v % 2 ? '½' : '') : '');

// ---------- Layout pieces ----------

/** Large-title page with a compact title that fades in on scroll (iOS navigation bar). */
export function Page({ title, subtitle, back, actions, children, large = true, className = '' }) {
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef();
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { rootMargin: '-60px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return html`
    <div class=${'page ' + className}>
      <header class=${'navbar' + (scrolled || !large ? ' scrolled' : '')}>
        <div class="nav-left">${back && html`<button class="nav-back" onClick=${back.onClick}><${Icon} name="back" size=${22} stroke=${2.4} /><span>${back.label}</span></button>`}</div>
        <div class="nav-title">${title}</div>
        <div class="nav-right">${actions}</div>
      </header>
      ${large && html`<div class="large-title" ref=${sentinel}><h1>${title}</h1>${subtitle && html`<p>${subtitle}</p>`}</div>`}
      ${!large && html`<div ref=${sentinel}></div>`}
      <div class="page-body">${children}</div>
    </div>`;
}

export function Segmented({ options, value, onChange, small }) {
  return html`<div class=${'segmented' + (small ? ' small' : '')} role="tablist">
    ${options.map(o => html`<button role="tab" aria-selected=${o.value === value} class=${o.value === value ? 'on' : ''} onClick=${() => onChange(o.value)}>
      ${o.label}${o.count != null && html`<span class="seg-count">${o.count}</span>`}
    </button>`)}
  </div>`;
}

export function Empty({ emoji, title, text, children }) {
  return html`<div class="empty"><div class="empty-emoji">${emoji}</div><h3>${title}</h3>${text && html`<p>${text}</p>`}${children}</div>`;
}

export function ProgressBar({ pct, color }) {
  return html`<div class="progress"><span style=${`width:${Math.round(pct * 100)}%;${color ? 'background:' + color : ''}`}></span></div>`;
}

export function Spinner() { return html`<div class="spinner" role="progressbar" aria-label="Loading"></div>`; }

// ---------- Formatting ----------

export const pad = n => String(n).padStart(2, '0');
export const epCode = e => `S${pad(e.season)}E${pad(e.number)}`;

export function fmtDate(d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!d) return 'TBA';
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d);
  return date.toLocaleDateString(undefined, opts);
}

export function relDay(d) {
  if (!d) return 'TBA';
  const date = new Date(d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(date); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return fmtDate(date, { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

export function daysUntil(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  that.setHours(0, 0, 0, 0);
  return Math.round((that - today) / 864e5);
}

export const nav = hash => { location.hash = hash; };

/** Long-press helper for rows (context-menu style). */
export function useLongPress(onLong, ms = 480) {
  const t = useRef();
  const fired = useRef(false);
  const start = e => {
    fired.current = false;
    const p = e.touches?.[0];
    t.current = { x: p?.clientX, y: p?.clientY, timer: setTimeout(() => { fired.current = true; onLong(); }, ms) };
  };
  const move = e => {
    const p = e.touches?.[0];
    if (t.current && p && (Math.abs(p.clientX - t.current.x) > 8 || Math.abs(p.clientY - t.current.y) > 8)) clearTimeout(t.current.timer);
  };
  const cancel = () => t.current && clearTimeout(t.current.timer);
  return {
    onTouchStart: start, onTouchMove: move, onTouchEnd: cancel, onTouchCancel: cancel,
    onContextMenu: e => { e.preventDefault(); cancel(); if (!fired.current) onLong(); fired.current = true; },
    wasLong: () => fired.current,
  };
}
