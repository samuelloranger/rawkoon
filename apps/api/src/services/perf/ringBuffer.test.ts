import { describe, it, expect } from "bun:test";
import { RingBuffer } from "./ringBuffer";

describe("RingBuffer", () => {
  it("rejects a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
    expect(() => new RingBuffer(1.5)).toThrow();
  });

  it("stores elements in insertion order below capacity", () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it("wraps and evicts the oldest at capacity", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // evicts 1
    rb.push(5); // evicts 2
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([3, 4, 5]);
  });

  it("keeps size bounded no matter how many pushes arrive", () => {
    const rb = new RingBuffer<number>(4);
    for (let i = 0; i < 1000; i++) rb.push(i);
    expect(rb.size).toBe(4);
    expect(rb.toArray()).toEqual([996, 997, 998, 999]);
  });

  it("clears back to empty", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.size).toBe(0);
    expect(rb.toArray()).toEqual([]);
    rb.push(9);
    expect(rb.toArray()).toEqual([9]);
  });
});
