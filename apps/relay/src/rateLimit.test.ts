import { describe, expect, test } from "bun:test";
import { RateLimiter } from "./rateLimit";

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("RateLimiter", () => {
  test("allows up to capacity then denies", () => {
    const c = clock();
    const limiter = new RateLimiter(3, 1, { now: c.now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  test("keys are independent", () => {
    const c = clock();
    const limiter = new RateLimiter(1, 1, { now: c.now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.take("b")).toBe(true);
  });

  test("refills over elapsed time", () => {
    const c = clock();
    const limiter = new RateLimiter(2, 1, { now: c.now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    c.advance(1000);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  test("refill honours a fractional rate", () => {
    const c = clock();
    const limiter = new RateLimiter(10, 1 / 6, { now: c.now });
    for (let i = 0; i < 10; i++) expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    c.advance(3000);
    expect(limiter.take("a")).toBe(false);
    c.advance(5000);
    expect(limiter.take("a")).toBe(true);
  });

  test("refill never exceeds capacity", () => {
    const c = clock();
    const limiter = new RateLimiter(3, 1, { now: c.now });
    expect(limiter.take("a")).toBe(true);
    c.advance(3_600_000);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  test("sweep evicts only idle buckets", () => {
    const c = clock();
    const limiter = new RateLimiter(5, 1, { now: c.now });
    limiter.take("stale");
    c.advance(301_000);
    limiter.take("fresh");
    limiter.sweep();
    expect(limiter.size).toBe(1);
    expect(limiter.take("fresh")).toBe(true);
  });

  test("sweep keeps a bucket that is idle but not yet expired", () => {
    const c = clock();
    const limiter = new RateLimiter(5, 1, { now: c.now });
    limiter.take("a");
    c.advance(299_000);
    limiter.sweep();
    expect(limiter.size).toBe(1);
  });

  test("size reflects the number of tracked keys", () => {
    const c = clock();
    const limiter = new RateLimiter(5, 1, { now: c.now });
    expect(limiter.size).toBe(0);
    limiter.take("a");
    expect(limiter.size).toBe(1);
    limiter.take("a");
    expect(limiter.size).toBe(1);
    limiter.take("b");
    expect(limiter.size).toBe(2);
    c.advance(301_000);
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });

  test("denied keys are still tracked", () => {
    const c = clock();
    const limiter = new RateLimiter(1, 1, { now: c.now });
    limiter.take("a");
    expect(limiter.take("a")).toBe(false);
    expect(limiter.size).toBe(1);
  });

  test("denies new keys at the cap but keeps serving existing ones", () => {
    const c = clock();
    const limiter = new RateLimiter(5, 1, { maxKeys: 2, now: c.now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("b")).toBe(true);
    expect(limiter.size).toBe(2);
    expect(limiter.take("c")).toBe(false);
    expect(limiter.size).toBe(2);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("b")).toBe(true);
  });

  test("a flood of distinct keys cannot grow the map past the cap", () => {
    const c = clock();
    const limiter = new RateLimiter(5, 1, { maxKeys: 4, now: c.now });
    for (let i = 0; i < 1000; i++) limiter.take(`key-${i}`);
    expect(limiter.size).toBe(4);
  });

  test("an inline sweep reclaims room for a new key", () => {
    const c = clock();
    const limiter = new RateLimiter(5, 1, { maxKeys: 2, now: c.now });
    limiter.take("a");
    limiter.take("b");
    c.advance(301_000);
    expect(limiter.take("c")).toBe(true);
    expect(limiter.size).toBe(1);
  });

  test("the cap applies without an explicit maxKeys", () => {
    const c = clock();
    const limiter = new RateLimiter(5, 1, { now: c.now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.size).toBe(1);
  });
});
