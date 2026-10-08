/**
 * Image downloading — visits each post permalink, pulls every slide
 * (carousels included), converts it to real PNG, and writes it as
 *
 *   <username>-<date>-<time>-<NN>.png
 *
 * e.g. `some.user-2026-10-08-143022-01.png`, `-02`, `-03` for carousel
 * slides. Date/time is the post timestamp rendered in the *local*
 * timezone (what you see on the post itself). `<NN>` is the slide
 * position, so a video slide keeps its slot via its poster frame.
 *
 * Media sources, most reliable first:
 *   1. edge_sidecar_to_children  — ordered and complete, when the blob ships it
 *   2. carousel walk             — clicks the post's Next button and reads
 *                                  each slide's full-res <img> (live Instagram
 *                                  no longer embeds sidecar JSON; og:image is
 *                                  a cropped 640px preview)
 *   3. og:image / og:video meta  — single photo or reel poster frame
 *   4. <article> DOM             — whatever fbcdn media is rendered
 *
 * Downloads go through the browser context's request API first (reuses
 * the session cookies), then plain fetch as a fallback.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { harvestJson, extractSidecarChildren, mine } from '../extractors/json-miner.mjs';
import { scrapePostDom, scrapeCarouselDom, scrapeOgMedia, walkCarousel } from '../extractors/dom.mjs';
import { parseTimestamp, extractShortcode } from '../extractors/parser.mjs';
import { logger } from '../utils/logger.mjs';
import { humanDelay } from '../utils/rate-limit.mjs';

const pad2 = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const firstLine = (e) => String(e?.message || e).split('\n')[0];

/**
 * Build the canonical filename for one slide.
 *
 * @param {string} username        target handle (sanitized)
 * @param {Date|number|string} ts  post timestamp (ISO, unix seconds/ms)
 * @param {number} index           1-based carousel position
 * @param {object} [opts]
 * @param {string} [opts.shortcode]  post shortcode
 * @param {boolean} [opts.withShortcode] insert shortcode before index —
 *                  used to disambiguate two posts sharing a timestamp
 * @returns {string} e.g. "some.user-2026-10-08-143022-01.png"
 */
export function buildImageName(username, ts, index, { shortcode = null, withShortcode = false } = {}) {
  const user = String(username || 'unknown').replace(/[^\w.-]/g, '_');
  // Unix seconds arrive as numeric strings too; normalize before parsing
  const raw = typeof ts === 'string' && /^\d+$/.test(ts) ? Number(ts) : ts;
  const d = parseTimestamp(raw);
  const ok = d instanceof Date && !isNaN(d);

  const date = ok ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : 'unknown-date';
  const time = ok ? `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}` : '000000';

  const parts = [user, date, time];
  if (withShortcode && shortcode) parts.push(String(shortcode).replace(/[^\w-]/g, '_'));
  parts.push(pad2(index));
  return `${parts.join('-')}.png`;
}

/** Guess the true extension from image magic bytes (URL as last resort). */
export function extFromBuffer(buf, url = '') {
  if (buf && buf.length >= 12) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
    if (buf.toString('ascii', 0, 4) === 'GIF8') return '.gif';
    if (buf[0] === 0x42 && buf[1] === 0x4d) return '.bmp';
    if (buf.toString('ascii', 0, 2) === 'II' || buf.toString('ascii', 0, 2) === 'MM') return '.tiff';
  }
  const m = String(url).match(/\.(jpe?g|png|webp|gif|bmp|tiff?)(?:\?|$)/i);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

/** Decode any image and re-encode as real PNG. Falls back to the original bytes. */
export async function toPng(buffer, url = '') {
  try {
    const { Jimp } = await import('jimp'); // lazy: keeps startup light, tests skip it
    const img = await Jimp.read(buffer);
    return { buffer: await img.getBuffer('image/png'), ext: '.png', converted: true };
  } catch (e) {
    const ext = extFromBuffer(buffer, url);
    logger.warn(`PNG conversion failed (${firstLine(e)}) — saving original bytes as ${ext}`);
    return { buffer, ext, converted: false };
  }
}

/**
 * Resolve the ordered list of still frames for a post page.
 * Returns [{ kind, src, shot }] — `shot` is an already-decoded PNG buffer
 * (used for video slides that render without a poster attribute).
 */
