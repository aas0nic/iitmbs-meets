// App shell: session, routing, navigation, notifications, account menu, sign-in.
import { api } from './api.js';
import {
  $, $$, ago, applyPrefs, avatar, closePopover, esc, getPrefs, html, icon, MODES, on, openPopover, ROLE, ROLE_SHORT, setPrefs,
  skeleton, toast, userLine,
} from './ui.js';
import { initPalette, openPalette } from './palette.js';
import * as home from './views/home.js';
import * as meetups from './views/meetups.js';
import * as detail from './views/detail.js';
import * as propose from './views/propose.js';
import * as claimForm from './views/claim-form.js';
import * as invites from './views/invites.js';
import * as claims from './views/claims.js';
import * as insights from './views/insights.js';
import * as settings from './views/settings.js';

export const state = { user: null, meta: null, badges: {} };

// ── Routing ─────────────────────────────────────────────────────────────────
const routes = [
  [/^\/home$/, home, 'home'],
  [/^\/meetups$/, meetups, 'meetups'],
  [/^\/meetups\/(\d+)$/, detail, 'meetups'],
  [/^\/meetups\/(\d+)\/edit$/, propose, 'meetups'],
  [/^\/meetups\/(\d+)\/claim$/, claimForm, 'claims', ['LHC', 'UHC']],
  [/^\/new$/, propose, 'new'],
  [/^\/invites$/, invites, 'invites', ['LHC', 'UHC']],
  [/^\/claims$/, claims, 'claims'],
  [/^\/insights$/, insights, 'insights'],
  [/^\/settings$/, settings, 'settings'],
];

export const navigate = (path) => { location.hash = '#' + path; };

function currentPath() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { path: path || '/home', query: new URLSearchParams(query) };
}

let renderToken = 0;
async function route() {
  if (!state.user) return;
  closePopover();
  closeDrawer();
  const { path, query } = currentPath();
  const match = routes.find(([re, , , roles]) => re.test(path) && (!roles || roles.includes(state.user.role)));
  if (!match) return navigate('/home');
  const [re, view, section] = match;
  if (view === propose && state.user.role === 'MANAGEMENT') return navigate('/home');
  const params = path.match(re).slice(1);
  setActive(section);

  // Fresh container per render so listeners from the previous view don't accumulate.
  const el = $('#view').cloneNode(false);
  $('#view').replaceWith(el);
  const token = ++renderToken;
  el.innerHTML = String(html`<div style="padding-top:8px">${skeleton(4)}</div>`);
  window.scrollTo(0, 0);
  try {
    const ctx = {
      user: state.user, meta: state.meta, params, query,
      isCurrent: () => token === renderToken,
      setTitle,
      refreshBadges,
      rerender: route,
    };
    await view.render(el, ctx);
  } catch (e) {
    if (token !== renderToken) return;
    el.innerHTML = String(html`<div class="card"><div class="empty">${icon('alert')}<strong>Couldn't load this page</strong><p>${e.message}</p>
      <a class="btn btn-sm" href="#/home">Go home</a></div></div>`);
  }
}

function setTitle(...crumbs) {
  // crumbs: strings or [label, href]
  const parts = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    if (Array.isArray(c)) return html`<a href="${c[1]}">${c[0]}</a>`;
    return last ? html`<b class="truncate">${c}</b>` : html`<span>${c}</span>`;
  });
  $('#topbarTitle').innerHTML = String(html`${parts.map((p, i) => html`${i ? icon('chevron-right', 'i-sm') : ''}${p}`)}`);
  document.title = `${typeof crumbs.at(-1) === 'string' ? crumbs.at(-1) + ' · ' : ''}Meetup Planner · IITM BS`;
}

// ── Navigation ──────────────────────────────────────────────────────────────
function navItems(role) {
  const items = [
    { id: 'home', label: 'Home', icon: 'home', href: '#/home' },
    { id: 'meetups', label: role === 'MANAGEMENT' ? 'Meetups' : 'Meetups', icon: 'calendar', href: '#/meetups', badge: 'meetups' },
  ];
  if (role !== 'MANAGEMENT') items.push({ id: 'invites', label: 'Co-host invites', short: 'Invites', icon: 'inbox', href: '#/invites', badge: 'invites' });
  items.push({ id: 'claims', label: 'Reimbursements', short: 'Claims', icon: 'receipt', href: '#/claims', badge: 'claims' });
  items.push({ id: 'insights', label: 'Insights', icon: 'chart', href: '#/insights' });
  return items;
}

