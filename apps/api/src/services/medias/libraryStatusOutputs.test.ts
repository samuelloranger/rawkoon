import { describe, expect, it, mock } from "bun:test";

const rows = [
  {
    id: 1,
    tmdbId: 10,
    type: "show",
    title: "Airing",
    year: 2024,
    status: "downloaded",
    tmdbStatus: "Returning Series",
  },
  {
    id: 2,
    tmdbId: 11,
    type: "show",
    title: "Finished",
    year: 2010,
    status: "downloaded",
    tmdbStatus: "Ended",
  },
  {
    id: 3,
    tmdbId: 12,
    type: "movie",
    title: "Film",
    year: 2020,
    status: "wanted",
    tmdbStatus: null,
  },
];

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { findMany: mock(async () => rows) } },
}));

const { libraryEntriesForTmdbItems, loadAllLibraryTmdbIds, libraryKey } =
  await import("./tmdbLibraryLookup");
const { searchLibraryMedias } = await import("./quickSearch");

describe("library status and airing state outputs", () => {
  it("adds the airing state beside the stored status on TMDB search badges", async () => {
    const map = await libraryEntriesForTmdbItems([
      { tmdb_id: 10, media_type: "tv" },
    ]);
    expect(map.get(libraryKey(10, "show"))).toEqual({
      id: 1,
      status: "downloaded",
      airingState: "returning",
    });
    expect(map.get(libraryKey(11, "show"))?.airingState).toBe("ended");
    expect(map.get(libraryKey(12, "movie"))).toEqual({
      id: 3,
      status: "wanted",
      airingState: null,
    });
  });

  it("does the same for the discover deck lookup", async () => {
    const { libraryByKey } = await loadAllLibraryTmdbIds();
    expect(libraryByKey.get(libraryKey(10, "show"))?.airingState).toBe(
      "returning",
    );
  });

  it("returns the stored status and the airing state from quick search, without the raw TMDB status", async () => {
    const result = await searchLibraryMedias("a", 10);
    expect(result.map((r) => [r.status, r.airing_state])).toEqual([
      ["downloaded", "returning"],
      ["downloaded", "ended"],
      ["wanted", null],
    ]);
    expect(result[0]).not.toHaveProperty("tmdbStatus");
  });
});
