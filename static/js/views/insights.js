// Insights, per role:
//   Administration → institute-wide (12 houses × 10 regions, filters)
//   UHC        → their house: LHC activity, regional spread, rank among houses
//   LHC        → themselves + their region: peers, houses active in the region, rank among regions
import { api } from '../api.js';
import { $, crest, html, rupees } from '../ui.js';

const SERIES = [
  ['completed', 'Held', 'var(--st-completed)'],
  ['approved', 'Approved', 'var(--st-approved)'],
  ['in_review', 'In review', 'var(--st-pending)'],
  ['rejected', 'Rejected', 'var(--st-rejected)'],
  ['cancelled', 'Cancelled', 'var(--st-cancelled)'],
];

export async function render(el, ctx) {
  const { user, meta, query } = ctx;
  ctx.setTitle('Insights');
  if (user.role === 'UHC') return renderHouse(el, ctx);
  if (user.role === 'LHC') return renderMe(el, ctx);
  const f = {
    house_id: query.get('house') ?? (user.role === 'UHC' ? String(user.house_id) : ''),
    region_id: query.get('region') || '',
  };

  el.innerHTML = String(html`
    <div class="page-head">
      <div class="page-head-text"><h1 class="page-title">Insights</h1>
        <p class="page-sub">How meetups are spread across houses and regions. Counts exclude drafts.</p></div>
      <div class="page-actions">
        <select class="select select-sm" name="house_id" aria-label="House"><option value="">All houses</option>
          ${meta.houses.map((h) => html`<option value="${h.id}" ${String(h.id) === f.house_id ? 'selected' : ''}>${h.name}</option>`)}</select>
        <select class="select select-sm" name="region_id" aria-label="Region"><option value="">All regions</option>
          ${meta.regions.map((r) => html`<option value="${r.id}" ${String(r.id) === f.region_id ? 'selected' : ''}>${r.name}</option>`)}</select>
      </div>
    </div>
    <div id="insightsBody"></div>`);

  const body = $('#insightsBody', el);
  const load = async () => {
    const p = new URLSearchParams();
    if (f.house_id) p.set('house', f.house_id);
    if (f.region_id) p.set('region', f.region_id);
    history.replaceState(null, '', `#/insights${p.size ? '?' + p : ''}`);
    const s = await api.get('/api/stats', f);
    if (!ctx.isCurrent()) return;
    body.innerHTML = String(view(s, meta));
  };
  el.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => { f[sel.name] = sel.value; load(); }));
  await load();
}

function view(s, meta) {
  const t = s.totals;
  const reviewTime = t.median_review_hours == null ? '—'
    : t.median_review_hours < 48 ? html`${Math.round(t.median_review_hours)}<small>hrs</small>`
      : html`${(t.median_review_hours / 24).toFixed(1)}<small>days</small>`;
  return html`
    <div class="stats kpis">
      ${kpi('Meetups', t.total, `${t.in_review} in review`)}
      ${kpi('Approval rate', t.approval_rate == null ? '—' : html`${t.approval_rate}<small>%</small>`, `${t.rejected} rejected`)}
      ${kpi('Median decision', reviewTime, 'Submission to decision')}
      ${kpi('Students reached', t.reached.toLocaleString('en-IN'), `${t.completed} meetups held`)}
      ${kpi('Budget approved', rupees(t.budget_approved), 'Approved + held')}
      ${kpi('Paid out', rupees(t.disbursed), `of ${rupees(t.claimed)} claimed`)}
    </div>

    <section class="card section">
      <header class="card-head"><h2 class="card-title">Houses × regions</h2>
        <span class="heat-legend hide-mobile">Fewer ${[0.15, 0.4, 0.7, 1].map((a) => html`<i style="background:color-mix(in oklab, var(--accent) ${Math.round(a * 100)}%, transparent)"></i>`)} More</span>
      </header>
      ${heatmap(s, meta)}
    </section>

    <div class="grid grid-2 section">
      ${bars('By house', s.by_house, (h) => html`${crest(h.slug)}<span>${h.name}</span>`)}
      ${bars('By region', s.by_region, (r) => html`<span class="faint" style="font-size:11px;font-weight:600;width:28px">${r.code}</span><span>${r.name}</span>`)}
    </div>

    <div class="grid grid-2 section">
      ${months(s.months)}
      ${categories(s.by_category)}
    </div>`;
}

