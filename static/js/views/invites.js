// Co-host invitations for the signed-in LHC or UHC member.
import { api } from '../api.js';
import { busy, datebox, empty, fmtTimeRange, html, icon, on, status, toast } from '../ui.js';

const OPEN = ['PEER_REVIEW', 'PENDING', 'APPROVED'];

export async function render(el, ctx) {
  ctx.setTitle('Co-host invites');
  const { meetups } = await api.get('/api/meetups', { invited: 1, sort: 'date_asc' });
  if (!ctx.isCurrent()) return;

  const waiting = meetups.filter((m) => m.my_invitation === 'INVITED' && OPEN.includes(m.status));
  const accepted = meetups.filter((m) => m.my_invitation === 'ACCEPTED');
  const other = meetups.filter((m) => !waiting.includes(m) && !accepted.includes(m));

  const item = (m, actions) => html`<div class="row row-invite" data-invite="${m.id}">
    ${datebox(m.event_date)}
    <a class="row-main" href="#/meetups/${m.id}">
      <div class="row-title">${m.title}</div>
      <div class="row-meta"><span>${m.proposer_name}</span><span class="sep">${m.house_name}</span><span class="sep">${fmtTimeRange(m.start_time, m.end_time)}</span></div>
    </a>
    <div class="row-foot">${actions}</div>
  </div>`;

  el.innerHTML = String(html`
    <div class="page-head"><div class="page-head-text">
      <h1 class="page-title">Co-host invites</h1>
      <p class="page-sub">${ctx.user.role === 'UHC' ? 'UHC members from other houses' : `LHCs in ${ctx.user.region_name}`} who want you on their meetup. Proposals go to Administration once every co-host replies.</p>
    </div></div>

    <section>
      <div class="section-head"><h2 class="section-title">Waiting for your reply</h2><span class="count">${waiting.length}</span></div>
      <div class="card">${waiting.length ? html`<div class="rows">${waiting.map((m) => item(m, html`
          <button class="btn btn-sm" data-respond="DECLINE">Decline</button>
          <button class="btn btn-sm btn-primary" data-respond="ACCEPT">${icon('check', 'i-sm')} Accept</button>`))}</div>`
        : empty('inbox', 'No invites waiting', ctx.user.role === 'UHC' ? "When another UHC member invites you to co-host, it'll show up here." : "When an LHC in your region invites you to co-host, it'll show up here.")}</div>
    </section>

    ${accepted.length ? html`<section class="section">
      <div class="section-head"><h2 class="section-title">You're co-hosting</h2><span class="count">${accepted.length}</span></div>
      <div class="card"><div class="rows">${accepted.map((m) => item(m, status(m.status)))}</div></div>
    </section>` : ''}

    ${other.length ? html`<section class="section">
      <div class="section-head"><h2 class="section-title">Declined or closed</h2><span class="count">${other.length}</span></div>
      <div class="card"><div class="rows">${other.map((m) => item(m, html`${status(m.my_invitation)}`))}</div></div>
    </section>` : ''}`);

  on(el, 'click', '[data-respond]', (e, btn) => {
    const id = btn.closest('[data-invite]').dataset.invite;
    busy(btn, async () => {
      await api.post(`/api/invitations/${id}/respond`, { decision: btn.dataset.respond });
      toast(btn.dataset.respond === 'ACCEPT' ? "You're a co-host. The host has been notified." : 'Invitation declined.');
      ctx.refreshBadges();
      ctx.rerender();
    });
  });
}
