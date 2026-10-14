// Propose / edit a meetup.
// Co-hosts: an LHC can invite LHCs of their own region; a UHC member can invite other UHC members and
// pick any region (both enforced server-side too). Every field is required except co-hosts and the
// collaboration block — and that block's fields become required once a collaboration type is chosen.
import { api } from '../api.js';
import { $, $$, busy, clearFieldError, crest, html, icon, showFieldErrors, status, toast } from '../ui.js';

const COLLAB = [
  ['NONE', 'x', 'No collaboration', 'Just your council'],
  ['SOCIETY', 'users', 'IITM society', 'With a BS society'],
  ['EXTERNAL', 'link', 'External organisation', 'Company, community, NGO…'],
];

export async function render(el, ctx) {
  const editId = ctx.params[0];
  const u = ctx.user;
  const isUhc = u.role === 'UHC';
  const [{ peers }, existing] = await Promise.all([
    api.get('/api/peers'),
    editId ? api.get(`/api/meetups/${editId}`) : null,
  ]);
  if (!ctx.isCurrent()) return;
  if (existing && !existing.can.edit) { location.hash = `#/meetups/${editId}`; return; }

  const m = existing?.meetup || { category: '', start_time: '10:00', end_time: '13:00', collab_type: 'NONE' };
  const invited = new Map((existing?.invitations || []).map((i) => [i.invitee_id, i.status]));
  const rejected = m.status === 'REJECTED';
  ctx.setTitle(['Meetups', '#/meetups'], editId ? 'Edit proposal' : 'New proposal');

  const perHead = ctx.meta.budget_per_head;
  const hasExtra = Number(m.extra_budget) > 0;
  const tomorrow = new Date(Date.now() + 86400000);
  const minDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const sponsored = m.collab_sponsored === 1 ? 'yes' : m.collab_sponsored === 0 ? 'no' : '';
  const peerWord = isUhc ? 'UHC members' : `LHCs in ${u.region_name}`;

  el.innerHTML = String(html`
    <a class="back-link" href="${editId ? `#/meetups/${editId}` : '#/home'}">${icon('chevron-left', 'i-sm')} ${editId ? 'Back to meetup' : 'Home'}</a>
    <div class="page-head"><div class="page-head-text">
      <h1 class="page-title">${editId ? (rejected ? 'Revise and resubmit' : 'Edit draft') : 'Propose a meetup'}</h1>
      <p class="page-sub">${isUhc
        ? `UHC proposal · ${u.house_name} House. You can hold it in any region.`
        : `For ${u.region_name} region · ${u.house_name} House.`} Management reviews every proposal before it goes ahead.</p>
    </div></div>

    ${rejected && m.review_comments ? html`<div class="callout is-bad" style="margin-bottom:20px">
      <div class="callout-title">${icon('alert', 'i-sm')} Feedback from ${m.reviewer_name}</div><p>${m.review_comments}</p></div>` : ''}

    <form id="proposeForm" novalidate>
      <div class="form-error" data-error hidden></div>

      <section class="form-section">
        <div class="form-section-head"><h3>The meetup</h3><p>What it is and why students should come.</p></div>
        <div class="form-section-body">
          <label class="field" data-field="title"><span class="field-label">Title</span>
            <input class="input" name="title" maxlength="120" value="${m.title || ''}" placeholder="e.g. PDSA study jam and mock OPPE"></label>
          <label class="field" data-field="category"><span class="field-label">Type</span>
            <select class="select" name="category">
              <option value="" disabled ${m.category ? '' : 'selected'}>Choose a type</option>
              ${ctx.meta.categories.map((c) => html`<option value="${c.id}" ${c.id === m.category ? 'selected' : ''}>${c.label}</option>`)}
            </select></label>
          <label class="field" data-field="description"><span class="field-label">Plan and agenda</span>
            <textarea class="textarea" name="description" rows="6" maxlength="4000" placeholder="Who it's for, what you'll do, and what students should bring.">${m.description || ''}</textarea>
            <span class="field-hint">At least 20 characters. Reviewers look for a clear agenda and audience.</span></label>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>When and where</h3><p>All meetups are offline. Give a preferred and a backup date; Management approves one of them.</p></div>
        <div class="form-section-body">
          <div class="field-row keep">
            <label class="field" data-field="event_date"><span class="field-label">Preferred date</span><input class="input" type="date" name="event_date" min="${minDate}" value="${m.event_date || ''}"></label>
            <label class="field" data-field="backup_date"><span class="field-label">Backup date</span><input class="input" type="date" name="backup_date" min="${minDate}" value="${m.backup_date || ''}"></label>
          </div>
          <div class="field-row keep">
            <label class="field" data-field="start_time"><span class="field-label">Starts</span><input class="input" type="time" name="start_time" value="${m.start_time}"></label>
            <label class="field" data-field="end_time"><span class="field-label">Ends</span><input class="input" type="time" name="end_time" value="${m.end_time}"></label>
          </div>
          ${isUhc ? html`<label class="field" data-field="region_id"><span class="field-label">Region</span>
            <select class="select" name="region_id">
              <option value="" disabled ${m.region_id ? '' : 'selected'}>Choose where it will be held</option>
              ${ctx.meta.regions.map((r) => html`<option value="${r.id}" ${r.id === m.region_id ? 'selected' : ''}>${r.name}</option>`)}
            </select></label>` : ''}
          <label class="field" data-field="venue"><span class="field-label">Venue</span>
            <input class="input" name="venue" maxlength="300" value="${m.venue || ''}" placeholder="Venue name and full address">
            <span class="field-hint">Include the area and city so people can plan travel.</span></label>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>Size and budget</h3><p>Every meetup gets ₹${perHead} per expected attendee. Large meetups can ask for extra, e.g. to book a venue. Reimbursed after the meetup against bills.</p></div>
        <div class="form-section-body">
          <div class="field-row keep">
            <label class="field" data-field="expected_attendees"><span class="field-label">Expected attendance</span><input class="input" name="expected_attendees" inputmode="numeric" value="${m.expected_attendees || ''}" placeholder="30"></label>
            <div class="field"><span class="field-label">Standard allowance</span>
              <div class="readout"><span data-allowance>₹0</span><small data-allowance-calc>₹${perHead} × attendees</small></div></div>
          </div>
          <div class="extra-budget ${hasExtra ? 'open' : ''}" data-extra>
            <button type="button" class="btn btn-ghost btn-sm extra-toggle" data-extra-toggle>${icon('plus', 'i-sm')} Request extra budget</button>
            <div class="extra-fields">
              <div class="extra-head"><span class="field-label">Extra budget</span>
                <button type="button" class="btn btn-ghost btn-sm" data-extra-remove>Remove</button></div>
              <div class="field-row keep">
                <label class="field" data-field="extra_budget"><span class="field-label sub">Amount</span>
                  <span class="prefix-input"><span>₹</span><input class="input" name="extra_budget" inputmode="numeric" value="${m.extra_budget || ''}" placeholder="0"></span></label>
              </div>
              <label class="field" data-field="extra_budget_note"><span class="field-label sub">What it's for</span>
                <textarea class="textarea" name="extra_budget_note" rows="2" maxlength="1000" placeholder="e.g. Hall booking for 120 people at … (₹3,000 per day)">${m.extra_budget_note || ''}</textarea></label>
            </div>
          </div>
          <div class="budget-total"><span>Total requested</span><strong data-total>₹0</strong></div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>Collaboration</h3><p>Is this meetup run with an IITM BS society or an outside organisation? Choose one to add their details.</p></div>
        <div class="form-section-body">
          <div class="choice-group" data-field="collab_type">${COLLAB.map(([id, ic, label, sub]) => html`
            <label class="choice"><input type="radio" name="collab_type" value="${id}" ${m.collab_type === id ? 'checked' : ''}>${icon(ic)}<span><strong>${label}</strong><small>${sub}</small></span></label>`)}
          </div>
          <div class="collab-fields" data-collab>
            <label class="field" data-field="collab_name"><span class="field-label" data-collab-label="name"></span>
              <input class="input" name="collab_name" maxlength="150" value="${m.collab_name || ''}"></label>
            <label class="field" data-field="collab_about" data-external><span class="field-label">About the organisation</span>
              <textarea class="textarea" name="collab_about" rows="2" maxlength="1000" placeholder="What kind of body it is, what it does, website">${m.collab_about || ''}</textarea></label>
            <label class="field" data-field="collab_agenda"><span class="field-label" data-collab-label="agenda"></span>
              <textarea class="textarea" name="collab_agenda" rows="3" maxlength="2000">${m.collab_agenda || ''}</textarea></label>
            <label class="field" data-field="collab_contact"><span class="field-label">Point of contact</span>
              <input class="input" name="collab_contact" maxlength="200" value="${m.collab_contact || ''}" placeholder="Name, role, and email or phone"></label>
            <div class="field" data-field="collab_sponsored" data-external><span class="field-label">Are they sponsoring the meetup?</span>
              <div class="choice-group two">
                <label class="choice"><input type="radio" name="collab_sponsored" value="yes" ${sponsored === 'yes' ? 'checked' : ''}><span><strong>Yes</strong><small>Money or in-kind support</small></span></label>
                <label class="choice"><input type="radio" name="collab_sponsored" value="no" ${sponsored === 'no' ? 'checked' : ''}><span><strong>No</strong><small>No sponsorship</small></span></label>
              </div></div>
            <label class="field" data-field="collab_sponsorship" data-sponsor><span class="field-label">Sponsorship details</span>
              <textarea class="textarea" name="collab_sponsorship" rows="2" maxlength="1000" placeholder="Amount or what they provide, and what they expect in return (logo, talk slot…)">${m.collab_sponsorship || ''}</textarea></label>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>Co-hosts <span class="opt">optional</span></h3><p>${isUhc
          ? 'Invite UHC members from any house.'
          : `Invite LHCs from ${u.region_name}, any house.`} They'll get a notification when you submit.</p></div>
        <div class="form-section-body">
          <div class="peer-list">
            <div class="peer-list-head">
              <label class="peer-search">${icon('search', 'i-sm')}<input type="search" placeholder="Search ${peerWord}" data-peer-search></label>
              <span data-peer-count></span><button type="button" class="btn btn-ghost btn-sm" data-all>Select all</button>
            </div>
            <div class="peer-items">${peers.map((p) => html`
              <label class="peer" data-q="${`${p.name} ${p.house_name} ${p.roll_number} ${p.title || ''}`.toLowerCase()}">
                <input type="checkbox" name="invitee_ids" value="${p.id}" ${invited.has(p.id) ? 'checked' : ''}>
                ${crest(p.house_slug, 'crest-md')}
                <span><span class="peer-name">${p.name}</span><span class="peer-sub"> · ${p.house_name}${p.title ? ` · ${p.title}` : ''}</span><br><span class="peer-sub mono">${p.roll_number}</span></span>
                ${invited.has(p.id) && invited.get(p.id) !== 'INVITED' ? html`<span class="peer-status">${status(invited.get(p.id))}</span>` : ''}
              </label>`)}
              <div class="empty-inline" data-peer-empty hidden>No one matches that search.</div>
            </div>
          </div>
        </div>
      </section>

      <div class="form-footer">
        <span class="hint">${rejected ? 'Resubmitting sends it back to Management.' : 'Drafts are only visible to you.'}</span>
        ${rejected ? '' : html`<button type="button" class="btn" data-save="draft">Save draft</button>`}
        <button type="button" class="btn btn-primary" data-save="submit">${icon('send', 'i-sm')} ${rejected ? 'Resubmit' : 'Submit proposal'}</button>
      </div>
    </form>`);

  const form = $('#proposeForm', el);
  const inr = (n) => '₹' + n.toLocaleString('en-IN');
  const extraOpen = () => $('[data-extra]', form).classList.contains('open');

  // ── Live bits ──
  const syncBudget = () => {
    const a = Number(form.expected_attendees.value.replace(/[^\d]/g, '')) || 0;
    const extra = extraOpen() ? Number(form.extra_budget.value.replace(/[^\d]/g, '')) || 0 : 0;
    $('[data-allowance]', form).textContent = inr(a * perHead);
    $('[data-allowance-calc]', form).textContent = a ? `${a} × ${inr(perHead)}` : `${inr(perHead)} × attendees`;
    $('[data-total]', form).innerHTML = extra ? `${inr(a * perHead + extra)} <small>incl. ${inr(extra)} extra</small>` : inr(a * perHead);
  };
  const syncCollab = () => {
    const kind = form.collab_type.value || 'NONE';
    $('[data-collab]', form).hidden = kind === 'NONE';
    $$('[data-external]', form).forEach((f) => { f.hidden = kind !== 'EXTERNAL'; });
    $('[data-sponsor]', form).hidden = kind !== 'EXTERNAL' || form.collab_sponsored.value !== 'yes';
    $('[data-collab-label=name]', form).textContent = kind === 'SOCIETY' ? 'Society name' : 'Organisation name';
    $('[data-collab-label=agenda]', form).textContent = kind === 'SOCIETY' ? 'What the society will do' : 'Agenda of the collaboration';
    form.collab_name.placeholder = kind === 'SOCIETY' ? 'e.g. Coding and Development Society' : 'e.g. Mumbai Data Circle';
    form.collab_agenda.placeholder = kind === 'SOCIETY'
      ? 'Their role in the meetup: sessions they run, mentors, resources…'
      : 'What they will do at the meetup and what we will do';
  };
  const syncPeers = () => {
    const n = $$('[name=invitee_ids]:checked', form).length;
    $('[data-peer-count]', form).textContent = n ? `${n} selected` : `${peers.length} ${isUhc ? 'members' : 'LHCs'}`;
    const visible = $$('.peer', form).filter((p) => !p.hidden).map((p) => $('input', p));
    $('[data-all]', form).textContent = visible.length && visible.every((b) => b.checked) ? 'Clear' : 'Select all';
  };

  $('[data-extra-toggle]', form).addEventListener('click', () => {
    $('[data-extra]', form).classList.add('open');
    form.extra_budget.focus();
    syncBudget();
  });
  $('[data-extra-remove]', form).addEventListener('click', () => {
    $('[data-extra]', form).classList.remove('open');
    form.extra_budget.value = '';
    form.extra_budget_note.value = '';
    clearError('extra_budget'); clearError('extra_budget_note');
    syncBudget();
  });
  $('[data-peer-search]', form).addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    $$('.peer', form).forEach((p) => { p.hidden = q && !p.dataset.q.includes(q); if (!p.hidden) shown++; });
    $('[data-peer-empty]', form).hidden = shown > 0;
    syncPeers();
  });
  $('[data-all]', form).addEventListener('click', () => {
    const boxes = $$('.peer', form).filter((p) => !p.hidden).map((p) => $('input', p));
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !all; });
    syncPeers();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'invitee_ids') syncPeers();
    if (e.target.name === 'collab_type' || e.target.name === 'collab_sponsored') syncCollab();
    clearError(e.target.name);
  });
  form.addEventListener('input', (e) => {
    if (['extra_budget', 'expected_attendees'].includes(e.target.name)) syncBudget();
    clearError(e.target.name);
  });
  syncPeers(); syncBudget(); syncCollab();

  const clearError = (name) => clearFieldError(form, name);

  $$('[data-save]', form).forEach((btn) => btn.addEventListener('click', () => {
    const submit = btn.dataset.save === 'submit';
    const banner = $('[data-error]', form);
    banner.hidden = true;
    const problems = validate(form, { submit, minDate, isUhc, extraOpen: extraOpen() });
    if (problems.length) { showFieldErrors(form, problems); return; }
    const fd = new FormData(form);
    const body = Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'invitee_ids'));
    body.invitee_ids = fd.getAll('invitee_ids');
    body.submit = submit;
    body.extra_budget = extraOpen() ? (body.extra_budget || '0').replace(/[^\d]/g, '') || '0' : '0';
    if (!extraOpen()) body.extra_budget_note = '';
    body.expected_attendees = (body.expected_attendees || '').replace(/[^\d]/g, '');
    busy(btn, async () => {
      try {
        const res = editId ? await api.put(`/api/meetups/${editId}`, body) : await api.post('/api/meetups', body);
        toast(!submit ? 'Draft saved.'
          : res.status === 'PEER_REVIEW' ? `Submitted. ${body.invitee_ids.length} co-host invite${body.invitee_ids.length === 1 ? '' : 's'} sent.`
            : 'Submitted to Management.');
        ctx.refreshBadges();
        location.hash = `#/meetups/${res.id}`;
      } catch (e) {
        banner.innerHTML = '<svg class="i"><use href="#i-alert"/></svg><span></span>';
        $('span', banner).textContent = e.message;
        banner.hidden = false;
        banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }));
}

