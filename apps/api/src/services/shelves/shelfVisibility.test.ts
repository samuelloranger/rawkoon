import { describe, expect, it } from "bun:test";
import {
  isVisibleNow,
  normalizeMmdd,
  sortEntries,
  todayMmdd,
} from "./shelfVisibility";

// Local dates on purpose: the window is compared in the server's time zone.
const at = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0);

describe("shelf visibility", () => {
  it("normalizes a month-day and rejects anything else", () => {
    expect(normalizeMmdd("11-01")).toBe("11-01");
    expect(normalizeMmdd("01-15")).toBe("01-15");
    expect(normalizeMmdd("13-01")).toBeNull();
    expect(normalizeMmdd("11-32")).toBeNull();
    expect(normalizeMmdd("")).toBeNull();
    expect(normalizeMmdd(null)).toBeNull();
  });

  it("refuses a day no month has, so a saved window always matches some date", () => {
    expect(normalizeMmdd("02-29")).toBe("02-29");
    expect(normalizeMmdd("02-30")).toBeNull();
    expect(normalizeMmdd("02-31")).toBeNull();
    expect(normalizeMmdd("04-31")).toBeNull();
    expect(normalizeMmdd("06-31")).toBeNull();
    expect(normalizeMmdd("12-31")).toBe("12-31");
  });

  it("formats today as MM-DD", () => {
    expect(todayMmdd(at(2026, 3, 7))).toBe("03-07");
  });

  it("is always visible with no window", () => {
    expect(isVisibleNow(null, null, at(2026, 6, 1))).toBe(true);
  });

  it("includes both ends of a window that wraps the year end", () => {
    expect(isVisibleNow("11-01", "01-15", at(2026, 11, 1))).toBe(true);
    expect(isVisibleNow("11-01", "01-15", at(2026, 12, 31))).toBe(true);
    expect(isVisibleNow("11-01", "01-15", at(2027, 1, 1))).toBe(true);
    expect(isVisibleNow("11-01", "01-15", at(2027, 1, 15))).toBe(true);
  });

  it("hides the day after the window and the day before it", () => {
    expect(isVisibleNow("11-01", "01-15", at(2027, 1, 16))).toBe(false);
    expect(isVisibleNow("11-01", "01-15", at(2026, 10, 31))).toBe(false);
    expect(isVisibleNow("11-01", "01-15", at(2026, 6, 1))).toBe(false);
  });

  it("handles a window inside one year and one-sided bounds", () => {
    expect(isVisibleNow("06-01", "08-31", at(2026, 6, 1))).toBe(true);
    expect(isVisibleNow("06-01", "08-31", at(2026, 9, 1))).toBe(false);
    expect(isVisibleNow("12-01", null, at(2026, 12, 5))).toBe(true);
    expect(isVisibleNow("12-01", null, at(2026, 11, 30))).toBe(false);
    // A one-sided bound is the same-year range: January 1 up to that day.
    expect(isVisibleNow(null, "12-31", at(2026, 1, 1))).toBe(true);
    expect(isVisibleNow(null, "06-30", at(2026, 7, 1))).toBe(false);
  });

  it("keeps manual order by position, then id", () => {
    const entries = [
      { id: 3, position: 1, title: "C", year: 2000, addedAt: new Date(0) },
      { id: 1, position: 0, title: "A", year: 2010, addedAt: new Date(0) },
      { id: 2, position: 0, title: "B", year: 2005, addedAt: new Date(0) },
    ];
    expect(sortEntries("manual", entries).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("sorts release by year, then title, with unknown years last", () => {
    const entries = [
      { id: 1, position: 0, title: "B", year: 2000, addedAt: new Date(0) },
      { id: 2, position: 1, title: "A", year: 2000, addedAt: new Date(0) },
      {
        id: 3,
        position: 2,
        title: "Unknown",
        year: null,
        addedAt: new Date(0),
      },
      { id: 4, position: 3, title: "Old", year: 1990, addedAt: new Date(0) },
    ];
    expect(sortEntries("release", entries).map((e) => e.title)).toEqual([
      "Old",
      "A",
      "B",
      "Unknown",
    ]);
  });

  it("falls back to release order for rating shelves", () => {
    const entries = [
      { id: 1, position: 0, title: "New", year: 2020, addedAt: new Date(0) },
      { id: 2, position: 1, title: "Old", year: 1990, addedAt: new Date(0) },
    ];
    expect(sortEntries("rating", entries).map((e) => e.id)).toEqual([2, 1]);
  });

  it("sorts recently added shelves newest first", () => {
    const entries = [
      { id: 1, position: 0, title: "Old", year: 2000, addedAt: at(2026, 1, 1) },
      { id: 2, position: 1, title: "New", year: 2000, addedAt: at(2026, 5, 1) },
    ];
    expect(sortEntries("added", entries).map((e) => e.id)).toEqual([2, 1]);
  });
});
