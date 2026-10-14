// Home: one screen per role, built around "what needs me now".
import { api } from '../api.js';
import {
  ago, busy, crest, datebox, empty, fmtDate, hoursSince, html, icon, meetupRow, on, relDay, rupees, status, toast,
} from '../ui.js';
import { mountCalendar } from '../calendar.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const firstName = (name) => name.replace(/^(Dr|Prof)\.\s*/, '').split(' ')[0];
const todayLong = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

export async function render(el, ctx) {
  ctx.setTitle('Home');
  const data = await api.get('/api/home');
  if (!ctx.isCurrent()) return;
  const view = { MANAGEMENT: management, UHC: uhc, LHC: lhc }[ctx.user.role];
  el.innerHTML = String(view(data, ctx));
  bind(el, ctx);
  const u = ctx.user;
  const scopes = {
    MANAGEMENT: [['all', 'All meetups']],
    UHC: [['house', u.house_name], ['all', 'All houses']],
    LHC: [['region', u.region_name], ['mine', 'Mine'], ['all', 'Everywhere']],
  }[u.role];
  await mountCalendar(el.querySelector('[data-calendar]'), { scopes });
}

// ── Shared pieces ───────────────────────────────────────────────────────────
const stat = (label, value, { href, note, hot } = {}) => html`
  <${href ? 'a' : 'div'} class="stat ${hot && value ? 'is-hot' : ''}" ${href ? html`href="${href}"` : ''}>
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    ${note ? html`<div class="stat-note">${note}</div>` : ''}
  </${href ? 'a' : 'div'}>`;

const card = (title, count, body, link) => html`
  <section class="card">
    <header class="card-head"><h2 class="card-title">${title}</h2>${count != null ? html`<span class="count">${count}</span>` : ''}
      ${link ? html`<a class="link" href="${link[1]}">${link[0]} ${icon('arrow-right', 'i-sm')}</a>` : ''}</header>
    ${body}
  </section>`;

const rows = (list, opts) => html`<div class="rows">${list.map((m) => meetupRow(m, opts?.(m)))}</div>`;

const ACTIVITY_TEXT = {
  SUBMITTED: 'submitted', RESUBMITTED: 'resubmitted', WITHDRAWN: 'withdrew', EDITED: 'edited',
  INVITE_ACCEPTED: 'agreed to co-host', INVITE_DECLINED: 'declined to co-host',
  SENT_TO_MANAGEMENT: 'sent to Management', APPROVED: 'approved', REJECTED: 'rejected',
  COMPLETED: 'marked complete', CANCELLED: 'cancelled', COMMENT: 'commented on',
  CLAIM_FILED: 'filed a claim for', CLAIM_IN_PROGRESS: 'forwarded the claim for', CLAIM_APPROVED: 'paid out the claim for',
  CLAIM_REJECTED: 'rejected the claim for',
};
const feed = (items) => items.length
  ? html`<ul class="feed">${items.map((a) => html`<li><span class="feed-dot"></span>
      <span><b>${a.actor_name || 'System'}</b> ${ACTIVITY_TEXT[a.action] || a.action.toLowerCase()} <a href="#/meetups/${a.meetup_id}">${a.meetup_title}</a></span>
      <span class="feed-time">${ago(a.created_at)}</span></li>`)}</ul>`
  : html`<div class="empty-inline">Nothing yet.</div>`;

const waited = (m) => {
  const h = hoursSince(m.submitted_at);
  const label = h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
  return html`<span class="age ${h > 72 ? 'is-old' : ''}" title="Waiting since submission">waiting ${label}</span>`;
};

