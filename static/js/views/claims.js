// Reimbursement claims: Management verifies, UHC reads their house, LHC tracks their own.
import { api } from '../api.js';
import {
  $, CLAIM_STATUS, empty, fmtDate, formData, fullTime, house, html, icon, on, openDialog, plural, rupees, status, toast,
} from '../ui.js';

const TABS = [
  { id: 'open', label: 'To verify', statuses: ['PENDING_REVIEW'] },
  { id: 'accounts', label: 'With accounts', statuses: ['IN_PROGRESS'] },
  { id: 'settled', label: 'Settled', statuses: ['APPROVED', 'REJECTED'] },
  { id: 'all', label: 'All', statuses: null },
];

export async function render(el, ctx) {
  const { user, query } = ctx;
  ctx.setTitle('Reimbursements');
  const reqs = [api.get('/api/claims')];
  if (user.role !== 'MANAGEMENT') reqs.push(api.get('/api/meetups', { mine: 1, status: 'COMPLETED,APPROVED', when: 'past' }));
  const [{ claims }, ready] = await Promise.all(reqs);
  if (!ctx.isCurrent()) return;

  const unclaimed = (ready?.meetups || []).filter((m) => m.proposer_id === user.id && !m.claim_status && m.budget_requested > 0);
  let tab = query.get('tab') || (user.role === 'LHC' ? 'all' : 'open');
  const count = (t) => (t.statuses ? claims.filter((c) => t.statuses.includes(c.status)).length : claims.length);
  const totals = {
    claimed: claims.reduce((s, c) => s + c.amount_claimed, 0),
    paid: claims.filter((c) => c.status === 'APPROVED').reduce((s, c) => s + (c.amount_approved || 0), 0),
  };

  const sub = {
    MANAGEMENT: 'Check bills and attendance against the approved budget, then pay out or send back.',
    UHC: `Your own claims, plus claims filed by ${user.house_name} LHCs (read-only).`,
    LHC: 'Claims for meetups you hosted. File one after the meetup with bills and attendance.',
  }[user.role];

  el.innerHTML = String(html`
    <div class="page-head"><div class="page-head-text"><h1 class="page-title">Reimbursements</h1><p class="page-sub">${sub}</p></div></div>

    ${user.role !== 'LHC' ? html`<div class="stats" style="margin-bottom:24px">
      <div class="stat ${count(TABS[0]) ? 'is-hot' : ''}"><div class="stat-label">To verify</div><div class="stat-value">${count(TABS[0])}</div></div>
      <div class="stat"><div class="stat-label">With accounts</div><div class="stat-value">${count(TABS[1])}</div></div>
      <div class="stat"><div class="stat-label">Claimed</div><div class="stat-value">${rupees(totals.claimed)}</div></div>
      <div class="stat"><div class="stat-label">Paid out</div><div class="stat-value">${rupees(totals.paid)}</div></div>
    </div>` : ''}

    ${unclaimed.length ? html`<section class="card" style="margin-bottom:24px">
      <header class="card-head"><h2 class="card-title">Ready to claim</h2><span class="count">${unclaimed.length}</span></header>
      ${unclaimed.map((m) => html`<div class="task">
        <span class="task-icon accent">${icon('receipt')}</span>
        <span class="task-body"><span class="task-title">${m.title}</span><span class="task-sub">Held ${fmtDate(m.event_date)} · budget ${rupees(m.budget_requested)}</span></span>
        <span class="task-actions"><a class="btn btn-sm btn-primary" href="#/meetups/${m.id}/claim">File claim</a></span>
      </div>`)}
    </section>` : ''}

    ${user.role !== 'LHC' ? html`<div class="toolbar"><div class="tabs">${TABS.map((t) => html`
      <button class="tab ${t.id === tab ? 'active' : ''}" data-tab="${t.id}">${t.label} <span class="n">${count(t)}</span></button>`)}</div></div>` : ''}
    <div id="claimList"></div>`);

  const draw = () => {
    const t = TABS.find((x) => x.id === tab) || TABS[3];
    const list = t.statuses ? claims.filter((c) => t.statuses.includes(c.status)) : claims;
    $('#claimList', el).innerHTML = String(list.length
      ? html`<div class="card"><div class="rows">${list.map(row)}</div></div>`
      : html`<div class="card">${empty('receipt', user.role === 'LHC' ? 'No claims yet' : 'Nothing here', user.role === 'LHC' ? 'After a meetup with a budget, file a claim from its page.' : 'Claims in this state will appear here.')}</div>`);
  };
  draw();

  on(el, 'click', '[data-tab]', (e, b) => {
    tab = b.dataset.tab;
    el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    history.replaceState(null, '', `#/claims?tab=${tab}`);
    draw();
  });
  on(el, 'click', '[data-claim]', (e, b) => { e.preventDefault(); openClaim(b.dataset.claim, ctx); });

  if (query.get('open')) openClaim(query.get('open'), ctx);
}

