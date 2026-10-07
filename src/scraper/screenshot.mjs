/**
 * Screenshot capture for vision model analysis.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger.mjs';

export async function takeScreenshot(page, name, { fullPage = false, outDir = 'out' } = {}) {
  const dir = path.resolve(outDir, 'screenshots');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^\w.-]/g, '_')}.png`);
  await page.screenshot({ path: file, fullPage });
  logger.info(`screenshot: ${file}`);
  return file;
}
