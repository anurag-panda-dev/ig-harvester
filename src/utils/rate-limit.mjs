/**
 * Token-bucket rate limiter. Call `acquire()` before each request.
 * Not thread-safe (single-threaded Node is fine).
 */
export class RateLimiter {
  constructor({ rate = 1, burst = 1 } = {}) {
    this.rate = rate;       // tokens per second
    this.burst = burst;     // max bucket size
    this.tokens = burst;
    this.last = Date.now();
  }

  async acquire(tokens = 1) {
    this._replenish();
    while (this.tokens < tokens) {
      const needed = tokens - this.tokens;
      const waitMs = (needed / this.rate) * 1000;
      await new Promise(r => setTimeout(r, waitMs));
      this._replenish();
    }
    this.tokens -= tokens;
  }

  _replenish() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    this.last = now;
  }
}

/** Human-delay with jitter — mimics the original pacing. */
export async function humanDelay(minMs = 900, maxMs = 2600) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  await new Promise(r => setTimeout(r, ms));
}
