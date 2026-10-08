/**
 * CLI orchestration for ig-images — the standalone post-image downloader.
 * Shares config, browser attach, auth, and grid collection with scrape-ig.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig, validateConfig } from './config.mjs';
import { connectBrowser, ensureAuthenticated, safeGoto } from './browser.mjs';
import { getPostLinks } from './scraper/posts.mjs';
import { explainShortGrid } from './scraper/grid-report.mjs';
import { detectProfileGate, scrapeHeader } from './extractors/dom.mjs';
import { parseCount } from './extractors/parser.mjs';
import { downloadPostImages } from './scraper/images.mjs';
import { logger } from './utils/logger.mjs';
import { ProgressBar } from './utils/progress.mjs';

export async function runImages() {
  const cfg = await resolveConfig(process.argv.slice(2));
  validateConfig(cfg);

  process.env.LOG_LEVEL = cfg.logLevel;
  process.env.LOG_JSON = cfg.logJson ? '1' : '0';

  const USER = cfg.target || cfg.url.match(/instagram\.com\/([^/?#]+)/)?.[1] || 'target';
  const imgDir = path.resolve(cfg.outDir, USER, 'images');
  await fs.mkdir(imgDir, { recursive: true });

  logger.info(`ig-images — collecting post images for @${USER}`);
  logger.info(`output: ${path.relative(process.cwd(), imgDir) || imgDir}`);

  const { browser, isCDP } = await connectBrowser(cfg);
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();

  try {
    logger.info('Checking session...');
    await safeGoto(page, `https://www.instagram.com/${USER}/`);
    await new Promise(r => setTimeout(r, 2500));

    const authed = await ensureAuthenticated(page);
    if (!authed) {
      logger.error('Cannot proceed without authentication.');
      process.exit(1);
    }

    // Private wall / follow state — say WHY the grid may be empty before scrolling.
    const gate = await detectProfileGate(page);
    const expected = parseCount((await scrapeHeader(page)).postsRaw) ?? null;
    if (gate.isPrivateWall) {
      if (gate.followState === 'following') {
        logger.warn('private profile: this session follows it but Instagram still shows the wall - reload the page or re-login and retry');
      } else if (gate.followState === 'requested') {
        logger.error('private profile: the follow request is still PENDING ("Requested") - Instagram serves no posts until it is accepted');
      } else {
        logger.error('private profile: this session does NOT follow the account - log in as the burner account that follows it');
      }
    } else if (gate.followState === 'requested') {
      logger.warn('follow request pending ("Requested")');
    }

    logger.info(`Collecting post links (target: ${cfg.maxPosts === Infinity ? 'all' : cfg.maxPosts})...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    const links = await getPostLinks(page, cfg.maxPosts, {
      onProgress: (count, scroll) => {
        if (scroll % 5 === 0) logger.info(`grid: ${count} links (scroll ${scroll})`);
      },
    });
    logger.info(`found ${links.length} permalinks`);
    const cap = cfg.maxPosts === Infinity ? Infinity : cfg.maxPosts;
    const short = expected ? links.length < Math.min(expected, cap) : links.length === 0;
    if (short && expected) {
      logger.warn(
        `grid stopped early: ${links.length} of ${expected} posts found` +
        (links.length === 0
          ? ' - private wall / not following (see the warnings above)'
          : ' - slow grid, private wall or an Instagram pagination limit; re-run (--posts all removes our own cap)')
      );
    } else if (!short && expected && cap !== Infinity && expected > cap) {
      logger.info(`${links.length} of ${expected} posts requested - raise --posts or pass --posts all`);
    }
    if (short) {
      await explainShortGrid(page, USER, cfg);
    }
    if (!links.length) {
      logger.error('No post links found — private wall / not following, or the profile does not exist (see the warnings above).');
      return;
    }

    const userAgent = await page.evaluate(() => navigator.userAgent);

    const progress = new ProgressBar(links.length, 'images');
    const result = await downloadPostImages(ctx, page, links, {
      username: USER,
      dir: imgDir,
      userAgent,
      minDelay: cfg.minDelay,
      maxDelay: cfg.maxDelay,
      force: cfg.force,
      onProgress: (current, total, status) => progress.update(current, status || ''),
    });
    progress.done();

    logger.info('done');
    logger.info(`  ${path.relative(process.cwd(), imgDir) || imgDir}`);
    logger.info(
      `${result.posts} posts · ${result.saved} saved · ${result.skipped} already present` +
      `${result.missing ? ` · ${result.missing} missing` : ''}${result.failed ? ` · ${result.failed} failed` : ''}`
    );
    if (result.saved) logger.info('files are real PNGs named <username>-<date>-<time>-<NN>.png');
  } finally {
    await page.close().catch(() => {});
    // CDP: never kill the user's browser, just disconnect
    if (isCDP) await browser.close().catch(() => {});
  }
}
