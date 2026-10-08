#!/usr/bin/env node
/**
 * scrape-ig.mjs — entry point
 * ---------------------------------------------------------------------------
 * Reads a rendered Instagram page and harvests public profile data.
 *
 * Extraction is TRIPLE-SOURCE with graceful fallback, because Instagram
 * obfuscates its class names roughly monthly:
 *
 *   1. Embedded Relay JSON  <script type="application/json">  -> most stable
 *   2. Semantic DOM          aria-labels, <li>, <time datetime> -> solid
 *   3. Screenshots                      --shots flag        -> for a vision LLM
 *
 * It attaches to YOUR OWN browser over CDP (see dependencies/launch-chrome-debug.ps1) so it
 * reuses the session you already authenticated. It never types your password.
 *
 * Collects : profile stats, bio, recent posts (caption/likes/comments/time/
 *            location), post comments, follower list, following list.
 * Emits    : <out>/<user>.json and <out>/<user>-posts.csv
 *            <out>/<user>-followers.csv, <user>-following.csv
 *            <out>/screenshots/*.png   (with --shots)
 *            <out>/<user>.db          (with --sqlite)
 *            <out>/.cache.db          (resume cache, with --resume)
 *
 * Usage
 *   node dependencies/scrape-ig.mjs --profile someuser
 *   node dependencies/scrape-ig.mjs --profile someuser --posts 50 --comments --followers --following
 *   node dependencies/scrape-ig.mjs --profile someuser --shots-only
 *   node dependencies/scrape-ig.mjs --shot-only --url https://instagram.com/someuser
 *   node dependencies/scrape-ig.mjs --profile someuser --proxy http://127.0.0.1:8080
 *   node dependencies/scrape-ig.mjs --config config.json
 *
 * Honesty note: like *counts* are reliable. The list of users who liked a post
 * is no longer served to web clients at all - only the bundled Instagram app
 * (via a rooted phone / Frida, see README) still exposes it.
 */

import { run } from '../src/cli.mjs';

run().catch(e => {
  console.error('\x1b[31mfatal\x1b[0m', e.message || e);
  process.exit(1);
});
