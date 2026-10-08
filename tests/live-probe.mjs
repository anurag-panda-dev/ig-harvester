/**
 * Live probe: verify walkCarousel clicks through a real Instagram carousel
 * (trusted clicks + button-anchored slide detection) and returns every
 * slide at full resolution.
 */
import { chromium } from 'playwright';
import { walkCarousel } from '../src/extractors/dom.mjs';

const POSTS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['/p/DYq2HIvGYak/', '/p/DZScF4UmVKw/'];

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

try {
  for (const href of POSTS) {
    console.log(`\n══ ${href}`);
    await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded' });
    await sleep(2200);   // exactly the tool's timing

    const t0 = Date.now();
    const slides = await walkCarousel(page);
    console.log(`  ${slides.length} slides in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    slides.forEach((s, i) => console.log(
      `  ${String(i + 1).padStart(2, '0')} ${s.kind} shot=${s.shot ? s.shot.length + 'B' : '-'} ${(s.src || '(no src)').slice(0, 96)}`
    ));
  }
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});   // CDP: disconnect only
}
