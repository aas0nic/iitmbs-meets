// Reimbursement claim form (full page): attendees → spending → post link → who gets paid.
// Also used in "change payee" mode when a co-host payout is pending or was declined.
import { api } from '../api.js';
import {
  $, $$, BANK_RULES, busy, clearFieldError, crest, esc, fmtLongDate, html, icon, rupees, showFieldErrors, toast,
} from '../ui.js';

const PAYOUT = [
  ['SELF', 'wallet', 'Reimburse me', 'Uses your saved bank details'],
  ['OTHER', 'users', 'Another student', 'Enter their bank details'],
  ['COHOST', 'link', 'A co-host', 'From another house'],
];

export async function render(el, ctx) {
  const id = ctx.params[0];
  const [d, setup] = await Promise.all([api.get(`/api/meetups/${id}`), api.get(`/api/meetups/${id}/claim-setup`)]);
  if (!ctx.isCurrent()) return;
  const m = d.meetup;
  const changing = d.claim && d.claim.can_change_payee;
  if (d.claim && !changing) { location.hash = `#/meetups/${id}`; return; }
  if (!d.claim && !d.can.file_claim) { location.hash = `#/meetups/${id}`; return; }
  ctx.setTitle(['Meetups', '#/meetups'], [m.title, `#/meetups/${id}`], changing ? 'Change payee' : 'Claim');

  const perHead = setup.per_head;
  const saved = setup.payout;
  const attendees = [];
  let files = [];
  let amountTouched = false;
  // Bank inputs are shared between "Reimburse me" and "Another student"; remember each separately.
  const bankFor = {
    SELF: saved ? { payee_name: saved.account_holder, bank_name: saved.bank_name, account_number: saved.account_number, ifsc: saved.ifsc, upi_id: saved.upi_id || '' }
      : { payee_name: ctx.user.name, bank_name: '', account_number: '', ifsc: '', upi_id: '' },
    OTHER: { payee_name: '', bank_name: '', account_number: '', ifsc: '', upi_id: '' },
  };

  el.innerHTML = String(html`
    <a class="back-link" href="#/meetups/${id}">${icon('chevron-left', 'i-sm')} Back to meetup</a>
    <div class="page-head"><div class="page-head-text">
      <h1 class="page-title">${changing ? 'Choose who gets paid' : 'File reimbursement claim'}</h1>
      <p class="page-sub">${m.title} <span class="sep">held ${fmtLongDate(m.event_date)}</span><span class="sep">approved budget ${rupees(m.budget_requested)}</span></p>
    </div></div>

    ${changing && d.claim.status === 'PAYEE_DECLINED' ? html`<div class="callout is-bad" style="margin-bottom:20px">
      <div class="callout-title">${icon('alert', 'i-sm')} ${d.claim.payee_user_name} declined the payout</div>
      ${d.claim.payee_note ? html`<p>${d.claim.payee_note}</p>` : ''}</div>` : ''}

    <form id="claimForm" novalidate>
      <div class="form-error" data-error hidden></div>
      ${changing ? '' : html`
      <section class="form-section">
        <div class="form-section-head"><h3>Who attended</h3>
          <p>Add each student's name and email, or import a CSV or Excel file with “Name” and “Email” columns.</p>
          <a class="link small" style="margin-top:8px" download="attendees-template.csv"
             href="data:text/csv;charset=utf-8,Name%2CEmail%0AAsha%20Kumar%2C23f1000001%40ds.study.iitm.ac.in%0A">${icon('file', 'i-sm')} Download template</a></div>
        <div class="form-section-body">
          <label class="file-drop compact" data-import>${icon('upload')}<span><strong>Drop a CSV or Excel file</strong> or browse</span>
            <input type="file" accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-import-input></label>
          <p class="field-hint" data-import-note hidden></p>
          <div class="field" data-field="attendees">
            <div class="att-add">
              <input class="input" placeholder="Student name" data-att-name autocomplete="off">
              <input class="input" placeholder="Email" type="email" data-att-email autocomplete="off">
              <button type="button" class="btn" data-att-add>${icon('plus', 'i-sm')} Add</button>
            </div>
            <div class="att-list" data-att-list></div>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>What was spent</h3><p>The amount starts at ₹${perHead} per student who attended. Change it to what you actually spent — it can go over the approved budget; Administration decides the payout.</p></div>
        <div class="form-section-body">
          <div class="field-row keep">
            <div class="field"><span class="field-label">Students who attended</span><div class="readout"><span data-att-count>0</span><small data-att-vs></small></div></div>
            <label class="field" data-field="amount_claimed"><span class="field-label">Amount spent</span>
              <span class="prefix-input"><span>₹</span><input class="input" name="amount_claimed" inputmode="numeric" placeholder="0"></span>
              <span class="field-hint" data-amount-hint></span></label>
          </div>
          <div class="callout is-warn" data-over hidden></div>
          <label class="field" data-field="expense_notes"><span class="field-label">What the money was spent on</span>
            <textarea class="textarea" name="expense_notes" rows="3" placeholder="One line per bill, e.g. Snacks from … — ₹1,200"></textarea></label>
          <div class="field" data-field="receipts"><span class="field-label">Bills and receipts</span>
            <label class="file-drop" data-receipt-drop>${icon('upload', 'i-lg')}<strong>Drop files or browse</strong><span class="small">PDF or images, up to 10 files</span>
              <input type="file" multiple accept=".pdf,image/*" data-receipt-input></label>
            <div class="file-list" data-receipt-list></div>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><h3>Post link</h3><p>Link to the post about this meetup, e.g. on Instagram.</p></div>
        <div class="form-section-body">
          <label class="field" data-field="post_link"><span class="field-label">Post URL</span>
            <input class="input" name="post_link" type="url" placeholder="https://www.instagram.com/p/…"></label>
        </div>
      </section>`}

      <section class="form-section">
        <div class="form-section-head"><h3>Who should be reimbursed</h3><p>Pay yourself, another student, or a co-host from another house.</p></div>
        <div class="form-section-body">
          <div class="choice-group" data-field="payout_mode">${PAYOUT.map(([mode, ic, label, sub]) => html`
            <label class="choice"><input type="radio" name="payout_mode" value="${mode}">${icon(ic)}<span><strong>${label}</strong><small>${sub}</small></span></label>`)}
          </div>

          <div class="collab-fields" data-bank hidden>
            <p class="field-hint" data-bank-note></p>
            <label class="field" data-field="payee_name"><span class="field-label" data-holder-label>Account holder name</span><input class="input" name="payee_name" autocomplete="off"></label>
            <div class="field-row">
              <label class="field" data-field="bank_name"><span class="field-label">Bank name</span><input class="input" name="bank_name" placeholder="e.g. State Bank of India"></label>
              <label class="field" data-field="account_number"><span class="field-label">Account number</span><input class="input" name="account_number" inputmode="numeric" autocomplete="off" placeholder="9 to 18 digits"></label>
            </div>
            <div class="field-row">
              <label class="field" data-field="ifsc"><span class="field-label">IFSC</span><input class="input" name="ifsc" autocomplete="off" placeholder="e.g. SBIN0001234" style="text-transform:uppercase"></label>
              <label class="field" data-field="upi_id"><span class="field-label">UPI ID <span class="opt">optional</span></span><input class="input" name="upi_id" autocomplete="off" placeholder="name@bank"></label>
            </div>
          </div>

          <div class="collab-fields" data-cohost hidden>
            ${setup.cohosts.length ? html`<div class="payee-list" data-field="payee_user_id">${setup.cohosts.map((c) => html`
              <label class="payee ${c.has_details ? '' : 'is-disabled'}">
                <input type="radio" name="payee_user_id" value="${c.id}" ${c.has_details ? '' : 'disabled'}>
                ${crest(c.house_slug, 'crest-md')}
                <span class="payee-body"><strong>${c.name}</strong><small>${c.house_name} · co-host</small></span>
                <span class="payee-state">${c.has_details ? html`${icon('check', 'i-sm')} Bank details saved` : 'No bank details saved'}</span>
              </label>`)}</div>
              <p class="field-hint">${icon('alert', 'i-sm')} Their saved bank details go straight to Administration — you won't see them. They'll get a notification to confirm the details before the claim is reviewed.</p>`
              : html`<div class="empty-inline" style="padding:4px 0">No co-hosts from another house accepted this meetup.</div>`}
          </div>
        </div>
      </section>

      <div class="form-footer">
        <span class="hint">${changing ? 'The claim goes to Administration once the payee is settled.' : 'Administration verifies bills and attendance before payout.'}</span>
        <a class="btn btn-ghost" href="#/meetups/${id}">Cancel</a>
        <button type="submit" class="btn btn-primary">${icon('send', 'i-sm')} ${changing ? 'Update payee' : 'Submit claim'}</button>
      </div>
    </form>`);

  const form = $('#claimForm', el);
  const clearError = (name) => clearFieldError(form, name);

  // ── Attendees ──
  const drawAttendees = () => {
    if (changing) return;
    $('[data-att-list]', form).innerHTML = attendees.length ? String(html`
      <div class="att-head"><span>${attendees.length} student${attendees.length === 1 ? '' : 's'}</span><button type="button" class="btn btn-ghost btn-sm" data-att-clear>Clear all</button></div>
      <div class="att-rows">${attendees.map((a, i) => html`<div class="att-row"><span class="att-n">${i + 1}</span><span class="truncate">${a.name}</span><span class="truncate faint">${a.email}</span>
        <button type="button" class="icon-btn" data-att-remove="${i}" aria-label="Remove ${a.name}">${icon('x', 'i-sm')}</button></div>`)}</div>`)
      : '<div class="empty-inline" style="padding:10px 2px">No students added yet.</div>';
    $('[data-att-count]', form).textContent = attendees.length;
    $('[data-att-vs]', form).textContent = `expected ${m.expected_attendees}`;
    syncAmount();
  };
  const addAttendees = (list) => {
    const known = new Set(attendees.map((a) => a.email));
    let added = 0;
    list.forEach((a) => { if (!known.has(a.email)) { attendees.push(a); known.add(a.email); added++; } });
    drawAttendees();
    clearError('attendees');
    return added;
  };

  // ── Amount ──
  const syncAmount = () => {
    if (changing) return;
    const suggested = attendees.length * perHead;
    if (!amountTouched) form.amount_claimed.value = suggested || '';
    const amount = Number(form.amount_claimed.value.replace(/[^\d]/g, '')) || 0;
    $('[data-amount-hint]', form).innerHTML = amountTouched && suggested && amount !== suggested
      ? `Suggested ${rupees(suggested)} (${attendees.length} × ${rupees(perHead)}) · <a class="link" href="#" data-use-suggested>Use suggestion</a>`
      : `${attendees.length || 0} × ${rupees(perHead)}`;
    const notes = [];
    if (amount > m.budget_requested) notes.push(`${rupees(amount - m.budget_requested)} over the approved budget of ${rupees(m.budget_requested)}. Add a reason in the spending notes — Administration may approve less.`);
    if (attendees.length > m.expected_attendees) notes.push(`${attendees.length - m.expected_attendees} more students attended than the ${m.expected_attendees} expected.`);
    const over = $('[data-over]', form);
    over.hidden = !notes.length;
    over.innerHTML = notes.map((n) => `<p style="color:var(--text-2)">${esc(n)}</p>`).join('');
  };

  // ── Receipts ──
  const drawFiles = () => {
    $('[data-receipt-list]', form).innerHTML = String(html`${files.map((f, i) => html`<div class="file-item">${icon('file', 'i-sm')}<span class="truncate">${f.name}</span>
      <span class="faint small">${Math.max(1, Math.round(f.size / 1024))} KB</span>
      <button type="button" class="icon-btn" style="width:28px;height:28px" data-file-remove="${i}" aria-label="Remove">${icon('x', 'i-sm')}</button></div>`)}`);
  };

  // ── Payout ──
  const bankInputs = ['payee_name', 'bank_name', 'account_number', 'ifsc', 'upi_id'];
  let mode = null;
  const syncPayout = (next) => {
    if (mode === 'SELF' || mode === 'OTHER') bankInputs.forEach((n) => { bankFor[mode][n] = form[n].value; });
    mode = next;
    $('[data-bank]', form).hidden = !(mode === 'SELF' || mode === 'OTHER');
    $('[data-cohost]', form).hidden = mode !== 'COHOST';
    if (mode === 'SELF' || mode === 'OTHER') {
      bankInputs.forEach((n) => { form[n].value = bankFor[mode][n] || ''; clearError(n); });
      $('[data-holder-label]', form).textContent = mode === 'SELF' ? 'Account holder name' : "Student's name (as on the bank account)";
      $('[data-bank-note]', form).textContent = mode === 'SELF'
        ? (saved ? 'Filled from your saved details. Any changes are saved to your profile for next time.'
          : "You haven't saved bank details yet. What you enter here is saved to your profile for next time.")
        : 'These details are only used for this claim.';
    }
  };

  // ── Events ──
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-att-remove]');
    if (rm) { attendees.splice(Number(rm.dataset.attRemove), 1); drawAttendees(); return; }
    if (e.target.closest('[data-att-clear]')) { attendees.length = 0; drawAttendees(); return; }
    if (e.target.closest('[data-att-add]')) { addManual(); return; }
    if (e.target.closest('[data-use-suggested]')) { e.preventDefault(); amountTouched = false; syncAmount(); return; }
    const fr = e.target.closest('[data-file-remove]');
    if (fr) { files.splice(Number(fr.dataset.fileRemove), 1); drawFiles(); }
  });
  function addManual() {
    const nameEl = $('[data-att-name]', form);
    const emailEl = $('[data-att-email]', form);
    const name = nameEl.value.trim();
    const email = emailEl.value.trim().toLowerCase();
    if (!name) { toast('Enter the student’s name.', { error: true }); nameEl.focus(); return; }
    if (!BANK_RULES.email.test(email)) { toast('Enter a valid email address.', { error: true }); emailEl.focus(); return; }
    if (!addAttendees([{ name, email }])) toast('That email is already on the list.', { error: true });
    nameEl.value = ''; emailEl.value = '';
    nameEl.focus();
  }
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-att-name], [data-att-email]')) {
      e.preventDefault();
      if (e.target.matches('[data-att-name]')) $('[data-att-email]', form).focus(); else addManual();
    }
  });
  form.addEventListener('input', (e) => {
    if (e.target.name === 'amount_claimed') { amountTouched = true; syncAmount(); }
    clearError(e.target.name);
  });
  form.addEventListener('change', async (e) => {
    if (e.target.name === 'payout_mode') { syncPayout(e.target.value); clearError('payout_mode'); }
    if (e.target.name === 'payee_user_id') clearError('payee_user_id');
    if (e.target.matches('[data-import-input]')) { await importFile(e.target.files[0]); e.target.value = ''; }
    if (e.target.matches('[data-receipt-input]')) { files = [...files, ...e.target.files].slice(0, 10); drawFiles(); clearError('receipts'); e.target.value = ''; }
  });
  $$('[data-import], [data-receipt-drop]', form).forEach((zone) => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      if (zone.matches('[data-import]')) await importFile(e.dataTransfer.files[0]);
      else { files = [...files, ...e.dataTransfer.files].slice(0, 10); drawFiles(); clearError('receipts'); }
    });
  });
  async function importFile(file) {
    if (!file) return;
    const note = $('[data-import-note]', form);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { attendees: rows, skipped } = await api.post('/api/attendees/parse', fd);
      const added = addAttendees(rows);
      note.hidden = false;
      note.textContent = `Imported ${added} from ${file.name}${rows.length - added ? ` · ${rows.length - added} already on the list` : ''}${skipped ? ` · skipped ${skipped} row${skipped === 1 ? '' : 's'} without a name or valid email` : ''}.`;
    } catch (ex) { toast(ex.message, { error: true }); }
  }

  drawAttendees();
  if (!changing) syncAmount();

  // ── Submit ──
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const problems = validate();
    if (problems.length) { showFieldErrors(form, problems); return; }
    const btn = $('[type=submit]', form);
    const payload = { payout_mode: mode };
    if (mode === 'COHOST') payload.payee_user_id = form.querySelector('[name=payee_user_id]:checked')?.value;
    else bankInputs.forEach((n) => { payload[n] = form[n].value.trim(); });
    busy(btn, async () => {
      try {
        let res;
        if (changing) res = await api.post(`/api/claims/${d.claim.id}/payee`, payload);
        else {
          const fd = new FormData();
          Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
          fd.append('attendees', JSON.stringify(attendees));
          fd.append('amount_claimed', form.amount_claimed.value.replace(/[^\d]/g, ''));
          fd.append('expense_notes', form.expense_notes.value.trim());
          fd.append('post_link', form.post_link.value.trim());
          files.forEach((f) => fd.append('receipts', f));
          res = await api.post(`/api/meetups/${id}/claim`, fd);
        }
        toast(res.status === 'AWAITING_PAYEE' ? 'Sent. The co-host will confirm their bank details, then it goes to Administration.'
          : 'Claim submitted for verification.');
        ctx.refreshBadges();
        location.hash = `#/meetups/${id}`;
      } catch (ex) {
        const banner = $('[data-error]', form);
        banner.innerHTML = '<svg class="i"><use href="#i-alert"/></svg><span></span>';
        $('span', banner).textContent = ex.message;
        banner.hidden = false;
        banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  function validate() {
    const out = [];
    const need = (cond, name, msg) => { if (cond && !out.some(([n]) => n === name)) out.push([name, msg]); };
    if (!changing) {
      need(!attendees.length, 'attendees', 'Add at least one student who attended.');
      const amount = Number(form.amount_claimed.value.replace(/[^\d]/g, '')) || 0;
      need(amount <= 0, 'amount_claimed', 'Enter the amount spent.');
      need(form.expense_notes.value.trim().length < 5, 'expense_notes', 'Describe what the money was spent on.');
      need(!files.length, 'receipts', 'Attach at least one bill or receipt.');
      need(!/^https?:\/\/\S+\.\S+/.test(form.post_link.value.trim()), 'post_link', 'Paste the full post link, starting with https://');
    }
    need(!mode, 'payout_mode', 'Choose who should be reimbursed.');
    if (mode === 'SELF' || mode === 'OTHER') {
      const v = (n) => form[n].value.trim();
      need(v('payee_name').length < 2, 'payee_name', 'Enter the account holder’s name.');
      need(v('bank_name').length < 2, 'bank_name', 'Enter the bank name.');
      need(!BANK_RULES.account.test(v('account_number').replace(/[\s-]/g, '')), 'account_number', 'Account number should be 9 to 18 digits.');
      need(!BANK_RULES.ifsc.test(v('ifsc').toUpperCase()), 'ifsc', 'IFSC should look like SBIN0001234.');
      need(v('upi_id') && !BANK_RULES.upi.test(v('upi_id')), 'upi_id', 'UPI ID should look like name@bank.');
    }
    if (mode === 'COHOST') need(!form.querySelector('[name=payee_user_id]:checked'), setup.cohosts.length ? 'payee_user_id' : 'payout_mode', 'Pick the co-host to reimburse.');
    return out;
  }
}
