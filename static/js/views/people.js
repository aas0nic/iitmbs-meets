// Administration · People & access: who can sign in and as what.
// Everything follows the current tab: Add / Import / Export work on LHCs, UHC seats or administrators.
// LHCs use their student email. UHC seats (house × position) keep a fixed seat email and are handed to
// each newly elected member by changing the holder.
import { api } from '../api.js';
import { $, $$, avatar, crest, empty, html, icon, on, openDialog, skeleton, toast } from '../ui.js';

const TABS = [
  { id: 'LHC', label: 'LHC', params: { role: 'LHC' } },
  { id: 'UHC', label: 'UHC', params: { role: 'UHC' } },
  { id: 'ADMINISTRATION', label: 'Administration', params: { role: 'ADMINISTRATION' } },
  { id: 'off', label: 'Access off', params: { active: '0' } },
];
const ROLE_LABEL = { LHC: 'LHC', UHC: 'UHC', ADMINISTRATION: 'Administration' };
const ADD_LABEL = { LHC: 'Add LHC', ADMINISTRATION: 'Add administrator' }; // none for UHC: fixed seats
const PLURAL = { LHC: 'LHCs', UHC: 'UHC seats', ADMINISTRATION: 'administrators' };
const POSITIONS = ['Secretary', 'Deputy Secretary', 'Web Admin'];

const TEMPLATES = {
  LHC: {
    file: 'lhc-template.csv',
    csv: 'ID,Name,Email,Roll number,House,Region,Access\n,Asha Kumar,24f1000001@ds.study.iitm.ac.in,24f1000001,Gir,Chennai,On\n',
    help: html`<b>Name, Email</b> (the student's own IIT Madras email), <b>Roll number, House, Region</b>, and <b>Access</b> (On/Off).
      Rows match an existing LHC by <b>ID</b> or email; others are added.`,
  },
  UHC: {
    file: 'uhc-template.csv',
    csv: 'ID,House,Position,Name,Email,Roll number,Access\n,Sundarbans,Secretary,Neha Iyer,,24f1000002,On\n',
    help: html`<b>House</b> and <b>Position</b> (${POSITIONS.join(' / ')}) pick one of the 36 fixed seats. Put the new holder's
      <b>Name</b> and <b>Roll number</b> on the seat's row to hand it over. Seats can't be added; leave <b>Email</b> blank.`,
  },
  ADMINISTRATION: {
    file: 'administration-template.csv',
    csv: 'ID,Name,Email,Title,Access\n,Priya Raman,activities.coordinator@study.iitm.ac.in,Student Activities Office,On\n',
    help: html`<b>Name, Email</b> (IIT Madras), optional <b>Title</b>, and <b>Access</b> (On/Off).`,
  },
};

