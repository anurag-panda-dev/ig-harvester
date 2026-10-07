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
  logLevel    : 'info',
  logJson     : false,
};

/** Parse CLI arguments into a config object. */
export function parseArgs(argv) {
  const cfg = { ...DEFAULTS };
  const flag = (n) => argv.includes(`--${n}`);
  const val  = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };

  if (flag('comments')) cfg.wantComments = true;
  if (flag('followers')) cfg.wantFollowers = true;
  if (flag('following')) cfg.wantFollowing = true;
  if (flag('shots') || flag('shots-only')) cfg.shots = true;
  if (flag('shot-only')) cfg.shotOnly = true;
  if (flag('headless')) cfg.headful = false;
  if (flag('sqlite')) cfg.sqlite = true;
  if (flag('no-resume')) cfg.resume = false;
  if (flag('json-log')) cfg.logJson = true;

  const target = val('profile');
  if (target) cfg.target = target;
  const url = val('url');
  if (url) cfg.url = url;
  const posts = val('posts');
  if (posts) cfg.maxPosts = Number(posts);
  const out = val('out');
  if (out) cfg.outDir = out;
  const cdp = val('cdp');
  if (cdp) cfg.cdp = cdp;
  const dMin = val('delay-min');
  if (dMin) cfg.minDelay = Number(dMin);
  const dMax = val('delay-max');
  if (dMax) cfg.maxDelay = Number(dMax);
  const proxy = val('proxy');
  if (proxy) cfg.proxy = proxy;
  const proxyBypass = val('proxy-bypass');
  if (proxyBypass) cfg.proxyBypass = proxyBypass;
  const configFile = val('config');
  if (configFile) cfg.configFile = configFile;
  const logLevel = val('log-level');
  if (logLevel) cfg.logLevel = logLevel;

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

/** Merge configs: defaults < file < CLI. */
export async function resolveConfig(argv) {
  const cliCfg = parseArgs(argv);

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

  // Merge: defaults < file < CLI (CLI wins)
  const merged = { ...DEFAULTS, ...fileCfg, ...cliCfg };

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
  if (cfg.maxPosts < 1) {
    throw new Error('--posts must be >= 1');
  }
  if (cfg.minDelay < 0 || cfg.maxDelay < cfg.minDelay) {
    throw new Error('Invalid delay range');
  }
}
