import { describe, it, expect } from "bun:test";
import { pickDigitalRelease } from "@rawkoon/api/utils/medias/libraryHelpers";

// type 4 = digital release. type 3 = theatrical.
const digital = (date: string) => ({ type: 4, release_date: date });
const theatrical = (date: string) => ({ type: 3, release_date: date });

describe("pickDigitalRelease", () => {
  it("prefers the requested region's digital release", () => {
    const got = pickDigitalRelease(
      [
        { iso_3166_1: "US", release_dates: [digital("2026-06-30")] },
        { iso_3166_1: "CA", release_dates: [digital("2026-06-15")] },
      ],
      "CA",
    );
    expect(got?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("falls back to another country when the region has no digital release", () => {
    const got = pickDigitalRelease(
      [
        { iso_3166_1: "CA", release_dates: [theatrical("2026-05-13")] },
        { iso_3166_1: "US", release_dates: [digital("2026-06-30")] },
      ],
      "CA",
    );
    expect(got?.toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("returns null when there is no digital release at all", () => {
    const got = pickDigitalRelease(
      [{ iso_3166_1: "CA", release_dates: [theatrical("2026-05-13")] }],
      "CA",
    );
    expect(got).toBeNull();
  });

  // Regression: TMDB can return a type-4 entry with an empty/invalid date.
  // new Date("") is an Invalid Date that slips past `> cutoff` checks and
  // triggers premature searches + auto-skip. It must be ignored.
  it("ignores type-4 entries with an empty release_date", () => {
    const got = pickDigitalRelease(
      [{ iso_3166_1: "US", release_dates: [digital("")] }],
      "CA",
    );
    expect(got).toBeNull();
  });

  it("skips an invalid date and uses a later valid one", () => {
    const got = pickDigitalRelease(
      [
        { iso_3166_1: "US", release_dates: [digital("not-a-date")] },
        { iso_3166_1: "GB", release_dates: [digital("2026-06-30")] },
      ],
      "CA",
    );
    expect(got?.toISOString().slice(0, 10)).toBe("2026-06-30");
  });
});
