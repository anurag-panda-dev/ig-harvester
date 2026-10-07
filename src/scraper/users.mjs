/**
 * Follower/following list scraping via the modal dialog.
 * Scrolls until ALL users are loaded — no count limit.
 */
import { logger } from '../utils/logger.mjs';
import { humanDelay } from '../utils/rate-limit.mjs';

const SKIP = new Set(['p','reel','tv','explore','accounts','direct','stories','about',
  'developer','legal','challenge','directory','welcome','web','business','settings',
  'pods','saved','search','notifications','share','threads','hashtag',
  'reels','popular','shop','guides','watch','discover']);

export async function scrapeUserList(page, username, kind, { cache } = {}) {
  // Check cache first
  if (cache) {
    const cached = cache.getUserList(username, kind);
    if (cached.length) {
      logger.info(`cache: ${cached.length} ${kind}`);
      return cached;
    }
  }

  // Navigate to profile and click the followers/following button to open the modal
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));

  // Click the followers/following button — use multiple selector strategies
  let clicked = false;
  const selectors = [
    `a[href*="/${kind}/"]`,
    `a[href="/${username}/${kind}/"]`,
    `span:has-text("${kind}")`,
    `div[role="button"]:has-text("${kind}")`,
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      await btn.click({ timeout: 5000 });
      logger.info(`clicked ${kind} button via ${sel}`);
      clicked = true;
      break;
    } catch { /* try next selector */ }
  }

  if (!clicked) {
    logger.warn(`could not click ${kind} button with any selector`);
  }

  // Wait for the dialog to actually appear
  try {
    await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });
    logger.info('dialog opened');
    await new Promise(r => setTimeout(r, 2000));
  } catch {
    logger.warn('dialog did not appear — reading whole page (may include nav links)');
  }

  const seen = new Map();
  let idle = 0;
  let totalScrolls = 0;

  // Click "See all followers" / "See more" / "View all" button if it appears
  try {
    const seeMoreSelectors = [
      'a:has-text("See all followers")',
      'a:has-text("See all following")',
      'button:has-text("See all followers")',
      'button:has-text("See all following")',
      'button:has-text("See more")',
      'button:has-text("View all")',
      'button:has-text("Show more")',
      'div[role="button"]:has-text("See all followers")',
      'div[role="button"]:has-text("See all following")',
      'div[role="button"]:has-text("See more")',
      'div[role="button"]:has-text("View all")',
      'span:has-text("See all followers")',
      'span:has-text("See all following")',
      'span:has-text("See more")',
      'span:has-text("View all")',
    ];
    for (const sel of seeMoreSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click({ timeout: 5000 });
        logger.info(`clicked "${sel}" button`);
        await new Promise(r => setTimeout(r, 2000));
        break;
      }
    }
  } catch { /* no see-more button */ }

  // Scroll until no new users for 8 consecutive rounds (increased from 5)
  for (let i = 0; i < 500; i++) {
    const batch = await page.evaluate((skip) => {
      const dlg = document.querySelector('div[role="dialog"]') || document;
      const out = [];
      for (const a of dlg.querySelectorAll('a[href^="/"]')) {
        const u = a.getAttribute('href').slice(1).split(/[/?#]/)[0];
        if (!u || skip.includes(u) || u.length < 2) continue;
        const row = a.closest('div[role="listitem"]') || a.parentElement?.parentElement;
        const full = row?.innerText?.split('\n')?.map(s => s.trim()).filter(Boolean) || [];
        const name = full.find(s =>
          s !== u &&
          s.toLowerCase() !== u.toLowerCase() &&
          s !== 'Verified' &&
          s.length > 1 &&
          !/^[•·]?$/.test(s) &&
          !/^\d+$/.test(s)
        ) || '';
        out.push({
          username: u,
          name,
          verified : /verified/i.test(row?.innerText || '') || !!row?.querySelector('svg[aria-label*="Verified"]'),
        });
      }
      return out;
    }, [...SKIP]);

    const before = seen.size;
    batch.forEach(b => { if (!seen.has(b.username)) seen.set(b.username, b); });
    idle = seen.size === before ? idle + 1 : 0;

    // Progress log every 20 rounds
    if (i % 20 === 0) {
      logger.info(`${kind}: ${seen.size} accounts (scroll ${i})`);
    }

    // Break if no new users for 8 consecutive rounds
    if (idle >= 8 && i > 10) {
      logger.info(`${kind}: no new users for 8 rounds — done`);
      break;
    }

    // Scroll inside the dialog — try multiple strategies
    await page.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"]');
      if (!dlg) return;

      // Strategy 1: find scrollable div inside dialog
      const scrollables = [...dlg.querySelectorAll('div')].filter(d => {
        const s = getComputedStyle(d);
        return /auto|scroll/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 40;
      });
      if (scrollables.length) {
        scrollables.forEach(d => { d.scrollTop = d.scrollHeight; });
        return;
      }

      // Strategy 2: find scrollable div anywhere on page
      const allScrollables = [...document.querySelectorAll('div')].filter(d => {
        const s = getComputedStyle(d);
        return /auto|scroll/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 100;
      });
      if (allScrollables.length) {
        allScrollables.forEach(d => { d.scrollTop = d.scrollHeight; });
        return;
      }

      // Strategy 3: scroll the dialog itself
      dlg.scrollTop = dlg.scrollHeight;
    });

    // Also try keyboard scroll as fallback
    if (i % 3 === 0) {
      await page.keyboard.press('End');
    }

    totalScrolls = i;
    await humanDelay(1200, 2800);
  }

  const users = [...seen.values()];
  logger.info(`${kind}: ${users.length} accounts (after ${totalScrolls + 1} scrolls)`);

  if (cache) cache.saveUserList(username, kind, users);
  return users;
}
