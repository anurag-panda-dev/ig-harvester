/**
 * Config layering (defaults < config file < CLI) and --posts parsing.
 * --posts all / 0 / any must mean "no cap", because the grid collector
 * otherwise stops at the default 30.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, parseMaxPosts, resolveConfig, validateConfig } from '../src/config.mjs';

async function writeConfig(obj) {
  const p = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'igcfg-')), 'config.json');
  await fs.writeFile(p, JSON.stringify(obj), 'utf8');
  return p;
}

test('parseMaxPosts: numbers stay numbers, all/0 mean unlimited', () => {
  assert.equal(parseMaxPosts('50'), 50);
  assert.equal(parseMaxPosts(' 12 '), 12);
  assert.equal(parseMaxPosts('all'), Infinity);
  assert.equal(parseMaxPosts('ALL'), Infinity);
  assert.equal(parseMaxPosts('unlimited'), Infinity);
  assert.equal(parseMaxPosts('0'), Infinity);
  assert.ok(Number.isNaN(parseMaxPosts('abc')));
});

test('parseArgs records which keys were actually given', () => {
  const cfg = parseArgs(['--profile', 'u', '--posts', 'all']);
  assert.equal(cfg.__given.has('target'), true);
  assert.equal(cfg.__given.has('maxPosts'), true);
  assert.equal(cfg.__given.has('outDir'), false);
  assert.equal(cfg.maxPosts, Infinity);
  assert.equal(cfg.outDir, 'out');   // default present, but not "given"
});

test('config file is honoured; the CLI only wins where it was passed', async () => {
  const file = await writeConfig({ profile: 'fileuser', posts: 40, comments: true });

  // No CLI overrides -> file values apply (the documented behaviour)
  const fromFile = await resolveConfig(['--config', file]);
  assert.equal(fromFile.target, 'fileuser');
  assert.equal(fromFile.maxPosts, 40);
  assert.equal(fromFile.wantComments, true);

  // CLI overrides only its own keys, the rest still comes from the file
  const mixed = await resolveConfig(['--config', file, '--profile', 'cliuser']);
  assert.equal(mixed.target, 'cliuser');
  assert.equal(mixed.maxPosts, 40);

  // ...and --posts beats the file
  const capped = await resolveConfig(['--config', file, '--posts', '5']);
  assert.equal(capped.maxPosts, 5);
  const uncapped = await resolveConfig(['--config', file, '--posts', 'all']);
  assert.equal(uncapped.maxPosts, Infinity);
});

test('validateConfig: all passes, a bogus --posts fails', async () => {
  const all = await resolveConfig(['--profile', 'u', '--posts', 'all']);
  validateConfig(all);                       // must not throw

  const bad = await resolveConfig(['--profile', 'u', '--posts', 'abc']);
  assert.throws(() => validateConfig(bad), /--posts/);
});
