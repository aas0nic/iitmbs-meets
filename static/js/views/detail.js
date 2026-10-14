// Meetup detail: overview, co-hosts, activity thread, and the role-specific action panel.
import { api } from '../api.js';
import {
  $, ago, avatar, busy, CLAIM_STATUS, confirmDialog, crest, daysUntil, fmtLongDate, fmtTimeRange, formData, fullTime,
  html, icon, on, openDialog, plural, relDay, rupees, status, toast,
} from '../ui.js';

export async function render(el, ctx) {
  const id = ctx.params[0];
  const data = await api.get(`/api/meetups/${id}`);
  if (!ctx.isCurrent()) return;
  const { meetup: m } = data;
  ctx.setTitle(['Meetups', '#/meetups'], m.title);
  el.innerHTML = String(page(data, ctx));
  bind(el, data, ctx);
  if (ctx.query.get('claim') && data.can.file_claim && !data.claim) fileClaim(data, ctx);
}

// ── Layout ──────────────────────────────────────────────────────────────────
function page(d, ctx) {
  const m = d.meetup;
  const when = daysUntil(m.event_date);
  return html`
    <a class="back-link" href="#/meetups">${icon('chevron-left', 'i-sm')} All meetups</a>
    <header class="detail-head">
      <div class="eyebrow">${crest(m.house_slug)} ${m.house_name} <span class="sep">${m.region_name}</span><span class="sep">${m.category_label}</span></div>
      <div class="detail-title-row"><h1 class="detail-title">${m.title}</h1>${status(m.status)}</div>
      <div class="detail-meta">
        <span>${icon('calendar')}${fmtLongDate(m.event_date)}${when >= 0 && when < 7 && !['COMPLETED', 'CANCELLED'].includes(m.status) ? html`<span class="faint">(${relDay(m.event_date).toLowerCase()})</span>` : ''}</span>
        <span>${icon('clock')}${fmtTimeRange(m.start_time, m.end_time)}</span>
        <span>${icon('pin')}${m.venue}</span>
      </div>
      ${steps(m, d.invitations)}
    </header>

    <div class="grid grid-main detail-grid">
      <div class="stack">
        <section class="card card-pad"><p class="prose">${m.description}</p></section>
        ${facts(m, d)}
        ${people(m, d)}
        ${timeline(d)}
      </div>
      <aside class="stack detail-side">
        ${actionPanel(d, ctx)}
        ${decisionNote(m)}
        ${d.claim ? claimCard(d.claim) : ''}
      </aside>
    </div>`;
}

function steps(m, invitations) {
  const labels = ['Draft', invitations.length ? 'Co-hosts' : 'No co-hosts', 'Management', 'Approved', 'Held'];
  let done = { DRAFT: 0, PEER_REVIEW: 1, PENDING: 2, APPROVED: 4, COMPLETED: 5, REJECTED: 2, CANCELLED: m.reviewed_at ? 4 : 2 }[m.status];
  let failAt = m.status === 'REJECTED' ? 2 : m.status === 'CANCELLED' ? done : -1;
  if (failAt >= 0) labels[failAt] = m.status === 'REJECTED' ? 'Rejected' : 'Cancelled';
  return html`<div class="steps" aria-label="Progress">${labels.map((label, i) => {
    const cls = i === failAt ? 'failed' : i < done ? 'done' : i === done ? 'current' : '';
    const dot = cls === 'done' ? icon('check') : cls === 'failed' ? icon('x') : i + 1;
    return html`${i ? html`<span class="step-line ${i <= done && i !== failAt ? 'done' : ''}"></span>` : ''}
      <span class="step ${cls}"><span class="step-dot">${dot}</span>${label}</span>`;
  })}</div>`;
}

