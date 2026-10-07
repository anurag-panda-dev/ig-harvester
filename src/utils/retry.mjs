/**
 * Retry with exponential backoff + jitter.
 * Retries on any error unless `shouldRetry` says otherwise.
 */
import { logger } from './logger.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function retry(fn, opts = {}) {
  const {
    attempts = 5,
    baseDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    jitter = true,
    shouldRetry = () => true,
    onRetry = null,
  } = opts;

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err, i)) throw err;

      let delay = Math.min(baseDelay * Math.pow(factor, i), maxDelay);
      if (jitter) delay = delay * (0.5 + Math.random() * 0.5);

      logger.warn(`retry ${i + 1}/${attempts} after ${Math.round(delay)}ms: ${err.message?.split('\n')[0]}`);
      if (onRetry) onRetry(err, i, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Retry specifically on network/timeout errors. */
export function isRetryable(err) {
  const msg = (err.message || '').toLowerCase();
  return /timeout|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|429|503|502|504|socket|closed/i.test(msg);
}
