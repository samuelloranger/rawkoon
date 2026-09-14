import { describe, expect, it } from "bun:test";
import { parseExternalIds } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";

describe("parseExternalIds", () => {
  it("keeps the tvdb id", () => {
    expect(
      parseExternalIds({ imdb_id: "tt0903747", tvdb_id: 81189 })?.tvdb_id,
    ).toBe(81189);
  });

  it("is null when the id is absent, null, or unparseable", () => {
    expect(parseExternalIds({ imdb_id: "tt1" })?.tvdb_id).toBeNull();
    expect(parseExternalIds({ tvdb_id: null })?.tvdb_id).toBeNull();
    expect(parseExternalIds({ tvdb_id: "not-a-number" })?.tvdb_id).toBeNull();
  });

  // Shared toNumberOrNull parses numeric strings; every other field here
  // relies on that, so tvdb_id follows the same contract.
  it("parses a numeric string id", () => {
    expect(parseExternalIds({ tvdb_id: "81189" })?.tvdb_id).toBe(81189);
  });

  it("still returns null for a non-object", () => {
    expect(parseExternalIds(null)).toBeNull();
  });
});
