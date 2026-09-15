// Token-bucket rate limiter. A device realistically needs a handful of
// notifications a minute; a server stuck in a loop needs stopping.
interface Bucket {
  tokens: number;
  updated: number;
}

const IDLE_MS = 300_000;
// Real deployments track a few hundred servers and devices; 10k is ~100x that
// and caps the map at a couple of MB under a flood of forged keys.
const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    opts: { maxKeys?: number; now?: () => number } = {},
  ) {
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
    this.now = opts.now ?? (() => Date.now());
  }

  get size(): number {
    return this.buckets.size;
  }

  take(key: string): boolean {
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) {
        this.sweep();
        // Fail closed: under a flood of distinct keys, dropping the request
        // beats growing the map without bound on a public endpoint.
        if (this.buckets.size >= this.maxKeys) return false;
      }
      b = { tokens: this.capacity, updated: now };
    }
    const elapsed = (now - b.updated) / 1000;
    b.tokens = Math.min(
      this.capacity,
      b.tokens + elapsed * this.refillPerSecond,
    );
    b.updated = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }

  sweep(): void {
    const now = this.now();
    for (const [key, b] of this.buckets) {
      if (now - b.updated > IDLE_MS) this.buckets.delete(key);
    }
  }
}
