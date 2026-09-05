import { describe, it, expect } from "bun:test";
import { percentile, summarize } from "./percentiles";

describe("percentile", () => {
  it("returns 0 for an empty set", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([], 95)).toBe(0);
  });

  it("computes nearest-rank p50/p95 over 1..10", () => {
    const values = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]; // unsorted on purpose
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
  });

  it("returns min at p<=0 and max at p>=100", () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 100)).toBe(9);
  });

  it("handles a single sample", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("picks the observed value for a known distribution", () => {
    // 100 samples 1..100. Nearest rank: p50 -> rank 50 -> value 50,
    // p95 -> rank 95 -> value 95, p99 -> rank 99 -> value 99.
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
  });
});

describe("summarize", () => {
  it("returns zeros for an empty set", () => {
    expect(summarize([])).toEqual({
      count: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      mean: 0,
    });
  });

  it("summarizes a known set", () => {
    const values = [10, 20, 30, 40, 50];
    const s = summarize(values);
    expect(s.count).toBe(5);
    expect(s.min).toBe(10);
    expect(s.max).toBe(50);
    expect(s.mean).toBe(30);
    expect(s.p50).toBe(30); // rank ceil(0.5*5)=3 -> value 30
    expect(s.p95).toBe(50); // rank ceil(0.95*5)=5 -> value 50
  });
});