function facts(m, d) {
  const perHead = m.budget_requested && m.expected_attendees ? Math.round(m.budget_requested / m.expected_attendees) : 0;
  return html`<section class="card">
    <header class="card-head"><h2 class="card-title">Logistics</h2></header>
    <div class="facts">
      <div class="fact wide"><div class="fact-label">Venue</div><div class="fact-value">${m.venue}
        <a class="link small" style="margin-left:6px;font-weight:400" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.venue)}" target="_blank" rel="noopener">Open in Maps</a></div></div>
      <div class="fact"><div class="fact-label">Region</div><div class="fact-value">${m.region_name}</div></div>
      <div class="fact"><div class="fact-label">Expected attendance</div><div class="fact-value">${m.expected_attendees}</div></div>
      <div class="fact"><div class="fact-label">Budget requested</div><div class="fact-value">${m.budget_requested ? rupees(m.budget_requested) : 'None'}</div></div>
      <div class="fact"><div class="fact-label">Per attendee</div><div class="fact-value">${perHead ? rupees(perHead) : '—'}</div></div>
      ${m.budget_breakdown ? html`<div class="fact wide"><div class="fact-label">Breakdown</div><div class="fact-value prose" style="font-size:13.5px">${m.budget_breakdown}</div></div>` : ''}
      ${m.submitted_at ? html`<div class="fact wide"><div class="fact-label">Submitted</div><div class="fact-value">${fullTime(m.submitted_at)}</div></div>` : ''}
    </div>
  </section>`;
}

function people(m, d) {
  const host = { name: m.proposer_name, house_color: m.house_color };
  return html`<section class="card">
    <header class="card-head"><h2 class="card-title">People</h2><span class="count">${1 + d.invitations.filter((i) => i.status === 'ACCEPTED').length} hosting</span></header>
    <div class="people">
      <div class="person">${avatar(host)}
        <div class="person-body">
          <div class="person-name">${m.proposer_name} <span class="tag">Host</span></div>
          <div class="person-sub">${crest(m.house_slug)} ${m.house_name}<span class="sep mono">${m.proposer_roll}</span></div>
        </div>
      </div>
      ${d.invitations.map((i) => html`<div class="person">${avatar({ name: i.name, house_color: i.house_color })}
        <div class="person-body">
          <div class="person-name">${i.name} ${status(i.status)}</div>
          <div class="person-sub">${crest(i.house_slug)} ${i.house_name}<span class="sep mono">${i.roll_number}</span></div>
          ${i.response_note ? html`<div class="person-note">${i.response_note}</div>` : ''}
        </div>
      </div>`)}
      ${!d.invitations.length ? html`<div class="empty-inline">No co-hosts invited — the host is running this one solo.</div>` : ''}
    </div>
  </section>`;
}

const TL = {
  CREATED: ['edit', '', 'started a draft'],
  EDITED: ['edit', '', 'edited the proposal'],
  SUBMITTED: ['send', 'accent', 'submitted the proposal'],
  RESUBMITTED: ['send', 'accent', 'resubmitted with changes'],
  WITHDRAWN: ['rotate', '', 'withdrew it back to draft'],
  INVITE_ACCEPTED: ['check', 'ok', 'agreed to co-host'],
  INVITE_DECLINED: ['x', '', 'declined to co-host'],
  SENT_TO_MANAGEMENT: ['arrow-right', 'accent', 'sent to Management'],
  APPROVED: ['check', 'ok', 'approved the proposal'],
  REJECTED: ['x', 'bad', 'rejected the proposal'],
  COMPLETED: ['flag', 'ok', 'marked the meetup as held'],
  CANCELLED: ['x', 'bad', 'cancelled the meetup'],
  COMMENT: ['message', '', 'commented'],
  CLAIM_FILED: ['receipt', 'accent', 'filed a reimbursement claim'],
  CLAIM_IN_PROGRESS: ['receipt', '', 'forwarded the claim to Accounts'],
  CLAIM_APPROVED: ['wallet', 'ok', 'approved the claim'],
  CLAIM_REJECTED: ['receipt', 'bad', 'rejected the claim'],
};

