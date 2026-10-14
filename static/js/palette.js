// ⌘K command palette: jump to pages, run actions, find meetups.
import { api } from './api.js';
import { $, ACCENTS, fmtDate, html, icon, MODES, setPrefs, statusIcon, toast } from './ui.js';

let state;
let items = [];
let active = 0;
let searchSeq = 0;

export function initPalette(appState) {
  state = appState;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      if (!state.user) return;
      e.preventDefault();
      $('#palette').hidden ? openPalette() : closePalette();
    }
  });
}

function baseCommands() {
  const role = state.user.role;
  const go = (href) => () => { location.hash = href; };
  const cmds = [
    { group: 'Go to', label: 'Home', icon: 'home', run: go('#/home') },
    { group: 'Go to', label: 'Meetups', icon: 'calendar', run: go('#/meetups') },
  ];
  if (role === 'MANAGEMENT') cmds.push({ group: 'Go to', label: 'Proposals awaiting decision', icon: 'inbox', run: go('#/meetups?tab=pending') });
  if (role !== 'MANAGEMENT') cmds.push({ group: 'Go to', label: 'Co-host invites', icon: 'inbox', run: go('#/invites') });
  if (role === 'LHC') {
    cmds.push({ group: 'Go to', label: `Meetups in ${state.user.region_name}`, icon: 'pin', run: go('#/meetups?tab=region') });
  }
  cmds.push(
    { group: 'Go to', label: 'Reimbursements', icon: 'receipt', run: go('#/claims') },
    { group: 'Go to', label: 'Insights', icon: 'chart', run: go('#/insights') },
    { group: 'Go to', label: 'Appearance and settings', icon: 'settings', run: go('#/settings') },
  );
  if (role !== 'MANAGEMENT') cmds.unshift({ group: 'Actions', label: 'New proposal', icon: 'plus', hint: 'Propose a meetup', run: go('#/new') });
  MODES.forEach((m) => cmds.push({ group: 'Theme', label: `${m.label} theme`, icon: m.icon, run: () => { setPrefs({ mode: m.id }); toast(`${m.label} theme`); } }));
  ACCENTS.forEach((a) => cmds.push({ group: 'Theme', label: `Accent: ${a.label}`, icon: 'palette', keep: true, run: () => setPrefs({ accent: a.id }) }));
  return cmds;
}

export function openPalette() {
  const root = $('#palette');
  root.hidden = false;
  root.innerHTML = String(html`
    <div class="palette-box" role="dialog" aria-label="Command palette">
      <label class="palette-input">${icon('search')}<input placeholder="Search meetups, pages and actions…" autocomplete="off" spellcheck="false"></label>
      <div class="palette-list" role="listbox"></div>
      <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
    </div>`);
  const input = $('input', root);
  root.onclick = (e) => { if (e.target === root) closePalette(); };
  input.addEventListener('input', () => update(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(items[active]); }
    else if (e.key === 'Escape') closePalette();
  });
  $('.palette-list', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) runItem(items[Number(b.dataset.i)]);
  });
  $('.palette-list', root).addEventListener('mousemove', (e) => {
    const b = e.target.closest('[data-i]');
    if (b && Number(b.dataset.i) !== active) setActive(Number(b.dataset.i), false);
  });
  update('');
  input.focus();
}

export function closePalette() {
  const root = $('#palette');
  root.hidden = true;
  root.innerHTML = '';
}

function runItem(item) {
  if (!item) return;
  if (!item.keep) closePalette();
  item.run();
}

async function update(q) {
  const query = q.trim().toLowerCase();
  const cmds = baseCommands().filter((c) => !query || c.label.toLowerCase().includes(query) || c.group.toLowerCase().includes(query));
  items = query ? cmds : cmds.filter((c) => c.group !== 'Theme' || c.label.endsWith('theme'));
  draw();
  if (query.length < 2) return;
  const seq = ++searchSeq;
  try {
    const { meetups } = await api.get('/api/meetups', { q });
    if (seq !== searchSeq || $('#palette').hidden) return;
    const found = meetups.slice(0, 7).map((m) => ({
      group: 'Meetups', label: m.title, meetup: m, icon: 'calendar',
      run: () => { location.hash = `#/meetups/${m.id}`; },
    }));
    items = [...found, ...cmds];
    draw();
  } catch { /* keep commands */ }
}

function draw() {
  const list = $('#palette .palette-list');
  if (!list) return;
  active = Math.min(active, Math.max(items.length - 1, 0));
  if (!items.length) { list.innerHTML = '<div class="palette-empty">No matches</div>'; return; }
  let group = null;
  list.innerHTML = String(html`${items.map((it, i) => {
    const head = it.group !== group ? html`<div class="palette-group">${it.group}</div>` : '';
    group = it.group;
    const hint = it.meetup ? html`<small>${fmtDate(it.meetup.event_date)} · ${it.meetup.region_name}</small>` : it.hint ? html`<small>${it.hint}</small>` : '';
    return html`${head}<button type="button" class="palette-item ${i === active ? 'active' : ''}" data-i="${i}" role="option">
      ${it.meetup ? statusIcon(it.meetup.status) : icon(it.icon)}<span class="truncate">${it.label}</span>${hint}</button>`;
  })}`);
}

function setActive(i, scroll = true) {
  if (!items.length) return;
  active = (i + items.length) % items.length;
  document.querySelectorAll('#palette .palette-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === active));
  if (scroll) document.querySelector('#palette .palette-item.active')?.scrollIntoView({ block: 'nearest' });
}
