/**
 * Grid collection regression test — the "only 1 of 28 posts" bug.
 *
 * Instagram 2026 scrolls the feed inside <main> (hashed class names, nothing
 * selectable), while the document itself is often NOT scrollable, so a
 * collector that only does window.scrollBy() stops after the first row. This
 * serves two mock profile shells and checks collectPostLinks() pages all the
 * way through:
 *
 *   - main-scroll shell : document shorter than the viewport (the real bug)
 *   - window-scroll shell: classic document scrolling
 *   - static page       : stops early with a reason instead of hanging
 *
 * Offline: the page is served with page.setContent(), no network involved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectPostLinks, diagnoseGridPage } from '../src/extractors/dom.mjs';

const FAST = { delayMin: 20, delayMax: 40 };   // test-only: keep the pacing sane

const SHORTCODE = (i) => `SC${String(i).padStart(8, '0')}`;

function profileShell({ layout, total, perBatch }) {
  const scroller = layout === 'main' ? 'shell' : 'document.scrollingElement';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; font-family: sans-serif; }
    .cell { display: inline-block; width: 400px; height: 260px; margin: 5px;
            background: #ccd; text-decoration: none; color: #222; }
    ${layout === 'main' ? '#shell { height: 480px; overflow-y: auto; }' : '#shell { overflow: visible; }'}
  </style></head>
  <body>
    <nav style="position:fixed;top:0;left:0;right:0;height:44px;background:#333;color:#fff">nav</nav>
    <main id="shell">
      <header style="padding:56px 8px 8px"><h1>test.user</h1><p>${total} posts</p></header>
      <section><div id="grid"></div></section>
      <footer style="height:200px">footer</footer>
    </main>
    <script>
      const total = ${total}, perBatch = ${perBatch};
      const grid = document.getElementById('grid');
      let shown = 0;
      function add() {
        const n = Math.min(perBatch, total - shown);
        for (let i = 0; i < n; i++) {
          const idx = shown + i;
          const a = document.createElement('a');
          a.href = '/test.user/p/SC' + String(idx).padStart(8, '0') + '/';
          a.className = 'cell';
          a.textContent = 'post ' + idx;
          grid.appendChild(a);
        }
        shown += n;
      }
      add();                                  // Instagram renders the first batch
      const scroller = ${scroller};
      function maybeLoad() {
        if (shown >= total) return;
        if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 300) add();
      }
      ${layout === 'main'
        ? 'shell.addEventListener("scroll", maybeLoad);'
        : 'window.addEventListener("scroll", maybeLoad);'}
    </script>
  </body></html>`;
}

function staticShell() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main style="height:480px;overflow-y:auto"><header><h1>test.user</h1></header>
    <a href="/test.user/p/${SHORTCODE(0)}/">only post</a></main>
  </body></html>`;
}

async function withBrowser(fn) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    return { skip: String(e.message).split('\n')[0] };
  }
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

test('collectPostLinks pages a main-scrolling shell (hashed classes, dead window)', async (t) => {
  const skip = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setContent(profileShell({ layout: 'main', total: 24, perBatch: 6 }));

    const links = await collectPostLinks(page, 100, FAST);
    assert.equal(links.length, 24, `expected all 24 posts, got ${links.length}`);
    for (const href of links) {
      assert.match(href, /^\/test\.user\/p\/SC\d{8}\/$/, `unexpected link shape: ${href}`);
    }
    assert.equal(new Set(links).size, links.length, 'links must be unique');

    const diag = await diagnoseGridPage(page);
    assert.equal(diag.permalinks, 24);
    assert.equal(diag.isPrivateWall, false);
    await page.close();
  });
  if (skip) t.skip(skip);
});

test('collectPostLinks pages a window-scrolling shell', async (t) => {
  const skip = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setContent(profileShell({ layout: 'window', total: 18, perBatch: 6 }));

    const links = await collectPostLinks(page, 100, FAST);
    assert.equal(links.length, 18, `expected all 18 posts, got ${links.length}`);
    await page.close();
  });
  if (skip) t.skip(skip);
});

test('collectPostLinks honours the --posts cap', async (t) => {
  const skip = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setContent(profileShell({ layout: 'main', total: 40, perBatch: 6 }));

    const links = await collectPostLinks(page, 7, FAST);
    assert.equal(links.length, 7, `expected the cap (7), got ${links.length}`);
    await page.close();
  });
  if (skip) t.skip(skip);
});

test('collectPostLinks stops on a static page instead of hanging', async (t) => {
  const skip = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setContent(staticShell());

    const started = Date.now();
    const links = await collectPostLinks(page, 30, FAST);
    assert.equal(links.length, 1);
    assert.ok(Date.now() - started < 20000, 'must give up quickly on an unscrollable page');

    const diag = await diagnoseGridPage(page);
    assert.equal(diag.permalinks, 1);
    assert.equal(diag.isPrivateWall, false);
    await page.close();
  });
  if (skip) t.skip(skip);
});
