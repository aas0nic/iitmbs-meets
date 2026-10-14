// End-to-end regression in headless Chrome. Drives the real UI as each role.
//
//   python app.py            # server on :5050
//   node tools/e2e.mjs       # resets demo data first and again at the end
//
// Exits non-zero on the first failed check. Add a step here whenever a workflow changes.
import { launch, sleep } from './cdp.mjs';

const page = await launch();
const { ev } = page;
let step = 0;
const ok = (cond, label, detail = '') => {
  step++;
  if (!cond) throw new Error(`✗ ${step}. ${label} ${detail}`);
  console.log(`✓ ${step}. ${label}${detail ? ` — ${detail}` : ''}`);
};
const toasts = () => ev(`return [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | ')`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const resetData = async () => {
  await page.login('admin-1');
  await ev(`await fetch('/api/admin/reset', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({confirm:'RESET'})})`);
};
// Fill inputs and fire the events the app listens to.
const fill = (formSel, values) => ev(`const f = document.querySelector(${JSON.stringify(formSel)});
  for (const [k, v] of Object.entries(${JSON.stringify(values)})) { f[k].value = v; f[k].dispatchEvent(new Event('input', {bubbles: true})); f[k].dispatchEvent(new Event('change', {bubbles: true})); }`);
const attachFile = (sel, name, content, type) => ev(`const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], '${name}', {type: '${type}'}));
  const i = document.querySelector('${sel}'); i.files = dt.files; i.dispatchEvent(new Event('change', {bubbles: true}));`);

try {
  await page.size(1280, 900);
  await resetData();

  // ── Proposal (LHC) ──
  await page.login('lhc-11-5', { route: '/new' });
  await click('[data-save=submit]'); await sleep(400);
  const missing = await ev(`return document.querySelectorAll('#proposeForm .has-error').length`);
  ok(missing >= 7, 'empty proposal is blocked with inline errors', `${missing} fields`);
  await fill('#proposeForm', { title: 'E2E study jam', category: 'STUDY_JAM', description: 'A study jam created by the end-to-end test.',
    event_date: '2026-12-12', backup_date: '2026-12-19', start_time: '10:00', end_time: '13:00', venue: 'Test hall, Mumbai', expected_attendees: '20' });
  await click('[data-extra-toggle]');
  await fill('#proposeForm', { extra_budget: '3000', extra_budget_note: 'Hall booking for the day' });
  ok((await ev(`return document.querySelector('[data-total]').innerText`)).startsWith('₹7,000'), 'budget total = 20 × ₹200 + ₹3,000');
  await ev(`document.querySelector('#proposeForm input[value="lhc-2-5"]').click()`);
  await click('[data-save=submit]'); await sleep(1500);
  const mid = (await ev('return location.hash')).match(/meetups\/(\d+)/)?.[1];
  ok(mid, 'proposal submitted', `meetup ${mid}`);

  // ── Co-host accepts ──
  await page.login('lhc-2-5');
  await ev(`document.querySelector('[data-invite="${mid}"] [data-respond=ACCEPT]').click()`); await sleep(1200);
  ok((await toasts()).includes('co-host'), 'co-host accepts from Home');

  // ── Administration decision ──
  await page.login('admin-1', { route: `/meetups/${mid}` });
  await click('[data-decide=REJECT]'); await sleep(300);
  ok((await toasts()).includes('feedback'), 'reject without feedback is blocked');
  await ev(`document.querySelector('[name=date_choice][value=BACKUP]').click()`);
  await click('[data-decide=APPROVE]'); await sleep(1300);
  ok((await ev(`return document.querySelector('.detail-meta').innerText`)).includes('19 December'), 'approved on the backup date');
  await click('[data-act=complete]'); await sleep(1200);
  ok((await toasts()).includes('held'), 'marked as held');

  // ── Claim, pay to self (details saved to profile) ──
  await page.login('lhc-11-5', { route: `/meetups/${mid}/claim` });
  await attachFile('[data-import-input]', 'att.csv', 'Name,Email\nAsha Kumar,asha@example.com\nBad row,\nRavi P,ravi@example.com\n', 'text/csv'); await sleep(900);
  await ev(`document.querySelector('[data-att-name]').value = 'Meena S'; document.querySelector('[data-att-email]').value = 'meena@example.com'; document.querySelector('[data-att-add]').click();`);
  ok((await ev(`return document.querySelector('[name=amount_claimed]').value`)) === '600', 'amount suggested from attendance (3 × ₹200)');
  await fill('#claimForm', { amount_claimed: '650', expense_notes: 'Snacks and tea', post_link: 'https://www.instagram.com/p/e2e/' });
  await attachFile('[data-receipt-input]', 'bill.pdf', '%PDF-1.4', 'application/pdf');
  await ev(`document.querySelector('[name=payout_mode][value=SELF]').click()`); await sleep(100);
  await fill('#claimForm', { bank_name: 'Demo Bank', account_number: '123456789012', ifsc: 'DEMO0000001' });
  await ev(`document.querySelector('#claimForm [type=submit]').click()`); await sleep(1600);
  ok((await toasts()).includes('Claim submitted'), 'claim filed (pay to self)');
  ok(await ev(`return (await (await fetch('/api/me/payout')).json()).payout?.account_number === '123456789012'`), 'own bank details saved to profile');

  // ── Administration pays out ──
  await page.login('admin-1', { route: '/claims' });
  await ev(`[...document.querySelectorAll('[data-claim]')].find(r => r.innerText.includes('E2E study jam')).click()`); await sleep(900);
  ok((await ev(`return document.querySelector('#dialog').innerText`)).includes('3 students attended'), 'Administration sees attendee list');
  await click('#dialog [data-submit]'); await sleep(1300);
  ok((await toasts()).includes('approved for payout'), 'claim paid out');

  // ── Claim paid to a co-host (hidden details + confirmation) ──
  await page.login('lhc-11-5', { route: '/meetups/4/claim' });
  await ev(`document.querySelector('[data-att-name]').value = 'Kiran'; document.querySelector('[data-att-email]').value = 'kiran@example.com'; document.querySelector('[data-att-add]').click();`);
  await fill('#claimForm', { expense_notes: 'Snacks', post_link: 'https://www.instagram.com/p/e2e2/' });
  await attachFile('[data-receipt-input]', 'b.pdf', '%PDF-1.4', 'application/pdf');
  await ev(`document.querySelector('[name=payout_mode][value=COHOST]').click()`); await sleep(100);
  await ev(`document.querySelector('[name=payee_user_id]').click()`);
  await ev(`document.querySelector('#claimForm [type=submit]').click()`); await sleep(1600);
  ok((await ev(`return document.querySelector('.detail-side').innerText`)).includes('details hidden'), 'claimant cannot see co-host bank details');
  await page.login('lhc-2-5');
  await ev(`[...document.querySelectorAll('.task')].find(t => t.innerText.includes('Confirm your bank')).querySelector('a.btn').click()`); await sleep(1400);
  await click('[data-payee=CONFIRM]'); await sleep(1200);
  ok((await toasts()).includes('with Administration'), 'co-host confirms payout details');

  // ── UHC proposes in another region with an external collaboration ──
  await page.login('uhc-11-1', { route: '/new' });
  await fill('#proposeForm', { title: 'E2E inter-house meet', category: 'NETWORKING', description: 'Inter-house meet created by the end-to-end test.',
    event_date: '2026-12-05', backup_date: '2026-12-06', start_time: '17:00', end_time: '20:00', region_id: '3', venue: 'Hall, Bengaluru', expected_attendees: '40' });
  await ev(`document.querySelector('[name=collab_type][value=EXTERNAL]').click()`); await sleep(100);
  await fill('#proposeForm', { collab_name: 'Test Org', collab_about: 'A community that runs quizzes.', collab_agenda: 'They host the quiz round.', collab_contact: 'Arjun, organiser' });
  await ev(`document.querySelector('[name=collab_sponsored][value=no]').click()`);
  await ev(`document.querySelector('#proposeForm .peer input').click()`);
  await click('[data-save=submit]'); await sleep(1500);
  ok((await ev(`return document.body.innerText`)).includes('Test Org'), 'UHC proposal with external collaboration submitted');

  // ── Insights per role ──
  await page.go('/insights'); await sleep(500);
  ok((await ev(`return document.querySelector('.page-title').innerText`)).includes('Sundarbans insights'), 'UHC sees house insights');
  await page.login('lhc-11-5', { route: '/insights' });
  ok((await ev(`return document.querySelector('.page-title').innerText`)) === 'Your insights', 'LHC sees personal insights');
  await page.login('admin-1', { route: '/insights' });
  ok(await ev(`return !!document.querySelector('.heat')`), 'Administration sees house × region heatmap');

  // ── Shell ──
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', metaKey: true}))`); await sleep(200);
  ok(await ev(`return !document.querySelector('#palette').hidden`), '⌘K palette opens');
  // ── People & access (Administration) ──
  await page.go('/people'); await sleep(400);
  ok((await ev(`return document.querySelector('.page-title').innerText`)) === 'People & access', 'Administration opens People & access');
  await ev(`[...document.querySelectorAll('[data-tab]')].find(b => b.dataset.tab === 'UHC').click()`); await sleep(800);
  await ev(`document.querySelector('[data-edit="uhc-11-1"]').click()`); await sleep(300);
  await fill('#dialog form', { name: 'Neha Iyer', roll_number: '24f1009999' });
  await click('#dialog [data-submit]'); await sleep(1000);
  const seat = await ev(`return (await (await fetch('/api/admin/people?role=UHC&house_id=11')).json()).people.find(p => p.id === 'uhc-11-1')`);
  ok(seat.name === 'Neha Iyer' && seat.email === 'sundarbans.secretary@study.iitm.ac.in', 'UHC seat handed over, seat email kept');
  await click('[data-import]'); await sleep(300);
  await attachFile('[data-people-file]', 'people.csv',
    'Role,Name,Email,Roll number,House,Region,Position,Access\nLHC,E2E Student,24f3999001@ds.study.iitm.ac.in,24f3999001,Gir,Chennai,,On\nLHC,Bad Region,24f3999002@ds.study.iitm.ac.in,24f3999002,Gir,Pune,,On\n', 'text/csv');
  await sleep(900);
  ok((await ev(`return document.querySelector('.import-summary').innerText`)).includes('1 new'), 'import preview shows 1 new + 1 error');
  await click('#dialog [data-submit]'); await sleep(1000);
  ok((await toasts()).includes('1 added'), 'import applied');
  await ev(`await fetch('/api/admin/people/lhc-8-5', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({is_active: 0})})`);
  ok(await ev(`return (await fetch('/api/session', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({user_id:'lhc-8-5'})})).status === 403`), 'access off blocks sign-in');

  await page.size(390, 844); await page.login('admin-1');
  ok(await ev(`return getComputedStyle(document.querySelector('#sidebar')).display === 'none'`), 'phone has no sidebar');
  ok(await ev(`return document.querySelectorAll('.tabbar a').length === 5 && !document.querySelector('.tabbar [data-action=account]')`), 'phone tab bar: 5 pages, no profile');
  await click('.topbar [data-action=account]'); await sleep(300);
  ok(await ev(`return !document.querySelector('#popover').hidden`), 'profile menu opens from the top bar');
  ok(!(await ev('return document.documentElement.scrollWidth > innerWidth')), 'no horizontal overflow on phone');
  await page.size(1280, 900); await page.go('/home');
  ok(await ev(`return document.querySelectorAll('[data-action=account]').length === 1`), 'one profile entry point on desktop (top right)');

  ok(!page.errors.length, 'no JavaScript errors', page.errors.join('\n'));
  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error(`\n${e.message}`);
  if (page.errors.length) console.error('JS errors:\n' + page.errors.join('\n'));
  process.exitCode = 1;
} finally {
  await page.size(1280, 900);
  await resetData().catch(() => {});
  page.close();
}
