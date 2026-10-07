/**
 * Structured logger with levels, timestamps, and optional JSON output.
 * Levels: debug < info < warn < error
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = process.env.LOG_LEVEL || 'info';
const JSON_LOG = process.env.LOG_JSON === '1';

function ts() { return new Date().toISOString(); }

function emit(level, msg, meta) {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
  if (JSON_LOG) {
    console.log(JSON.stringify({ ts: ts(), level, msg, ...meta }));
  } else {
    const colors = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
    const c = colors[level] || '';
    const m = Object.keys(meta || {}).length ? ' ' + JSON.stringify(meta) : '';
    console.log(`${c}[${level.padEnd(5)}]\x1b[0m ${msg}${m}`);
  }
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info:  (msg, meta) => emit('info', msg, meta),
  warn:  (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};

/** Create a child logger with a prefix context. */
export function childLogger(prefix) {
  return {
    debug: (msg, meta) => logger.debug(`[${prefix}] ${msg}`, meta),
    info:  (msg, meta) => logger.info(`[${prefix}] ${msg}`, meta),
    warn:  (msg, meta) => logger.warn(`[${prefix}] ${msg}`, meta),
    error: (msg, meta) => logger.error(`[${prefix}] ${msg}`, meta),
  };
}
