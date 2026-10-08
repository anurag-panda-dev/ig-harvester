#!/usr/bin/env node
/**
 * ig-images.mjs — entry point
 * ---------------------------------------------------------------------------
 * Standalone tool: downloads every post image of a profile and saves it as
 *   <username>-<date>-<time>-<NN>.png
 * where <NN> is the carousel slide index (01, 02, 03 ...). Video slides are
 * saved as their poster frame so the numbering never shifts. Files are real
 * PNGs (converted with jimp); if a source format cannot be decoded the
 * original bytes are kept under their true extension instead.
 *
 * Like scrape-ig.mjs it attaches to YOUR OWN browser over CDP
 * (see dependencies/launch-chrome-debug.ps1) and reuses the session you already
 * authenticated. It never touches credentials, and it does nothing except
 * save images — no JSON/CSV, no comments, no follower lists.
 *
 * Emits : <out>/<user>/images/<user>-<YYYY-MM-DD>-<HHMMSS>-<NN>.png
 *         (timestamp is the post time in your local timezone; files already
 *          on disk are skipped, so re-running resumes where it stopped)
 *
 * Usage
 *   node dependencies/ig-images.mjs --profile someuser
 *   node dependencies/ig-images.mjs --profile someuser --posts 50
 *   node dependencies/ig-images.mjs --profile someuser --out artifacts   # -> artifacts/someuser/images/
 *   node dependencies/ig-images.mjs --config config.json --posts 100
 */
import { runImages } from '../src/images-cli.mjs';

runImages().catch(e => {
  console.error('\x1b[31mfatal\x1b[0m', e.message || e);
  process.exit(1);
});
