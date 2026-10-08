/**
 * Semantic-DOM scraping — survives class-hash churn because it uses
 * aria-labels, tag structure, and innerText rather than CSS classes.
 */
import { logger } from '../utils/logger.mjs';

/** Read the profile header (name, bio, stats) from semantic DOM. */
export async function scrapeHeader(page) {
  return page.evaluate(() => {
    const txt = (document.querySelector('main') || document.body).innerText;
    const num = (label) => {
      const m = txt.match(new RegExp(`([\\d][\\d.,]*\\s?[KMB]?)\\s*${label}\\b`, 'i'));
      return m ? m[1] : undefined;
    };

    // Bio: find a div/span that contains the username but NOT the stats keywords
    const bioEl = [...document.querySelectorAll('div,span')]
      .filter(e => {
        if (!e.className || typeof e.className !== 'string' || e.className.length < 40) return false;
        const t = e.innerText || '';
        if (t.split('\n').length > 8) return false;
        // Must contain the username but NOT be the stats block
        if (/\b(posts|followers|following)\b/i.test(t)) return false;
        // Must have some meaningful text (not just a name)
        return t.length > 10;
      })
      .sort((a, b) => b.innerText.length - a.innerText.length)[0];

    return {
      name      : document.querySelector('h1')?.innerText?.trim() || undefined,
      bio       : bioEl?.innerText?.trim() || undefined,
      postsRaw  : num('posts'),
      follRaw   : num('followers'),
      followRaw : num('following'),
    };
  });
}

/** Read a post page's DOM-level data (caption, time, likes, type). */
export async function scrapePostDom(page) {
  return page.evaluate(() => ({
    caption: document.querySelector('h1')?.innerText || undefined,
    time   : document.querySelector('time[datetime]')?.getAttribute('datetime') || undefined,
    likesUi: (() => {
      const svg = document.querySelector('svg[aria-label*="ike"]');
      const t = svg?.parentElement?.textContent?.match(/[\d.,]+[KMB]?/)?.[0];
      return t || undefined;
    })(),
    type   : 'photo',
  }));
}

/** Detect if a post is a carousel and extract media info from DOM. */
export async function scrapeCarouselDom(page) {
  return page.evaluate(() => {
    // Scope to the post article so page chrome (avatar, suggested posts,
    // ads) is never counted as post media.
    const container = document.querySelector('article') || document.body;
    const mediaItems = [];

    // Look for post images inside the article
    const images = container.querySelectorAll('img[srcset], img[src]');
    images.forEach(img => {
      const src = img.src || img.getAttribute('srcset')?.split(' ')[0];
      if (src && src.includes('fbcdn.net')) {
        mediaItems.push({ type: 'image', url: src });
      }
    });

    // Look for video elements (poster = still frame used as the thumbnail)
    const videos = container.querySelectorAll('video');
    videos.forEach(vid => {
      const src = vid.src || vid.querySelector('source')?.src;
      if (src) mediaItems.push({ type: 'video', url: src, poster: vid.getAttribute('poster') || null });
    });

    // Check for carousel indicator (e.g., "1/5", dots, or aria-label)
    const carouselIndicator =
      document.querySelector('[aria-label*="Carousel"]') ||
      document.querySelector('[aria-label*="carousel"]') ||
      container.querySelector('div[role="tablist"]');
    const isCarousel = !!carouselIndicator || mediaItems.length > 1;

    return { isCarousel, mediaCount: mediaItems.length, mediaItems };
  });
}

/** Read og:image / og:video meta tags — semantic, survives class churn.
 *  For a single photo og:image is the photo; for a reel it is the poster frame. */
export async function scrapeOgMedia(page) {
  return page.evaluate(() => ({
    image: document.querySelector('meta[property="og:image"]')?.content || null,
    video: document.querySelector('meta[property="og:video"]')?.content || null,
  }));
}

