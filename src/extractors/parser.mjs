/**
 * Parsing utilities — counts, timestamps, text sanitization.
 */

/** Parse a human count like "686M", "1,204", "2.3K" into a number. */
export function parseCount(raw) {
  if (raw == null) return undefined;
  const s = String(raw).replace(/[\s,]/g, '').trim();
  if (!s) return undefined;
  const MULT = { K: 1e3, M: 1e6, B: 1e9 };
  const tail = s.slice(-1).toUpperCase();
  const mult = MULT[tail] ?? 1;
  const head = mult === 1 ? s : s.slice(0, -1);
  const n = parseFloat(head) * mult;
  return Number.isFinite(n) && n > 0 && n < 1e10 ? n : undefined;
}

/** Parse an ISO date string or Unix timestamp (seconds) into a Date. */
export function parseTimestamp(input) {
  if (input == null) return null;
  if (typeof input === 'number') {
    // Instagram uses seconds, not ms
    const ms = input < 1e12 ? input * 1000 : input;
    const d = new Date(ms);
    return isNaN(d) ? null : d;
  }
  const d = new Date(input);
  return isNaN(d) ? null : d;
}

/** Collapse whitespace and strip control chars from text. */
export function sanitizeText(s) {
  if (s == null) return '';
  return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim();
}

/** Extract shortcode from a permalink path like /p/ABC123/ or /username/p/ABC123/
 *  The path segment after p/reel/tv *is* the shortcode — callers pass
 *  permalinks already shape-checked by the grid collector. */
export function extractShortcode(href) {
  const m = href.match(/\/(?:[\w.-]+\/)?(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : undefined;
}

/** Determine media type from permalink. */
export function mediaType(href) {
  if (/\/reel\//.test(href)) return 'reel';
  if (/\/tv\//.test(href)) return 'igtv';
  return 'photo';
}

/** Parse a URL into components. */
export function parseUrl(url) {
  try {
    const u = new URL(url);
    return { protocol: u.protocol, host: u.host, pathname: u.pathname, search: u.search };
  } catch {
    return null;
  }
}
