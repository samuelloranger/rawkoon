/**
 * A fixed-capacity ring buffer. Pushing past capacity overwrites the oldest
 * entry, so memory is bounded regardless of how many samples arrive. Used by
 * the perf-baseline instrumentation to hold recent request timings without an
 * unbounded array or a durable table.
 *
 * Pure data structure — no I/O, no env reads — so it is unit-tested directly.
 */
export class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private start = 0; // index of the oldest element
  private count = 0; // number of live elements (<= capacity)

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("RingBuffer capacity must be a positive integer");
    }
    this.buf = new Array<T | undefined>(capacity);
  }

  /** Current number of stored elements. */
  get size(): number {
    return this.count;
  }

  /** Append one element, evicting the oldest when at capacity. */
  push(item: T): void {
    const end = (this.start + this.count) % this.capacity;
    this.buf[end] = item;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      // Full: overwrote the oldest slot, so advance the window start.
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** Snapshot of live elements, oldest first. */
  toArray(): T[] {
    const out: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buf[(this.start + i) % this.capacity] as T;
    }
    return out;
  }

  /** Drop all elements. */
  clear(): void {
    this.start = 0;
    this.count = 0;
    this.buf.fill(undefined);
  }
}