/**
 * Page-side state reader for the current post media — serialized into the
 * browser by walkCarousel(), so it must stay fully self-contained.
 *
 * Returns { src, key, kind, hasNext, clicked }. Live 2026 Instagram ships no
 * <article> and no sidecar JSON, so this reads the slide <img> elements
 * directly: they carry the full-resolution, uncropped CDN URL.
 * Pass doClick=true to also press the carousel's Next button.
 * Exported for live probes/diagnostics; walkCarousel is the real caller.
 */
export function slideStatePage(doClick) {
  const visible = (el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0;
  };

  // Post media only: grid/suggested thumbs live inside a[role="link"], and the
  // post's own media sits at the very top of the page.
  const cands = [...document.querySelectorAll('img, video')].filter((el) => {
    if (el.closest('a[role="link"]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 150 || r.top > 700) return false;
    if (el.tagName === 'IMG' && !(el.currentSrc || el.src)) return false;
    return true;
  });
  if (!cands.length) {
    return { src: null, key: null, kind: null, hasNext: false, rect: null, clicked: !!doClick };
  }

  // "Next" — it lives in the FIXED media frame (never translates), which
  // makes it the perfect anchor for "which slide is current".
  const btn = [...document.querySelectorAll('button[aria-label="Next"]')].find(b => !b.disabled && visible(b)) || null;

  // Current slide:
  //   1. the candidate whose box CONTAINS the Next button's centre — the
  //      per-slide wrappers translate with their slide, so any overflow
  //      ancestor we climb to moves too (the old logic saw slide 1 forever);
  //   2. no button (single post / last slide): largest visible area in the
  //      window — ties keep the earlier DOM node, and slides sit in DOM
  //      order, so the current slide always beats its peeking neighbour.
  let best = null;
  let bestScore = -1;
  const win = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight };

  if (btn) {
    const br = btn.getBoundingClientRect();
    const cx = br.left + br.width / 2;
    const cy = br.top + br.height / 2;
    cands.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      if (r.left <= cx && r.right >= cx && r.top <= cy && r.bottom >= cy && bestScore < 1) {
        bestScore = 1;
        best = { el, idx };
      }
    });
  }
  if (!best) {
    cands.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, win.right) - Math.max(r.left, win.left));
      const h = Math.max(0, Math.min(r.bottom, win.bottom) - Math.max(r.top, win.top));
      const area = w * h;
      if (area > bestScore) {
        bestScore = area;
        best = { el, idx };
      }
    });
  }

  const el = best.el;
  const kind = el.tagName === 'VIDEO' ? 'video' : 'image';
  let src = null;
  if (kind === 'image') {
    const pool = (el.getAttribute('srcset') || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .map((t) => {
        const parts = t.split(/\s+/);
        return { url: parts[0], n: parseFloat(parts[1]) || 0, w: /w$/.test(parts[1] || '') };
      })
      .filter(e => e.url);
    const wPool = pool.filter(e => e.w);
    const use = (wPool.length ? wPool : pool)
      .slice()
      .sort((a, b) => b.n - a.n)[0];
    src = (use && use.url) || el.currentSrc || el.src || null;
  } else {
    src = el.poster || el.getAttribute('poster') || null; // video still = poster frame
  }

  // Page-space box of the current slide — walkCarousel screenshots it when a
  // video slide has no poster attribute, so the slot still gets a still.
  const er = el.getBoundingClientRect();
  const rect = {
    x: er.left + window.scrollX,
    y: er.top + window.scrollY,
    width: er.width,
    height: er.height,
  };

  let key;
  if (src) {
    try { key = 'u:' + new URL(src, location.href).pathname; } catch { key = 'u:' + src; }
  } else {
    key = 'i:' + best.idx; // poster-less video: identity = its slot
  }

  if (doClick && btn) btn.click();
  return { src, key, kind, hasNext: !!btn, rect, clicked: !!doClick };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Walk a post's media, clicking the carousel's Next button so every slide
 * loads, and collect each slide's full-resolution still in slide order.
 *
 * Works on single posts too (no Next button → one item). When a slide is a
 * video without a poster attribute it still occupies its slot with src:null,
 * so numbering downstream never shifts.
 */
export async function walkCarousel(page, {
  maxSlides = 40, pollMs = 250, polls = 14, settleMs = 550,
} = {}) {
  const read = () => page.evaluate(slideStatePage, false);
  const slides = [];
  const seen = new Set();

  for (let step = 0; step < maxSlides; step++) {
    let st = await read();
    if (!st.kind) {           // media not mounted yet — one retry
      await sleep(650);
      st = await read();
    }
    if (!st.kind && !st.hasNext) break;

    if ((st.src || st.kind === 'video') && !seen.has(st.key)) {
      seen.add(st.key);
      let shot = null;
      // Video slide with no poster: screenshot the rendered slide so the
      // slot still gets a PNG (and numbering never shifts).
      if (st.kind === 'video' && !st.src && st.rect && st.rect.width >= 40 && st.rect.height >= 40) {
        try {
          shot = await page.screenshot({
            type: 'png',
            clip: { x: Math.max(0, st.rect.x), y: Math.max(0, st.rect.y),
                    width: st.rect.width, height: st.rect.height },
          });
        } catch (e) {
          logger.debug(`video slide screenshot failed: ${String(e?.message || e).split('\n')[0]}`);
        }
      }
      slides.push({ kind: st.kind, src: st.src, shot });
    }
    if (!st.hasNext) break;

    const before = st.key;
    // Press Next with a TRUSTED Playwright click — Instagram ignores
    // synthetic HTMLElement.click() (no pointer events), so page-side
    // btn.click() silently does nothing.
    const nextBtn = page.locator('button[aria-label="Next"]:visible').first();
    if (!(await nextBtn.count())) break;
    try {
      await nextBtn.click({ timeout: 2500 });
    } catch (e) {
      logger.debug(`Next click failed: ${String(e?.message || e).split('\n')[0]}`);
      break;
    }

    let moved = false;
    for (let t = 0; t < polls && !moved; t++) {
      await sleep(pollMs);
      const now = await read();
      if (now.key !== before && now.kind) { moved = true; break; }
      if (!now.hasNext && now.key === before) break;  // click did nothing — end reached
    }
    if (!moved) break;
    await sleep(settleMs);                        // let the slide transition finish
  }

  return slides;
}

/**
 * What the profile page says about the private wall and the follow state.
 *   isPrivateWall : Instagram is rendering the "This account is private" shell
 *   followState   : 'following' | 'requested' | 'follow' | 'unknown'
 * A private profile you follow renders a normal grid; a wall with 'follow' or
 * 'requested' means THIS session will never be shown the posts (the request is
 * pending, or it simply isn't the burner account that follows).
 */
export async function detectProfileGate(page) {
  return page.evaluate(() => {
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
    const isPrivateWall =
      /\bthis account is private\b/i.test(txt) || /\baccount is private\b/i.test(txt);
    let followState = 'unknown';
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const t = (b.innerText || '').trim().replace(/\s+/g, ' ');
      if (!t) continue;
      if (/^following$/i.test(t)) { followState = 'following'; break; }
      if (/^requested$/i.test(t)) { followState = 'requested'; continue; }
      if (/^follow$/i.test(t) && followState === 'unknown') followState = 'follow';
    }
    return { isPrivateWall, followState };
  });
}

