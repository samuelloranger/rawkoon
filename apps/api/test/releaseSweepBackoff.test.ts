import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Past the fast misses, the release sweep searches a movie or episode about
// once a day instead of on every run, so the miss cap spans weeks, not days.
const realSearch = {
  ...(await import("@rawkoon/api/services/mediaGrabber/mediaGrabberSearch")),
};
const realActive = {
  ...(await import("@rawkoon/api/services/activeShowGrab")),
};
const realRefresh = {
  ...(await import("@rawkoon/api/services/libraryTmdbRefresh")),
};

const HOUR = 60 * 60 * 1000;
let attempts = 0;
let lastMissAt: Date | null = null;
let monitoredInSeason = 1;
const searches: { episodeId?: number; season?: number }[] = [];
const mediaUpdates: Record<string, unknown>[] = [];
const episodeUpdates: Record<string, unknown>[] = [];

mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberSearch", () => ({
  ...realSearch,
  searchAndGrabWithTitleFallback: async (a: {
    episodeId?: number;
    season?: number;
  }) => {
    searches.push({ episodeId: a.episodeId, season: a.season });
    return { grabbed: false, reason: "No matching releases found" };
  },
}));
mock.module("@rawkoon/api/services/activeShowGrab", () => ({
  ...realActive,
  activeShowGrabCovers: async () => new Map(),
}));
mock.module("@rawkoon/api/services/libraryTmdbRefresh", () => ({
  ...realRefresh,
  refreshLibraryMovieDigitalDate: async () => new Date("2020-01-01"),
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findMany: async () => [
        {
          id: 1,
          title: "Some Movie",
          searchTitle: null,
          originalTitle: null,
          year: 2020,
          qualityProfileId: null,
          searchAttempts: attempts,
          lastMissAt,
          digitalReleaseDate: new Date("2020-01-01"),
          digitalReleaseCheckedAt: new Date(),
        },
      ],
      update: async (a: { data: Record<string, unknown> }) => {
        if (!("lastSearchAt" in a.data)) mediaUpdates.push(a.data);
        return {};
      },
    },
    libraryEpisode: {
      findMany: async () => [
        {
          id: 10,
          mediaId: 2,
          season: 1,
          episode: 1,
          searchAttempts: attempts,
          lastMissAt,
          media: {
            id: 2,
            title: "Some Show",
            searchTitle: null,
            originalTitle: null,
            qualityProfileId: null,
          },
        },
      ],
      groupBy: async () => [
        { mediaId: 2, season: 1, _count: { _all: monitoredInSeason } },
      ],
      update: async (a: { data: Record<string, unknown> }) => {
        episodeUpdates.push(a.data);
        return {};
      },
    },
  },
}));

const { isGrabSearchDue } = await import(
  "@rawkoon/api/services/grab/grabAttempts"
);
const { checkMovieReleases } = await import(
  "@rawkoon/api/workers/checkMovieReleases"
);
const { checkEpisodeReleases } = await import(
  "@rawkoon/api/workers/checkEpisodeReleases"
);

afterAll(() => {
  mock.module(
    "@rawkoon/api/services/mediaGrabber/mediaGrabberSearch",
    () => realSearch,
  );
  mock.module("@rawkoon/api/services/activeShowGrab", () => realActive);
  mock.module("@rawkoon/api/services/libraryTmdbRefresh", () => realRefresh);
});

beforeEach(() => {
  searches.length = 0;
  mediaUpdates.length = 0;
  episodeUpdates.length = 0;
  monitoredInSeason = 1;
});

describe("isGrabSearchDue", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

  it("searches on every sweep during the fast misses", () => {
    expect(
      isGrabSearchDue({ searchAttempts: 11, lastMissAt: ago(1) }, now),
    ).toBe(true);
  });

  it("waits about a day after a miss once the fast misses are spent", () => {
    expect(
      isGrabSearchDue({ searchAttempts: 12, lastMissAt: ago(6) }, now),
    ).toBe(false);
    expect(
      isGrabSearchDue({ searchAttempts: 12, lastMissAt: ago(20) }, now),
    ).toBe(true);
  });

  it("searches when no miss time was recorded", () => {
    expect(isGrabSearchDue({ searchAttempts: 30, lastMissAt: null }, now)).toBe(
      true,
    );
  });
});

describe("release sweep backoff", () => {
  it("records the miss time with each counted miss", async () => {
    attempts = 0;
    lastMissAt = null;
    await checkMovieReleases();
    expect(mediaUpdates).toEqual([
      { searchAttempts: 1, lastMissAt: expect.any(Date) },
    ]);
  });

  for (const [label, total] of [
    ["season pack", 1],
    ["individual", 2],
  ] as const) {
    it(`skips a backing-off movie and episode (${label}) until a day has passed`, async () => {
      monitoredInSeason = total;
      attempts = 20;
      lastMissAt = new Date(Date.now() - 6 * HOUR);
      await checkMovieReleases();
      await checkEpisodeReleases();
      expect(searches).toHaveLength(0);

      lastMissAt = new Date(Date.now() - 21 * HOUR);
      await checkMovieReleases();
      await checkEpisodeReleases();
      expect(searches).toHaveLength(2);
    });
  }
});
