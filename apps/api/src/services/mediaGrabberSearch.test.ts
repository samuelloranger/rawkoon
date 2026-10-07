import { describe, it, expect, mock, beforeEach } from "bun:test";

const findUniqueMedia = mock(async () => ({
  title: "Show",
  year: 2020,
  type: "tv",
  searchTitle: null,
  originalTitle: null,
}));
const findUniqueEpisode = mock(async () => ({ season: 2, episode: 5 }));
const findManyBlocklist = mock(async () => [] as { releaseTitle: string }[]);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique: findUniqueMedia },
    libraryEpisode: { findUnique: findUniqueEpisode },
    qualityProfile: { findUnique: mock(async () => null) },
    grabBlocklist: { findMany: findManyBlocklist },
  },
}));

const release = (n: number, seeders: number) => ({
  title: `Show.S02E05.${n}.1080p.WEB-DL-GRP`,
  magnetUrl: `magnet:?xt=${n}`,
  downloadUrl: null,
  sizeBytes: 1e9,
  seeders,
  indexer: "idx",
  rejected: false,
  freeleech: false,
});

let searchReleases = [release(1, 10), release(2, 50)];
mock.module("@rawkoon/api/services/indexerManager", () => ({
  getActiveIndexerManager: async () => ({
    search: async () => ({ releases: searchReleases }),
  }),
}));

const grabRelease = mock(
  async (_o: { releaseTitle: string; aiPicked?: boolean }) =>
    ({ grabbed: true }) as
      | { grabbed: true; releaseTitle?: string }
      | { grabbed: false; reason: string },
);
mock.module("@rawkoon/api/services/mediaGrabberGrab", () => ({ grabRelease }));

const aiConfig = { base_url: "http://x", model: "m" };
const pickReleaseWithAi = mock(
  async (..._a: unknown[]) => null as { release_key: string } | null,
);
const loadEnabledAiProviderConfig = mock(async () => aiConfig as unknown);
mock.module("@rawkoon/api/services/aiProvider/client", () => ({
  pickReleaseWithAi,
  loadEnabledAiProviderConfig,
}));

const { searchAndGrab } = await import("./mediaGrabberSearch");

const base = {
  mediaId: 1,
  episodeId: 7,
  mediaType: "tv" as const,
  searchQuery: "Show S02E05",
  qualityProfileId: null,
};

describe("searchAndGrab AI judge", () => {
  beforeEach(() => {
    grabRelease.mockClear();
    pickReleaseWithAi.mockClear();
    findManyBlocklist.mockClear();
    grabRelease.mockImplementation(async () => ({ grabbed: true }));
    searchReleases = [release(1, 10), release(2, 50)];
  });

  it("grabs the AI pick first with aiPicked and passes the ledger ctx", async () => {
    pickReleaseWithAi.mockImplementationOnce(async () => ({
      release_key: "1",
    }));
    await searchAndGrab({
      ...base,
      trigger: "scheduled",
      aiConfig: aiConfig as never,
    });
    expect(grabRelease.mock.calls[0]![0]).toMatchObject({
      releaseTitle: expect.stringContaining(".2."),
      aiPicked: true,
    });
    const [, media, list, ctx] = pickReleaseWithAi.mock.calls[0]! as never[];
    expect(ctx).toMatchObject({
      feature: "release_pick_search",
      trigger: "scheduled",
      mediaId: 1,
      classicTitle: expect.stringContaining("S02E05"),
    });
    expect(media).toMatchObject({ season: 2, episode: 5 });
    expect((list as { seeders: number }[]).map((r) => r.seeders)).toEqual([
      10, 50,
    ]);
  });

  it("grabs the picked row when two results share a download URL", async () => {
    searchReleases = [
      release(1, 10),
      { ...release(2, 50), magnetUrl: "magnet:?xt=1" },
    ];
    pickReleaseWithAi.mockImplementationOnce(async () => ({
      release_key: "1",
    }));
    await searchAndGrab({ ...base, aiConfig: aiConfig as never });
    expect(grabRelease.mock.calls[0]![0]).toMatchObject({
      releaseTitle: expect.stringContaining(".2."),
      aiPicked: true,
    });
  });

  it("keeps the classic path when the AI returns null", async () => {
    await searchAndGrab({ ...base, aiConfig: aiConfig as never });
    expect(grabRelease).toHaveBeenCalledTimes(1);
    expect(grabRelease.mock.calls[0]![0].aiPicked).toBe(false);
    expect(grabRelease.mock.calls[0]![0].releaseTitle).toContain(".1.");
  });

  it("does not call the AI with a single viable candidate", async () => {
    findManyBlocklist.mockImplementationOnce(async () => [
      { releaseTitle: release(1, 10).title },
    ]);
    await searchAndGrab({ ...base, aiConfig: aiConfig as never });
    expect(pickReleaseWithAi).not.toHaveBeenCalled();
  });

  it("falls back to classic order when the AI pick is blocklisted", async () => {
    pickReleaseWithAi.mockImplementationOnce(async () => ({
      release_key: "1",
    }));
    grabRelease.mockImplementationOnce(async () => ({
      grabbed: false,
      reason: "Blocklisted: hash",
    }));
    await searchAndGrab({ ...base, aiConfig: aiConfig as never });
    expect(grabRelease).toHaveBeenCalledTimes(2);
    expect(grabRelease.mock.calls[1]![0]).toMatchObject({ aiPicked: false });
    expect(grabRelease.mock.calls[1]![0].releaseTitle).toContain(".1.");
  });
});
