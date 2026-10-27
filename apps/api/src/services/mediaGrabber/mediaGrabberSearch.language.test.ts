import { beforeEach, describe, expect, it, mock } from "bun:test";

let profile: Record<string, unknown> | null = null;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: mock(async () => ({
        title: "Film",
        year: 2020,
        type: "movie",
        searchTitle: null,
        originalTitle: null,
      })),
    },
    libraryEpisode: { findUnique: mock(async () => null) },
    qualityProfile: { findUnique: mock(async () => profile) },
    grabBlocklist: { findMany: mock(async () => []) },
  },
}));

const releaseNamed = (tags: string) => ({
  guid: tags,
  title: `Film.2020.${tags}.1080p.WEB.H264-GRP`,
  magnetUrl: `magnet:?xt=${tags}`,
  downloadUrl: null,
  sizeBytes: 1e9,
  seeders: 10,
  indexer: "idx",
  rejected: false,
  freeleech: false,
  publishedAt: null,
});

let searchReleases = [releaseNamed("MULTi.VFF")];
mock.module("@rawkoon/api/services/indexerManager", () => ({
  getActiveIndexerManager: async () => ({
    search: async () => ({ releases: searchReleases }),
  }),
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
  pickReleaseWithAi: mock(async () => null),
  loadEnabledAiProviderConfig: mock(async () => null),
}));

const { searchAndGrab, searchAndGrabWithTitleFallback } = await import(
  "./mediaGrabberSearch"
);

const profileRow = (preferredLanguages: string[]) => ({
  minResolution: 720,
  cutoffResolution: null,
  preferredSources: [],
  preferredCodecs: [],
  preferredLanguages,
  prioritizedTrackers: [],
  preferTrackerOverQuality: false,
  maxSizeGb: null,
  requireHdr: false,
  preferHdr: false,
  minSeeders: 0,
  customFormats: [],
});

const base = {
  mediaId: 1,
  mediaType: "movie" as const,
  searchQuery: "Film 2020",
  qualityProfileId: 1,
};

beforeEach(() => {
  grabRelease.mockClear();
  profile = profileRow(["VFQ", "VF2"]);
  searchReleases = [
    releaseNamed("MULTi.VFF"),
    releaseNamed("TRUEFRENCH"),
    releaseNamed("MULTi.VFI"),
    releaseNamed("MULTi.VFF.2"),
  ];
});

describe("searchAndGrab language fallback", () => {
  it("never grabs a fallback release and explains the miss", async () => {
    const res = await searchAndGrab(base);
    expect(grabRelease).not.toHaveBeenCalled();
    expect(res).toEqual({
      grabbed: false,
      reason:
        "No VFQ or VF2 release yet; 4 in other French versions (VFF 3, VFI 1)",
      languageFallback: {
        missing: ["VFQ", "VF2"],
        counts: { VFF: 3, VFI: 1 },
      },
    });
  });

  it("keeps the plain reason when nothing is in the language family", async () => {
    searchReleases = [releaseNamed("GERMAN")];
    expect(await searchAndGrab(base)).toEqual({
      grabbed: false,
      reason: "No matching releases found",
    });
  });

  it("still grabs a preferred-language release when fallbacks exist", async () => {
    searchReleases = [releaseNamed("MULTi.VFF"), releaseNamed("MULTi.VFQ")];
    const res = await searchAndGrab(base);
    expect(res.grabbed).toBe(true);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    expect(grabRelease.mock.calls[0]![0]).toMatchObject({
      releaseTitle: expect.stringContaining("VFQ"),
    });
  });

  it("title fallback keeps trying titles and returns the summary", async () => {
    const res = await searchAndGrabWithTitleFallback({
      mediaId: 1,
      mediaType: "movie",
      titleBaseQueries: ["Film", "Film Alt"],
      suffix: " 2020",
      qualityProfileId: 1,
    });
    expect(res.grabbed).toBe(false);
    expect(!res.grabbed && res.languageFallback?.counts).toEqual({
      VFF: 3,
      VFI: 1,
    });
  });
});