function renderNav() {
  const { role } = state.user;
  const items = navItems(role);
  const count = (key) => {
    const n = state.badges[key];
    return n ? html`<span class="nav-count hot">${n}</span>` : '';
  };
  $('#nav').innerHTML = String(html`
    ${items.map((it) => html`<a class="nav-link" data-nav="${it.id}" href="${it.href}" data-tip="${it.label}">
      ${icon(it.icon)}<span class="nav-label">${it.label}</span>${count(it.badge)}</a>`)}
  `);

  // Phone tab bar: four destinations + account.
  const tabs = role === 'LHC'
    ? ['home', 'meetups', 'invites', 'claims']
    : role === 'MANAGEMENT' ? ['home', 'meetups', 'claims', 'insights'] : ['home', 'meetups', 'invites', 'insights'];
  $('#tabbar').innerHTML = String(html`
    ${tabs.map((id) => items.find((i) => i.id === id)).map((it) => html`
      <a data-nav="${it.id}" href="${it.href}">${icon(it.icon)}<span>${it.short || it.label}</span>${it.badge && state.badges[it.badge] ? html`<span class="nav-count">${state.badges[it.badge]}</span>` : ''}</a>`)}
    <button type="button" data-action="account">${avatar(state.user, 'avatar-sm')}<span>Me</span></button>
  `);
  setActive(currentSection);
}

let currentSection = 'home';
function setActive(section) {
  currentSection = section;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === section));
}

function renderIdentity() {
  const u = state.user;
  $('#topbarAvatar').innerHTML = String(avatar(u));
  $('#topbarName').textContent = u.name;
  $('#topbarRole').textContent = u.role === 'MANAGEMENT' ? 'Management' : `${ROLE_SHORT[u.role]} · ${u.house_name}`;
  $('#sidebarAvatar').innerHTML = String(avatar(u, 'avatar-sm'));
  $('#sidebarName').textContent = u.name;
  $('#sidebarRole').textContent = u.role === 'MANAGEMENT' ? 'Management' : `${ROLE_SHORT[u.role]} · ${u.house_name}`;
  const canPropose = u.role !== 'MANAGEMENT';
  $('#newProposalBtn').hidden = !canPropose;
  $('#newProposalIcon').hidden = !canPropose;
}

export async function refreshBadges() {
  try {
    state.badges = await api.get('/api/badges');
  } catch { return; }
  const n = state.badges.notifications;
  const b = $('#notifBadge');
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : n;
  renderNav();
}

// ── Sidebar: full, icon rail (tablet, or collapsed on desktop), or drawer (phone) ──
const tabletMq = matchMedia('(min-width: 768px) and (max-width: 1179px)');
const desktopMq = matchMedia('(min-width: 1180px)');
function syncRail() {
  const collapsed = getPrefs().sidebar === 'collapsed';
  const rail = tabletMq.matches || (desktopMq.matches && collapsed);
  $('#shell').classList.toggle('is-rail', rail);
  const t = $('.side-toggle');
  t.hidden = !desktopMq.matches;
  t.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  t.dataset.tip = collapsed ? 'Expand  [' : 'Collapse  [';
}
function toggleSidebar() {
  if (!desktopMq.matches) return;
  setPrefs({ sidebar: getPrefs().sidebar === 'collapsed' ? 'expanded' : 'collapsed' });
  syncRail();
}

// ── Drawer (phone) ──────────────────────────────────────────────────────────
function openDrawer() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; }
function closeDrawer() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }

// ── Notifications ───────────────────────────────────────────────────────────
async function showNotifications(anchor) {
  const pop = openPopover(anchor, html`<div class="pop-head"><h3>Notifications</h3></div><div class="pop-body">${skeleton(3, 52)}</div>`);
  const { notifications } = await api.get('/api/notifications');
  if (pop.hidden) return;
  pop.innerHTML = String(html`
    <div class="pop-head"><h3>Notifications</h3>
      ${notifications.some((n) => !n.is_read) ? html`<button class="btn btn-ghost btn-sm" data-mark-read>Mark all read</button>` : ''}
    </div>
    <div class="pop-body">
      ${notifications.length ? notifications.map((n) => html`
        <${n.meetup_id ? 'a' : 'div'} class="notif ${n.is_read ? '' : 'unread'}" ${n.meetup_id ? html`href="#/meetups/${n.meetup_id}"` : ''}>
          <span class="notif-dot"></span>
          <div><div class="notif-title">${n.title}</div><div class="notif-body">${n.body}</div><div class="notif-time">${ago(n.created_at)}</div></div>
        </${n.meetup_id ? 'a' : 'div'}>`)
        : html`<div class="empty">${icon('bell')}<strong>You're all caught up</strong><p>Updates on proposals, invites and claims will show up here.</p></div>`}
    </div>`);
  $('[data-mark-read]', pop)?.addEventListener('click', async () => {
    await api.post('/api/notifications/read');
    $$('.notif.unread', pop).forEach((n) => n.classList.remove('unread'));
    $('[data-mark-read]', pop)?.remove();
    refreshBadges();
  });
}

// ── Account menu ────────────────────────────────────────────────────────────
function showAccount(anchor) {
  const u = state.user;
  const { mode } = getPrefs();
  const pop = openPopover(anchor, html`
    <div class="menu">
      <div class="menu-id">${avatar(u, 'avatar-lg')}<div style="min-width:0"><strong>${u.name}</strong><small>${ROLE[u.role]}</small><small>${userLine(u)}</small></div></div>
      <div class="menu-label">Theme</div>
      <div class="mode-seg">
        ${MODES.map((m) => html`<button type="button" data-theme-set="${m.id}" class="${mode === m.id ? 'active' : ''}" title="${m.label}">${m.label}</button>`)}
      </div>
      <div class="menu-sep"></div>
      <a class="menu-item" href="#/settings">${icon('palette')} Appearance and settings</a>
      <button class="menu-item hide-mobile" data-palette type="button">${icon('search')} Search <kbd>⌘K</kbd></button>
      <button class="menu-item" data-switch type="button">${icon('swap')} Switch account</button>
      <button class="menu-item" data-signout type="button">${icon('logout')} Sign out</button>
    </div>`, { align: anchor.closest('.sidebar') || anchor.closest('.tabbar') ? 'left' : 'right' });
  pop.onclick = (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (!b) return;
    setPrefs({ mode: b.dataset.themeSet });
    $$('[data-theme-set]', pop).forEach((x) => x.classList.toggle('active', x === b));
  };
  $('[data-palette]', pop).addEventListener('click', () => { closePopover(); openPalette(); });
  $('[data-switch]', pop).addEventListener('click', signOut);
  $('[data-signout]', pop).addEventListener('click', signOut);
  // Anchored near the bottom (sidebar foot / tab bar): open upwards.
  const r = anchor.getBoundingClientRect();
  if (r.top > innerHeight / 2) { pop.style.top = 'auto'; pop.style.bottom = `${innerHeight - r.top + 8}px`; }
  else pop.style.bottom = 'auto';
}

async function signOut() {
  closePopover();
  await api.del('/api/session').catch(() => {});
  state.user = null;
  showSignin();
}

// ── Sign in ─────────────────────────────────────────────────────────────────
async function showSignin() {
  $('#shell').hidden = true;
  const root = $('#signin');
  root.hidden = false;
  const [{ featured }, meta] = await Promise.all([api.get('/api/directory'), state.meta || api.get('/api/meta')]);
  state.meta = meta;
  const roleTag = (u) => html`<span class="tag">${ROLE_SHORT[u.role]}</span>`;
  const blurb = {
    MANAGEMENT: 'Approve or reject proposals, verify claims',
    UHC: 'Oversee your house across all regions',
  };
  const acct = (u, note) => html`<button class="acct" type="button" data-uid="${u.id}">
      ${avatar(u)}<span class="acct-body"><span class="acct-name">${u.name}</span><span class="acct-sub">${note || userLine(u)}</span></span>
      ${roleTag(u)}</button>`;

  root.innerHTML = String(html`
    <section class="signin-art">
      <div class="signin-art-inner">
        <a class="brand" href="#"><img src="/static/img/iitm_logo.png" alt="" width="34" height="34"><span class="brand-text"><strong>Meetup Planner</strong><small>IIT Madras BS Degree</small></span></a>
        <div class="signin-pitch">
          <p class="signin-eyebrow">For the house councils of IIT Madras BS Degree</p>
          <h1>Plan meetups with your region. <em>Get them approved</em> in one place.</h1>
          <ol class="signin-steps">
            <li><span>1</span><div><strong>Propose</strong><small>Venue, date, budget and agenda in one form.</small></div></li>
            <li><span>2</span><div><strong>Bring in co-hosts</strong><small>Invite LHCs from your region, any house.</small></div></li>
            <li><span>3</span><div><strong>Approve and reimburse</strong><small>Management decides, then verifies your bills.</small></div></li>
          </ol>
          <div class="crest-ring">${meta.houses.map((h) => html`<img src="/static/img/houses/${h.slug}.png" alt="${h.name}" title="${h.name}">`)}</div>
        </div>
        <p class="signin-foot">12 houses · 10 regions · 156 council members</p>
      </div>
    </section>
    <section class="signin-panel">
      <div class="signin-box">
        <h2>Sign in</h2>
        <p>Continue with your institute account.</p>
        <div class="demo-note">${icon('alert', 'i-sm')}<span>Google sign-in isn't connected yet. Pick an account below to use the portal as that person.</span></div>
        <div class="acct-list">
          ${featured.map((u) => acct(u, blurb[u.role] || (u.id === 'lhc-11-5' ? `Proposer · ${u.house_name}, ${u.region_name}` : `Regional peer · ${u.house_name}, ${u.region_name}`)))}
        </div>
        <div class="or">or find anyone on the roster</div>
        <div class="search" style="max-width:none">${icon('search')}<input class="input" id="dirSearch" placeholder="Name, roll number, house or region" autocomplete="off"></div>
        <div class="dir-results" id="dirResults" hidden></div>
      </div>
    </section>`);

  on(root, 'click', '[data-uid]', async (e, b) => {
    b.style.opacity = .6;
    try {
      const { user } = await api.post('/api/session', { user_id: b.dataset.uid });
      startApp(user);
    } catch (ex) { toast(ex.message, { error: true }); b.style.opacity = 1; }
  });
  let t;
  $('#dirSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    const q = e.target.value.trim();
    t = setTimeout(async () => {
      const box = $('#dirResults');
      if (!q) { box.hidden = true; return; }
      const { users } = await api.get('/api/directory', { q });
      box.hidden = false;
      box.innerHTML = users.length ? String(html`${users.slice(0, 30).map((u) => acct(u))}`) : `<div class="empty-inline">No one matches “${esc(q)}”.</div>`;
    }, 160);
  });
}

function startApp(user) {
  state.user = user;
  $('#signin').hidden = true;
  $('#signin').innerHTML = '';
  $('#shell').hidden = false;
  renderIdentity();
  renderNav();
  refreshBadges();
  if (!location.hash || location.hash === '#') location.hash = '#/home';
  else route();
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  on(document, 'click', '[data-action]', (e, el) => {
    const a = el.dataset.action;
    if (a === 'drawer') openDrawer();
    if (a === 'palette') { closeDrawer(); openPalette(); }
    if (a === 'collapse') toggleSidebar();
    if (a === 'notifications') { e.stopPropagation(); $('#popover').hidden ? showNotifications(el) : closePopover(); }
    if (a === 'account') { e.stopPropagation(); $('#popover').hidden ? (closeDrawer(), showAccount(el)) : closePopover(); }
  });
  $('#scrim').addEventListener('click', closeDrawer);
  window.addEventListener('hashchange', route);
  window.addEventListener('auth:expired', () => { if (state.user) { state.user = null; showSignin(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refreshBadges(); });
  setInterval(() => { if (state.user && !document.hidden) refreshBadges(); }, 60000);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (getPrefs().mode === 'system') applyPrefs(); });
  initPalette(state);
  syncRail();
  tabletMq.addEventListener('change', syncRail);
  desktopMq.addEventListener('change', syncRail);
  document.addEventListener('keydown', (e) => {
    if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) toggleSidebar();
  });

  const [{ user }, meta] = await Promise.all([api.get('/api/session'), api.get('/api/meta')]);
  state.meta = meta;
  if (user) startApp(user);
  else showSignin();
}

boot();