export async function render(el, ctx) {
  const { meta, query } = ctx;
  ctx.setTitle('People & access');
  const f = { tab: TABS.some((t) => t.id === query.get('tab')) ? query.get('tab') : 'LHC', q: '', house_id: '', region_id: '' };
  let view = 'list';
  try { view = localStorage.getItem('peopleView') === 'cards' ? 'cards' : 'list'; } catch { /* storage unavailable */ }
  const role = () => (f.tab === 'off' ? null : f.tab);

  el.innerHTML = String(html`
    <div class="page-head">
      <div class="page-head-text"><h1 class="page-title">People & access</h1>
        <p class="page-sub">Who can sign in, and as what. UHC seats keep their position email — after elections, hand a seat over by changing its holder.</p></div>
      <div class="page-actions">
        <button class="btn" data-export>${icon('file', 'i-sm')} Export</button>
        <button class="btn" data-import>${icon('upload', 'i-sm')} Import</button>
        <button class="btn btn-primary" data-add>${icon('plus', 'i-sm')} <span data-add-label>Add</span></button>
      </div>
    </div>
    <div class="toolbar"><div class="tabs" data-tabs></div></div>
    <div class="toolbar">
      <label class="search">${icon('search')}<input class="input" type="search" name="q" placeholder="Search name, email or roll number"></label>
      <div class="toolbar-right">
        <select class="select select-sm" name="house_id" aria-label="House"><option value="">All houses</option>
          ${meta.houses.map((h) => html`<option value="${h.id}">${h.name}</option>`)}</select>
        <select class="select select-sm" name="region_id" aria-label="Region"><option value="">All regions</option>
          ${meta.regions.map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select>
        <div class="tabs tabs-sm view-toggle" role="group" aria-label="View">
          <button class="tab" data-view="list" title="List view">${icon('menu', 'i-sm')}<span class="hide-mobile">List</span></button>
          <button class="tab" data-view="cards" title="Card view">${icon('grid', 'i-sm')}<span class="hide-mobile">Cards</span></button>
        </div>
      </div>
    </div>
    <div id="peopleList"></div>`);

  const list = $('#peopleList', el);
  let seq = 0;
  let people = [];
  async function load() {
    const mine = ++seq;
    list.innerHTML = String(skeleton(4, 56));
    const tab = TABS.find((t) => t.id === f.tab);
    const res = await api.get('/api/admin/people', { ...tab.params, q: f.q, house_id: f.house_id, region_id: f.region_id });
    if (mine !== seq || !ctx.isCurrent()) return;
    people = res.people;
    $('[data-tabs]', el).innerHTML = String(html`${TABS.map((t) => html`<button class="tab ${t.id === f.tab ? 'active' : ''}" data-tab="${t.id}">${t.label}
      <span class="n">${t.id === 'off' ? res.counts.inactive : res.counts[t.id] || 0}</span></button>`)}`);
    const r = role();
    $('[name=region_id]', el).hidden = f.tab === 'UHC' || f.tab === 'ADMINISTRATION';
    $('[name=house_id]', el).hidden = f.tab === 'ADMINISTRATION';
    $('[data-add]', el).hidden = !r || r === 'UHC'; // UHC is 36 fixed seats: hand over, never add
    $$('[data-view]', el).forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('[data-import]', el).hidden = !r;
    if (r) $('[data-add-label]', el).textContent = ADD_LABEL[r];
    list.innerHTML = String(people.length ? (view === 'cards' ? cards(people, f.tab) : table(people, f.tab))
      : html`<div class="card">${empty('users', f.tab === 'off' ? 'Everyone has access' : 'No one here', f.q ? 'Try a different search.' : '')}</div>`);
    history.replaceState(null, '', `#/people?tab=${f.tab}`);
  }

  on(el, 'click', '[data-tab]', (e, b) => { f.tab = b.dataset.tab; load(); });
  on(el, 'click', '[data-view]', (e, b) => {
    view = b.dataset.view;
    try { localStorage.setItem('peopleView', view); } catch { /* storage unavailable */ }
    load();
  });
  el.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { f[s.name] = s.value; load(); }));
  let t;
  $('[name=q]', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 220); });
  on(el, 'click', '[data-edit]', (e, b) => { const p = people.find((x) => x.id === b.dataset.edit); if (p) editPerson(ctx, p.role, p, load); });
  on(el, 'click', '[data-add]', () => role() && editPerson(ctx, role(), null, load));
  on(el, 'click', '[data-import]', () => role() && importPeople(role(), load));
  on(el, 'click', '[data-export]', () => exportPeople(f));
  await load();
}

function table(people, tab) {
  const showRegion = tab === 'LHC' || tab === 'off';
  return html`<div class="card"><div class="tbl-wrap"><table class="tbl people-tbl">
    <thead><tr><th>${tab === 'UHC' ? 'Seat holder' : 'Name'}</th>
      ${tab === 'UHC' ? html`<th class="hide-mobile">Seat</th>` : ''}
      <th class="hide-mobile">${tab === 'UHC' ? 'Seat email' : 'Email'}</th>
      ${tab === 'LHC' || tab === 'off' ? html`<th class="hide-mobile">House</th>` : ''}
      ${showRegion ? html`<th class="hide-mobile">Region</th>` : ''}
      ${tab === 'ADMINISTRATION' ? html`<th class="hide-mobile">Title</th>` : ''}
      <th>Access</th><th></th></tr></thead>
    <tbody>${people.map((p) => html`<tr class="${p.is_active ? '' : 'is-quiet'}">
      <td><div class="tbl-person">${avatar(p, 'avatar-sm')}<span><b>${p.name}</b>
        <small>${tab === 'off' ? `${ROLE_LABEL[p.role]} · ` : ''}${p.roll_number || ''}<span class="only-mobile">${tab === 'UHC' ? ` · ${p.house_name} ${p.title}` : ` · ${p.email}`}</span></small></span></div></td>
      ${tab === 'UHC' ? html`<td class="hide-mobile"><span class="house">${crest(p.house_slug)}<span>${p.house_name} · ${p.title}</span></span></td>` : ''}
      <td class="hide-mobile">${p.email}</td>
      ${tab === 'LHC' || tab === 'off' ? html`<td class="hide-mobile">${p.house_slug ? html`<span class="house">${crest(p.house_slug)}<span>${p.house_name}</span></span>` : '—'}</td>` : ''}
      ${showRegion ? html`<td class="hide-mobile">${p.region_name || '—'}</td>` : ''}
      ${tab === 'ADMINISTRATION' ? html`<td class="hide-mobile">${p.title || '—'}</td>` : ''}
      <td>${p.is_active ? html`<span class="status st-APPROVED"><svg class="sicon" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="currentColor"/></svg><span>On</span></span>`
        : html`<span class="status st-CANCELLED"><svg class="sicon" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>Off</span></span>`}</td>
      <td class="n"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">${p.role === 'UHC' ? 'Hand over / edit' : 'Edit'}</button></td>
    </tr>`)}</tbody></table></div></div>`;
}

