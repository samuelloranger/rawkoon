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

describe("library status as clients read it", () => {
  it("shows a downloaded airing show as its composite status in TMDB search badges", async () => {
    const map = await libraryEntriesForTmdbItems([
      { tmdb_id: 10, media_type: "tv" },
    ]);
    expect(map.get(libraryKey(10, "show"))).toEqual({
      id: 1,
      status: "returning",
    });
    expect(map.get(libraryKey(11, "show"))?.status).toBe("downloaded");
    expect(map.get(libraryKey(12, "movie"))?.status).toBe("wanted");
  });

  it("does the same for the discover deck lookup", async () => {
    const { libraryByKey } = await loadAllLibraryTmdbIds();
    expect(libraryByKey.get(libraryKey(10, "show"))?.status).toBe("returning");
    expect(libraryByKey.get(libraryKey(11, "show"))?.status).toBe("downloaded");
  });

  it("does the same for quick search and omits the TMDB status", async () => {
    const result = await searchLibraryMedias("a", 10);
    expect(result.map((r) => r.status)).toEqual([
      "returning",
      "downloaded",
      "wanted",
    ]);
    expect(result[0]).not.toHaveProperty("tmdbStatus");
  });
});