/**
 * One grid scroll step, plus the metrics that say whether it did anything.
 * Instagram's shell scrolls <main> (its class names are hashed, so there is
 * nothing reliable to select by name), the document may or may not scroll,
 * and the lazy loader wants real input events — so try all three.
 * Returns what moved and whether we are already at the bottom.
 */
async function scrollGrid(page) {
  // Real wheel input first: it targets the cursor, so put the cursor over the
  // content (0,0 is the fixed nav, where a wheel event does nothing).
  try {
    await page.mouse.move(600, 450);
    await page.mouse.wheel(0, 1200);
  } catch (e) {
    logger.debug(`grid wheel failed: ${String(e?.message || e).split('\n')[0]}`);
  }

  return page.evaluate(() => {
    const isScrollable = (el) => {
      const s = getComputedStyle(el);
      return /auto|scroll|overlay/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 60;
    };

    // The biggest scrolling box inside <main> = the app shell / feed.
    let best = null, bestOver = 0;
    const main = document.querySelector('main');
    const pool = main ? [main, ...main.querySelectorAll('div,ul,section')] : [];
    for (const el of pool.slice(0, 800)) {
      if (!isScrollable(el)) continue;
      const over = el.scrollHeight - el.clientHeight;
      if (over > bestOver) { best = el; bestOver = over; }
    }
    if (!best) {
      const grid = document.querySelector('[role="list"]') ||
                   document.querySelector('div[class*="grid"]') ||
                   document.querySelector('div[class*="Grid"]');
      if (grid && isScrollable(grid)) best = grid;
    }

    const winBefore = window.scrollY;
    const boxBefore = best ? best.scrollTop : 0;
    if (best) {
      best.scrollTop = Math.min(boxBefore + Math.max(400, best.clientHeight * 0.9), best.scrollHeight);
    }
    window.scrollBy(0, Math.max(600, window.innerHeight * 0.9));

    const winAfter = window.scrollY;
    const boxAfter = best ? best.scrollTop : 0;
    return {
      winY: Math.round(winAfter),
      winMoved: winAfter > winBefore + 4,
      boxMoved: boxAfter > boxBefore + 4,
      boxName: best ? best.tagName.toLowerCase() : (main ? 'main(static)' : 'document'),
      boxTop: Math.round(boxAfter),
      boxH: best ? best.scrollHeight : document.documentElement.scrollHeight,
      atBottom:
        (winAfter + window.innerHeight >= document.documentElement.scrollHeight - 8) &&
        (!best || boxAfter + best.clientHeight >= best.scrollHeight - 8),
    };
  });
}

