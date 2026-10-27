import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// A future digital date is re-checked once its last TMDB check is stale, so a
// date moved earlier is not missed; a recent check costs no TMDB call.
const realSearch = {
  ...(await import("@rawkoon/api/services/mediaGrabber/mediaGrabberSearch")),
};
const realRefresh = {
  ...(await import("@rawkoon/api/services/libraryTmdbRefresh")),
};

const HOUR = 60 * 60 * 1000;
const future = new Date(Date.now() + 30 * 24 * HOUR);
let checkedAt: Date | null = null;
let refreshedTo: Date | null = future;
let refreshCalls = 0;
let searchCalls = 0;

mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberSearch", () => ({
  ...realSearch,
  searchAndGrabWithTitleFallback: async () => {
    searchCalls++;
    return { grabbed: true };
  },
}));
mock.module("@rawkoon/api/services/libraryTmdbRefresh", () => ({
  ...realRefresh,
  refreshLibraryMovieDigitalDate: async () => {
    refreshCalls++;
    return refreshedTo;
  },
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
          year: 2026,
          qualityProfileId: null,
          searchAttempts: 0,
          digitalReleaseDate: future,
          digitalReleaseCheckedAt: checkedAt,
        },
      ],
      update: async () => ({}),
    },
  },
}));

const { checkMovieReleases } = await import(
  "@rawkoon/api/workers/checkMovieReleases"
);

afterAll(() => {
  mock.module(
    "@rawkoon/api/services/mediaGrabber/mediaGrabberSearch",
    () => realSearch,
  );
  mock.module("@rawkoon/api/services/libraryTmdbRefresh", () => realRefresh);
});

beforeEach(() => {
  refreshCalls = 0;
  searchCalls = 0;
  refreshedTo = future;
});

describe("checkMovieReleases on a future digital date", () => {
  it("leaves a recently checked date alone", async () => {
    checkedAt = new Date(Date.now() - HOUR);
    await checkMovieReleases();
    expect(refreshCalls).toBe(0);
    expect(searchCalls).toBe(0);
  });

  it("re-checks a stale or never-checked date", async () => {
    for (const at of [new Date(Date.now() - 21 * HOUR), null]) {
      checkedAt = at;
      refreshCalls = 0;
      await checkMovieReleases();
      expect(refreshCalls).toBe(1);
      expect(searchCalls).toBe(0);
    }
  });

  it("searches right away when the re-check moved the date to today or earlier", async () => {
    checkedAt = null;
    refreshedTo = new Date("2020-01-01");
    await checkMovieReleases();
    expect(refreshCalls).toBe(1);
    expect(searchCalls).toBe(1);
  });
});
