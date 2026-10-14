// Screenshot any screen as any demo user, at any width and theme.
//
//   node tools/shoot.mjs <outdir> "user|route|width|name[|mode[|accent]]" ...
//
//   node tools/shoot.mjs .shots "mgmt-1|/home|1440|mgmt-home" "lhc-11-5|/new|390|propose-phone|dark"
//   user "none" = signed out (sign-in screen). Prints OVERFLOW if the page scrolls sideways.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const [outdir = '.shots', ...jobs] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const page = await launch();
try {
  for (const job of jobs) {
    const [user, route, width, name, mode = 'light', accent = 'terracotta'] = job.split('|');
    await page.size(Number(width), 900);
    await page.login(user === 'none' ? null : user, { route, prefs: { mode, accent } });
    const overflow = await page.ev('return document.documentElement.scrollWidth > innerWidth');
    await page.screenshot(join(outdir, `${name}.png`));
    console.log(`${name}.png${overflow ? '  OVERFLOW' : ''}`);
  }
  if (page.errors.length) console.log('JS errors:\n' + [...new Set(page.errors)].join('\n'));
} finally {
  page.close();
}
