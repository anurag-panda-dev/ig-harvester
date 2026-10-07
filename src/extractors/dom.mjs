/**
 * Semantic-DOM scraping — survives class-hash churn because it uses
 * aria-labels, tag structure, and innerText rather than CSS classes.
 */

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
    // Carousel posts have a specific structure with multiple images/videos
    const carouselContainer = document.querySelector('[role="button"][tabindex="0"]');
    const mediaItems = [];

    // Look for all images in the post
    const images = document.querySelectorAll('img[srcset], img[src]');
    images.forEach(img => {
      const src = img.src || img.getAttribute('srcset')?.split(' ')[0];
      if (src && src.includes('fbcdn.net')) {
        mediaItems.push({ type: 'image', url: src });
      }
    });

    // Look for video elements
    const videos = document.querySelectorAll('video');
    videos.forEach(vid => {
      const src = vid.src || vid.querySelector('source')?.src;
      if (src) mediaItems.push({ type: 'video', url: src });
    });

    // Check for carousel indicator (e.g., "1/5" or dots)
    const carouselIndicator = document.querySelector('[aria-label*="Carousel"]');
    const isCarousel = !!carouselIndicator || mediaItems.length > 1;

    return { isCarousel, mediaCount: mediaItems.length, mediaItems };
  });
}

/** Scroll the profile grid until it stops yielding new permalinks. */
export async function collectPostLinks(page, max, { onProgress } = {}) {
  const seen = new Set();
  let idle = 0;

  // Scroll to top first to ensure consistent starting point
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 1000));

  for (let i = 0; i < 80 && seen.size < max && idle < 5; i++) {
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href'))
        .filter(h => /^\/[\w.-]+\/(p|reel|tv)\/[A-Za-z0-9_-]{8,30}\/?$/.test(h))
    );
    const before = seen.size;
    hrefs.forEach(h => seen.add(h.split('?')[0]));
    idle = seen.size === before ? idle + 1 : 0;

    if (onProgress) onProgress(seen.size, i);
    if (i % 5 === 0) onProgress?.(seen.size, i, true);

    // Scroll the grid container — try multiple strategies
    await page.evaluate(() => {
      // Strategy 1: find the scrollable grid container
      const grid = document.querySelector('[role="list"]') ||
                   document.querySelector('div[class*="grid"]') ||
                   document.querySelector('div[class*="Grid"]');
      if (grid) {
        const s = getComputedStyle(grid);
        if (/auto|scroll/.test(s.overflowY)) {
          grid.scrollTop = grid.scrollHeight;
          return;
        }
      }

      // Strategy 2: find any scrollable div in main content
      const main = document.querySelector('main') || document.body;
      const scrollables = [...main.querySelectorAll('div')].filter(d => {
        const s = getComputedStyle(d);
        return /auto|scroll/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 100;
      });
      if (scrollables.length) {
        scrollables.forEach(d => { d.scrollTop = d.scrollHeight; });
        return;
      }

      // Strategy 3: scroll window
      window.scrollBy(0, window.innerHeight * 0.7);
    });

    await new Promise(r => setTimeout(r, 1200 + Math.random() * 1800));
  }
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