const accessDot = (p) => (p.is_active
  ? html`<span class="status st-APPROVED"><svg class="sicon" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="currentColor"/></svg><span>On</span></span>`
  : html`<span class="status st-CANCELLED"><svg class="sicon" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>Off</span></span>`);

/** Card view. UHC: one card per house with its three seats; everyone else: one card per person. */
function cards(people, tab) {
  if (tab === 'UHC') {
    const byHouse = new Map();
    people.forEach((p) => { if (!byHouse.has(p.house_id)) byHouse.set(p.house_id, []); byHouse.get(p.house_id).push(p); });
    const order = ['Secretary', 'Deputy Secretary', 'Web Admin'];
    return html`<div class="pgrid">${[...byHouse.values()].map((seats) => html`<section class="card hcard">
      <header class="hcard-head">${crest(seats[0].house_slug, 'crest-md')}<strong>${seats[0].house_name}</strong></header>
      ${seats.sort((a, b) => order.indexOf(a.title) - order.indexOf(b.title)).map((p) => html`<div class="seat-row ${p.is_active ? '' : 'is-off'}">
        <div class="seat-row-main"><span class="seat-pos">${p.title}</span><b>${p.name}</b><small>${p.email}</small></div>
        <div class="seat-row-side">${accessDot(p)}<button class="btn btn-ghost btn-sm" data-edit="${p.id}">Hand over</button></div>
      </div>`)}
    </section>`)}</div>`;
  }
  return html`<div class="pgrid">${people.map((p) => html`<article class="card pcard ${p.is_active ? '' : 'is-off'}">
    <div class="pcard-top">${avatar(p, 'avatar-lg')}
      <div class="pcard-id"><b>${p.name}</b><small>${p.roll_number || (p.role === 'ADMINISTRATION' ? p.title || 'Administration' : '')}</small></div>
      ${accessDot(p)}</div>
    <div class="pcard-email truncate">${p.email}</div>
    <div class="pcard-tags">
      ${tab === 'off' ? html`<span class="tag">${ROLE_LABEL[p.role]}</span>` : ''}
      ${p.house_slug ? html`<span class="house">${crest(p.house_slug)}<span>${p.house_name}</span></span>` : ''}
      ${p.region_name ? html`<span class="tag">${p.region_name}</span>` : ''}
      ${p.role === 'UHC' ? html`<span class="tag">${p.title}</span>` : ''}
    </div>
    <button class="btn btn-sm btn-block" data-edit="${p.id}">${p.role === 'UHC' ? 'Hand over / edit' : 'Edit'}</button>
  </article>`)}</div>`;
}

// ── Add / edit (a different form per role) ──────────────────────────────────
const houseOptions = (meta, sel) => html`<option value="" disabled ${sel ? '' : 'selected'}>Choose a house</option>
  ${meta.houses.map((h) => html`<option value="${h.id}" ${h.id === sel ? 'selected' : ''}>${h.name}</option>`)}`;
const regionOptions = (meta, sel) => html`<option value="" disabled ${sel ? '' : 'selected'}>Choose a region</option>
  ${meta.regions.map((r) => html`<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${r.name}</option>`)}`;
const accessToggle = (p, isMe) => html`<label class="toggle-row"><input type="checkbox" name="is_active" ${!p || p.is_active ? 'checked' : ''} ${isMe ? 'disabled' : ''}>
  <span><strong>Portal access</strong><small>${isMe ? "You can't turn off your own access." : 'When off, they can’t sign in or be invited. Their meetups and claims stay.'}</small></span></label>`;

