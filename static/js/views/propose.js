// Propose / edit a meetup. Peers are limited to LHCs in the proposer's region (enforced server-side too).
import { api } from '../api.js';
import { $, $$, busy, crest, esc, html, icon, status, toast } from '../ui.js';

export async function render(el, ctx) {
  const editId = ctx.params[0];
  const [{ peers }, existing] = await Promise.all([
    api.get('/api/peers'),
    editId ? api.get(`/api/meetups/${editId}`) : null,
  ]);
  if (!ctx.isCurrent()) return;
  if (existing && !existing.can.edit) { location.hash = `#/meetups/${editId}`; return; }

  const m = existing?.meetup || { category: '', start_time: '10:00', end_time: '13:00' };
  const invited = new Map((existing?.invitations || []).map((i) => [i.invitee_id, i.status]));
  const rejected = m.status === 'REJECTED';
  ctx.setTitle(['Meetups', '#/meetups'], editId ? 'Edit proposal' : 'New proposal');

  const tomorrow = new Date(Date.now() + 86400000);
  const minDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  el.innerHTML = String(html`
    <a class="back-link" href="${editId ? `#/meetups/${editId}` : '#/home'}">${icon('chevron-left', 'i-sm')} ${editId ? 'Back to meetup' : 'Home'}</a>
    <div class="page-head"><div class="page-head-text">
      <h1 class="page-title">${editId ? (rejected ? 'Revise and resubmit' : 'Edit draft') : 'Propose a meetup'}</h1>
      <p class="page-sub">For ${ctx.user.region_name} region · ${ctx.user.house_name} House. Management reviews every proposal before it goes ahead.</p>
    </div></div>

    ${rejected && m.review_comments ? html`<div class="callout is-bad" style="margin-bottom:20px">
      <div class="callout-title">${icon('alert', 'i-sm')} Feedback from ${m.reviewer_name}</div><p>${m.review_comments}</p></div>` : ''}

    <form id="proposeForm" novalidate>
      <div class="form-error" data-error hidden></div>

      <section class="form-section">
        <div class="form-section-head"><h3>The meetup</h3><p>What it is and why students should come.</p></div>
        <div class="form-section-body">
          <label class="field"><span class="field-label">Title</span>
            <input class="input" name="title" required maxlength="120" value="${m.title || ''}" placeholder="e.g. PDSA study jam and mock OPPE"></label>
          <label class="field"><span class="field-label">Type</span>
            <select class="select" name="category" required>
              <option value="" disabled ${m.category ? '' : 'selected'}>Choose a type</option>
              ${ctx.meta.categories.map((c) => html`<option value="${c.id}" ${c.id === m.category ? 'selected' : ''}>${c.label}</option>`)}
            </select></label>
          <label class="field"><span class="field-label">Plan and agenda</span>
            <textarea class="textarea" name="description" rows="6" required maxlength="4000" placeholder="Who it's for, what you'll do, and what students should bring.">${m.description || ''}</textarea>
            <span class="field-hint">At least 20 characters. Reviewers look for a clear agenda and audience.</span></label>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>When and where</h3><p>All meetups are offline. Pick a date at least a day out; campus venues need extra clearance.</p></div>
        <div class="form-section-body">
          <div class="field-row field-row-3">
            <label class="field"><span class="field-label">Date</span><input class="input" type="date" name="event_date" required min="${minDate}" value="${m.event_date || ''}"></label>
            <div class="field-row keep" style="grid-column: span 2">
              <label class="field"><span class="field-label">Starts</span><input class="input" type="time" name="start_time" required value="${m.start_time}"></label>
              <label class="field"><span class="field-label">Ends</span><input class="input" type="time" name="end_time" required value="${m.end_time}"></label>
            </div>
          </div>
          <label class="field"><span class="field-label">Venue</span>
            <input class="input" name="venue" required maxlength="300" value="${m.venue || ''}" placeholder="Venue name and full address">
            <span class="field-hint">Meetups are held in person. Include the area and city so peers can plan travel.</span></label>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>Size and budget</h3><p>Budget is reimbursed after the meetup against bills.</p></div>
        <div class="form-section-body">
          <div class="field-row keep">
            <label class="field"><span class="field-label">Expected attendance</span><input class="input" name="expected_attendees" inputmode="numeric" required value="${m.expected_attendees || ''}" placeholder="30"></label>
            <label class="field"><span class="field-label">Budget</span>
              <span class="prefix-input"><span>₹</span><input class="input" name="budget_requested" inputmode="numeric" value="${m.budget_requested ?? ''}" placeholder="0"></span>
              <span class="field-hint" data-perhead>&nbsp;</span></label>
          </div>
          <label class="field"><span class="field-label">Breakdown <span class="opt">if requesting budget</span></span>
            <textarea class="textarea" name="budget_breakdown" rows="3" maxlength="2000" placeholder="Snacks for 30 — ₹1,500&#10;Projector rental — ₹700">${m.budget_breakdown || ''}</textarea></label>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>Co-hosts</h3><p>Invite LHCs from ${ctx.user.region_name}, any house. They'll get a notification when you submit.</p></div>
        <div class="form-section-body">
          <div class="peer-list">
            <div class="peer-list-head"><span data-peer-count></span><button type="button" class="btn btn-ghost btn-sm" data-all>Select all</button></div>
            <div class="peer-items">${peers.map((p) => html`
              <label class="peer"><input type="checkbox" name="invitee_ids" value="${p.id}" ${invited.has(p.id) ? 'checked' : ''}>
                ${crest(p.house_slug, 'crest-md')}
                <span><span class="peer-name">${p.name}</span><span class="peer-sub"> · ${p.house_name}</span><br><span class="peer-sub mono">${p.roll_number}</span></span>
                ${invited.has(p.id) && invited.get(p.id) !== 'INVITED' ? html`<span class="peer-status">${status(invited.get(p.id))}</span>` : ''}
              </label>`)}</div>
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
  const syncPeers = () => {
    const n = $$('[name=invitee_ids]:checked', form).length;
    $('[data-peer-count]', form).textContent = n ? `${n} of ${peers.length} selected` : `${peers.length} LHCs in ${ctx.user.region_name}`;
    $('[data-all]', form).textContent = n === peers.length ? 'Clear' : 'Select all';
  };
  const syncBudget = () => {
    const b = Number(form.budget_requested.value.replace(/[^\d]/g, ''));
    const a = Number(form.expected_attendees.value.replace(/[^\d]/g, ''));
    $('[data-perhead]', form).innerHTML = b && a ? `≈ <span>₹${Math.round(b / a).toLocaleString('en-IN')}</span> per attendee` : '&nbsp;';
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'invitee_ids') syncPeers();
  });
  form.addEventListener('input', (e) => { if (['budget_requested', 'expected_attendees'].includes(e.target.name)) syncBudget(); });
  $('[data-all]', form).addEventListener('click', () => {
    const boxes = $$('[name=invitee_ids]', form);
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !all; });
    syncPeers();
  });
  syncPeers(); syncBudget();

  $$('[data-save]', form).forEach((btn) => btn.addEventListener('click', () => {
    const submit = btn.dataset.save === 'submit';
    const err = $('[data-error]', form);
    err.hidden = true;
    const problem = validate(form, submit, minDate);
    if (problem) { showError(err, problem); return; }
    const fd = new FormData(form);
    const body = Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'invitee_ids'));
    body.invitee_ids = fd.getAll('invitee_ids');
    body.submit = submit;
    body.budget_requested = (body.budget_requested || '0').replace(/[^\d]/g, '') || '0';
    body.expected_attendees = (body.expected_attendees || '').replace(/[^\d]/g, '');
    busy(btn, async () => {
      try {
        const res = editId ? await api.put(`/api/meetups/${editId}`, body) : await api.post('/api/meetups', body);
        toast(!submit ? 'Draft saved.'
          : res.status === 'PEER_REVIEW' ? `Submitted. ${body.invitee_ids.length} co-host invite${body.invitee_ids.length === 1 ? '' : 's'} sent.`
            : 'Submitted to Management.');
        ctx.refreshBadges();
        location.hash = `#/meetups/${res.id}`;
      } catch (e) { showError(err, e.message); }
    });
  }));
}

function showError(box, msg) {
  box.innerHTML = `<svg class="i"><use href="#i-alert"/></svg><span>${esc(msg)}</span>`;
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function validate(f, submit, minDate) {
  if (f.title.value.trim().length < 4) return 'Give the meetup a title (at least 4 characters).';
  if (!f.category.value) return 'Choose a type for the meetup.';
  if (f.description.value.trim().length < 20) return 'Describe the plan in at least 20 characters.';
  if (!f.event_date.value) return 'Pick a date.';
  if (submit && f.event_date.value < minDate) return 'The date must be at least a day from today.';
  if (!f.start_time.value || !f.end_time.value) return 'Set start and end times.';
  if (f.end_time.value <= f.start_time.value) return 'End time must be after the start time.';
  if (f.venue.value.trim().length < 4) return 'Add the venue name and address.';
  if (!/^\d+$/.test(f.expected_attendees.value.replace(/[,\s]/g, '')) || Number(f.expected_attendees.value) < 1) return 'Expected attendance must be a number.';
  return null;
}

