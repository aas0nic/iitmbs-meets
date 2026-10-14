// Minimal Chrome DevTools Protocol driver shared by tools/e2e.mjs and tools/shoot.mjs.
// No dependencies: needs Node 22+ (global WebSocket) and a local Chrome.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BASE = process.env.BASE_URL || 'http://localhost:5050';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9400 + Math.floor(Math.random() * 400) } = {}) {
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--hide-scrollbars',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'meetups-cdp-'))}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');

  const page = {
    errors,
    send,
    /** Evaluate an async function body in the page; returns its JSON-serialisable result. */
    async ev(body) {
      const r = await send('Runtime.evaluate', { expression: `(async()=>{${body}})()`, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(`page eval failed: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}\n  in: ${body.slice(0, 200)}`);
      return r.result?.result?.value;
    },
    async size(width, height = 900) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    },
    /** Sign in as a demo user with the given appearance prefs, landing on #route. */
    async login(userId, { route = '/home', prefs = { mode: 'light' } } = {}) {
      await send('Page.navigate', { url: `${BASE}/` });
      await sleep(700);
      await page.ev(`localStorage.setItem('prefs', ${JSON.stringify(JSON.stringify(prefs))});
        await fetch('/api/session', {method:'DELETE'});
        ${userId ? `await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'${userId}'})});` : ''}
        location.hash = '#${route}'; location.reload();`);
      await sleep(1600);
    },
    async go(route) { await page.ev(`location.hash = '#${route}'`); await sleep(1200); },
    async screenshot(path, { full = true, width } = {}) {
      const { writeFileSync } = await import('node:fs');
      let clip;
      if (full) {
        const [w, h] = await page.ev('return [innerWidth, document.documentElement.scrollHeight]');
        clip = { x: 0, y: 0, width: width || w, height: Math.min(h, 8000), scale: 1 };
      }
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
      writeFileSync(path, Buffer.from(shot.result.data, 'base64'));
    },
    close() { ws.close(); proc.kill(); },
  };
  return page;
}