function formBody(role, p, meta, isMe) {
  if (role === 'LHC') {
    return html`
      <div class="field-row">
        <label class="field"><span class="field-label">Name</span><input class="input" name="name" value="${p?.name || ''}"></label>
        <label class="field"><span class="field-label">Roll number</span><input class="input" name="roll_number" value="${p?.roll_number || ''}" placeholder="e.g. 24f1000123"></label>
      </div>
      <label class="field"><span class="field-label">Student email</span><input class="input" name="email" type="email" value="${p?.email || ''}" placeholder="24f1000123@ds.study.iitm.ac.in">
        <span class="field-hint">Their own IIT Madras student email — they sign in with it.</span></label>
      <div class="field-row">
        <label class="field"><span class="field-label">House</span><select class="select" name="house_id">${houseOptions(meta, p?.house_id)}</select></label>
        <label class="field"><span class="field-label">Region</span><select class="select" name="region_id">${regionOptions(meta, p?.region_id)}</select></label>
      </div>
      ${accessToggle(p, isMe)}`;
  }
  if (role === 'UHC') {
    // 36 fixed seats: the seat (house · position · seat email) is locked; editing = handing it over.
    return html`
      <div class="seat-card">${crest(p.house_slug, 'crest-md')}
        <div><strong>${p.house_name} · ${p.title}</strong><small>${p.email}</small></div>
        <span class="tag">${icon('shield', 'i-sm')} Fixed seat</span></div>
      <div class="callout is-accent"><div class="callout-title">${icon('swap', 'i-sm')} Handing over after elections?</div>
        <p>Enter the newly elected member's name and roll number. They sign in with the seat email above.</p></div>
      <div class="field-row">
        <label class="field"><span class="field-label">Holder name</span><input class="input" name="name" value="${p.name}"></label>
        <label class="field"><span class="field-label">Roll number</span><input class="input" name="roll_number" value="${p.roll_number || ''}" placeholder="e.g. 24f1000123"></label>
      </div>
      ${accessToggle(p, isMe)}`;
  }
  return html`
    <label class="field"><span class="field-label">Name</span><input class="input" name="name" value="${p?.name || ''}"></label>
    <label class="field"><span class="field-label">Email</span><input class="input" name="email" type="email" value="${p?.email || ''}" placeholder="name@study.iitm.ac.in"></label>
    <label class="field"><span class="field-label">Title <span class="opt">optional</span></span><input class="input" name="title" value="${p?.title || ''}" placeholder="e.g. Student Activities Office"></label>
    ${accessToggle(p, isMe)}`;
}

async function editPerson(ctx, role, p, reload) {
  const { meta } = ctx;
  const isMe = p && p.id === ctx.user.id;
  const pending = openDialog({
    title: p ? (role === 'UHC' ? `${p.house_name} ${p.title}` : `Edit ${p.name}`) : ADD_LABEL[role],
    subtitle: p ? `${ROLE_LABEL[role]}${p.meetups ? ` · ${p.meetups} meetup${p.meetups === 1 ? '' : 's'} proposed` : ''}`
      : 'They can sign in once added.',
    submitLabel: p ? 'Save changes' : ADD_LABEL[role],
    body: formBody(role, p, meta, isMe),
    onSubmit: async (form) => {
      const data = Object.fromEntries(new FormData(form));
      data.is_active = form.is_active.checked ? 1 : 0;
      if (p) await api.put(`/api/admin/people/${p.id}`, data);
      else await api.post('/api/admin/people', { ...data, role });
      return true;
    },
  });

  if (await pending) { toast(p ? 'Saved.' : `${ROLE_LABEL[role]} added.`); reload(); }
}

// ── Export ──────────────────────────────────────────────────────────────────
async function exportPeople(f) {
  const filtered = f.q || f.house_id || f.region_id;
  const thisTab = f.tab === 'off' ? 'People with access off' : `${PLURAL[f.tab][0].toUpperCase()}${PLURAL[f.tab].slice(1)} only`;
  await openDialog({
    title: 'Export people',
    subtitle: 'Downloads a CSV file that opens in Excel. Edit it and import it back to update in bulk.',
    submitLabel: 'Download CSV',
    body: html`
      <div class="field"><span class="field-label">What to export</span>
        <div class="choice-group two">
          <label class="choice"><input type="radio" name="scope" value="tab" checked>${icon('users')}<span><strong>${thisTab}</strong><small>Columns for this list</small></span></label>
          <label class="choice"><input type="radio" name="scope" value="all">${icon('grid')}<span><strong>Everyone</strong><small>LHC, UHC and Administration</small></span></label>
        </div></div>
      ${filtered ? html`<label class="toggle-row"><input type="checkbox" name="filters" checked><span><strong>Only people matching the current filters</strong>
        <small>${[f.q && `“${f.q}”`, f.house_id && 'house', f.region_id && 'region'].filter(Boolean).join(', ')}</small></span></label>` : ''}
      ${f.tab === 'off' ? '' : html`<label class="toggle-row"><input type="checkbox" name="inactive" checked><span><strong>Include people whose access is off</strong></span></label>`}`,
    onSubmit: async (form) => {
      const p = new URLSearchParams();
      const scope = form.scope.value;
      if (scope === 'tab' && f.tab !== 'off') p.set('role', f.tab);
      if (f.tab === 'off' && scope === 'tab') p.set('active', '0');
      else if (form.inactive && !form.inactive.checked) p.set('active', '1');
      if (form.filters?.checked) {
        if (f.q) p.set('q', f.q);
        if (f.house_id) p.set('house_id', f.house_id);
        if (f.region_id) p.set('region_id', f.region_id);
      }
      const a = document.createElement('a');
      a.href = `/api/admin/people/export.csv?${p}`;
      a.download = '';
      document.body.append(a); a.click(); a.remove();
      return true;
    },
  });
}

