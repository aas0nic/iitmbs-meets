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
  const canClaim = u.role !== 'MANAGEMENT';
  let payout = canClaim ? (await api.get('/api/me/payout')).payout : null;
  if (!ctx.isCurrent()) return;

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

        ${canClaim ? html`<section class="card" id="payout">
          <header class="card-head"><h2 class="card-title">Payout details</h2>
            <span class="count hide-mobile">${payout ? `Saved · used to fill your reimbursement claims` : 'Used to fill your reimbursement claims'}</span></header>
          <form class="card-pad payout-form" data-payout novalidate>
            <div class="form-error" data-payout-error hidden></div>
            <div class="field-row">
              <label class="field"><span class="field-label">Account holder name</span><input class="input" name="account_holder" autocomplete="name" value="${payout?.account_holder || u.name}"></label>
              <label class="field"><span class="field-label">Bank name</span><input class="input" name="bank_name" value="${payout?.bank_name || ''}" placeholder="e.g. State Bank of India"></label>
            </div>
            <div class="field-row">
              <label class="field"><span class="field-label">Account number</span><input class="input" name="account_number" inputmode="numeric" autocomplete="off" value="${payout?.account_number || ''}" placeholder="9 to 18 digits"></label>
              <label class="field"><span class="field-label">IFSC</span><input class="input" name="ifsc" autocomplete="off" value="${payout?.ifsc || ''}" placeholder="e.g. SBIN0001234" style="text-transform:uppercase"></label>
            </div>
            <label class="field"><span class="field-label">UPI ID <span class="opt">optional</span></span><input class="input" name="upi_id" autocomplete="off" value="${payout?.upi_id || ''}" placeholder="name@bank"></label>
            <div class="payout-actions">
              <span class="field-hint">Only you and Management (when paying a claim) see these.</span>
              ${payout ? html`<button type="button" class="btn btn-ghost btn-sm" data-payout-clear>Remove</button>` : ''}
              <button type="submit" class="btn btn-primary btn-sm">${payout ? 'Update details' : 'Save details'}</button>
            </div>
          </form>
        </section>` : ''}

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

  el.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-payout]')) return;
    e.preventDefault();
    const form = e.target;
    const err = form.querySelector('[data-payout-error]');
    err.hidden = true;
    const btn = form.querySelector('[type=submit]');
    btn.classList.add('is-loading');
    try {
      ({ payout } = await api.put('/api/me/payout', Object.fromEntries(new FormData(form))));
      toast('Payout details saved. They will fill in automatically on your next claim.');
      draw();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { btn.classList.remove('is-loading'); }
  });

  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-payout-clear]')) {
      await api.del('/api/me/payout');
      payout = null;
      toast('Saved payout details removed.');
      draw();
      return;
    }
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
