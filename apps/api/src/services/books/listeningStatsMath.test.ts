import { describe, expect, test } from "bun:test";
import {
  buildSeriesStats,
  calendarDateInTz,
  creditSeconds,
  isoWeekDays,
  streakDays,
  type SeriesBookInput,
} from "@rawkoon/api/services/books/listeningStatsMath";

describe("creditSeconds", () => {
  test("seek back is 0", () => {
    expect(creditSeconds(100, 40, 10)).toBe(0);
  });
  test("10s PUT with +12s at 1x counts 12", () => {
    expect(creditSeconds(100, 112, 10)).toBe(12);
  });
  test("scrub +120s with 10s elapsed is 0", () => {
    expect(creditSeconds(100, 220, 10)).toBe(0);
  });
  test("offline +2700s position with 2700s elapsed counts 2700", () => {
    expect(creditSeconds(100, 2800, 2700)).toBe(2700);
  });
  test("negative elapsed is 0", () => {
    expect(creditSeconds(100, 112, -1)).toBe(0);
  });
  test("zero or negative delta is 0", () => {
    expect(creditSeconds(100, 100, 10)).toBe(0);
  });
});

describe("calendarDateInTz", () => {
  test("UTC morning is still previous evening in America/Toronto", () => {
    // 2026-09-07 03:30 UTC = 2026-09-06 23:30 EDT
    expect(
      calendarDateInTz(new Date("2026-09-07T03:30:00.000Z"), "America/Toronto"),
    ).toBe("2026-09-06");
  });
});

describe("isoWeekDays", () => {
  test("2026-09-01 (Tuesday) week starts 2026-08-31 (spans months)", () => {
    expect(isoWeekDays("2026-09-01")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("streakDays", () => {
  test("empty is 0", () => {
    expect(streakDays(new Set(), "2026-09-06")).toBe(0);
  });
  test("today counts backward", () => {
    expect(
      streakDays(new Set(["2026-09-04", "2026-09-05", "2026-09-06"]), "2026-09-06"),
    ).toBe(3);
  });
  test("yesterday-only still counts (morning before today's listen)", () => {
    expect(streakDays(new Set(["2026-09-05"]), "2026-09-06")).toBe(1);
  });
  test("a gap breaks it", () => {
    expect(
      streakDays(new Set(["2026-09-03", "2026-09-06"]), "2026-09-06"),
    ).toBe(1);
  });
});

describe("buildSeriesStats", () => {
  const discworld = (title: string, extra: Partial<SeriesBookInput>) => ({
    seriesName: "Discworld",
    title,
    hasAudiobook: true,
    finished: false,
    positionSecs: 0,
    totalDurationSecs: 100,
    updatedAtMs: null,
    ...extra,
  });

  test("drops a one-book series and ebook-only books", () => {
    const stats = buildSeriesStats([
      discworld("Mort", {}),
      {
        seriesName: "Discworld",
        title: "Sourcery ebook",
        hasAudiobook: false,
        finished: false,
        positionSecs: 0,
        totalDurationSecs: 0,
        updatedAtMs: null,
      },
      {
        seriesName: "Standalone",
        title: "Alone",
        hasAudiobook: true,
        finished: true,
        positionSecs: 50,
        totalDurationSecs: 50,
        updatedAtMs: 1,
      },
    ]);
    expect(stats).toEqual([]);
  });

  test("finished is ratio 1; mean rounds to integer percent; current_title is latest in-progress", () => {
    const stats = buildSeriesStats([
      discworld("Mort", {
        finished: true,
        positionSecs: 90,
        totalDurationSecs: 100,
        updatedAtMs: 1,
      }),
      discworld("Sourcery", {
        positionSecs: 50,
        totalDurationSecs: 100,
        updatedAtMs: 9,
      }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].books_total).toBe(2);
    expect(stats[0].books_finished).toBe(1);
    expect(stats[0].percent).toBe(75);
    expect(stats[0].current_title).toBe("Sourcery");
  });
});
