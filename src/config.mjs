/**
 * Configuration loading — merges defaults, config file, and CLI args.
 * CLI args take highest precedence.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = {
  target      : null,
  url         : null,
  maxPosts    : 30,
  wantComments: false,
  wantFollowers: false,
  wantFollowing: false,
  shots       : false,
  shotOnly    : false,
  outDir      : 'out',
  cdp         : 'http://127.0.0.1:9222',
  headful     : true,
  minDelay    : 900,
  maxDelay    : 2600,
  proxy       : null,        // "http://host:port" or "socks5://host:port"
  proxyBypass : null,        // comma-separated hosts to bypass
  configFile  : null,        // path to JSON config
  sqlite      : false,       // also write SQLite output
  resume      : true,        // use cache for resume
  force       : false,       // images: re-download files already on disk
  logLevel    : 'info',
  logJson     : false,
};

// Config-file key spellings (the ones used by config.example.json / the docs)
// mapped onto the internal names. Internal names are accepted as-is.
const FILE_KEY_MAP = {
  profile   : 'target',
  username  : 'target',
  posts     : 'maxPosts',
  comments  : 'wantComments',
  followers : 'wantFollowers',
  following : 'wantFollowing',
};

/**
 * --posts accepts a number, or one of: all / any / unlimited / none / 0
 * (meaning "every post the grid will serve").
 */
export function parseMaxPosts(v) {
  const s = String(v).trim().toLowerCase();
  if (s === '') return NaN;
  if (['all', 'any', 'unlimited', 'none', '*', '0'].includes(s)) return Infinity;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Parse CLI arguments into a config object. */
export function parseArgs(argv) {
  const cfg = { ...DEFAULTS };
  const given = new Set();            // keys actually set on the command line
  const flag = (n) => argv.includes(`--${n}`);
  const val  = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };

  if (flag('comments')) { cfg.wantComments = true; given.add('wantComments'); }
  if (flag('followers')) { cfg.wantFollowers = true; given.add('wantFollowers'); }
  if (flag('following')) { cfg.wantFollowing = true; given.add('wantFollowing'); }
  if (flag('shots') || flag('shots-only')) { cfg.shots = true; given.add('shots'); }
  if (flag('shot-only')) { cfg.shotOnly = true; given.add('shotOnly'); }
  if (flag('headless')) { cfg.headful = false; given.add('headful'); }
  if (flag('sqlite')) { cfg.sqlite = true; given.add('sqlite'); }
  if (flag('no-resume')) { cfg.resume = false; given.add('resume'); }
  if (flag('force')) { cfg.force = true; given.add('force'); }
  if (flag('json-log')) { cfg.logJson = true; given.add('logJson'); }

  const target = val('profile');
  if (target) { cfg.target = target; given.add('target'); }
  const url = val('url');
  if (url) { cfg.url = url; given.add('url'); }
  const posts = val('posts');
  if (posts !== undefined && String(posts).trim() !== '') {
    cfg.maxPosts = parseMaxPosts(posts); given.add('maxPosts');
  }
  const out = val('out');
  if (out) { cfg.outDir = out; given.add('outDir'); }
  const cdp = val('cdp');
  if (cdp) { cfg.cdp = cdp; given.add('cdp'); }
  const dMin = val('delay-min');
  if (dMin) { cfg.minDelay = Number(dMin); given.add('minDelay'); }
  const dMax = val('delay-max');
  if (dMax) { cfg.maxDelay = Number(dMax); given.add('maxDelay'); }
  const proxy = val('proxy');
  if (proxy) { cfg.proxy = proxy; given.add('proxy'); }
  const proxyBypass = val('proxy-bypass');
  if (proxyBypass) { cfg.proxyBypass = proxyBypass; given.add('proxyBypass'); }
  const configFile = val('config');
  if (configFile) { cfg.configFile = configFile; given.add('configFile'); }
  const logLevel = val('log-level');
  if (logLevel) { cfg.logLevel = logLevel; given.add('logLevel'); }

  cfg.__given = given;   // consumed by resolveConfig(), never part of the config
  return cfg;
}

/** Load config from a JSON file. */
export async function loadConfigFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to load config file ${filePath}: ${e.message}`);
  }
}

/** Merge configs: defaults < file < CLI (CLI only wins where it was given). */
export async function resolveConfig(argv) {
  const cliCfg = parseArgs(argv);
  const given = cliCfg.__given instanceof Set ? cliCfg.__given : new Set();
  delete cliCfg.__given;

  let fileCfg = {};
  if (cliCfg.configFile) {
    fileCfg = await loadConfigFile(cliCfg.configFile);
  } else {
    // Auto-detect config.json in cwd
    const autoPath = path.resolve('config.json');
    try {
      await fs.access(autoPath);
      fileCfg = await loadConfigFile(autoPath);
    } catch { /* no auto config */ }
  }
  if (!fileCfg || typeof fileCfg !== 'object' || Array.isArray(fileCfg)) fileCfg = {};

  // Merge: defaults < file < CLI. The file may use the documented key spellings
  // (profile/posts/comments/...) — map them onto the internal names. The CLI
  // layer only contributes keys that were actually passed, so a value from the
  // config file is no longer silently overwritten by the built-in default.
  const merged = { ...DEFAULTS };
  for (const [k, v] of Object.entries(fileCfg)) {
    if (v === undefined) continue;
    merged[FILE_KEY_MAP[k] || k] = v;
  }
  for (const k of given) merged[k] = cliCfg[k];

  // Derive target from URL if needed
  if (!merged.target && merged.url) {
    merged.target = merged.url.match(/instagram\.com\/([^/?#]+)/)?.[1] || 'target';
  }

  return merged;
}

/** Validate config and throw on critical issues. */
export function validateConfig(cfg) {
  if (!cfg.target && !cfg.url) {
    throw new Error('Need --profile <username> or --url <full instagram url>');
  }
  if (!(cfg.maxPosts >= 1)) {
    throw new Error('--posts must be >= 1 (or "all" for every post)');
  }
  if (cfg.minDelay < 0 || cfg.maxDelay < cfg.minDelay) {
    throw new Error('Invalid delay range');
  }
}