// ── Management ──────────────────────────────────────────────────────────────
function management(d, ctx) {
  const c = d.counts;
  return html`
    <div class="hello"><div class="hello-text"><h1>${greeting()}, ${firstName(ctx.user.name)}</h1><p>${todayLong()}</p></div></div>

    <div class="stats">
      ${stat('Awaiting your decision', c.pending, { href: '#/meetups?tab=pending', hot: true, note: c.peer_review ? `${c.peer_review} more with co-hosts` : 'Queue is clear' })}
      ${stat('Claims to verify', c.claims, { href: '#/claims', hot: true, note: 'Bills and attendance' })}
      ${stat('Next 14 days', c.upcoming, { href: '#/meetups?tab=upcoming', note: 'Approved meetups' })}
      ${stat('Need closing', c.to_close, { note: 'Held, not marked complete' })}
    </div>

    <div class="section" data-calendar></div>

    <div class="grid grid-main section">
      <div class="stack">
        ${card('Decision queue', d.queue.length,
          d.queue.length ? rows(d.queue, (m) => ({ extra: waited(m) }))
            : empty('check', 'Nothing waiting', 'New proposals land here once co-hosts have replied.'),
          d.queue.length ? ['All meetups', '#/meetups?tab=pending'] : null)}
        ${card('Coming up in the next two weeks', d.upcoming.length,
          d.upcoming.length ? rows(d.upcoming) : html`<div class="empty-inline">No approved meetups in the next 14 days.</div>`)}
        ${d.to_close.length ? card('Held but not closed', d.to_close.length, html`
          <p class="small muted" style="padding:12px 20px 0">These meetups' dates have passed. Mark them complete so hosts can file claims.</p>
          ${rows(d.to_close)}`) : ''}
      </div>
      <div class="stack">
        ${card('Claims to verify', d.claims.length, d.claims.length ? html`<div>${d.claims.map((c) => html`
          <a class="task" href="#/claims?open=${c.id}">
            <span class="task-icon ${c.status === 'PENDING_REVIEW' ? 'accent' : ''}">${icon('receipt')}</span>
            <span class="task-body"><span class="task-title">${rupees(c.amount_claimed)}</span>
              <span class="task-sub">${c.meetup_title}</span></span>
            ${status(c.status)}
          </a>`)}</div>` : html`<div class="empty-inline">No open claims.</div>`, ['All claims', '#/claims'])}
        ${card('Recent activity', null, feed(d.activity))}
      </div>
    </div>`;
}

// ── UHC ─────────────────────────────────────────────────────────────────────
function uhc(d, ctx) {
  const c = d.counts;
  const inReview = (c.PEER_REVIEW || 0) + (c.PENDING || 0);
  const quiet = d.regions.filter((r) => !r.meetups).length;
  return html`
    <div class="hello">
      <div class="house-banner">${crest(d.house.slug, 'crest-lg')}
        <div class="hello-text"><h1>${greeting()}, ${firstName(ctx.user.name)}</h1>
          <p>${d.house.name} House <span class="sep">${ctx.user.title}, Upper House Council</span></p></div>
      </div>
    </div>

    <div class="stats">
      ${stat('In review', inReview, { href: `#/meetups?tab=review&house=${d.house.id}`, note: 'Proposals from your LHCs' })}
      ${stat('Approved', c.APPROVED || 0, { href: `#/meetups?tab=upcoming&house=${d.house.id}`, note: 'Scheduled to happen' })}
      ${stat('Completed', c.COMPLETED || 0, { note: 'All time' })}
      ${stat('Rejected', c.REJECTED || 0, { note: 'Needed changes' })}
    </div>

    <div class="section" data-calendar></div>

    <div class="grid grid-main section">
      <div class="stack">
        ${card('Your LHCs by region', quiet ? `${quiet} quiet` : null, html`
          <div class="region-cov">${d.regions.map((r) => html`
            <a class="cov ${r.meetups ? '' : 'is-zero'}" href="#/meetups?tab=all&house=${d.house.id}&region=${r.id}">
              <span class="cov-code">${r.code}</span>
              <span class="cov-body"><span class="cov-name">${r.name}</span><span class="cov-sub">${r.lhc_name || 'No LHC assigned'}</span></span>
              <span class="cov-n" title="Meetups proposed">${r.meetups}</span>
            </a>`)}</div>`)}
        ${card('In review', d.in_review.length, d.in_review.length ? rows(d.in_review)
          : html`<div class="empty-inline">No ${d.house.name} proposals are in review.</div>`)}
        ${card('Upcoming', d.upcoming.length, d.upcoming.length ? rows(d.upcoming)
          : html`<div class="empty-inline">No approved ${d.house.name} meetups coming up.</div>`, ['Calendar', `#/meetups?tab=upcoming&house=${d.house.id}`])}
      </div>
      <div class="stack">
        ${card('House activity', null, feed(d.activity))}
      </div>
    </div>`;
}

// ── LHC ─────────────────────────────────────────────────────────────────────
const TODO = {
  draft: { icon: 'edit', cls: '', title: 'Finish your draft', cta: 'Continue', href: (m) => `#/meetups/${m.id}/edit` },
  rejected: { icon: 'alert', cls: 'bad', title: 'Changes requested', cta: 'Revise', href: (m) => `#/meetups/${m.id}` },
  close: { icon: 'flag', cls: 'ok', title: 'How did it go?', cta: 'Close out', href: (m) => `#/meetups/${m.id}` },
  claim: { icon: 'receipt', cls: 'accent', title: 'File your reimbursement', cta: 'File claim', href: (m) => `#/meetups/${m.id}?claim=1` },
};

