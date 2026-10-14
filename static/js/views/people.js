// Administration · People & access: who can sign in and as what.
// LHCs use their student email; UHC seats keep a fixed position email and are handed to each newly
// elected member by changing the holder. Bulk changes via CSV/Excel with a preview before applying.
import { api } from '../api.js';
import { $, $$, avatar, crest, empty, html, icon, on, openDialog, skeleton, toast } from '../ui.js';

const TABS = [
  { id: 'LHC', label: 'LHC', params: { role: 'LHC' } },
  { id: 'UHC', label: 'UHC', params: { role: 'UHC' } },
  { id: 'ADMINISTRATION', label: 'Administration', params: { role: 'ADMINISTRATION' } },
  { id: 'off', label: 'Access off', params: { active: '0' } },
];
const ROLE_LABEL = { LHC: 'LHC', UHC: 'UHC', ADMINISTRATION: 'Administration' };
const TEMPLATE = 'ID,Role,Name,Email,Roll number,House,Region,Position,Access\n'
  + ',LHC,Asha Kumar,24f1000001@ds.study.iitm.ac.in,24f1000001,Gir,Chennai,,On\n'
  + ',UHC,Neha Iyer,sundarbans.secretary@study.iitm.ac.in,24f1000002,Sundarbans,,Secretary,On\n';

export async function render(el, ctx) {
  const { meta, query } = ctx;
  ctx.setTitle('People & access');
  const f = { tab: TABS.some((t) => t.id === query.get('tab')) ? query.get('tab') : 'LHC', q: '', house_id: '', region_id: '' };

  el.innerHTML = String(html`
    <div class="page-head">
      <div class="page-head-text"><h1 class="page-title">People & access</h1>
        <p class="page-sub">Who can sign in, and as what. UHC seats keep their position email — after elections, hand a seat over by changing its holder.</p></div>
      <div class="page-actions">
        <a class="btn" href="/api/admin/people/export.csv">${icon('file', 'i-sm')} Export</a>
        <button class="btn" data-import>${icon('upload', 'i-sm')} Import</button>
        <button class="btn btn-primary" data-add>${icon('plus', 'i-sm')} Add person</button>
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
    $('[name=region_id]', el).hidden = f.tab === 'UHC' || f.tab === 'ADMINISTRATION';
    $('[name=house_id]', el).hidden = f.tab === 'ADMINISTRATION';
    list.innerHTML = String(people.length ? table(people, f.tab) : html`<div class="card">${empty('users', 'No one here', f.q ? 'Try a different search.' : '')}</div>`);
    history.replaceState(null, '', `#/people?tab=${f.tab}`);
  }

  on(el, 'click', '[data-tab]', (e, b) => { f.tab = b.dataset.tab; load(); });
  el.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { f[s.name] = s.value; load(); }));
  let t;
  $('[name=q]', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 220); });
  on(el, 'click', '[data-edit]', (e, b) => { const p = people.find((x) => x.id === b.dataset.edit); if (p) editPerson(ctx, p, load); });
  on(el, 'click', '[data-add]', () => editPerson(ctx, null, load, f.tab === 'off' ? 'LHC' : f.tab));
  on(el, 'click', '[data-import]', () => importPeople(load));
  await load();
}

