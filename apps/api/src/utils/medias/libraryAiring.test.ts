import { describe, expect, it } from "bun:test";

import { airingStateOf, isAiring, isAiringShow } from "./libraryAiring";

describe("isAiring", () => {
  it.each([
    ["Returning Series", true],
    ["In Production", true],
    ["Planned", true],
    ["Ended", false],
    ["Canceled", false],
    ["Pilot", false],
    ["returning", false],
    ["toString", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("%s -> %p", (tmdbStatus, expected) => {
    expect(isAiring(tmdbStatus)).toBe(expected);
  });
});

describe("isAiringShow", () => {
  it("is true only for a show with an airing TMDB status", () => {
    expect(isAiringShow({ type: "show", tmdbStatus: "Returning Series" })).toBe(
      true,
    );
    expect(isAiringShow({ type: "show", tmdbStatus: "Ended" })).toBe(false);
    expect(isAiringShow({ type: "show", tmdbStatus: null })).toBe(false);
    expect(
      isAiringShow({ type: "movie", tmdbStatus: "Returning Series" }),
    ).toBe(false);
  });
});

describe("airingStateOf", () => {
  it.each([
    ["Returning Series", "returning"],
    ["In Production", "in_production"],
    ["Planned", "planned"],
    ["Ended", "ended"],
    ["Canceled", "ended"],
  ])("maps TMDB %s to %s for a show", (tmdbStatus, expected) => {
    expect(airingStateOf({ type: "show", tmdbStatus }) as string | null).toBe(
      expected,
    );
  });

  it.each<string | null | undefined>([
    null,
    undefined,
    "Pilot",
    "returning",
    "toString",
    "",
  ])("is null for a show with TMDB status %p", (tmdbStatus) => {
    expect(airingStateOf({ type: "show", tmdbStatus })).toBeNull();
  });

  it("is null for a movie, whatever its TMDB status", () => {
    expect(
      airingStateOf({ type: "movie", tmdbStatus: "Returning Series" }),
    ).toBeNull();
  });
});