function lhc(d, ctx) {
  const u = ctx.user;
  const attention = d.invites.length + d.todo.length;
  return html`
    <div class="hello">
      <div class="house-banner">${crest(u.house_slug, 'crest-lg')}
        <div class="hello-text"><h1>${greeting()}, ${firstName(u.name)}</h1>
          <p>${u.house_name} <span class="sep">${u.region_name} region</span></p></div>
      </div>
    </div>

    ${attention ? card('Needs your attention', attention, html`<div>
      ${d.invites.map((m) => html`
        <div class="task" data-invite="${m.id}">
          <span class="task-icon accent">${icon('users')}</span>
          <span class="task-body"><span class="task-title">${m.proposer_name} invited you to co-host</span>
            <span class="task-sub"><a href="#/meetups/${m.id}" class="link" style="font-weight:500">${m.title}</a> · ${fmtDate(m.event_date)}</span></span>
          <span class="task-actions">
            <button class="btn btn-sm" data-respond="DECLINE">Decline</button>
            <button class="btn btn-sm btn-primary" data-respond="ACCEPT">Accept</button>
          </span>
        </div>`)}
      ${d.todo.map(({ kind, meetup: m }) => {
        const t = TODO[kind];
        return html`<div class="task">
          <span class="task-icon ${t.cls}">${icon(t.icon)}</span>
          <span class="task-body"><span class="task-title">${t.title}</span><span class="task-sub">${m.title} · ${fmtDate(m.event_date)}</span></span>
          <span class="task-actions"><a class="btn btn-sm" href="${t.href(m)}">${t.cta}</a></span>
        </div>`;
      })}
    </div>`) : ''}

    <div class="${attention ? 'section' : ''}" data-calendar></div>

    <div class="grid grid-main section">
      <div class="stack">
        ${card('Your proposals in review', d.in_flight.length, d.in_flight.length ? rows(d.in_flight)
          : empty('send', 'Nothing in review', 'Propose a meetup and invite LHCs from your region to co-host it.',
              html`<a class="btn btn-primary btn-sm" href="#/new">${icon('plus')} New proposal</a>`))}
        ${card('Coming up for you', d.upcoming.length, d.upcoming.length ? rows(d.upcoming)
          : html`<div class="empty-inline">No approved meetups you're hosting or co-hosting yet.</div>`)}
      </div>
      <div class="stack">
        <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          ${stat('Proposed', d.counts.proposed)}
          ${stat('Approved', d.counts.approved)}
          ${stat('Held', d.counts.completed)}
        </div>
        ${card(`Around ${u.region_name}`, d.region.length, d.region.length ? html`<div class="rows rows-compact">${d.region.map((m) => html`
          <a class="row" href="#/meetups/${m.id}">
            ${datebox(m.event_date)}
            <div class="row-main"><div class="row-title">${m.title}</div><div class="row-meta"><span>${m.proposer_name}</span><span class="sep">${relDay(m.event_date)}</span></div></div>
            <div class="row-foot">${status(m.status)}</div>
            <span class="row-chev">${icon('chevron-right', 'i-sm')}</span>
          </a>`)}</div>` : html`<div class="empty-inline">No other meetups planned in ${u.region_name} yet.</div>`,
          ['Region', '#/meetups?tab=region'])}
      </div>
    </div>`;
}

function bind(el, ctx) {
  on(el, 'click', '[data-respond]', (e, btn) => {
    const row = btn.closest('[data-invite]');
    const decision = btn.dataset.respond;
    busy(btn, async () => {
      await api.post(`/api/invitations/${row.dataset.invite}/respond`, { decision });
      toast(decision === 'ACCEPT' ? "You're a co-host. The host has been notified." : 'Invitation declined.');
      ctx.refreshBadges();
      ctx.rerender();
    });
  });
}