async function collectPostMedia(page, blob, shortcode = null) {
  // 1. Carousel children JSON — ordered and complete when the blob ships it
  const sidecar = extractSidecarChildren(blob, { shortcode });
  if (sidecar.length > 1) {
    // For video nodes displayUrl is the poster frame — exactly what we want
    return sidecar.map(c => ({ kind: c.isVideo ? 'video' : 'image', src: c.displayUrl }));
  }

  // 2. Click through the carousel's Next button. This is the reliable path on
  //    live Instagram: no sidecar JSON in the blob, and og:image is a cropped
  //    640px preview. Also handles single posts (no Next button → 1 slide).
  let walked = [];
  try {
    walked = await walkCarousel(page);
  } catch (e) {
    logger.warn(`carousel walk failed: ${String(e?.message || e).split('\n')[0]}`);
  }
  if (walked.some(w => w.src || w.shot)) return walked;

  // 3. Single-node JSON (old payloads) — full-res, better than the og crop
  if (sidecar.length === 1) {
    const c = sidecar[0];
    return [{ kind: c.isVideo ? 'video' : 'image', src: c.displayUrl }];
  }

  // 4. og:image — the photo, or the reel's poster frame (cropped, last resort)
  const og = await scrapeOgMedia(page);
  if (og.image) return [{ kind: og.video ? 'video' : 'image', src: og.image }];

  // 5. Poster-less videos: keep the numbered slots, the loop warns per slide
  if (walked.length) return walked;

  // 6. Last resort: whatever media the page currently renders
  const dom = await scrapeCarouselDom(page);
  return dom.mediaItems.map(m => ({
    kind: m.type === 'video' ? 'video' : 'image',
    src: m.poster || m.url || null, // video without poster: no still to save
  }));
}

/** Download raw bytes: context request (session cookies) first, fetch second. */
async function fetchMedia(ctx, url, { referer, userAgent } = {}) {
  const headers = { Referer: referer || 'https://www.instagram.com/' };
  if (userAgent) headers['User-Agent'] = userAgent;

  try {
    const res = await ctx.request.get(url, { timeout: 30000, headers });
    if (res.ok()) return await res.body();
    logger.warn(`CDN returned HTTP ${res.status()} — retrying via fetch`);
  } catch (e) {
    logger.debug(`context request failed: ${firstLine(e)}`);
  }

  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} downloading media`);
  return Buffer.from(await r.arrayBuffer());
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Walk every permalink and save its images into `dir`.
 * Already-present files are skipped, so an interrupted run resumes
 * simply by re-running the same command. Pass `force` to re-download
 * files that are already on disk (e.g. to replace an old bad run).
 */
export async function downloadPostImages(ctx, page, links, {
  username, dir, userAgent, minDelay, maxDelay, onProgress, force = false,
} = {}) {
  if (!username || !dir) throw new Error('downloadPostImages requires username and dir');

  const seen = new Map();   // filename -> shortcode (same-second collisions)
  const result = { posts: 0, saved: 0, skipped: 0, missing: 0, failed: 0 };

  for (const [i, href] of links.entries()) {
    const shortcode = extractShortcode(href) || `post${i + 1}`;

    try {
      await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded' });
      await sleep(2200);

      const blob = await harvestJson(page);
      const dom = await scrapePostDom(page);
      const timestamp = parseTimestamp(dom.time) ?? parseTimestamp(mine(blob).takenAt);
      if (!timestamp) logger.debug(`${shortcode}: no timestamp — using unknown-date`);

      const media = await collectPostMedia(page, blob, shortcode);
      if (!media.length) {
        logger.warn(`[${i + 1}/${links.length}] ${shortcode}: no media found`);
        result.missing++;
      }

      let savedThisPost = 0;
      for (const [mi, item] of media.entries()) {
        const index = mi + 1;
        let name = buildImageName(username, timestamp, index);
        if (seen.has(name)) {
          name = buildImageName(username, timestamp, index, { shortcode, withShortcode: true });
        }
        seen.set(name, shortcode);

        const target = path.join(dir, name);
        if (!force && await fileExists(target)) {   // resume: already downloaded
          result.skipped++;
          continue;
        }
        if (!item.shot && !item.src) {
          logger.warn(`${shortcode}: slide ${pad2(index)} (${item.kind}) has no still frame — skipped`);
          result.missing++;
          continue;
        }

        let conv;
        if (item.shot) {
          conv = { buffer: item.shot, ext: '.png' };   // screenshot: already PNG
        } else {
          const bytes = await fetchMedia(ctx, item.src, {
            referer: `https://www.instagram.com${href}`,
            userAgent,
          });
          conv = await toPng(bytes, item.src);
        }
        const finalPath = conv.ext === '.png' ? target : target.replace(/\.png$/, conv.ext);
        await fs.writeFile(finalPath, conv.buffer);

        result.saved++;
        savedThisPost++;
        logger.info(`[${i + 1}/${links.length}] ${path.basename(finalPath)}`);
        await sleep(350 + Math.random() * 650);   // pace the CDN too
      }

      result.posts++;
      onProgress?.(i + 1, links.length, savedThisPost ? `+${savedThisPost}` : '(cached)');
    } catch (e) {
      logger.warn(`failed on ${href}: ${firstLine(e)}`);
      result.failed++;
      onProgress?.(i + 1, links.length, 'error');
    }

    await humanDelay(minDelay, maxDelay);
  }

  return result;
}
