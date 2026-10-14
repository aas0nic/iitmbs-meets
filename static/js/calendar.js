// Month calendar of meetups with a day agenda. Desktop shows titled chips per day;
// phones collapse to dots with the agenda underneath.
import { api } from './api.js';
import { $, crest, fmtTime, html, icon, status, todayISO } from './ui.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND = { APPROVED: 'approved', PEER_REVIEW: 'review', PENDING: 'review', COMPLETED: 'held' };
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

/**
 * Mount a calendar into `el`.
 * scopes: [[id, label], …] passed to /api/calendar?scope=; the first is the default.
 */
export function mountCalendar(el, { scopes = [['all', 'All']] } = {}) {
  const today = todayISO();
  const t = parse(today);
  const st = { year: t.getFullYear(), month: t.getMonth(), scope: scopes[0][0], selected: today, byDate: new Map(), all: [] };
  let seq = 0;

  function range() {
    const first = new Date(st.year, st.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(st.year, st.month + 1, 0).getDate();
    const weeks = Math.ceil((offset + days) / 7);
    const start = new Date(st.year, st.month, 1 - offset);
    const end = new Date(start); end.setDate(start.getDate() + weeks * 7 - 1);
    return { start, end, weeks };
  }

  async function load() {
    const mine = ++seq;
    const { start, end } = range();
    drawShell(true);
    const { meetups } = await api.get('/api/calendar', { start: iso(start), end: iso(end), scope: st.scope });
    if (mine !== seq) return;
    st.all = meetups;
    st.byDate = new Map();
    for (const m of meetups) {
      if (!st.byDate.has(m.event_date)) st.byDate.set(m.event_date, []);
      st.byDate.get(m.event_date).push(m);
    }
    // Keep the selection inside the visible month; prefer today, else the first day with something on.
    const inMonth = (s) => parse(s).getMonth() === st.month && parse(s).getFullYear() === st.year;
    if (!inMonth(st.selected)) {
      const firstBusy = meetups.find((m) => inMonth(m.event_date) && m.event_date >= today) || meetups.find((m) => inMonth(m.event_date));
      st.selected = inMonth(today) ? today : firstBusy ? firstBusy.event_date : iso(new Date(st.year, st.month, 1));
    }
    drawShell(false);
  }

  function drawShell(loading) {
    const monthName = new Date(st.year, st.month, 1).toLocaleDateString('en-IN', { month: 'long' });
    el.innerHTML = String(html`<section class="card cal" aria-busy="${loading}">
      <header class="cal-head">
        <h2 class="cal-title">${monthName} <span>${st.year}</span></h2>
        <div class="cal-nav">
          <button class="icon-btn" data-cal="prev" aria-label="Previous month">${icon('chevron-left')}</button>
          <button class="btn btn-ghost btn-sm" data-cal="today">Today</button>
          <button class="icon-btn" data-cal="next" aria-label="Next month">${icon('chevron-right')}</button>
        </div>
        ${scopes.length > 1 ? html`<div class="tabs tabs-sm">${scopes.map(([id, label]) => html`<button class="tab ${id === st.scope ? 'active' : ''}" data-scope="${id}">${label}</button>`)}</div>` : ''}
      </header>
      <div class="cal-body">
        <div class="cal-main">
          <div class="cal-dow">${DOW.map((d) => html`<span>${d}</span>`)}</div>
          <div class="cal-grid" style="${loading ? 'opacity:.55' : ''}">${grid()}</div>
        </div>
        <aside class="cal-agenda">${agenda()}</aside>
      </div>
      <footer class="cal-legend">
        <span><i style="background:color-mix(in oklab,var(--st-approved) 30%,transparent);box-shadow:inset 2px 0 0 var(--st-approved)"></i>Approved</span>
        <span><i style="box-shadow:inset 0 0 0 1px var(--st-pending)"></i>In review</span>
        <span><i style="background:var(--surface-3)"></i>Held</span>
      </footer>
    </section>`);
  }

  function grid() {
    const { start, weeks } = range();
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = iso(d);
      const list = st.byDate.get(key) || [];
      const cls = [
        'cal-day',
        d.getMonth() !== st.month && 'out',
        key === today && 'today',
        key === st.selected && 'selected',
        i % 7 >= 5 && 'weekend',
      ].filter(Boolean).join(' ');
      const label = `${d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `, ${list.length} meetup${list.length > 1 ? 's' : ''}` : ''}`;
      cells.push(html`<button type="button" class="${cls}" data-date="${key}" aria-label="${label}" aria-pressed="${key === st.selected}">
        <span class="cal-num">${d.getDate()}</span>
        ${list.slice(0, 2).map((m) => html`<span class="cal-chip k-${KIND[m.status]}" title="${m.title}">${m.title}</span>`)}
        ${list.length > 2 ? html`<span class="cal-more">+${list.length - 2} more</span>` : ''}
        ${list.length ? html`<span class="cal-dots">${list.slice(0, 3).map((m) => html`<i class="k-${KIND[m.status]}"></i>`)}</span>` : ''}
      </button>`);
    }
    return cells;
  }

  function agenda() {
    const d = parse(st.selected);
    const list = st.byDate.get(st.selected) || [];
    const head = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const next = st.all.filter((m) => m.event_date > st.selected && parse(m.event_date).getMonth() === st.month).slice(0, 3);
    return html`
      <div class="cal-agenda-head">
        <h3>${head}${st.selected === today ? html` <span class="tag">Today</span>` : ''}</h3>
        <p>${list.length ? `${list.length} meetup${list.length > 1 ? 's' : ''}` : 'Nothing scheduled'}</p>
      </div>
      <div class="cal-items">
        ${list.map(item)}
        ${!list.length && next.length ? html`<div class="palette-group" style="padding:4px 10px">Later this month</div>${next.map(item)}` : ''}
      </div>`;
  }

  const item = (m) => html`<a class="cal-item" href="#/meetups/${m.id}">
    <span class="cal-item-time">${fmtTime(m.start_time)}<small>${m.event_date !== st.selected ? parse(m.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : fmtTime(m.end_time)}</small></span>
    <span style="min-width:0">
      <span class="cal-item-title" style="display:block">${m.title}</span>
      <span class="cal-item-sub">${crest(m.house_slug)}<span>${m.venue}, ${m.city}</span></span>
      ${status(m.status)}
    </span>
  </a>`;

  el.addEventListener('click', (e) => {
    const day = e.target.closest('[data-date]');
    if (day) {
      const d = parse(day.dataset.date);
      if (d.getMonth() !== st.month) { st.year = d.getFullYear(); st.month = d.getMonth(); st.selected = day.dataset.date; load(); return; }
      st.selected = day.dataset.date;
      el.querySelectorAll('.cal-day').forEach((c) => { c.classList.toggle('selected', c === day); c.setAttribute('aria-pressed', c === day); });
      $('.cal-agenda', el).innerHTML = String(agenda());
      return;
    }
    const nav = e.target.closest('[data-cal]');
    if (nav) {
      if (nav.dataset.cal === 'today') { st.year = t.getFullYear(); st.month = t.getMonth(); st.selected = today; }
      else {
        const d = new Date(st.year, st.month + (nav.dataset.cal === 'next' ? 1 : -1), 1);
        st.year = d.getFullYear(); st.month = d.getMonth();
      }
      load();
      return;
    }
    const sc = e.target.closest('[data-scope]');
    if (sc && sc.dataset.scope !== st.scope) { st.scope = sc.dataset.scope; load(); }
  });

  return load();
}
