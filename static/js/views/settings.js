// Appearance (theme, accent, typeface), account, and (Management only) demo data reset.
import { api } from '../api.js';
import { ACCENTS, avatar, FONTS, getPrefs, html, icon, loadFont, MODES, openDialog, ROLE, setPrefs, toast, userLine } from '../ui.js';

const PREVIEW = {
  light: html`<div class="mode-prev pv-light"><div class="pv-side"><i></i><i></i><i></i></div><div class="pv-main"><b></b><span></span></div></div>`,
  dark: html`<div class="mode-prev pv-dark"><div class="pv-side"><i></i><i></i><i></i></div><div class="pv-main"><b></b><span></span></div></div>`,
  black: html`<div class="mode-prev pv-black"><div class="pv-side"><i></i><i></i><i></i></div><div class="pv-main"><b></b><span></span></div></div>`,
  system: html`<div class="mode-prev pv-auto"><div><i></i><i></i><i></i></div><div><i></i><i></i><i></i></div></div>`,
};
const MODE_NOTE = { light: 'Warm paper', dark: 'Soft graphite', black: 'True black, for OLED', system: 'Follows your device' };

export async function render(el, ctx) {
  const u = ctx.user;
  ctx.setTitle('Settings');
  FONTS.forEach((f) => loadFont(f.id)); // previews render in each typeface

  const draw = () => {
    const p = getPrefs();
    const dark = document.documentElement.dataset.theme !== 'light';
    el.innerHTML = String(html`
      <div class="page-head"><div class="page-head-text"><h1 class="page-title">Settings</h1>
        <p class="page-sub">Appearance is saved on this device.</p></div></div>
      <div class="stack" style="max-width:820px">
        <section class="card">
          <header class="card-head"><h2 class="card-title">Theme</h2></header>
          <div class="card-pad"><div class="modes">${MODES.map((m) => html`
            <button type="button" class="mode-card ${p.mode === m.id ? 'active' : ''}" data-pick-mode="${m.id}">
              ${PREVIEW[m.id]}<span>${m.label} <span class="faint" style="font-weight:400">· ${MODE_NOTE[m.id]}</span></span>
            </button>`)}</div></div>
        </section>

        <section class="card">
          <header class="card-head"><h2 class="card-title">Accent colour</h2><span class="count hide-mobile">Buttons, highlights and today's date</span></header>
          <div class="card-pad"><div class="swatches">${ACCENTS.map((a) => html`
            <button type="button" class="swatch ${p.accent === a.id ? 'active' : ''}" data-pick-accent="${a.id}" style="--sw:${dark ? a.dark : a.light}">
              <i></i>${a.label}${p.accent === a.id ? icon('check', 'i-sm') : ''}</button>`)}</div></div>
        </section>

        <section class="card">
          <header class="card-head"><h2 class="card-title">Typeface</h2></header>
          <div class="card-pad"><div class="fonts">${FONTS.map((f) => html`
            <button type="button" class="font-card ${p.font === f.id ? 'active' : ''}" data-pick-font="${f.id}" style="font-family:'${f.label}', system-ui">
              <b>Aa 12</b><span>${f.label}<br>${f.note}</span></button>`)}</div></div>
        </section>

        <section class="card">
          <header class="card-head"><h2 class="card-title">Account</h2></header>
          <div class="person" style="padding:18px 20px">${avatar(u, 'avatar-lg')}
            <div class="person-body"><div class="person-name" style="font-size:15px">${u.name}</div>
              <div class="person-sub">${ROLE[u.role]}<span class="sep">${userLine(u)}</span></div>
              <div class="person-sub">${u.email}</div></div>
          </div>
        </section>

        ${u.role === 'MANAGEMENT' ? html`<section class="card">
          <header class="card-head"><h2 class="card-title">Demo data</h2></header>
          <div class="setting">
            <div class="setting-body"><strong>Reset to sample data</strong>
              <p>Rebuilds the database with the 156-member roster and sample meetups. Everything created since is erased, including uploaded receipts.</p></div>
            <button class="btn btn-danger" data-reset>${icon('rotate', 'i-sm')} Reset database</button>
          </div>
        </section>` : ''}
      </div>`);
  };
  draw();

  el.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick-mode], [data-pick-accent], [data-pick-font]');
    if (pick) {
      const { pickMode: mode, pickAccent: accent, pickFont: font } = pick.dataset;
      setPrefs(mode ? { mode } : accent ? { accent } : { font });
      const y = scrollY;
      draw();
      scrollTo(0, y);
      return;
    }
    if (e.target.closest('[data-reset]')) {
      const ok = await openDialog({
        title: 'Reset all data?',
        subtitle: 'This permanently replaces every meetup, claim and notification with the sample set.',
        body: html`<label class="field"><span class="field-label">Type RESET to confirm</span><input class="input" name="confirm" autocomplete="off"></label>`,
        submitLabel: 'Reset database', submitClass: 'btn-danger',
        onSubmit: async (form) => {
          if (form.confirm.value !== 'RESET') throw new Error('Type RESET in capitals to confirm.');
          await api.post('/api/admin/reset', { confirm: 'RESET' });
          return true;
        },
      });
      if (ok) { toast('Database reset.'); ctx.refreshBadges(); location.hash = '#/home'; }
    }
  });
}
