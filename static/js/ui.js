// Shared rendering helpers: safe HTML templating, formatting, components, overlays.

// ── Templating ──────────────────────────────────────────────────────────────
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const out = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(out).join('') : esc(v));

/** Tagged template: interpolations are escaped unless wrapped in raw()/html``. */
export function html(strings, ...vals) {
  let s = '';
  strings.forEach((str, i) => { s += str + (i < vals.length ? out(vals[i]) : ''); });
  return new Raw(s);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated event listener. */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  });
}

export const icon = (name, cls = '') => raw(`<svg class="i ${cls}"><use href="#i-${name}"/></svg>`);

// ── Formatting ──────────────────────────────────────────────────────────────
const parseDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return parseDate(iso).toLocaleDateString('en-IN', opts);
}
export const fmtLongDate = (iso) => fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}
export const fmtTimeRange = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`;

export function daysUntil(iso) {
  return Math.round((parseDate(iso) - parseDate(todayISO())) / 86400000);
}
export function relDay(iso) {
  const n = daysUntil(iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return `In ${n} days`;
  if (n < 0 && n > -7) return `${-n} days ago`;
  return fmtDate(iso);
}

const utc = (ts) => new Date(ts.replace(' ', 'T') + 'Z');
export function ago(ts) {
  if (!ts) return '';
  const s = (Date.now() - utc(ts)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return utc(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
export const fullTime = (ts) => utc(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const hoursSince = (ts) => (Date.now() - utc(ts)) / 3600000;

export const rupees = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN'));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const initials = (name) => name.replace(/^(Dr|Prof)\.\s*/, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// ── Domain labels ───────────────────────────────────────────────────────────
export const STATUS = {
  DRAFT: 'Draft',
  PEER_REVIEW: 'With co-hosts',
  PENDING: 'Awaiting decision',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  // claims
  PENDING_REVIEW: 'To verify',
  IN_PROGRESS: 'With accounts',
  // invitations
  INVITED: 'Awaiting reply',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
};
export const CLAIM_STATUS = { ...STATUS, APPROVED: 'Paid out', REJECTED: 'Rejected' };
export const ROLE = { MANAGEMENT: 'Management', UHC: 'Upper House Council', LHC: 'Lower House Council' };
export const ROLE_SHORT = { MANAGEMENT: 'Management', UHC: 'UHC', LHC: 'LHC' };

// ── Components ──────────────────────────────────────────────────────────────
// Status glyphs: a ring that fills as a meetup moves forward (Draft → Co-hosts → Awaiting → Approved → Held).
const RING = '<circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/>';
const GLYPHS = {
  dashed: '<circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.2 2"/>',
  quarter: `${RING}<path d="M7 7V3.4A3.6 3.6 0 0 1 10.6 7Z" fill="currentColor"/>`,
  half: `${RING}<path d="M7 7V3.4A3.6 3.6 0 0 1 7 10.6Z" fill="currentColor"/>`,
  three: `${RING}<path d="M7 7V3.4A3.6 3.6 0 1 1 3.4 7Z" fill="currentColor"/>`,
  done: '<circle cx="7" cy="7" r="6.3" fill="currentColor"/><path d="m4.4 7.1 1.8 1.8 3.5-3.6" fill="none" stroke="var(--surface)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<circle cx="7" cy="7" r="6.3" fill="currentColor"/><path d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2" fill="none" stroke="var(--surface)" stroke-width="1.5" stroke-linecap="round"/>',
  slash: `${RING}<path d="m3.2 10.8 7.6-7.6" stroke="currentColor" stroke-width="1.4"/>`,
};
const GLYPH_FOR = {
  meetup: { DRAFT: 'dashed', PEER_REVIEW: 'quarter', PENDING: 'half', APPROVED: 'three', COMPLETED: 'done', REJECTED: 'x', CANCELLED: 'slash' },
  claim: { PENDING_REVIEW: 'half', IN_PROGRESS: 'three', APPROVED: 'done', REJECTED: 'x' },
  invite: { INVITED: 'dashed', ACCEPTED: 'done', DECLINED: 'x' },
};
export const statusIcon = (s, kind = 'meetup') =>
  raw(`<svg class="sicon" viewBox="0 0 14 14" aria-hidden="true">${GLYPHS[GLYPH_FOR[kind][s] || 'dashed']}</svg>`);

/** Status = coloured glyph + quiet label. `kind` picks the glyph set: meetup | claim | invite. */
export function status(s, labels = STATUS, kind) {
  const k = kind || (labels === CLAIM_STATUS ? 'claim' : ['INVITED', 'ACCEPTED', 'DECLINED'].includes(s) ? 'invite' : 'meetup');
  return html`<span class="status st-${s}">${statusIcon(s, k)}<span>${labels[s] || s}</span></span>`;
}

export const crest = (slug, cls = '') => raw(`<img class="crest ${cls}" src="/static/img/houses/${esc(slug)}.png" alt="" loading="lazy">`);
export const house = (slug, name) => html`<span class="house">${crest(slug)}<span>${name}</span></span>`;

export function avatar(user, size = '') {
  const color = user.house_color || (user.role === 'MANAGEMENT' ? 'var(--accent)' : '#8C8798');
  return html`<span class="avatar ${size}" style="--c:${color}" aria-hidden="true">${initials(user.name || '?')}</span>`;
}

export function userLine(u) {
  if (u.role === 'MANAGEMENT') return u.title || 'Management';
  if (u.role === 'UHC') return `${u.house_name} · UHC ${u.title || ''}`.trim();
  return `${u.house_name} · ${u.region_name}`;
}

export function datebox(iso) {
  const d = parseDate(iso);
  const past = iso < todayISO();
  return html`<div class="datebox ${past ? 'is-past' : ''}" aria-hidden="true">
    <span class="m">${d.toLocaleDateString('en-IN', { month: 'short' })}</span>
    <span class="d">${d.getDate()}</span>
    <span class="w">${d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
  </div>`;
}

export function peerMeter(m) {
  if (!m.invites_total) return html`<span class="peers-meter faint">Solo</span>`;
  const declined = m.invites_total - m.invites_accepted - m.invites_waiting;
  const bars = [];
  for (let i = 0; i < m.invites_total; i++) bars.push(i < m.invites_accepted ? 'on' : i < m.invites_accepted + declined ? 'no' : '');
  return html`<span class="peers-meter" title="${m.invites_accepted} of ${m.invites_total} co-hosts accepted">
    <span class="meter">${bars.map((c) => html`<i class="${c}"></i>`)}</span>
    <span>${m.invites_accepted}/${m.invites_total}</span>
  </span>`;
}

/** One meetup in a list. `extra` replaces the status pill (e.g. waiting age). */
export function meetupRow(m, { extra } = {}) {
  return html`<a class="row" href="#/meetups/${m.id}">
    ${datebox(m.event_date)}
    <div class="row-main">
      <div class="row-title">${m.title}</div>
      <div class="row-meta">
        <span>${fmtTimeRange(m.start_time, m.end_time)}</span>
        <span class="sep">${m.region_name}</span>
        <span class="sep truncate">${m.proposer_name}</span>
      </div>
    </div>
    <div class="row-cell col-house">${house(m.house_slug, m.house_name)}</div>
    <div class="row-foot">
      <div class="row-cell">${peerMeter(m)}</div>
      <div class="row-status">${extra || status(m.status)}</div>
    </div>
    <span class="row-chev">${icon('chevron-right', 'i-sm')}</span>
  </a>`;
}

export function empty(iconName, title, text, action) {
  return html`<div class="empty">${icon(iconName)}<strong>${title}</strong>${text ? html`<p>${text}</p>` : ''}${action || ''}</div>`;
}

export const skeleton = (n = 3, h = 72) =>
  html`<div class="skeleton">${Array.from({ length: n }, () => html`<div class="sk" style="height:${h}px"></div>`)}</div>`;

// ── Toasts ──────────────────────────────────────────────────────────────────
export function toast(message, { error = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${error ? 'is-error' : ''}`;
  el.innerHTML = out(html`${icon(error ? 'alert' : 'check')}<span>${message}</span>`);
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, error ? 5000 : 3200);
}