function timeline(d) {
  const roleTag = (a) => (a.actor_role === 'MANAGEMENT' ? html` <span class="tag">Management</span>` : a.actor_role === 'UHC' ? html` <span class="tag">UHC</span>` : '');
  return html`<section class="card" id="activity">
    <header class="card-head"><h2 class="card-title">Activity</h2><span class="count">${d.activity.length}</span></header>
    <ol class="timeline">
      ${d.activity.map((a) => {
        const [ic, cls, text] = TL[a.action] || ['alert', '', a.action];
        const who = a.actor_name ? html`<b>${a.actor_name}</b>${roleTag(a)} ${text}` : html`<b>${text[0].toUpperCase() + text.slice(1)}</b>`;
        return html`<li class="tl-item ${a.action === 'COMMENT' ? 'is-comment' : ''}">
          <span class="tl-icon ${cls}">${icon(ic)}</span>
          <div class="tl-text">${who}<span class="tl-time" title="${fullTime(a.created_at)}">${ago(a.created_at)}</span>
            ${a.note ? html`<div class="tl-note">${a.note}</div>` : ''}</div>
        </li>`;
      })}
    </ol>
    ${d.can.comment ? html`<form class="composer" data-comment>
      <textarea class="textarea" name="body" rows="1" placeholder="Add a comment for the host and reviewers" required maxlength="2000"></textarea>
      <button class="btn btn-sm" type="submit">${icon('send', 'i-sm')} Post</button>
    </form>` : ''}
  </section>`;
}

function decisionNote(m) {
  if (!m.reviewed_by || !['APPROVED', 'COMPLETED', 'REJECTED'].includes(m.status)) return '';
  const bad = m.status === 'REJECTED';
  if (!bad && !m.review_comments) return '';
  return html`<div class="callout ${bad ? 'is-bad' : 'is-ok'}">
    <div class="callout-title">${icon(bad ? 'alert' : 'check', 'i-sm')} ${bad ? 'Not approved' : 'Approved'} by ${m.reviewer_name}</div>
    ${m.review_comments ? html`<p>${m.review_comments}</p>` : ''}
    <p class="small faint" style="margin-top:6px">${fullTime(m.reviewed_at)}</p>
  </div>`;
}

function claimCard(c) {
  return html`<section class="card">
    <header class="card-head"><h2 class="card-title">Reimbursement</h2>${status(c.status, CLAIM_STATUS)}</header>
    <div class="card-pad">
      <dl class="kv">
        <dt>Claimed</dt><dd>${rupees(c.amount_claimed)}</dd>
        ${c.amount_approved != null ? html`<dt>Approved</dt><dd>${rupees(c.amount_approved)}</dd>` : ''}
        <dt>Attendance</dt><dd>${c.actual_attendance}</dd>
        <dt>Receipts</dt><dd>${plural(c.files.length, 'file')}</dd>
      </dl>
      ${c.review_notes ? html`<p class="small muted" style="margin-top:12px">${c.review_notes}</p>` : ''}
      <a class="btn btn-sm btn-block" style="margin-top:14px" href="#/claims?open=${c.id}">Open claim</a>
    </div>
  </section>`;
}

