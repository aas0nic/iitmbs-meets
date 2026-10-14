// Meetups registry: role-specific tabs + house/region/category filters, grouped by month.
import { api } from '../api.js';
import { $, empty, html, icon, meetupRow, skeleton } from '../ui.js';

const TABS = {
  MANAGEMENT: [
    { id: 'pending', label: 'Awaiting decision', params: { status: 'PENDING', sort: 'submitted' } },
    { id: 'review', label: 'With co-hosts', params: { status: 'PEER_REVIEW', sort: 'submitted' } },
    { id: 'upcoming', label: 'Upcoming', params: { status: 'APPROVED', when: 'upcoming', sort: 'date_asc' } },
    { id: 'past', label: 'Past', params: { status: 'APPROVED,COMPLETED,CANCELLED', when: 'past' } },
    { id: 'rejected', label: 'Rejected', params: { status: 'REJECTED' } },
    { id: 'all', label: 'All', params: {} },
  ],
  UHC: [
    { id: 'review', label: 'In review', params: { status: 'PEER_REVIEW,PENDING', sort: 'submitted' } },
    { id: 'upcoming', label: 'Upcoming', params: { status: 'APPROVED', when: 'upcoming', sort: 'date_asc' } },
    { id: 'past', label: 'Past', params: { status: 'APPROVED,COMPLETED,CANCELLED', when: 'past' } },
    { id: 'rejected', label: 'Rejected', params: { status: 'REJECTED' } },
    { id: 'all', label: 'All', params: {} },
    { id: 'mine', label: 'Mine', params: { mine: 1, sort: 'date_asc' } },
  ],
  LHC: [
    { id: 'mine', label: 'Mine', params: { mine: 1, sort: 'date_asc' } },
    { id: 'region', label: 'My region', params: { region: 'own', status: 'PEER_REVIEW,PENDING,APPROVED,COMPLETED', sort: 'date_asc' } },
    { id: 'upcoming', label: 'Upcoming everywhere', params: { status: 'APPROVED', when: 'upcoming', sort: 'date_asc' } },
    { id: 'past', label: 'Past', params: { status: 'COMPLETED,APPROVED', when: 'past' } },
  ],
};

export async function render(el, ctx) {
  const { user, meta, query } = ctx;
  const tabs = TABS[user.role];
  const f = {
    tab: tabs.some((t) => t.id === query.get('tab')) ? query.get('tab') : tabs[0].id,
    house: query.get('house') ?? (user.role === 'UHC' ? String(user.house_id) : ''),
    region: query.get('region') || '',
    category: query.get('category') || '',
    q: query.get('q') || '',
  };
  ctx.setTitle('Meetups');

  const sub = {
    MANAGEMENT: 'Every proposal across all houses and regions.',
    UHC: `Proposals and events from LHCs. Filtered to ${user.house_name} by default.`,
    LHC: `Your proposals, what's planned in ${user.region_name}, and approved meetups everywhere.`,
  }[user.role];

  el.innerHTML = String(html`
    <div class="page-head">
      <div class="page-head-text"><h1 class="page-title">Meetups</h1><p class="page-sub">${sub}</p></div>
      ${user.role !== 'MANAGEMENT' ? html`<div class="page-actions hide-mobile"><a class="btn btn-primary" href="#/new">${icon('plus')} New proposal</a></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="tabs" role="tablist">${tabs.map((t) => html`<button class="tab ${t.id === f.tab ? 'active' : ''}" data-tab="${t.id}" role="tab">${t.label}</button>`)}</div>
    </div>
    <div class="toolbar">
      <label class="search">${icon('search')}<input class="input" name="q" type="search" placeholder="Search title, venue, host" value="${f.q}"></label>
      <div class="toolbar-right">
        <select class="select select-sm" name="house" aria-label="House">
          <option value="">All houses</option>
          ${meta.houses.map((h) => html`<option value="${h.id}" ${String(h.id) === f.house ? 'selected' : ''}>${h.name}</option>`)}
        </select>
        <select class="select select-sm" name="region" aria-label="Region" ${f.tab === 'region' ? 'hidden' : ''}>
          <option value="">All regions</option>
          ${meta.regions.map((r) => html`<option value="${r.id}" ${String(r.id) === f.region ? 'selected' : ''}>${r.name}</option>`)}
        </select>
        <select class="select select-sm" name="category" aria-label="Category">
          <option value="">All types</option>
          ${meta.categories.map((c) => html`<option value="${c.id}" ${c.id === f.category ? 'selected' : ''}>${c.label}</option>`)}
        </select>
      </div>
    </div>
    <div id="list"></div>`);

  const list = $('#list', el);
  let seq = 0;

  async function load() {
    const mine = ++seq;
    syncUrl();
    list.innerHTML = String(skeleton(4));
    const tab = tabs.find((t) => t.id === f.tab);
    const params = { ...tab.params, q: f.q, house_id: f.house, region_id: f.region, category: f.category };
    if (params.region === 'own') { params.region_id = user.region_id; delete params.region; }
    const { meetups } = await api.get('/api/meetups', params);
    if (mine !== seq || !ctx.isCurrent()) return;
    list.innerHTML = String(meetups.length ? groups(meetups, params.sort) : emptyState(f, user));
  }

  function syncUrl() {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    history.replaceState(null, '', `#/meetups?${p}`);
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    f.tab = t.dataset.tab;
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === t));
    el.querySelector('select[name=region]').hidden = f.tab === 'region';
    if (f.tab === 'region') f.region = '';
    load();
  });
  el.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { f[s.name] = s.value; load(); }));
  let timer;
  el.querySelector('input[name=q]').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 220);
  });

  await load();
}

function groups(meetups, sort) {
  const byMonth = new Map();
  for (const m of meetups) {
    const key = m.event_date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(m);
  }
  // Queues (sorted by submission) read better as one list.
  if (sort === 'submitted' || byMonth.size === 1) {
    return html`<section class="card"><div class="rows">${meetups.map((m) => meetupRow(m))}</div></section>`;
  }
  return html`${[...byMonth].map(([key, items], i) => {
    const label = new Date(key + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return html`<section class="${i ? 'section' : ''}">
      <div class="section-head"><h2 class="section-title">${label}</h2><span class="count">${items.length}</span></div>
      <div class="card"><div class="rows">${items.map((m) => meetupRow(m))}</div></div>
    </section>`;
  })}`;
}

function emptyState(f, user) {
  const filtered = f.q || f.house || f.region || f.category;
  if (filtered) return html`<div class="card">${empty('search', 'No meetups match these filters', 'Try clearing the search or picking a different house or region.')}</div>`;
  const msg = {
    pending: ['Nothing awaiting a decision', 'Proposals show up here once their co-hosts have replied.'],
    review: ['Nothing in review', 'No proposals are waiting on co-hosts or Management.'],
    upcoming: ['No upcoming meetups', 'Approved meetups with a future date appear here.'],
    past: ['No past meetups yet', ''],
    rejected: ['No rejected proposals', ''],
    mine: ["You haven't proposed anything yet", 'Start a proposal and invite co-hosts.'],
    region: [`Nothing planned in ${user.region_name}`, 'Be the first — propose a meetup for your region.'],
    all: ['No meetups yet', ''],
  }[f.tab];
  const cta = user.role !== 'MANAGEMENT' && ['mine', 'region'].includes(f.tab)
    ? html`<a class="btn btn-primary btn-sm" href="#/new">${icon('plus')} New proposal</a>` : '';
  return html`<div class="card">${empty('calendar', msg[0], msg[1], cta)}</div>`;
}