// ── Dialog (modal on desktop, bottom sheet on phones) ───────────────────────
const dlg = () => $('#dialog');

/**
 * Open a dialog. `body` is html``; `onSubmit(form, dialog)` may return a promise.
 * Resolves with the submit result, or undefined if dismissed.
 */
export function openDialog({ title, subtitle, body, submitLabel = 'Save', submitClass = 'btn-primary', cancelLabel = 'Cancel', wide = false, onSubmit, footer = true }) {
  const d = dlg();
  d.className = `dialog ${wide ? 'wide' : ''}`;
  d.innerHTML = out(html`
    <form method="dialog" class="dlg-form" style="display:contents" novalidate>
      <span class="sheet-grip"></span>
      <header class="dlg-head">
        <div><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="dlg-body"><div class="form-error" data-error hidden></div>${body}</div>
      ${footer ? html`<footer class="dlg-foot">
        <button type="button" class="btn btn-ghost" data-close>${cancelLabel}</button>
        ${onSubmit ? html`<button type="submit" class="btn ${submitClass}" data-submit>${submitLabel}</button>` : ''}
      </footer>` : ''}
    </form>`);
  return new Promise((resolve) => {
    let result;
    const form = $('form', d);
    const close = () => d.close();
    $$('[data-close]', d).forEach((b) => b.addEventListener('click', close));
    d.onclick = (e) => { if (e.target === d) close(); };
    d.addEventListener('close', () => resolve(result), { once: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return close();
      const btn = $('[data-submit]', d);
      const err = $('[data-error]', d);
      err.hidden = true;
      btn.classList.add('is-loading');
      try {
        result = await onSubmit(form, d);
        if (result !== false) close();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        err.scrollIntoView({ block: 'nearest' });
      } finally {
        btn.classList.remove('is-loading');
      }
    });
    d.showModal();
    const first = $('textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select', $('.dlg-body', d));
    if (first && matchMedia('(min-width: 768px)').matches) first.focus();
  });
}

