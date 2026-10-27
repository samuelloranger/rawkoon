import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// A space refusal must leave the item wanted: no attempt bump, no skip, no
// notification. Any other failure still counts as an attempt.
const realSearch = {
  ...(await import("@rawkoon/api/services/mediaGrabber/mediaGrabberSearch")),
};
const realNotify = {
  ...(await import("@rawkoon/api/workers/notifyLibraryGrabSkipped")),
};
const realRefresh = {
  ...(await import("@rawkoon/api/services/libraryTmdbRefresh")),
};

// 1 = the lone wanted episode is a whole season (pack path); 2 = individual path.
let monitoredTotal = 1;
let grabResult: {
  grabbed: false;
  reason: string;
  refusal?: "no_space" | "show_grab_active";
};
let packedMediaIds: number[] = [];
let packedTitle = "Some.Show.Integrale.MULTi.1080p";
let searchCalls = 0;
const mediaUpdates: Record<string, unknown>[] = [];
const episodeUpdates: Record<string, unknown>[] = [];
const notifications: unknown[] = [];

const SPACE =
  "Not enough free space: needs 50.0 GB, 5.0 GB free, keeping 10 GB";

mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberSearch", () => ({
  ...realSearch,
  searchAndGrabWithTitleFallback: async () => {
    searchCalls++;
    return grabResult;
  },
}));
mock.module("@rawkoon/api/workers/notifyLibraryGrabSkipped", () => ({
  ...realNotify,
  notifyAdminsLibraryGrabSkipped: async (a: unknown) => {
    notifications.push(a);
  },
}));
mock.module("@rawkoon/api/services/libraryTmdbRefresh", () => ({
  ...realRefresh,
  refreshLibraryMovieDigitalDate: async () => new Date("2020-01-01"),
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findMany: async () =>
        packedMediaIds.map((mediaId) => ({
          mediaId,
          releaseTitle: packedTitle,
        })),
    },
    libraryMedia: {
      findMany: async () => [
        {
          id: 1,
          title: "Some Movie",
          searchTitle: null,
          originalTitle: null,
          year: 2020,
          qualityProfileId: null,
          searchAttempts: 39,
          digitalReleaseDate: new Date("2020-01-01"),
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
          searchAttempts: 39,
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
        { mediaId: 2, season: 1, _count: { _all: monitoredTotal } },
      ],
      update: async (a: { data: Record<string, unknown> }) => {
        episodeUpdates.push(a.data);
        return {};
      },
    },
  },
}));

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
  mock.module(
    "@rawkoon/api/workers/notifyLibraryGrabSkipped",
    () => realNotify,
  );
  mock.module("@rawkoon/api/services/libraryTmdbRefresh", () => realRefresh);
});

beforeEach(() => {
  packedMediaIds = [];
  packedTitle = "Some.Show.Integrale.MULTi.1080p";
  searchCalls = 0;
  mediaUpdates.length = 0;
  episodeUpdates.length = 0;
  notifications.length = 0;
});

describe("cron release checks on a space refusal", () => {
  it("movie: leaves the item untouched", async () => {
    grabResult = { grabbed: false, reason: SPACE, refusal: "no_space" };
    await checkMovieReleases();
    expect(mediaUpdates).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });

  it("movie: still counts and skips on any other failure", async () => {
    grabResult = { grabbed: false, reason: "No matching releases found" };
    await checkMovieReleases();
    expect(mediaUpdates).toEqual([
      { searchAttempts: 40, lastMissAt: expect.any(Date), status: "skipped" },
    ]);
    expect(notifications).toHaveLength(1);
  });

  for (const [label, total] of [
    ["season pack", 1],
    ["individual", 2],
  ] as const) {
    it(`episode (${label}): leaves the episode untouched`, async () => {
      monitoredTotal = total;
      grabResult = { grabbed: false, reason: SPACE, refusal: "no_space" };
      await checkEpisodeReleases();
      expect(episodeUpdates).toHaveLength(0);
      expect(notifications).toHaveLength(0);
    });

    it(`episode (${label}): still counts and skips on any other failure`, async () => {
      monitoredTotal = total;
      grabResult = { grabbed: false, reason: "No matching releases found" };
      await checkEpisodeReleases();
      expect(episodeUpdates).toEqual([
        { searchAttempts: 40, lastMissAt: expect.any(Date), status: "skipped" },
      ]);
      expect(notifications).toHaveLength(1);
    });
  }
});

describe("episode check while a complete-series pack downloads", () => {
  it("leaves the show's wanted episodes alone, with no search and no miss", async () => {
    packedMediaIds = [2];
    monitoredTotal = 1;
    grabResult = { grabbed: false, reason: "No matching releases found" };
    await checkEpisodeReleases();
    expect(searchCalls).toBe(0);
    expect(episodeUpdates).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });

  it("still searches shows without one", async () => {
    packedMediaIds = [99];
    monitoredTotal = 1;
    grabResult = { grabbed: false, reason: "No matching releases found" };
    await checkEpisodeReleases();
    expect(searchCalls).toBe(1);
  });
});

describe("episode check scope of a show-level pack", () => {
  it("only stands down for the seasons a ranged pack names", async () => {
    packedMediaIds = [2];
    monitoredTotal = 1;
    grabResult = { grabbed: false, reason: "No matching releases found" };

    packedTitle = "Some.Show.S01-S03.COMPLETE.1080p";
    await checkEpisodeReleases();
    expect(searchCalls).toBe(0);

    // Season 1 is outside S02-S05, so its episode is still searched.
    packedTitle = "Some.Show.S02-S05.COMPLETE.1080p";
    await checkEpisodeReleases();
    expect(searchCalls).toBe(1);
  });

  it("counts no miss when the grab is refused for a show-level pack", async () => {
    monitoredTotal = 2;
    grabResult = {
      grabbed: false,
      reason: "A complete-series download is already active",
      refusal: "show_grab_active",
    };
    await checkEpisodeReleases();
    expect(episodeUpdates).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });
});
