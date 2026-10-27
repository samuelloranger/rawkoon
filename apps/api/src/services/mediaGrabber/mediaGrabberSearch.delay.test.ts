import { beforeEach, describe, expect, it, mock } from "bun:test";

let profile: Record<string, unknown> | null = null;
const pendingUpsert = mock(async (_a: unknown) => undefined);
const pendingDeleteMany = mock(async (_a: unknown) => undefined);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: mock(async () => ({
        title: "Show",
        year: 2020,
        type: "tv",
        searchTitle: null,
        originalTitle: null,
      })),
    },
    libraryEpisode: {
      findUnique: mock(async () => ({ season: 2, episode: 5 })),
    },
    qualityProfile: { findUnique: mock(async () => profile) },
    grabBlocklist: { findMany: mock(async () => []) },
    pendingRelease: {
      findMany: mock(async () => []),
      upsert: pendingUpsert,
      deleteMany: pendingDeleteMany,
    },
  },
}));

const recent = new Date(Date.now() - 5 * 60_000).toISOString();
const releaseAt = (res: number, publishedAt: string | null) => ({
  guid: `g${res}`,
  title: `Show.S02E05.${res}p.WEB-DL-GRP`,
  magnetUrl: `magnet:?xt=${res}`,
  downloadUrl: null,
  sizeBytes: 1e9,
  seeders: 10,
  indexer: "idx",
  rejected: false,
  freeleech: false,
  publishedAt,
});

let searchReleases = [releaseAt(720, recent)];
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

const { searchAndGrab } = await import("./mediaGrabberSearch");

const profileRow = (over: Record<string, unknown> = {}) => ({
  minResolution: 720,
  cutoffResolution: null,
  preferredSources: [],
  preferredCodecs: [],
  preferredLanguages: [],
  prioritizedTrackers: [],
  preferTrackerOverQuality: false,
  maxSizeGb: null,
  requireHdr: false,
  preferHdr: false,
  minSeeders: 0,
  customFormats: [],
  grabDelayMinutes: 60,
  bypassDelayIfCutoffMet: true,
  ...over,
});

const base = {
  mediaId: 1,
  episodeId: 7,
  mediaType: "tv" as const,
  searchQuery: "Show S02E05",
  qualityProfileId: 1,
};

beforeEach(() => {
  grabRelease.mockClear();
  pendingUpsert.mockClear();
  pendingDeleteMany.mockClear();
  profile = profileRow();
  searchReleases = [releaseAt(720, recent)];
});

describe("searchAndGrab grab delay", () => {
  it("holds a scheduled grab inside the window and stores it as pending", async () => {
    const r = await searchAndGrab({ ...base, trigger: "scheduled" });
    expect(r).toMatchObject({ grabbed: false, delayed: true });
    expect(grabRelease).not.toHaveBeenCalled();
    expect(pendingUpsert).toHaveBeenCalledTimes(1);
  });

  it("grabs at once when the profile delay is 0", async () => {
    profile = profileRow({ grabDelayMinutes: 0 });
    const r = await searchAndGrab({ ...base, trigger: "scheduled" });
    expect(r.grabbed).toBe(true);
    expect(pendingUpsert).not.toHaveBeenCalled();
    expect(pendingDeleteMany).not.toHaveBeenCalled();
  });

  it("never delays a manual search", async () => {
    const r = await searchAndGrab({ ...base, trigger: "manual_search" });
    expect(r.grabbed).toBe(true);
    expect(pendingUpsert).not.toHaveBeenCalled();
  });

  it("never delays an upgrade search", async () => {
    const r = await searchAndGrab({
      ...base,
      trigger: "scheduled",
      isUpgrade: true,
    });
    expect(r.grabbed).toBe(true);
  });

  it("bypasses the delay when the release meets the cutoff", async () => {
    profile = profileRow({ cutoffResolution: 720 });
    const r = await searchAndGrab({ ...base, trigger: "scheduled" });
    expect(r.grabbed).toBe(true);
    expect(pendingUpsert).not.toHaveBeenCalled();
  });

  it("grabs once the release is older than the window", async () => {
    searchReleases = [
      releaseAt(720, new Date(Date.now() - 120 * 60_000).toISOString()),
    ];
    const r = await searchAndGrab({ ...base, trigger: "scheduled" });
    expect(r.grabbed).toBe(true);
    expect(pendingDeleteMany).toHaveBeenCalled();
  });
});