const kpi = (label, value, note) => html`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;

function heatmap(s, meta) {
  const max = Math.max(1, ...Object.values(s.matrix));
  const houses = [...meta.houses].sort((a, b) => a.name.localeCompare(b.name));
  const colTotal = (rid) => houses.reduce((n, h) => n + s.matrix[`${h.id}-${rid}`], 0);
  const cell = (n) => {
    if (!n) return html`<div class="heat-cell">·</div>`;
    const a = 0.16 + 0.84 * (n / max);
    return html`<div class="heat-cell has ${a > 0.62 ? 'hi' : ''}" style="background:color-mix(in oklab, var(--accent) ${Math.round(a * 100)}%, var(--surface-2))">${n}</div>`;
  };
  return html`<div class="heat-wrap"><div class="heat" role="table" aria-label="Meetups by house and region">
    <div></div>
    ${meta.regions.map((r) => html`<div class="heat-col" title="${r.name}">${r.code}</div>`)}
    <div class="heat-col">Total</div>
    ${houses.map((h) => {
      const total = meta.regions.reduce((n, r) => n + s.matrix[`${h.id}-${r.id}`], 0);
      return html`<div class="heat-rowh">${crest(h.slug)}<span>${h.name}</span></div>
        ${meta.regions.map((r) => cell(s.matrix[`${h.id}-${r.id}`]))}
        <div class="heat-total">${total}</div>`;
    })}
    <div class="heat-rowh faint">Total</div>
    ${meta.regions.map((r) => html`<div class="heat-total">${colTotal(r.id)}</div>`)}
    <div></div>
  </div></div>`;
}

function bars(title, items, label) {
  const sorted = [...items].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const max = Math.max(1, ...sorted.map((i) => i.total));
  return html`<section class="card">
    <header class="card-head"><h2 class="card-title">${title}</h2></header>
    <div class="card-pad" style="padding-bottom:4px"><div class="legend">${SERIES.map(([, l, c]) => html`<span><i style="background:${c}"></i>${l}</span>`)}</div></div>
    <div class="bars">${sorted.map((i) => html`<div class="bar-row" title="${SERIES.map(([k, l]) => `${l}: ${i[k]}`).join(' · ')}">
      <div class="bar-label">${label(i)}</div>
      <div class="bar-track" style="width:${(i.total / max) * 100}%">
        ${SERIES.map(([k, , c]) => (i[k] ? html`<i style="width:${(i[k] / i.total) * 100}%;background:${c}"></i>` : ''))}
      </div>
      <div class="bar-n">${i.total}</div>
    </div>`)}</div>
  </section>`;
}

function months(list, title = 'Meetups by month') {
  const max = Math.max(1, ...list.map((m) => m.count));
  const label = (key) => new Date(key + '-01T00:00').toLocaleDateString('en-IN', { month: 'short' });
  return html`<section class="card">
    <header class="card-head"><h2 class="card-title">${title}</h2><span class="count">last 6 months</span></header>
    <div class="spark">${list.map((m) => html`<div class="spark-col"><span class="spark-n">${m.count}</span><div class="spark-bar" style="height:${(m.count / max) * 100}%"></div></div>`)}</div>
    <div class="spark-x">${list.map((m) => html`<span>${label(m.month)}</span>`)}</div>
  </section>`;
}

function categories(list) {
  const sorted = [...list].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...sorted.map((c) => c.count));
  return html`<section class="card">
    <header class="card-head"><h2 class="card-title">By type</h2></header>
    <div class="bars">${sorted.map((c) => html`<div class="bar-row">
      <div class="bar-label"><span>${c.label}</span></div>
      <div class="bar-track"><i style="width:${(c.count / max) * 100}%;background:var(--accent)"></i></div>
      <div class="bar-n">${c.count}</div>
    </div>`)}</div>
  </section>`;
}


// ── UHC: house insights ─────────────────────────────────────────────────────
const rate = (r) => (r == null ? '—' : html`${r}<small>%</small>`);
const ord = (n) => `#${n}`;

