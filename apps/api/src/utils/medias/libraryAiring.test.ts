import { describe, expect, it } from "bun:test";

import { airingStateOf } from "./libraryAiring";

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
