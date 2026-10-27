import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const realDb = { ...(await import("@rawkoon/api/db")) };
const realIndexer = {
  ...(await import("@rawkoon/api/services/indexerManager")),
};
const realStrategy = {
  ...(await import("@rawkoon/api/services/indexerManager/searchStrategy")),
};
const realGrab = {
  ...(await import("@rawkoon/api/services/mediaGrabber/mediaGrabberGrab")),
};
const realAi = { ...(await import("@rawkoon/api/services/aiProvider/client")) };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: mock(async () => ({
        title: "Show Name",
        year: 2020,
        type: "show",
        tmdbId: 4242,
        searchTitle: null,
        originalTitle: null,
      })),
    },
    libraryEpisode: {
      findUnique: mock(async () => null),
      findMany: mock(async () => episodeRows),
    },
    qualityProfile: { findUnique: mock(async () => null) },
    grabBlocklist: { findMany: mock(async () => []) },
    downloadHistory: { findMany: mock(async () => inFlightRows) },
  },
}));

const release = (title: string) => ({
  guid: title,
  title,
  magnetUrl: `magnet:?xt=urn:btih:${title}`,
  downloadUrl: null,
  sizeBytes: 1e9,
  seeders: 10,
  indexer: "idx",
  rejected: false,
  freeleech: false,
  publishedAt: null,
});

let titles: string[] = [];
let inFlightRows: Array<{
  season: number | null;
  episodeId: number | null;
  releaseTitle: string;
  episode: { season: number } | null;
}> = [];
let episodeRows: Array<{
  season: number;
  status: string;
  _count: { files: number };
}> = [];
const tiered = mock(async (_adapter: unknown, _opts: unknown) => ({
  releases: titles.map(release),
  indexerWarnings: [],
}));
let freeTitles: string[] = [];
const freetext = mock(async () => ({
  releases: freeTitles.map(release),
  indexerWarnings: [],
}));
mock.module("@rawkoon/api/services/indexerManager", () => ({
  ...realIndexer,
  getActiveIndexerManager: async () => ({ search: freetext }),
}));
mock.module("@rawkoon/api/services/indexerManager/searchStrategy", () => ({
  ...realStrategy,
  tieredSearch: tiered,
}));

const grabRelease = mock(
  async (_o: unknown) =>
    ({ grabbed: true, releaseTitle: "x" }) as
      | { grabbed: true; releaseTitle: string }
      | { grabbed: false; reason: string },
);
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberGrab", () => ({
  grabRelease,
}));
mock.module("@rawkoon/api/services/aiProvider/client", () => ({
  ...realAi,
  pickReleaseWithAi: mock(async () => null),
  loadEnabledAiProviderConfig: mock(async () => null),
}));

const { searchAndGrabWithTitleFallback } = await import("./mediaGrabberSearch");

afterAll(() => {
  mock.module("@rawkoon/api/db", () => realDb);
  mock.module("@rawkoon/api/services/indexerManager", () => realIndexer);
  mock.module(
    "@rawkoon/api/services/indexerManager/searchStrategy",
    () => realStrategy,
  );
  mock.module(
    "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab",
    () => realGrab,
  );
  mock.module("@rawkoon/api/services/aiProvider/client", () => realAi);
});

const search = (completeSeasons: number[]) =>
  searchAndGrabWithTitleFallback({
    trigger: "scheduled",
    mediaId: 1,
    mediaType: "tv",
    titleBaseQueries: ["Show Name"],
    suffix: "",
    completeSeasons,
    qualityProfileId: null,
  });

beforeEach(() => {
  grabRelease.mockClear();
  tiered.mockClear();
  freetext.mockClear();
  freeTitles = [];
  episodeRows = [];
  inFlightRows = [];
});

