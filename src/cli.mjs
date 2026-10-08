/**
 * Main CLI orchestration for ig-scrape.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig, validateConfig } from './config.mjs';
import { connectBrowser, ensureAuthenticated, safeGoto } from './browser.mjs';
import { scrapeProfile } from './scraper/profile.mjs';
import { detectProfileGate } from './extractors/dom.mjs';
import { getPostLinks, scrapePosts } from './scraper/posts.mjs';
import { explainShortGrid } from './scraper/grid-report.mjs';
import { scrapeUserList } from './scraper/users.mjs';
import { takeScreenshot } from './scraper/screenshot.mjs';
import { computeAnalytics } from './scraper/analytics.mjs';
import { Cache } from './storage/cache.mjs';
import { writeJson, writeCsv, writeSqlite, flatPost } from './storage/output.mjs';
import { logger } from './utils/logger.mjs';
import { ProgressBar } from './utils/progress.mjs';
import { humanDelay } from './utils/rate-limit.mjs';

export async function run() {
  const cfg = await resolveConfig(process.argv.slice(2));
  validateConfig(cfg);

  // Set log level from config
  process.env.LOG_LEVEL = cfg.logLevel;
  process.env.LOG_JSON = cfg.logJson ? '1' : '0';

  const USER = cfg.target || cfg.url.match(/instagram\.com\/([^/?#]+)/)?.[1] || 'target';
  const outDir = path.resolve(cfg.outDir);
  await fs.mkdir(outDir, { recursive: true });

  logger.info(`Instagram OSINT collector — target: ${USER}`);

  // Connect browser
  const { browser, isCDP } = await connectBrowser(cfg);
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();

  // Open cache
  let cache = null;
  if (cfg.resume) {
    cache = await new Cache(path.join(outDir, '.cache.db')).open();
    const runId = cache.startRun(USER);
    logger.info(`cache: ${path.join(outDir, '.cache.db')} (run ${runId})`);
  }

  try {
    // Authenticate
    logger.info('Checking session...');
    await safeGoto(page, `https://www.instagram.com/${USER}/`);
    await new Promise(r => setTimeout(r, 2500));

    const authed = await ensureAuthenticated(page);
    if (!authed) {
      logger.error('Cannot proceed without authentication.');
      process.exit(1);
    }

    // Screenshot-only mode
    if (cfg.shotOnly) {
      const f = await takeScreenshot(page, `${USER}-profile`, { fullPage: true, outDir: cfg.outDir });
      logger.info(`done -> ${f}`);
      return;
    }

    // Profile
    logger.info('Scraping profile...');
    const profile = await scrapeProfile(page, USER);
    if (cfg.shots) await takeScreenshot(page, `${USER}-profile`, { fullPage: true, outDir: cfg.outDir });

    // Private wall / follow state — say WHY the grid may be empty before scrolling.
    const gate = await detectProfileGate(page);
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

    // Posts
    logger.info(`Collecting post links (target: ${cfg.maxPosts === Infinity ? 'all' : cfg.maxPosts})...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await humanDelay();

    const links = await getPostLinks(page, cfg.maxPosts, {
      onProgress: (count, scroll) => {
        if (scroll % 5 === 0) logger.info(`grid: ${count} links (scroll ${scroll})`);
      },
    });
    logger.info(`found ${links.length} permalinks`);

    // Reconcile what the header promises with what the grid actually served.
    const expected = profile.posts ?? null;
    const cap = cfg.maxPosts === Infinity ? Infinity : cfg.maxPosts;
    const short = expected ? links.length < Math.min(expected, cap) : links.length === 0;

    if (short && expected) {
      logger.warn(
        `grid stopped early: ${links.length} of ${expected} posts found` +
        (links.length === 0
          ? ' - private wall / not following (see the warnings above)'
          : ' - slow grid, private wall or an Instagram pagination limit; re-run to resume (--posts all removes our own cap)')
      );
    } else if (!short && expected && cap !== Infinity && expected > cap) {
      logger.info(`${links.length} of ${expected} posts requested - raise --posts or pass --posts all for every post`);
    }
    if (short) {
      await explainShortGrid(page, USER, cfg);
    }

    const progress = new ProgressBar(links.length, 'posts');
    const posts = await scrapePosts(page, links, {
      wantComments: cfg.wantComments,
      cache,
      onProgress: (current, total, status) => {
        progress.update(current, status === 'cached' ? '(cached)' : '');
      },
    });
    progress.done();

    // Followers / following
    let followers = [], following = [];
    if (cfg.wantFollowers) {
      logger.info('Scraping followers...');
      followers = await scrapeUserList(page, USER, 'followers', { cache });
    }
    if (cfg.wantFollowing) {
      logger.info('Scraping following...');
      following = await scrapeUserList(page, USER, 'following', { cache });
    }

    // Compute analytics
    logger.info('Computing analytics...');
    const analytics = computeAnalytics({ profile, posts, followers, following });

    // Write output — all files inside a folder named after the username
    const userDir = path.join(outDir, USER);
    await fs.mkdir(userDir, { recursive: true });
    logger.info(`Writing output -> ${userDir}/`);

    const payload = { profile, posts, followers, following, analytics };
    const jsonPath = path.join(userDir, `${USER}.json`);
    await writeJson(jsonPath, payload);

    const files = [jsonPath];

    // CSV
    if (posts.length) {
      const csvPath = path.join(userDir, `${USER}-posts.csv`);
      await writeCsv(csvPath, posts.map(flatPost), Object.keys(flatPost(posts[0])));
      files.push(csvPath);
    }
    if (cfg.wantComments && posts.some(p => p.comments.length)) {
      const rows = posts.flatMap(p => p.comments.map(c => ({
        shortcode: p.shortcode, username: c.username, text: c.text, likes: c.likes,
      })));
      const csvPath = path.join(userDir, `${USER}-comments.csv`);
      await writeCsv(csvPath, rows, ['shortcode', 'username', 'text', 'likes']);
      files.push(csvPath);
    }
    if (followers.length) {
      const csvPath = path.join(userDir, `${USER}-followers.csv`);
      await writeCsv(csvPath, followers, ['username', 'name', 'verified']);
      files.push(csvPath);
    }
    if (following.length) {
      const csvPath = path.join(userDir, `${USER}-following.csv`);
      await writeCsv(csvPath, following, ['username', 'name', 'verified']);
      files.push(csvPath);
    }

    // SQLite
    if (cfg.sqlite) {
      const dbPath = path.join(userDir, `${USER}.db`);
      await writeSqlite(dbPath, { profile, posts, followers, following });
      files.push(dbPath);
    }

    // Finish cache run
    if (cache) cache.finishRun(null, 'done', posts.length);

    logger.info('done');
    for (const f of files) logger.info(`  ${path.relative(process.cwd(), f)}`);

    const totalComments = posts.reduce((n, p) => n + p.comments.length, 0);
    logger.info(`${posts.length} posts · ${totalComments} comments · ${followers.length} followers · ${following.length} following`);

    if (!cfg.wantComments) logger.info('(add --comments to harvest post comments)');
    if (!cfg.wantFollowers && !cfg.wantFollowing) logger.info('(add --followers --following for account lists)');
    if (!cfg.sqlite) logger.info('(add --sqlite for SQLite output)');

  } finally {
    await page.close().catch(() => {});
    if (cache) await cache.close();
    // CDP: never kill the user's browser, just disconnect
    if (isCDP) await browser.close().catch(() => {});
  }
}