function table(people, tab) {
  const showRegion = tab === 'LHC' || tab === 'off';
  return html`<div class="card"><div class="tbl-wrap"><table class="tbl people-tbl">
    <thead><tr><th>Name</th><th class="hide-mobile">Email</th>
      ${tab !== 'ADMINISTRATION' ? html`<th class="hide-mobile">House</th>` : ''}
      ${showRegion ? html`<th class="hide-mobile">Region</th>` : ''}
      ${tab !== 'LHC' ? html`<th class="hide-mobile">${tab === 'UHC' ? 'Position' : 'Title'}</th>` : ''}
      <th>Access</th><th></th></tr></thead>
    <tbody>${people.map((p) => html`<tr class="${p.is_active ? '' : 'is-quiet'}">
      <td><div class="tbl-person">${avatar(p, 'avatar-sm')}<span><b>${p.name}</b>
        <small>${tab === 'off' ? `${ROLE_LABEL[p.role]} · ` : ''}${p.roll_number || ''}<span class="only-mobile"> · ${p.email}</span></small></span></div></td>
      <td class="hide-mobile">${p.email}</td>
      ${tab !== 'ADMINISTRATION' ? html`<td class="hide-mobile">${p.house_slug ? html`<span class="house">${crest(p.house_slug)}<span>${p.house_name}</span></span>` : '—'}</td>` : ''}
      ${showRegion ? html`<td class="hide-mobile">${p.region_name || '—'}</td>` : ''}
      ${tab !== 'LHC' ? html`<td class="hide-mobile">${p.title || '—'}</td>` : ''}
      <td>${p.is_active ? html`<span class="status st-APPROVED"><svg class="sicon" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="currentColor"/></svg><span>On</span></span>`
        : html`<span class="status st-CANCELLED"><svg class="sicon" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>Off</span></span>`}</td>
      <td class="n"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">${p.role === 'UHC' ? 'Edit / hand over' : 'Edit'}</button></td>
    </tr>`)}</tbody></table></div></div>`;
}