export function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false }) {
  return openDialog({
    title, body: html`<p class="muted">${text}</p>`, submitLabel: confirmLabel,
    submitClass: danger ? 'btn-danger' : 'btn-primary', onSubmit: async () => true,
  });
}

// ── Popover (anchored panel; full-width on phones) ──────────────────────────
let popCleanup = null;
export function openPopover(anchor, content, { align = 'right' } = {}) {
  closePopover();
  const pop = $('#popover');
  pop.innerHTML = out(content);
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  if (align === 'right') { pop.style.right = `${Math.max(12, innerWidth - r.right)}px`; pop.style.left = 'auto'; }
  else { pop.style.left = `${r.left}px`; pop.style.right = 'auto'; }
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const esc = (e) => { if (e.key === 'Escape') closePopover(); };
  setTimeout(() => document.addEventListener('click', away));
  document.addEventListener('keydown', esc);
  popCleanup = () => { document.removeEventListener('click', away); document.removeEventListener('keydown', esc); };
  return pop;
}
export function closePopover() {
  const pop = $('#popover');
  if (pop) pop.hidden = true;
  if (popCleanup) { popCleanup(); popCleanup = null; }
}

/** Run an async action with a loading state on `btn`; toasts errors. */
export async function busy(btn, fn) {
  btn?.classList.add('is-loading');
  try { return await fn(); }
  catch (e) { toast(e.message, { error: true }); }
  finally { btn?.classList.remove('is-loading'); }
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ── Appearance preferences (per device) ────────────────────────────────────
export const MODES = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'black', label: 'Black', icon: 'circle' },
  { id: 'system', label: 'Auto', icon: 'monitor' },
];
export const ACCENTS = [
  { id: 'terracotta', label: 'Terracotta', dark: '#DA7049', light: '#B4532D' },
  { id: 'maroon', label: 'Madras maroon', dark: '#C9646C', light: '#8A2A36' },
  { id: 'indigo', label: 'Indigo', dark: '#8B8FEA', light: '#4D52BD' },
  { id: 'forest', label: 'Forest', dark: '#62AE8A', light: '#2F6F52' },
  { id: 'ocean', label: 'Ocean', dark: '#5FA7C6', light: '#256A86' },
  { id: 'gold', label: 'Gold', dark: '#CFA75A', light: '#8A6418' },
  { id: 'graphite', label: 'Graphite', dark: '#D4D2D8', light: '#34312C' },
];
export const FONTS = [
  { id: 'jakarta', label: 'Plus Jakarta Sans', family: 'Plus+Jakarta+Sans', note: 'Friendly, the IITM default' },
  { id: 'inter', label: 'Inter', family: 'Inter', note: 'Neutral and compact' },
  { id: 'geist', label: 'Geist', family: 'Geist', note: 'Crisp and modern' },
];
const PREF_DEFAULTS = { mode: 'dark', accent: 'terracotta', font: 'jakarta', sidebar: 'expanded' };

export function getPrefs() {
  try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return { ...PREF_DEFAULTS }; }
}
export const resolvedMode = (mode) => (mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode);

export function setPrefs(patch) {
  const prefs = { ...getPrefs(), ...patch };
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  applyPrefs(prefs);
  return prefs;
}

export function applyPrefs(prefs = getPrefs()) {
  const d = document.documentElement;
  const mode = resolvedMode(prefs.mode);
  d.dataset.theme = mode;
  d.dataset.accent = prefs.accent;
  if (d.dataset.font !== prefs.font) {
    d.dataset.font = prefs.font;
    loadFont(prefs.font, 'fontLink');
  }
  document.querySelector('meta[name="theme-color"]').content = { light: '#F3F0E9', dark: '#141317', black: '#000000' }[mode];
}

/** Load a typeface stylesheet (used for the active font and for previews in Settings). */
export function loadFont(id, linkId = `font-${id}`) {
  const f = FONTS.find((x) => x.id === id) || FONTS[0];
  let link = document.getElementById(linkId);
  if (!link) { link = document.createElement('link'); link.rel = 'stylesheet'; link.id = linkId; document.head.append(link); }
  link.href = `https://fonts.googleapis.com/css2?family=${f.family}:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap`;
}
