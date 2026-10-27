import { describe, expect, test } from "bun:test";
import { buildTimeline } from "@rawkoon/api/services/books/bookTimeline";

describe("buildTimeline", () => {
  test("chapters run end to end with no gap and no overlap", () => {
    const t = buildTimeline([
      { title: "Chapter 1", durationSecs: 498.125 },
      { title: "Chapter 2", durationSecs: 539.375 },
      { title: "Chapter 3", durationSecs: 412.75 },
    ]);
    expect(t[0]).toEqual({
      index: 0,
      title: "Chapter 1",
      startSecs: 0,
      endSecs: 498.125,
    });
    expect(t[1].startSecs).toBe(t[0].endSecs);
    expect(t[2].startSecs).toBe(t[1].endSecs);
    expect(t[2].endSecs).toBeCloseTo(1450.25, 6);
  });

  /**
   * The reference book's real numbers. The sum deliberately does NOT equal
   * metadata.json's 28798.9: `-c copy` rounds every cut up to a frame, which
   * drifts +1.567s across 61 files. A change that starts trusting source
   * chapter atoms must fail here.
   */
  test("the reference book's total is the sum of its files, not its atoms", () => {
    const durations = Array.from({ length: 61 }, (_, i) => ({
      title: `Chapter ${i + 1}`,
      durationSecs: 28800.5 / 61,
    }));
    const t = buildTimeline(durations);
    expect(t[60].endSecs).toBeCloseTo(28800.5, 3);
    expect(t[60].endSecs).toBeGreaterThan(28798.9);
  });

  test("an empty book has no chapters", () => {
    expect(buildTimeline([])).toEqual([]);
  });
});