describe("searchAndGrab for a complete-series pack", () => {
  it("runs the complete-series search with the TMDB id, not a freetext query", async () => {
    titles = [];
    await search([1, 2, 3]);
    expect(tiered.mock.calls[0]?.[1]).toMatchObject({
      query: "Show Name",
      tmdbId: 4242,
      complete: true,
      mediaType: "tv",
    });
    expect(freetext).not.toHaveBeenCalled();
  });

  it("grabs the pack covering every season, as a show-level grab", async () => {
    titles = [
      "Show.Name.S01E01.1080p.WEB-DL",
      "Show.Name.S01.1080p.WEB-DL",
      "Show.Name.S01-S02.1080p.WEB-DL",
      "Show.Name.S01-S03.COMPLETE.1080p.WEB-DL",
    ];
    const result = await search([1, 2, 3]);
    expect(result.grabbed).toBe(true);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    const call = grabRelease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.releaseTitle).toBe("Show.Name.S01-S03.COMPLETE.1080p.WEB-DL");
    expect(call.episodeId).toBeUndefined();
    expect(call.season).toBeUndefined();
  });

  it("accepts an unranged integrale", async () => {
    titles = ["Show.Name.Integrale.MULTi.1080p.WEB"];
    expect((await search([1, 2])).grabbed).toBe(true);
  });

  it("misses when no pack reaches every wanted season", async () => {
    titles = [
      "Show.Name.S01E01.1080p.WEB-DL",
      "Show.Name.S01.1080p.WEB-DL",
      "Show.Name.S01-S02.1080p.WEB-DL",
    ];
    const result = await search([1, 2, 3]);
    expect(result.grabbed).toBe(false);
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("ignores a pack for another show", async () => {
    titles = ["Other.Series.Integrale.MULTi.1080p.WEB"];
    expect((await search([1, 2])).grabbed).toBe(false);
    expect(grabRelease).not.toHaveBeenCalled();
  });
});

describe("searchAndGrab for one season", () => {
  const seasonSearch = (season: number) =>
    searchAndGrabWithTitleFallback({
      trigger: "scheduled",
      mediaId: 1,
      season,
      mediaType: "tv",
      titleBaseQueries: ["Show Name"],
      suffix: ` S0${season}`,
      qualityProfileId: null,
    });

  it("records a multi-season pack show-level instead of as that season's", async () => {
    freeTitles = ["Show.Name.S01-S03.COMPLETE.1080p.WEB-DL"];
    expect((await seasonSearch(2)).grabbed).toBe(true);
    const call = grabRelease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.season).toBeNull();
  });

  it("rejects a ranged pack that does not carry the season", async () => {
    freeTitles = ["Show.Name.S01-S02.1080p.WEB-DL"];
    expect((await seasonSearch(3)).grabbed).toBe(false);
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("keeps a plain season pack keyed to its season", async () => {
    freeTitles = ["Show.Name.S02.1080p.WEB-DL"];
    expect((await seasonSearch(2)).grabbed).toBe(true);
    const call = grabRelease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.season).toBe(2);
  });

  it.each([
    "Show.Name.S01-S03.COMPLETE.1080p.WEB-DL",
    "Show.Name.Integrale.MULTi.1080p.WEB",
  ])("rejects %s when a season it covers already has files", async (title) => {
    freeTitles = [title];
    episodeRows = [
      { season: 1, status: "downloaded", _count: { files: 1 } },
      { season: 2, status: "wanted", _count: { files: 0 } },
    ];
    expect((await seasonSearch(2)).grabbed).toBe(false);
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("accepts a ranged pack when only seasons outside it have files", async () => {
    freeTitles = ["Show.Name.S02-S03.1080p.WEB-DL"];
    episodeRows = [{ season: 1, status: "downloaded", _count: { files: 1 } }];
    expect((await seasonSearch(2)).grabbed).toBe(true);
  });

  it("rejects a multi-season pack when a covered season is mid-download", async () => {
    freeTitles = ["Show.Name.S01-S03.1080p.WEB-DL"];
    episodeRows = [{ season: 3, status: "downloading", _count: { files: 0 } }];
    expect((await seasonSearch(2)).grabbed).toBe(false);
  });

  it("sees a season pack in flight and falls to the single-season candidate", async () => {
    freeTitles = [
      "Show.Name.S01-S03.1080p.WEB-DL",
      "Show.Name.S01.1080p.WEB-DL",
    ];
    inFlightRows = [
      {
        season: 2,
        episodeId: null,
        releaseTitle: "Show.Name.S02.1080p.WEB-DL",
        episode: null,
      },
    ];
    expect((await seasonSearch(1)).grabbed).toBe(true);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    const call = grabRelease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.releaseTitle).toBe("Show.Name.S01.1080p.WEB-DL");
  });

  it("treats an in-flight complete pack as covering every season", async () => {
    freeTitles = ["Show.Name.S01-S03.1080p.WEB-DL"];
    inFlightRows = [
      {
        season: null,
        episodeId: null,
        releaseTitle: "Show.Name.Integrale.MULTi.1080p",
        episode: null,
      },
    ];
    expect((await seasonSearch(1)).grabbed).toBe(false);
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("tries the next candidate when a multi-season pack is refused as already active", async () => {
    freeTitles = [
      "Show.Name.S01-S03.1080p.WEB-DL",
      "Show.Name.S01.1080p.WEB-DL",
    ];
    grabRelease.mockImplementationOnce(async () => ({
      grabbed: false,
      reason: "A download is already active",
      refusal: "already_active" as const,
    }));
    expect((await seasonSearch(1)).grabbed).toBe(true);
    expect(grabRelease).toHaveBeenCalledTimes(2);
    expect(
      (grabRelease.mock.calls[1]?.[0] as Record<string, unknown>).releaseTitle,
    ).toBe("Show.Name.S01.1080p.WEB-DL");
  });

  it("still stops on an already-active refusal for a single-season candidate", async () => {
    freeTitles = ["Show.Name.S01.1080p.WEB-DL", "Show.Name.S01.720p.WEB-DL"];
    grabRelease.mockImplementationOnce(async () => ({
      grabbed: false,
      reason: "A download is already active",
      refusal: "already_active" as const,
    }));
    expect((await seasonSearch(1)).grabbed).toBe(false);
    expect(grabRelease).toHaveBeenCalledTimes(1);
  });
});
