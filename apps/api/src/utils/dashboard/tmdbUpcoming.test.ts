import { describe, expect, it } from "bun:test";
import { pickUpcomingMovieDay } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";

const country = (iso: string, ...dates: [number, string][]) => ({
  iso_3166_1: iso,
  release_dates: dates.map(([type, day]) => ({
    type,
    release_date: `${day}T00:00:00.000Z`,
  })),
});

describe("pickUpcomingMovieDay", () => {
  it("prefers the region's digital release, then its physical one", () => {
    const results = [
      country("US", [4, "2027-01-05"]),
      country("CA", [3, "2026-07-17"], [5, "2027-02-01"], [4, "2027-01-20"]),
    ];
    expect(pickUpcomingMovieDay(results, "CA")).toBe("2027-01-20");
    results[1]!.release_dates.pop();
    expect(pickUpcomingMovieDay(results, "CA")).toBe("2027-02-01");
  });

  it("falls back to a digital release elsewhere when the region has only a theatrical date", () => {
    const results = [
      country("CA", [3, "2026-07-17"]),
      country("US", [3, "2026-07-17"], [4, "2026-11-17"]),
    ];
    expect(pickUpcomingMovieDay(results, "CA")).toBe("2026-11-17");
  });

  it("keeps the region's digital release over an earlier one elsewhere", () => {
    const results = [
      country("US", [4, "2026-11-01"]),
      country("CA", [4, "2026-12-01"]),
    ];
    expect(pickUpcomingMovieDay(results, "CA")).toBe("2026-12-01");
  });

  it("skips malformed entries instead of losing the whole movie", () => {
    const results = [
      null,
      { iso_3166_1: "FR" },
      { iso_3166_1: "GB", release_dates: [{ type: 4, release_date: 7 }] },
      country("CA", [4, "2027-01-20"]),
    ];
    expect(pickUpcomingMovieDay(results, "CA")).toBe("2027-01-20");
    expect(pickUpcomingMovieDay(results, "US")).toBe("2027-01-20");
  });

  it("is null when no country lists a home release", () => {
    expect(
      pickUpcomingMovieDay([country("CA", [3, "2026-07-17"])], "CA"),
    ).toBeNull();
    expect(pickUpcomingMovieDay([], "CA")).toBeNull();
  });
});
