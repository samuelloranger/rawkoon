import { describe, expect, it, mock } from "bun:test";

const groupBy = mock(async (args: { by: string[] }) =>
  args.by.includes("status")
    ? [
        { type: "movie", status: "downloaded", tmdbStatus: null, _count: 4 },
        { type: "movie", status: "wanted", tmdbStatus: null, _count: 2 },
        { type: "show", status: "downloaded", tmdbStatus: "Ended", _count: 3 },
        {
          type: "show",
          status: "downloaded",
          tmdbStatus: "Returning Series",
          _count: 5,
        },
        {
          type: "show",
          status: "downloaded",
          tmdbStatus: "In Production",
          _count: 1,
        },
        {
          type: "show",
          status: "downloaded",
          tmdbStatus: "Returning Series",
          _count: 0,
        },
        {
          type: "show",
          status: "wanted",
          tmdbStatus: "Returning Series",
          _count: 6,
        },
      ]
    : [{ tmdbStatus: "Returning Series", _count: 11 }],
);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { groupBy },
    mediaSettings: { findUnique: async () => null },
    $queryRaw: async () => [],
  },
}));

const { getLibraryStatsWithDisk } = await import("./libraryStatsQueries");

describe("getLibraryStatsWithDisk", () => {
  it("reports the status clients read, not the stored one", async () => {
    const stats = await getLibraryStatsWithDisk();
    const byKey = Object.fromEntries(
      stats.counts_by_status_type.map((r) => [
        `${r.type}:${r.status}`,
        r.count,
      ]),
    );
    expect(byKey).toEqual({
      "movie:downloaded": 4,
      "movie:wanted": 2,
      "show:downloaded": 3,
      "show:returning": 5,
      "show:in_production": 1,
      "show:wanted": 6,
    });
  });

  it("keeps airing shows out of the downloaded total, as before", async () => {
    const stats = await getLibraryStatsWithDisk();
    expect(stats.downloaded).toBe(7);
    expect(stats.wanted).toBe(8);
    expect(stats.total_movies).toBe(6);
    expect(stats.total_shows).toBe(15);
    expect(stats.returning_series).toBe(11);
  });
});
