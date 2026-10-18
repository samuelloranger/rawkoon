import { describe, it, expect } from "bun:test";
import { pickDigitalRelease } from "@rawkoon/api/utils/medias/libraryHelpers";

// type 4 = digital release. type 3 = theatrical.
const digital = (date: string) => ({ type: 4, release_date: date });
const theatrical = (date: string) => ({ type: 3, release_date: date });
const physical = (date: string) => ({ type: 5, release_date: date });
const NOW = new Date("2026-10-18T12:00:00.000Z");

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
      NOW,
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

  it("falls back to a physical release when no country lists a digital one", () => {
    const got = pickDigitalRelease(
      [
        { iso_3166_1: "CA", release_dates: [theatrical("2026-05-13")] },
        { iso_3166_1: "US", release_dates: [physical("2026-08-04")] },
      ],
      "CA",
      NOW,
    );
    expect(got?.toISOString().slice(0, 10)).toBe("2026-08-04");
  });

  it("keeps a digital release elsewhere ahead of a physical one in the region", () => {
    const got = pickDigitalRelease(
      [
        { iso_3166_1: "CA", release_dates: [physical("2026-08-04")] },
        { iso_3166_1: "US", release_dates: [digital("2026-07-20")] },
      ],
      "CA",
      NOW,
    );
    expect(got?.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("treats a title first released over a year ago as out, from its first release", () => {
    const got = pickDigitalRelease(
      [
        { iso_3166_1: "FR", release_dates: [theatrical("1994-10-26")] },
        { iso_3166_1: "US", release_dates: [theatrical("1994-09-23")] },
      ],
      "CA",
      NOW,
    );
    expect(got?.toISOString().slice(0, 10)).toBe("1994-09-23");
  });

  it("does not guess a date for a recent title with only theatrical releases", () => {
    const got = pickDigitalRelease(
      [{ iso_3166_1: "US", release_dates: [theatrical("2025-11-01")] }],
      "CA",
      NOW,
    );
    expect(got).toBeNull();
  });

  it("does not treat an old premiere as out while a wider release is still ahead", () => {
    const got = pickDigitalRelease(
      [
        {
          iso_3166_1: "US",
          release_dates: [
            { type: 1, release_date: "2025-09-01" },
            theatrical("2026-12-01"),
          ],
        },
      ],
      "CA",
      NOW,
    );
    expect(got).toBeNull();
  });

  it("dates an old title from its first wide release, not its festival premiere", () => {
    const got = pickDigitalRelease(
      [
        {
          iso_3166_1: "US",
          release_dates: [
            { type: 1, release_date: "2023-01-20" },
            theatrical("2024-03-08"),
          ],
        },
      ],
      "CA",
      NOW,
    );
    expect(got?.toISOString().slice(0, 10)).toBe("2024-03-08");
  });
});
