import { describe, expect, it } from "bun:test";
import { resolveDefaultQualityProfileId } from "../src/lib/defaultQualityProfile";

describe("resolveDefaultQualityProfileId", () => {
  const settings = {
    defaultMovieQualityProfileId: 10,
    defaultShowQualityProfileId: 20,
  };

  it("uses the movie default for a movie", () => {
    expect(resolveDefaultQualityProfileId("movie", settings)).toBe(10);
  });

  it("uses the show default for a show", () => {
    expect(resolveDefaultQualityProfileId("show", settings)).toBe(20);
  });

  it("keeps the two defaults independent", () => {
    const movieOnly = {
      defaultMovieQualityProfileId: 10,
      defaultShowQualityProfileId: null,
    };
    expect(resolveDefaultQualityProfileId("movie", movieOnly)).toBe(10);
    expect(resolveDefaultQualityProfileId("show", movieOnly)).toBeNull();
  });

  it("returns null when the matching default is unset", () => {
    const none = {
      defaultMovieQualityProfileId: null,
      defaultShowQualityProfileId: null,
    };
    expect(resolveDefaultQualityProfileId("movie", none)).toBeNull();
    expect(resolveDefaultQualityProfileId("show", none)).toBeNull();
  });

  it("returns null when there are no media settings at all", () => {
    expect(resolveDefaultQualityProfileId("movie", null)).toBeNull();
    expect(resolveDefaultQualityProfileId("show", undefined)).toBeNull();
  });
});
