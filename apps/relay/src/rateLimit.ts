// Token-bucket rate limiter. A device realistically needs a handful of
// notifications a minute; a server stuck in a loop needs stopping.
interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string): boolean {
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    const elapsed = (now - b.updated) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
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
      if (now - b.updated > 300_000) this.buckets.delete(key);
    }
  }
}