// ── Import (per role) with preview ──────────────────────────────────────────
async function importPeople(role, reload) {
  let plan = null;
  const tpl = TEMPLATES[role];
  const pending = openDialog({
    title: `Import ${PLURAL[role]}`,
    subtitle: 'Add or update many at once from a CSV or Excel file. You will see every change before anything is saved.',
    wide: true,
    submitLabel: 'Apply changes',
    body: html`
      <div class="import-start">
        <a class="btn btn-sm" download="${tpl.file}" href="data:text/csv;charset=utf-8,${encodeURIComponent(tpl.csv)}">${icon('file', 'i-sm')} Download template</a>
        <a class="btn btn-sm btn-ghost" href="/api/admin/people/export.csv?role=${role}" download>${icon('file', 'i-sm')} Start from the current list</a>
      </div>
      <p class="field-hint">Columns: ${tpl.help}</p>
      <label class="file-drop compact" data-people-drop>${icon('upload')}<span><strong>Drop a CSV or Excel file</strong> or browse</span>
        <input type="file" accept=".csv,.xlsx,.xlsm" data-people-file></label>
      <div data-preview></div>`,
    onSubmit: async () => {
      const rows = (plan?.rows || []).filter((r) => r.action === 'create' || r.action === 'update');
      if (!rows.length) throw new Error(plan ? 'Nothing to apply — every row is unchanged or has an error.' : 'Choose a file first.');
      const res = await api.post('/api/admin/people/import/apply', { rows });
      return res.applied;
    },
  });

  async function handle(file) {
    if (!file) return;
    const box = document.querySelector('#dialog [data-preview]');
    box.innerHTML = String(skeleton(2, 40));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('role', role);
    try {
      plan = await api.post('/api/admin/people/import', fd);
    } catch (ex) { box.innerHTML = ''; toast(ex.message, { error: true }); return; }
    const s = plan.summary;
    const show = plan.rows.filter((r) => r.action !== 'unchanged');
    box.innerHTML = String(html`
      <div class="import-summary">
        <span class="tag" style="color:var(--st-approved)">${s.create} new</span>
        <span class="tag" style="color:var(--st-completed)">${s.update} ${role === 'UHC' ? 'updated / handed over' : 'updated'}</span>
        <span class="tag">${s.unchanged} unchanged</span>
        ${s.error ? html`<span class="tag" style="color:var(--st-rejected)">${s.error} with errors — skipped</span>` : ''}
      </div>
      ${show.length ? html`<div class="att-list"><div class="att-rows import-rows">${show.map((r) => html`<div class="import-row is-${r.action}">
        <span class="att-n">L${r.line}</span>
        <span class="import-what">${{ create: 'New', update: 'Update', error: 'Error' }[r.action]}</span>
        <span class="import-body"><b>${r.name || '(no name)'}</b> <span class="faint">${r.email}</span>
          <small>${r.action === 'error' ? r.error : r.action === 'create' ? 'Will be added' : r.changes.join(' · ')}</small></span>
      </div>`)}</div></div>` : html`<p class="muted">No changes — everything in the file matches the portal.</p>`}`);
  }
  const d = document.getElementById('dialog');
  d.querySelector('[data-people-file]').addEventListener('change', (e) => handle(e.target.files[0]));
  const zone = d.querySelector('[data-people-drop]');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-over'); handle(e.dataTransfer.files[0]); });

  const applied = await pending;
  if (applied) { toast(`Imported: ${applied.create} added, ${applied.update} updated.`); reload(); }
}