// ── Action panel ────────────────────────────────────────────────────────────
function actionPanel(d, ctx) {
  const { meetup: m, can, invitations } = d;
  const accepted = invitations.filter((i) => i.status === 'ACCEPTED').length;
  const waiting = invitations.filter((i) => i.status === 'INVITED').length;
  const declined = invitations.length - accepted - waiting;
  const blocks = [];

  if (can.review) {
    blocks.push(html`<form class="action-panel" data-review>
      <h3>Your decision</h3>
      <p>${invitations.length ? `${accepted} of ${invitations.length} co-hosts accepted${waiting ? `, ${waiting} didn't reply` : ''}.` : 'No co-hosts.'}
        ${m.budget_requested ? html` Requesting <b>${rupees(m.budget_requested)}</b> for ${m.expected_attendees} people.` : ' No budget requested.'}</p>
      <textarea class="textarea" name="comments" rows="3" placeholder="Feedback for the host (required if rejecting)"></textarea>
      <div class="btn-row">
        <button class="btn btn-danger" type="button" data-decide="REJECT">${icon('x', 'i-sm')} Reject</button>
        <button class="btn btn-success" type="button" data-decide="APPROVE">${icon('check', 'i-sm')} Approve</button>
      </div>
    </form>`);
  }

  if (d.my_invitation && can.respond) {
    const mine = d.my_invitation;
    blocks.push(mine.status === 'INVITED'
      ? html`<form class="action-panel" data-respond-form>
          <h3>${m.proposer_name} invited you to co-host</h3>
          <p>Co-hosts help run the day and are listed on the proposal Management reviews.</p>
          <textarea class="textarea" name="note" rows="2" placeholder="Optional note to the host"></textarea>
          <div class="btn-row">
            <button class="btn" type="button" data-respond="DECLINE">Decline</button>
            <button class="btn btn-primary" type="button" data-respond="ACCEPT">Accept</button>
          </div>
        </form>`
      : html`<div class="action-panel"><h3>You ${mine.status === 'ACCEPTED' ? "are co-hosting" : 'declined'}</h3>
          <p>Changed your mind? You can switch your answer while the meetup is open.</p>
          <button class="btn btn-sm" data-respond="${mine.status === 'ACCEPTED' ? 'DECLINE' : 'ACCEPT'}">${mine.status === 'ACCEPTED' ? 'Step down as co-host' : 'Accept after all'}</button>
        </div>`);
  }

  const isHost = m.proposer_id === ctx.user.id;
  if (isHost) {
    const host = {
      DRAFT: [
        'This is a draft',
        invitations.length ? `Submitting sends invites to ${plural(invitations.length, 'co-host')}. Once they reply it goes to Management.` : 'Submitting sends it straight to Management.',
        [['primary', 'submit', 'send', 'Submit proposal'], ['', 'edit', 'edit', 'Edit'], ['danger', 'delete', 'trash', 'Delete draft']],
      ],
      PEER_REVIEW: [
        `Waiting on ${plural(waiting, 'co-host')}`,
        `${accepted} accepted${declined ? `, ${declined} declined` : ''}. It moves to Management automatically when everyone replies, or you can send it now.`,
        [['primary', 'send_to_management', 'arrow-right', 'Send to Management now'], ['', 'withdraw', 'rotate', 'Withdraw to draft']],
      ],
      PENDING: [
        'With Management',
        'A reviewer will approve it or send it back with feedback. You will get a notification either way.',
        [['', 'withdraw', 'rotate', 'Withdraw to draft']],
      ],
      REJECTED: [
        'Revise and resubmit',
        'Address the feedback below, then resubmit. Co-hosts who already accepted stay on.',
        [['primary', 'edit', 'edit', 'Edit and resubmit']],
      ],
      APPROVED: daysUntil(m.event_date) <= 0 ? [
        'How did it go?',
        m.budget_requested ? 'File your claim with bills and attendance to get reimbursed. Filing closes out the meetup.' : 'Mark the meetup as held to close it out.',
        m.budget_requested ? [['primary', 'file_claim', 'receipt', 'File reimbursement claim'], ['', 'complete', 'flag', 'Mark as held without a claim']] : [['primary', 'complete', 'flag', 'Mark as held']],
      ] : [
        "You're all set",
        `Approved and happening ${relDay(m.event_date).toLowerCase()}. Keep an attendance sheet and your bills for the claim.`,
        [],
      ],
      COMPLETED: d.claim ? null : m.budget_requested ? [
        'File your claim',
        'Attach bills and an attendance record. Management verifies them before payout.',
        [['primary', 'file_claim', 'receipt', 'File reimbursement claim']],
      ] : null,
    }[m.status];
    if (host) {
      blocks.push(html`<div class="action-panel">
        <h3>${host[0]}</h3><p>${host[1]}</p>
        ${host[2].filter(([, act]) => can[act]).map(([kind, act, ic, label]) =>
          html`<button class="btn ${kind ? `btn-${kind}` : ''} btn-block" data-act="${act}">${icon(ic, 'i-sm')} ${label}</button>`)}
      </div>`);
    }
  }

  if (ctx.user.role === 'MANAGEMENT' && can.complete) {
    blocks.push(html`<div class="action-panel"><h3>Close out</h3>
      <p>${daysUntil(m.event_date) <= 0 ? 'The date has passed.' : 'Scheduled for later.'} Mark it as held so the host can file a claim.</p>
      <button class="btn btn-block" data-act="complete">${icon('flag', 'i-sm')} Mark as held</button></div>`);
  }

  if (can.cancel && !(isHost && ['PEER_REVIEW', 'PENDING'].includes(m.status))) {
    blocks.push(html`<div class="action-panel" style="padding-top:0"><button class="btn btn-ghost btn-danger btn-sm" data-act="cancel">Cancel this meetup</button></div>`);
  }

  if (!blocks.length) {
    const msg = {
      DRAFT: 'Only the host can see this draft.',
      PEER_REVIEW: 'Waiting for co-hosts to reply before it goes to Management.',
      PENDING: 'Waiting for a Management decision.',
      APPROVED: 'Approved and on the calendar.',
      REJECTED: 'Sent back to the host with feedback.',
      COMPLETED: 'This meetup has taken place.',
      CANCELLED: 'This meetup was cancelled.',
    }[m.status];
    return html`<section class="card"><div class="action-panel"><h3>${status(m.status)}</h3><p>${msg}</p></div></section>`;
  }
  return html`<section class="card">${blocks.map((b, i) => (i ? html`<div style="border-top:1px solid var(--border)">${b}</div>` : b))}</section>`;
}