function row(c) {
  const over = c.amount_claimed > c.budget_requested;
  return html`<a class="row claim-row" href="#" data-claim="${c.id}">
    <div class="row-main">
      <div class="row-title">${c.meetup_title}</div>
      <div class="row-meta"><span>${c.claimant_name}</span><span class="sep">${c.region_name}</span><span class="sep">held ${fmtDate(c.event_date)}</span></div>
    </div>
    <div class="row-cell col-house">${house(c.house_slug, c.house_name)}</div>
    <div class="amount ${over ? 'over' : ''}">${rupees(c.amount_claimed)}<small>${over ? 'over' : 'of'} ${rupees(c.budget_requested)} budget</small></div>
    <div class="row-cell col-att"><span>${c.actual_attendance}</span><span class="faint"> / ${c.expected_attendees} expected</span></div>
    <div class="row-status">${status(c.status, CLAIM_STATUS)}</div>
    <span class="row-chev">${icon('chevron-right', 'i-sm')}</span>
  </a>`;
}

async function openClaim(id, ctx) {
  let claim;
  try { ({ claim } = await api.get(`/api/claims/${id}`)); } catch (e) { toast(e.message, { error: true }); return; }
  const over = claim.amount_claimed - claim.budget_requested;
  const body = html`
    <div class="callout ${over > 0 ? 'is-warn' : ''}">
      <dl class="kv">
        <dt>Claimed</dt><dd>${rupees(claim.amount_claimed)}</dd>
        <dt>Approved budget</dt><dd>${rupees(claim.budget_requested)}</dd>
        ${over > 0 ? html`<dt>Over budget by</dt><dd style="color:var(--st-pending)">${rupees(over)}</dd>` : ''}
        <dt>Attendance</dt><dd><span>${claim.actual_attendance}</span> <span class="faint">of ${claim.expected_attendees} expected</span></dd>
        ${claim.amount_approved != null ? html`<dt>Paid out</dt><dd>${rupees(claim.amount_approved)}</dd>` : ''}
      </dl>
    </div>
    <div class="field"><span class="field-label">Expenses</span><p class="prose" style="font-size:13.5px">${claim.expense_notes}</p></div>
    <div class="field"><span class="field-label">Post</span><a class="link" href="${claim.post_link}" target="_blank" rel="noopener" style="font-weight:400;word-break:break-all">${claim.post_link}</a></div>
    <div class="field"><span class="field-label">Pay to · ${{ SELF: 'the host', OTHER: 'another student', COHOST: `co-host (${claim.payee_house_name})` }[claim.payout_mode]}</span>
      ${claim.bank_hidden
        ? html`<p class="muted">${claim.payout_mode === 'COHOST' ? claim.payee_user_name : 'Payee'} · bank details are visible to Management only.</p>`
        : claim.account_number
          ? html`<dl class="kv"><dt>Name</dt><dd>${claim.payee_name}</dd><dt>Bank</dt><dd>${claim.bank_name}</dd><dt>Account</dt><dd>${claim.account_number}</dd>
              <dt>IFSC</dt><dd>${claim.ifsc}</dd>${claim.upi_id ? html`<dt>UPI</dt><dd>${claim.upi_id}</dd>` : ''}</dl>`
          : html`<p class="muted">Waiting for ${claim.payee_user_name} to confirm their details.</p>`}
    </div>
    <details class="att-details"><summary>${claim.attendees.length} students attended <span class="faint">· show list</span></summary>
      <div class="att-list" style="margin-top:8px"><div class="att-rows">${claim.attendees.map((a, i) => html`<div class="att-row"><span class="att-n">${i + 1}</span><span class="truncate">${a.name}</span><span class="truncate faint">${a.email}</span><span></span></div>`)}</div></div>
    </details>
    <div class="field"><span class="field-label">Receipts · ${plural(claim.files.length, 'file')}</span>
      <div class="file-list" style="margin:0">${claim.files.map((f) => f.is_sample
        ? html`<div class="file-item" title="Sample data — no file attached">${icon('file', 'i-sm')}<span class="truncate">${f.original_name}</span><span class="faint small">sample</span></div>`
        : html`<a class="file-item" href="/api/claims/${claim.id}/files/${f.id}" target="_blank" rel="noopener">${icon('file', 'i-sm')}<span class="truncate">${f.original_name}</span><span class="faint small">${Math.max(1, Math.round(f.size_bytes / 1024))} KB</span></a>`)}</div></div>
    ${claim.reviewed_by ? html`<div class="callout"><div class="callout-title">${status(claim.status, CLAIM_STATUS)} <span class="faint small">by ${claim.reviewer_name} · ${fullTime(claim.reviewed_at)}</span></div>${claim.review_notes ? html`<p>${claim.review_notes}</p>` : ''}</div>` : ''}
    ${claim.can_review ? html`
      <div class="field"><span class="field-label">Decision</span>
        <div class="choice-group">
          <label class="choice"><input type="radio" name="decision" value="APPROVE" checked>${icon('check')}<span><strong>Pay out</strong><small>Bills verified</small></span></label>
          ${claim.status === 'PENDING_REVIEW' ? html`<label class="choice"><input type="radio" name="decision" value="IN_PROGRESS">${icon('arrow-right')}<span><strong>To accounts</strong><small>Processing</small></span></label>` : ''}
          <label class="choice"><input type="radio" name="decision" value="REJECT">${icon('x')}<span><strong>Reject</strong><small>Explain why</small></span></label>
        </div></div>
      <label class="field" data-amount><span class="field-label">Amount to pay</span>
        <span class="prefix-input"><span>₹</span><input class="input" name="amount_approved" inputmode="numeric" value="${Math.min(claim.amount_claimed, claim.budget_requested || claim.amount_claimed)}"></span>
        <span class="field-hint">Defaults to the lower of claimed and budgeted.</span></label>
      <label class="field"><span class="field-label">Note to the host <span class="opt">required if rejecting</span></span>
        <textarea class="textarea" name="notes" rows="2"></textarea></label>` : ''}`;

  const done = await openDialog({
    title: claim.meetup_title,
    subtitle: `${claim.claimant_name} · ${claim.house_name} · ${claim.region_name} · filed ${fullTime(claim.created_at)}`,
    wide: true,
    body,
    cancelLabel: claim.can_review ? 'Cancel' : 'Close',
    submitLabel: 'Save decision',
    onSubmit: claim.can_review ? async (form) => {
      const data = formData(form);
      if (data.decision !== 'APPROVE') delete data.amount_approved;
      else data.amount_approved = (data.amount_approved || '').replace(/[^\d]/g, '');
      await api.post(`/api/claims/${claim.id}/review`, data);
      return data.decision;
    } : null,
  });
  if (done) {
    toast({ APPROVE: 'Claim approved for payout.', IN_PROGRESS: 'Forwarded to accounts.', REJECT: 'Claim rejected.' }[done]);
    ctx.refreshBadges();
  }
  history.replaceState(null, '', location.hash.replace(/[?&]open=\d+/, ''));
  if (done) ctx.rerender();
}

function toggleAmount(e) {
  if (e.target.name !== 'decision') return;
  const amt = document.querySelector('#dialog [data-amount]');
  if (amt) amt.hidden = e.target.value !== 'APPROVE';
}
document.getElementById('dialog').addEventListener('change', toggleAmount);
