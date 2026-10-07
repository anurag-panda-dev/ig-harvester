/**
 * Browser management — CDP attach or fresh launch, with proxy support.
 */
import { chromium } from 'playwright';
import { logger } from './utils/logger.mjs';
import { retry, isRetryable } from './utils/retry.mjs';

/**
 * Connect to a running Chrome via CDP, or fall back to launching
 * a fresh bundled Chromium.
 */
export async function connectBrowser(cfg) {
  let browser;

  // Try CDP first
  try {
    browser = await chromium.connectOverCDP(cfg.cdp);
    logger.info(`attached over CDP -> ${cfg.cdp}`);
    return { browser, isCDP: true };
  } catch {
    logger.warn(`No CDP endpoint at ${cfg.cdp}`);
    logger.info('Falling back to bundled Chromium (you must log in there).');
  }

  // Fallback: launch fresh
  const launchOpts = {
    headless: !cfg.headful,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  if (cfg.proxy) {
    launchOpts.proxy = {
      server: cfg.proxy,
      bypass: cfg.proxyBypass || undefined,
    };
    logger.info(`using proxy: ${cfg.proxy}`);
  }

  browser = await chromium.launch(launchOpts);
  return { browser, isCDP: false };
}

/**
 * Check if the current page is blocked (login wall, challenge, etc).
 */
export async function isBlocked(page) {
  return page.evaluate(() =>
    /accounts\/login|challenge|checkpoint|\/consent\//.test(location.pathname + location.href) ||
    !!document.querySelector('#loginForm')
  );
}

/**
 * Wait for authentication if blocked. Returns true if authenticated.
 */
export async function ensureAuthenticated(page, { timeoutMs = 300000 } = {}) {
  if (!(await isBlocked(page))) {
    logger.info('already authenticated');
    return true;
  }

  logger.warn('Not logged in — log in manually in the browser window.');
  logger.info(`Waiting up to ${Math.round(timeoutMs / 1000)}s...`);

  try {
    await page.waitForFunction(
      () => !/accounts\/login|challenge|checkpoint/.test(location.pathname),
      { timeout: timeoutMs }
    );
    await new Promise(r => setTimeout(r, 3000));
    logger.info('session established');
    return true;
  } catch {
    logger.error('Authentication timeout — still not logged in.');
    return false;
  }
}

/**
 * Navigate with retry on transient failures.
 */
export async function safeGoto(page, url, opts = {}) {
  return retry(
    () => page.goto(url, { waitUntil: 'domcontentloaded', ...opts }),
    { shouldRetry: isRetryable, baseDelay: 2000, attempts: 3 }
  );
}
