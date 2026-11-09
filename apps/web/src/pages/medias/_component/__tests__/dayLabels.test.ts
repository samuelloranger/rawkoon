import { beforeAll, describe, expect, it } from "vitest";
import { formatDateShort } from "../LibraryHistoryCharts";
import { toTmdbSearchItem } from "@/pages/_component/UpcomingRail";

// A zone west of UTC is where midnight-UTC dates slip back a day.
beforeAll(() => {
  process.env.TZ = "America/Toronto";
});

describe("day-only dates west of UTC", () => {
  it("labels a UTC day bucket with that day, not the previous one", () => {
    expect(formatDateShort("2026-03-15")).toMatch(/15/);
  });

  it("keeps the release year of a January 1 upcoming item", () => {
    const item = toTmdbSearchItem({
      id: "movie-1",
      media_type: "movie",
      title: "X",
      release_date: "2027-01-01",
    } as Parameters<typeof toTmdbSearchItem>[0]);
    expect(item.release_year).toBe(2027);
  });
});