// ── Behaviour ───────────────────────────────────────────────────────────────
function bind(el, d, ctx) {
  const m = d.meetup;
  const base = `/api/meetups/${m.id}`;
  const done = (msg) => { toast(msg); ctx.refreshBadges(); ctx.rerender(); };

  on(el, 'click', '[data-decide]', (e, btn) => {
    const decision = btn.dataset.decide;
    const comments = $('[data-review] [name=comments]', el).value.trim();
    if (decision === 'REJECT' && comments.length < 10) {
      toast('Add feedback (at least 10 characters) so the host knows what to change.', { error: true });
      $('[data-review] [name=comments]', el).focus();
      return;
    }
    busy(btn, async () => {
      await api.post(`${base}/review`, { decision, comments });
      done(decision === 'APPROVE' ? 'Approved. The host and co-hosts have been notified.' : 'Rejected with feedback. The host has been notified.');
    });
  });

  on(el, 'click', '[data-respond]', (e, btn) => {
    const note = $('[data-respond-form] [name=note]', el)?.value || '';
    busy(btn, async () => {
      await api.post(`/api/invitations/${m.id}/respond`, { decision: btn.dataset.respond, note });
      done(btn.dataset.respond === 'ACCEPT' ? "You're a co-host." : 'Response recorded.');
    });
  });

  on(el, 'click', '[data-act]', async (e, btn) => {
    const act = btn.dataset.act;
    if (act === 'edit') { location.hash = `#/meetups/${m.id}/edit`; return; }
    if (act === 'file_claim') { fileClaim(d, ctx); return; }
    if (act === 'delete') {
      if (!await confirmDialog({ title: 'Delete this draft?', text: 'The draft and its co-host list will be removed. This cannot be undone.', confirmLabel: 'Delete draft', danger: true })) return;
      return busy(btn, async () => { await api.del(base); toast('Draft deleted.'); location.hash = '#/meetups'; });
    }
    if (act === 'cancel') {
      const ok = await openDialog({
        title: 'Cancel this meetup?',
        subtitle: 'The host and co-hosts will be notified with your reason.',
        body: html`<label class="field"><span class="field-label">Reason</span><textarea class="textarea" name="reason" rows="3" required></textarea></label>`,
        submitLabel: 'Cancel meetup', submitClass: 'btn-danger', cancelLabel: 'Keep it',
        onSubmit: async (form) => { await api.post(`${base}/cancel`, formData(form)); return true; },
      });
      if (ok) done('Meetup cancelled.');
      return;
    }
    const calls = {
      submit: [`${base}/submit`, 'Submitted.'],
      send_to_management: [`${base}/send-to-management`, 'Sent to Management.'],
      withdraw: [`${base}/withdraw`, 'Withdrawn to draft. You can edit it now.'],
      complete: [`${base}/complete`, 'Marked as held.'],
    };
    const [url, msg] = calls[act];
    busy(btn, async () => { await api.post(url); done(msg); });
  });

  $('[data-comment]', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const body = form.body.value.trim();
    if (!body) return;
    busy(form.querySelector('button'), async () => {
      await api.post(`${base}/comments`, { body });
      ctx.rerender();
    });
  });
}