/**
 * Everything worth knowing when the grid came back short: what the page is,
 * what it says, how far it scrolled, and whether the posts are already in the
 * embedded page JSON (shortcodes) even though no thumbnail rendered.
 */
export async function diagnoseGridPage(page) {
  return page.evaluate(() => {
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
    const hrefs = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    const permalink = (h) => /^\/[\w.-]+\/(p|reel|tv)\/[A-Za-z0-9_-]{8,30}\/?$/.test(h);
    const html = document.documentElement.innerHTML || '';
    const main = document.querySelector('main');
    return {
      url: location.href,
      title: document.title,
      isPrivateWall: /\bthis account is private\b/i.test(txt),
      snippet: txt.slice(0, 300),
      anchors: hrefs.length,
      permalinks: hrefs.filter(permalink).length,
      imgs: main ? main.querySelectorAll('img').length : 0,
      jsonShortcodes: (html.match(/"shortcode":"[A-Za-z0-9_-]{5,40}"/g) || []).length,
      winY: Math.round(window.scrollY),
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      mainH: main ? main.scrollHeight : 0,
      mainClientH: main ? main.clientHeight : 0,
    };
  });
}

/** Scroll the profile grid until it stops yielding new permalinks. */
export async function collectPostLinks(page, max, { onProgress, delayMin = 1200, delayMax = 3000 } = {}) {
  const seen = new Set();
  let idle = 0;
  let stuck = 0;
  const idleLimit = 8;                              // private grids page in 12-post steps and load slowly
  const budget = Number.isFinite(max) ? 80 : 400;   // --posts all -> keep scrolling
  let reason = 'unknown';
  let i = 0;
  const pace = () => new Promise(r => setTimeout(r, delayMin + Math.random() * Math.max(0, delayMax - delayMin)));

  // Scroll to top first to ensure consistent starting point
  await page.evaluate(() => window.scrollTo(0, 0));
  await pace();

  for (; i < budget && seen.size < max && idle < idleLimit; i++) {
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href'))
        .filter(h => /^\/[\w.-]+\/(p|reel|tv)\/[A-Za-z0-9_-]{8,30}\/?$/.test(h))
    );
    const before = seen.size;
    hrefs.forEach(h => seen.add(h.split('?')[0]));
    idle = seen.size === before ? idle + 1 : 0;

    if (onProgress) onProgress(seen.size, i);

    if (seen.size >= max) { reason = `--posts limit (${max}) reached`; break; }
    if (idle >= idleLimit) { reason = `no new thumbnails after ${idleLimit} scrolls`; break; }

    let m = null;
    try {
      m = await scrollGrid(page);
    } catch (e) {
      logger.debug(`grid scroll failed: ${String(e?.message || e).split('\n')[0]}`);
    }
    if (m) {
      logger.debug(`grid scroll: y=${m.winY} ${m.boxName}=${m.boxTop}/${m.boxH} bottom=${m.atBottom}`);
      const moved = m.winMoved || m.boxMoved;
      if (!moved && !m.atBottom) {
        stuck += 1;
        if (stuck >= 2) { reason = 'the page would not scroll (no scrollable grid container found)'; break; }
      } else {
        stuck = 0;
      }
      // At the bottom and nothing new appearing: that IS the end of the grid.
      if (m.atBottom && idle >= 2) { reason = `bottom of the grid reached with ${seen.size} link(s)`; break; }
    }

    await pace();
  }
  if (reason === 'unknown') reason = `scroll budget exhausted after ${i} scrolls`;

  logger.info(`grid: ${seen.size} permalink(s) - ${reason}`);
  return [...seen].slice(0, max);
}