async function renderHouse(el, ctx) {
  const d = await api.get('/api/insights/house');
  if (!ctx.isCurrent()) return;
  const t = d.totals;
  const active = d.lhcs.filter((l) => l.proposed > 0).length;
  el.innerHTML = String(html`
    <div class="page-head"><div class="page-head-text house-banner">${crest(d.house.slug, 'crest-lg')}
      <div><h1 class="page-title">${d.house.name} insights</h1>
        <p class="page-sub">How your house's LHCs are doing across the 10 regions. Counts exclude drafts.</p></div></div></div>

    <div class="stats kpis">
      ${kpi('Meetups', t.total, `${t.in_review} in review`)}
      ${kpi('Held', t.completed, `${ord(d.rank)} of ${d.of} houses`)}
      ${kpi('Students reached', t.reached.toLocaleString('en-IN'), 'At meetups held')}
      ${kpi('Approval rate', rate(t.approval_rate), `Institute: ${d.institute.approval_rate ?? '—'}%`)}
      ${kpi('Reimbursed', rupees(t.reimbursed), 'Claims paid out')}
      ${kpi('Active LHCs', html`${active}<small>/ ${d.lhcs.length}</small>`, 'Have proposed a meetup')}
    </div>

    <section class="card section">
      <header class="card-head"><h2 class="card-title">Your LHCs</h2><span class="count">${d.lhcs.length - active} yet to propose</span></header>
      ${peopleTable(d.lhcs, { regionCol: true })}
    </section>

    <div class="grid grid-2 section">
      ${bars('Across regions', d.by_region, (r) => html`<span class="faint" style="font-size:11px;font-weight:600;width:28px">${r.code}</span><span>${r.name}</span>`)}
      ${months(d.months, `${d.house.name} meetups by month`)}
    </div>`);
}

// ── LHC: personal + regional insights ───────────────────────────────────────
async function renderMe(el, ctx) {
  const d = await api.get('/api/insights/me');
  if (!ctx.isCurrent()) return;
  const me = d.me;
  const r = d.region;
  el.innerHTML = String(html`
    <div class="page-head"><div class="page-head-text"><h1 class="page-title">Your insights</h1>
      <p class="page-sub">Your meetups, and how ${r.name} is doing. Counts exclude drafts.</p></div></div>

    <div class="stats kpis">
      ${kpi('Proposed', me.total, `${me.in_review} in review`)}
      ${kpi('Approved', me.approved + me.completed, `Approval rate ${me.approval_rate ?? '—'}%`)}
      ${kpi('Held', me.completed, 'Meetups you hosted')}
      ${kpi('Students reached', me.reached.toLocaleString('en-IN'), 'At your meetups')}
      ${kpi('Co-hosted', me.cohosted, 'Invites you accepted')}
      ${kpi('Reimbursed', rupees(me.reimbursed), 'Paid out to you')}
    </div>

    <div class="section-head section"><h2 class="section-title">${r.name} region</h2></div>
    <div class="stats">
      ${kpi('Meetups', r.total, `${r.in_review} in review`)}
      ${kpi('Held', r.completed, `${r.reached.toLocaleString('en-IN')} students reached`)}
      ${kpi('Coming up', r.upcoming, 'Approved, not yet held')}
      ${kpi('Region rank', ord(d.rank), `of ${d.of} regions by meetups held`)}
    </div>

    <div class="grid grid-2 section">
      ${bars(`Houses active in ${r.name}`, d.by_house, (h) => html`${crest(h.slug)}<span>${h.name}</span>`)}
      ${months(d.months, `${r.name} meetups by month`)}
    </div>

    <section class="card section">
      <header class="card-head"><h2 class="card-title">LHCs in ${r.name}</h2><span class="count">one from each house</span></header>
      ${peopleTable(d.peers, { me: ctx.user.id })}
    </section>`);
}

function peopleTable(people, { regionCol = false, me = null } = {}) {
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr>
      <th>LHC</th>${regionCol ? html`<th class="hide-mobile">Region</th>` : html`<th class="hide-mobile">House</th>`}
      <th class="n">Proposed</th><th class="n">Approved</th><th class="n">Held</th>
      <th class="n hide-mobile">Reached</th><th class="n hide-mobile">Co-hosted</th><th class="hide-mobile">Last meetup</th>
    </tr></thead>
    <tbody>${people.map((p) => html`<tr class="${p.id === me ? 'is-me' : ''} ${p.proposed ? '' : 'is-quiet'}">
      <td><div class="tbl-person">${regionCol ? '' : crest(p.house_slug)}<span><b>${p.name}</b>${p.id === me ? html` <span class="tag">You</span>` : ''}
        <small class="only-mobile">${regionCol ? p.region_name : p.house_name}</small></span></div></td>
      ${regionCol ? html`<td class="hide-mobile">${p.region_name}</td>` : html`<td class="hide-mobile">${p.house_name}</td>`}
      <td class="n">${p.proposed || html`<span class="faint">0</span>`}</td><td class="n">${p.approved}</td><td class="n">${p.held}</td>
      <td class="n hide-mobile">${p.reached}</td><td class="n hide-mobile">${p.cohosted}</td>
      <td class="hide-mobile faint">${p.last_date ? new Date(p.last_date + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'None yet'}</td>
    </tr>`)}</tbody>
  </table></div>`;
}