// ── Claim form ──────────────────────────────────────────────────────────────
export async function fileClaim(d, ctx) {
  const m = d.meetup;
  const ok = await openDialog({
    title: 'File reimbursement claim',
    subtitle: `${m.title} · budget ${rupees(m.budget_requested)}`,
    wide: true,
    submitLabel: 'Submit claim',
    body: html`
      <div class="field-row keep">
        <label class="field"><span class="field-label">Amount spent</span>
          <span class="prefix-input"><span>₹</span><input class="input" name="amount_claimed" inputmode="numeric" required value="${m.budget_requested || ''}"></span>
          <span class="field-hint">Approved budget was ${rupees(m.budget_requested)}</span></label>
        <label class="field"><span class="field-label">People who attended</span>
          <input class="input" name="actual_attendance" inputmode="numeric" required placeholder="${m.expected_attendees}">
          <span class="field-hint">Expected ${m.expected_attendees}</span></label>
      </div>
      <label class="field"><span class="field-label">What the money was spent on</span>
        <textarea class="textarea" name="expense_notes" rows="3" required placeholder="One line per bill, e.g. Snacks from … — ₹1,200">${m.budget_breakdown || ''}</textarea></label>
      <label class="field"><span class="field-label">Attendance proof <span class="opt">optional</span></span>
        <input class="input" name="attendance_notes" placeholder="e.g. Sign-in sheet and group photo attached"></label>
      <label class="field"><span class="field-label">Pay to</span>
        <input class="input" name="payout_details" required placeholder="UPI ID or bank account"></label>
      <div class="field"><span class="field-label">Bills and receipts</span>
        <label class="file-drop" data-drop>${icon('upload', 'i-lg')}<strong>Choose files</strong><span class="small">PDF or images, up to 10 files</span>
          <input type="file" name="receipts" multiple accept=".pdf,image/*"></label>
        <div class="file-list" data-files></div>
      </div>`,
    onSubmit: async (form) => {
      const fd = new FormData(form);
      fd.delete('receipts');
      files.forEach((f) => fd.append('receipts', f));
      await api.post(`/api/meetups/${m.id}/claim`, fd);
      return true;
    },
  });

  if (ok) { toast('Claim submitted for verification.'); ctx.refreshBadges(); ctx.rerender(); }
}

// Files picked in the claim dialog (kept outside the form so we can add from multiple picks / drops).
let files = [];
document.addEventListener('change', (e) => {
  if (e.target.matches('#dialog input[name=receipts]')) { addFiles(e.target.files); e.target.value = ''; }
});
document.addEventListener('dragover', (e) => { const z = e.target.closest?.('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('is-over'); } });
document.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('is-over'));
document.addEventListener('drop', (e) => {
  const z = e.target.closest?.('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.remove('is-over');
  addFiles(e.dataTransfer.files);
});
document.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove-file]');
  if (rm) { files.splice(Number(rm.dataset.removeFile), 1); drawFiles(); }
});
document.getElementById('dialog').addEventListener('close', () => { files = []; });

function addFiles(list) { files = [...files, ...list].slice(0, 10); drawFiles(); }
function drawFiles() {
  const box = document.querySelector('#dialog [data-files]');
  if (!box) return;
  box.innerHTML = String(html`${files.map((f, i) => html`<div class="file-item">${icon('file', 'i-sm')}<span class="truncate">${f.name}</span>
    <span class="faint small">${Math.max(1, Math.round(f.size / 1024))} KB</span>
    <button type="button" class="icon-btn" style="width:28px;height:28px" data-remove-file="${i}" aria-label="Remove">${icon('x', 'i-sm')}</button></div>`)}`);
}