/** Comment rows: <li> with a profile link + free text. Works inline and in dialogs. */
export async function scrapeComments(page) {
  return page.evaluate(() => {
    const out = [], seen = new Set();
    const SKIP = new Set(['p','reel','tv','explore','accounts','direct','stories',
                          'about','developer','legal','challenge','emojiflags',
                          'directory','welcome','web','business','settings','pods']);

    for (const li of document.querySelectorAll('li')) {
      if (li.querySelector('img[alt*="Photo by"], img[alt*="Image by"]')) continue;
      const a = li.querySelector('a[href^="/"]');
      if (!a) continue;
      const username = a.getAttribute('href').slice(1).split(/[/?#]/)[0];
      if (!username || SKIP.has(username)) continue;

      const spans = [...li.querySelectorAll('span, a')]
        .map(s => s.textContent.trim()).filter(Boolean);
      if (!spans.length) continue;

      const text = spans
        .filter(s => s !== username && s !== username.toLowerCase() &&
                     !/^[•·]?$/.test(s) && !/^\d+[hdmwy]?(\s?ago)?$/i.test(s) &&
                     !/^\d+[.,]?\d*[KMB]?$/.test(s) &&
                     !/^(like|reply|view|more|translate|show more)$/i.test(s))
        .join(' ').trim();
      if (!text) continue;

      const key = username + ' ' + text;
      if (seen.has(key)) continue;
      seen.add(key);

      const likeSvg = li.querySelector('svg[aria-label*="ike"]');
      const likeTxt = likeSvg?.parentElement?.textContent?.match(/[\d.,]+[KMB]?/)?.[0];
      out.push({ username, text, likes: likeTxt ? (parseFloat(likeTxt) || 0) : 0 });
    }
    return out;
  });
}

/** Scroll the comment rail so lazy-loaded ones materialise. */
export async function loadAllComments(page, maxRounds = 6) {
  for (let i = 0; i < maxRounds; i++) {
    const moved = await page.evaluate(() => {
      const rails = [...document.querySelectorAll('div,ul')].filter(e => {
        const s = getComputedStyle(e);
        return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 40;
      });
      if (!rails.length) return false;
      rails.forEach(r => { r.scrollTop = r.scrollHeight; });
      return true;
    });
    await new Promise(r => setTimeout(r, 900 + Math.random() * 1700));
    if (!moved) break;
  }
}

/** Click all "View more replies" buttons to expand comment threads. */
export async function expandCommentThreads(page) {
  for (let i = 0; i < 5; i++) {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, span, a')].filter(el => {
        const t = el.textContent?.trim().toLowerCase();
        return t && (t.includes('view more replies') || t.includes('more replies') || t.includes('view replies'));
      });
      if (!btns.length) return false;
      btns.forEach(b => b.click());
      return true;
    });
    if (!clicked) break;
    await new Promise(r => setTimeout(r, 1500));
  }
}
