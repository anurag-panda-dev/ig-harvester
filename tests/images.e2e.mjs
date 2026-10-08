/**
 * Offline end-to-end check for the ig-images downloader.
 *
 * Touches nothing outside this machine: a local HTTP server serves fake
 * post pages and JPEG assets, and Playwright routes instagram.com to those
 * pages. Exercises the real code path end to end:
 *
 *   - single post via og:image
 *   - carousel via edge_sidecar_to_children (3 slides, middle one a video
 *     saved as its poster frame)
 *   - carousel via DOM walk (no sidecar JSON at all — mirrors live 2026
 *     Instagram: clicks Next, reads full-res slide imgs, screenshots a
 *     poster-less video slide)
 *   - timestamp-based naming + zero-padded slide index
 *   - same-second collision disambiguation (shortcode inserted)
 *   - real-PNG conversion
 *   - resume (second run downloads nothing)
 *   - --force (third run re-downloads everything)
 *
 * Not run by `npm test` (needs a browser launch):  node tests/images.e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Jimp } from 'jimp';
import { downloadPostImages } from '../src/scraper/images.mjs';

const TMP = path.join(os.tmpdir(), `ig-images-e2e-${process.pid}`);
const pad2 = (n) => String(n).padStart(2, '0');
const stemFor = (iso) => {
  const d = new Date(iso);
  return `test.user-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
         `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};

const T1 = '2026-10-08T14:30:22.000Z';
const T2 = '2026-10-09T10:00:00.000Z';
const T3 = '2026-10-10T08:15:00.000Z';

const jpeg = (color) => new Jimp({ width: 24, height: 24, color }).getBuffer('image/jpeg');

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${String(e.message).split('\n')[0]}`); }
};

async function main() {
  await fs.mkdir(TMP, { recursive: true });

  const pages = {};
  const assets = {
    '/a.jpg': await jpeg(0x3366ccff),
    '/b.jpg': await jpeg(0xcc6633ff),   // video poster frame
    '/c.jpg': await jpeg(0x33cc66ff),
    '/w1.jpg': await jpeg(0x118811ff),  // walk carousel slides
    '/w3.jpg': await jpeg(0x881111ff),
  };

  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (pages[u]) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(pages[u]);
    }
    if (assets[u]) {
      res.setHeader('content-type', 'image/jpeg');
      return res.end(assets[u]);
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  const abs = (p) => `http://127.0.0.1:${PORT}${p}`;

  const carouselBlob = JSON.stringify({
    data: { edge_sidecar_to_children: { edges: [
      { node: { __typename: 'GraphImage', display_url: abs('/a.jpg'), is_video: false } },
      { node: { __typename: 'GraphVideo', display_url: abs('/b.jpg'), is_video: true, video_url: abs('/v.mp4') } },
      { node: { __typename: 'GraphImage', display_url: abs('/c.jpg'), is_video: false } },
    ] } },
  });

  const postPage = (blob, ogImage, time) => `<!doctype html>
<html><head><meta property="og:image" content="${ogImage}"></head>
<body><article><h1>caption</h1><time datetime="${time}"></time></article>
<script type="application/json">${blob}</script></body></html>`;

  pages['/p/SINGLE12345/']  = postPage('{"taken_at":1791479422}', abs('/a.jpg'), T1);
  pages['/p/Carousel9999/'] = postPage(carouselBlob, abs('/a.jpg'), T2);
  pages['/p/SameStamp001/'] = postPage('{"taken_at":1791479422}', abs('/c.jpg'), T1);

  // Walk-based carousel: NO sidecar JSON, no <article> — exactly what live
  // 2026 Instagram serves. Slides are a translateX track with a Next button
  // that disappears on the last slide; slide 2 is a poster-less <video> so
  // the walker must screenshot it to keep its slot.
  pages['/p/WalkShow9999/'] = `<!doctype html>
<html><head><meta property="og:image" content="${abs('/a.jpg')}"></head>
<body style="margin:0">
<div id="clip" style="overflow:hidden;position:relative;width:600px;height:400px">
  <div id="track" style="display:flex;width:1800px;transition:transform .25s;will-change:transform">
    <img id="s1" src="${abs('/w1.jpg')}" style="flex:0 0 600px;width:600px;height:400px;display:block" alt="slide 1">
    <video id="s2" width="600" height="400" style="flex:0 0 600px;display:block" preload="none"><source src="${abs('/v.mp4')}" type="video/mp4"></video>
    <img id="s3" src="${abs('/w3.jpg')}" style="flex:0 0 600px;width:600px;height:400px;display:block" alt="slide 3">
  </div>
  <button aria-label="Next" id="next" style="position:absolute;right:8px;top:170px">&#8250;</button>
</div>
<time datetime="${T3}"></time>
<script>
  let i = 0;
  const track = document.getElementById('track');
  const next = document.getElementById('next');
  next.addEventListener('click', () => {
    if (i < 2) { i++; track.style.transform = 'translateX(' + (-i * 600) + 'px)'; }
    if (i === 2) next.style.display = 'none';   // live IG hides Next at the end
  });
</script>
</body></html>`;

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('https://www.instagram.com/**', (route) => {
      const p = new URL(route.request().url()).pathname;
      pages[p]
        ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: pages[p] })
        : route.fulfill({ status: 404, body: 'not found' });
    });

    const links = ['/p/SINGLE12345/', '/p/Carousel9999/', '/p/WalkShow9999/', '/p/SameStamp001/'];

    // ── run 1: downloads ─────────────────────────────────────────────
    const run1 = await downloadPostImages(ctx, page, links, {
      username: 'test.user', dir: TMP, minDelay: 1, maxDelay: 2,
    });

    console.log('\nrun 1 (fresh):');
    check('4 posts processed, none failed', () => {
      assert.equal(run1.posts, 4);
      assert.equal(run1.failed, 0);
      assert.equal(run1.missing, 0);
    });
    check('8 images saved (1 + 3 JSON slides + 3 walked + 1 collision)', () => {
      assert.equal(run1.saved, 8);
      assert.equal(run1.skipped, 0);
    });

    const expect = [
      `${stemFor(T1)}-01.png`,                             // single post
      `${stemFor(T2)}-01.png`,                             // carousel slide 1
      `${stemFor(T2)}-02.png`,                             // carousel slide 2 (video poster)
      `${stemFor(T2)}-03.png`,                             // carousel slide 3
      `${stemFor(T3)}-01.png`,                             // walked slide 1 (img)
      `${stemFor(T3)}-02.png`,                             // walked slide 2 (video screenshot)
      `${stemFor(T3)}-03.png`,                             // walked slide 3 (img)
      `${stemFor(T1)}-SameStamp001-01.png`,                // same second -> shortcode
    ];
    const written = (await fs.readdir(TMP)).sort();

    check('exactly the expected filenames exist', () => {
      assert.deepEqual(written, [...expect].sort());
    });

    try {
      for (const f of written) {
        const buf = await fs.readFile(path.join(TMP, f));
        assert.deepEqual([...buf.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${f} is not a PNG`);
      }
      console.log('  ok   every file is a real PNG (magic bytes)');
    } catch (e) {
      failures++;
      console.log(`  FAIL every file is a real PNG\n       ${String(e.message).split('\n')[0]}`);
    }

    // ── run 2: resume ────────────────────────────────────────────────
    const run2 = await downloadPostImages(ctx, page, links, {
      username: 'test.user', dir: TMP, minDelay: 1, maxDelay: 2,
    });

    console.log('\nrun 2 (resume):');
    check('nothing re-downloaded, everything skipped', () => {
      assert.equal(run2.saved, 0);
      assert.equal(run2.skipped, 8);
      assert.equal(run2.failed, 0);
    });

    // ── run 3: force ─────────────────────────────────────────────────
    const run3 = await downloadPostImages(ctx, page, links, {
      username: 'test.user', dir: TMP, minDelay: 1, maxDelay: 2, force: true,
    });

    console.log('\nrun 3 (--force):');
    check('force re-downloads every file', () => {
      assert.equal(run3.saved, 8);
      assert.equal(run3.skipped, 0);
      assert.equal(run3.failed, 0);
    });

    console.log(`\nfiles in ${TMP}:`);
    for (const f of written) console.log(`  ${f}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
    await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(e => {
  console.error('fatal', e);
  process.exit(1);
});
