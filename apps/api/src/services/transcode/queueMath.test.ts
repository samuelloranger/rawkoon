import { describe, expect, it } from "bun:test";
import {
  blockToTop,
  isInsideWindow,
  positionBetween,
} from "@rawkoon/api/services/transcode/queueMath";

const at = (h: number, m: number) => new Date(2026, 0, 1, h, m);

describe("isInsideWindow", () => {
  it("same-day window", () => {
    expect(isInsideWindow(at(1, 0), "01:00", "08:00")).toBe(true);
    expect(isInsideWindow(at(7, 59), "01:00", "08:00")).toBe(true);
    expect(isInsideWindow(at(8, 0), "01:00", "08:00")).toBe(false);
    expect(isInsideWindow(at(0, 59), "01:00", "08:00")).toBe(false);
  });

  it("window crossing midnight", () => {
    expect(isInsideWindow(at(23, 30), "22:00", "06:00")).toBe(true);
    expect(isInsideWindow(at(5, 59), "22:00", "06:00")).toBe(true);
    expect(isInsideWindow(at(6, 0), "22:00", "06:00")).toBe(false);
    expect(isInsideWindow(at(21, 59), "22:00", "06:00")).toBe(false);
  });

  it("equal start and end means always open", () => {
    expect(isInsideWindow(at(12, 0), "03:00", "03:00")).toBe(true);
  });
});

describe("positionBetween", () => {
  it("midpoint, top, and tail", () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(null, 5)).toBe(4);
    expect(positionBetween(7, null)).toBe(8);
    expect(positionBetween(null, null)).toBe(1);
  });
});

describe("blockToTop", () => {
  it("places N rows in order before the current minimum", () => {
    expect(blockToTop(10, 3)).toEqual([7, 8, 9]);
    expect(blockToTop(null, 2)).toEqual([1, 2]);
  });
});
