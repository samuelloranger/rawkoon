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

  it("is null when no country lists a home release", () => {
    expect(
      pickUpcomingMovieDay([country("CA", [3, "2026-07-17"])], "CA"),
    ).toBeNull();
    expect(pickUpcomingMovieDay([], "CA")).toBeNull();
  });
});