// ── Add / edit one person ───────────────────────────────────────────────────
async function editPerson(ctx, p, reload, defaultRole = 'LHC') {
  const { meta } = ctx;
  const role = p ? p.role : defaultRole;
  const isMe = p && p.id === ctx.user.id;
  const pending = openDialog({
    title: p ? (p.role === 'UHC' ? `${p.house_name} · ${p.title}` : `Edit ${p.name}`) : 'Add person',
    subtitle: p ? `${ROLE_LABEL[p.role]}${p.meetups ? ` · ${p.meetups} meetup${p.meetups === 1 ? '' : 's'} proposed` : ''}` : 'They can sign in with this email once added.',
    submitLabel: p ? 'Save changes' : 'Add person',
    body: html`
      ${p && p.role === 'UHC' ? html`<div class="callout is-accent"><div class="callout-title">${icon('swap', 'i-sm')} Handing over after elections?</div>
        <p>Replace the name and roll number with the newly elected member's. The seat email stays with the position, so they sign in with it.</p></div>` : ''}
      ${p ? '' : html`<label class="field"><span class="field-label">Role</span><select class="select" name="role">
        ${['LHC', 'UHC', 'ADMINISTRATION'].map((r) => html`<option value="${r}" ${r === role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`)}</select></label>`}
      <div class="field-row">
        <label class="field"><span class="field-label">Name</span><input class="input" name="name" value="${p?.name || ''}"></label>
        <label class="field" data-role-show="LHC UHC"><span class="field-label">Roll number</span><input class="input" name="roll_number" value="${p?.roll_number || ''}" placeholder="e.g. 24f1000123"></label>
      </div>
      <label class="field"><span class="field-label" data-email-label>Email</span><input class="input" name="email" type="email" value="${p?.email || ''}">
        <span class="field-hint" data-email-hint></span></label>
      <div class="field-row">
        <label class="field" data-role-show="LHC UHC"><span class="field-label">House</span><select class="select" name="house_id"><option value="">Choose</option>
          ${meta.houses.map((h) => html`<option value="${h.id}" ${h.id === p?.house_id ? 'selected' : ''}>${h.name}</option>`)}</select></label>
        <label class="field" data-role-show="LHC"><span class="field-label">Region</span><select class="select" name="region_id"><option value="">Choose</option>
          ${meta.regions.map((r) => html`<option value="${r.id}" ${r.id === p?.region_id ? 'selected' : ''}>${r.name}</option>`)}</select></label>
        <label class="field" data-role-show="UHC ADMINISTRATION"><span class="field-label" data-title-label>Position</span><input class="input" name="title" value="${p?.title || ''}" list="uhcPositions">
          <datalist id="uhcPositions"><option value="Secretary"><option value="Deputy Secretary"><option value="Web Admin"></datalist></label>
      </div>
      <label class="toggle-row"><input type="checkbox" name="is_active" ${!p || p.is_active ? 'checked' : ''} ${isMe ? 'disabled' : ''}>
        <span><strong>Portal access</strong><small>${isMe ? "You can't turn off your own access." : 'When off, they can’t sign in or be invited. Their meetups and claims stay.'}</small></span></label>`,
    onSubmit: async (form) => {
      const data = Object.fromEntries(new FormData(form));
      data.is_active = form.is_active.checked ? 1 : 0;
      if (p) await api.put(`/api/admin/people/${p.id}`, data);
      else await api.post('/api/admin/people', data);
      return true;
    },
  });
  syncRole(role);
  if (await pending) { toast(p ? 'Saved.' : 'Person added.'); reload(); }
}

// Show the fields that apply to the role chosen in the open dialog.
document.addEventListener('change', (e) => { if (e.target.matches('#dialog select[name=role]')) syncRole(e.target.value); });
const syncRole = (role) => {
  const d = document.getElementById('dialog');
  $$('[data-role-show]', d).forEach((f) => { f.hidden = !f.dataset.roleShow.split(' ').includes(role); });
  const titleLabel = $('[data-title-label]', d);
  if (titleLabel) titleLabel.textContent = role === 'UHC' ? 'Position' : 'Title';
  const hint = $('[data-email-hint]', d);
  if (hint) hint.textContent = role === 'UHC' ? 'Seat email — stays with the position across elections.'
    : role === 'LHC' ? "The student's own IIT Madras email (student ID)." : 'Their IIT Madras email.';
};

// ── Bulk import with preview ────────────────────────────────────────────────
async function importPeople(reload) {
  let plan = null;
  const pending = openDialog({
    title: 'Import people',
    subtitle: 'Add or update many people from a CSV or Excel file. You will see the changes before anything is saved.',
    wide: true,
    submitLabel: 'Apply changes',
    body: html`
      <label class="file-drop compact" data-people-drop>${icon('upload')}<span><strong>Drop a CSV or Excel file</strong> or browse</span>
        <input type="file" accept=".csv,.xlsx,.xlsm" data-people-file></label>
      <p class="field-hint">Columns: <b>Role, Name, Email, Roll number, House, Region, Position, Access</b>. Rows match an existing person by
        <b>ID</b> (from Export) or by email; others are added. Tip: <a class="link" href="/api/admin/people/export.csv">export</a> the current list, edit it, and import it back.
        <a class="link" download="people-template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}">Download template</a></p>
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
    try {
      plan = await api.post('/api/admin/people/import', fd);
    } catch (ex) { box.innerHTML = ''; toast(ex.message, { error: true }); return; }
    const s = plan.summary;
    const show = plan.rows.filter((r) => r.action !== 'unchanged');
    box.innerHTML = String(html`
      <div class="import-summary">
        <span class="tag" style="color:var(--st-approved)">${s.create} new</span>
        <span class="tag" style="color:var(--st-completed)">${s.update} updated</span>
        <span class="tag">${s.unchanged} unchanged</span>
        ${s.error ? html`<span class="tag" style="color:var(--st-rejected)">${s.error} with errors — skipped</span>` : ''}
      </div>
      ${show.length ? html`<div class="att-list"><div class="att-rows import-rows">${show.map((r) => html`<div class="import-row is-${r.action}">
        <span class="att-n">L${r.line}</span>
        <span class="import-what">${{ create: 'New', update: 'Update', error: 'Error' }[r.action]}</span>
        <span class="import-body"><b>${r.name || '(no name)'}</b> <span class="faint">${r.email}</span>
          <small>${r.action === 'error' ? r.error : r.action === 'create' ? `${ROLE_LABEL[r.role]}` : r.changes.join(' · ')}</small></span>
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