/** Returns [[fieldName, message], …] in the order the fields appear on the page. */
function validate(f, { submit, minDate, isUhc, extraOpen }) {
  const out = [];
  const need = (cond, name, msg) => { if (cond) out.push([name, msg]); };
  const v = (name) => (f[name]?.value || '').trim();

  need(v('title').length < 4, 'title', 'Give the meetup a title (at least 4 characters).');
  need(!v('category'), 'category', 'Choose a type.');
  need(v('description').length < 20, 'description', 'Describe the plan in at least 20 characters.');
  need(!v('event_date'), 'event_date', 'Pick a preferred date.');
  need(v('event_date') && submit && v('event_date') < minDate, 'event_date', 'Must be at least a day from today.');
  need(!v('backup_date'), 'backup_date', 'Pick a backup date.');
  need(v('backup_date') && v('backup_date') === v('event_date'), 'backup_date', 'Must differ from the preferred date.');
  need(v('backup_date') && submit && v('backup_date') < minDate, 'backup_date', 'Must be at least a day from today.');
  need(!v('start_time'), 'start_time', 'Set a start time.');
  need(!v('end_time'), 'end_time', 'Set an end time.');
  need(v('start_time') && v('end_time') && v('end_time') <= v('start_time'), 'end_time', 'Must be after the start time.');
  if (isUhc) need(!v('region_id'), 'region_id', 'Choose a region.');
  need(v('venue').length < 4, 'venue', 'Add the venue name and address.');
  const att = v('expected_attendees').replace(/[,\s]/g, '');
  need(!/^\d+$/.test(att) || Number(att) < 1, 'expected_attendees', 'Enter the number of people you expect.');
  if (extraOpen) {
    const extra = Number(v('extra_budget').replace(/[^\d]/g, '')) || 0;
    need(extra <= 0, 'extra_budget', 'Enter an amount, or remove the extra budget.');
    need(v('extra_budget_note').length < 5, 'extra_budget_note', 'Say what the extra budget is for.');
  }
  const kind = f.collab_type.value || 'NONE';
  if (kind !== 'NONE') {
    need(v('collab_name').length < 2, 'collab_name', kind === 'SOCIETY' ? 'Name the society.' : 'Name the organisation.');
    if (kind === 'EXTERNAL') need(v('collab_about').length < 10, 'collab_about', 'Describe the organisation (at least 10 characters).');
    need(v('collab_agenda').length < 10, 'collab_agenda', 'Describe the collaboration (at least 10 characters).');
    need(v('collab_contact').length < 4, 'collab_contact', 'Add a point of contact.');
    if (kind === 'EXTERNAL') {
      need(!f.collab_sponsored.value, 'collab_sponsored', 'Choose yes or no.');
      if (f.collab_sponsored.value === 'yes') need(v('collab_sponsorship').length < 10, 'collab_sponsorship', 'Describe the sponsorship (at least 10 characters).');
    }
  }
  // One message per field, in page order.
  const seen = new Set();
  return out.filter(([name]) => !seen.has(name) && seen.add(name));
}
