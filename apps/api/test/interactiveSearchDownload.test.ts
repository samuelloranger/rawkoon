import { beforeEach, describe, expect, it, mock } from "bun:test";

const grabRelease = mock(async () => ({
  grabbed: true as const,
  releaseTitle: "Movie.2024.1080p",
}));

const adapterGrab = mock(async () => ({
  success: true,
  downloadUrl: "https://indexer.example/dl.torrent",
  title: "Movie.2024.1080p",
  indexer: "tracker-a",
}));

const state = {
  media: { id: 42 } as { id: number } | null,
  episode: null as { mediaId: number } | null,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: async () => state.media,
    },
    libraryEpisode: {
      findUnique: async () => state.episode,
    },
  },
}));

mock.module("@rawkoon/api/services/indexerManager", () => ({
  getActiveIndexerManager: async () => ({
    name: "jackett",
    grabRelease: adapterGrab,
    storeReleaseToken: () => "tok",
    search: async () => ({ releases: [], indexerWarnings: [] }),
    getIndexers: async () => [],
    fetchRss: async () => [],
  }),
  tieredSearch: async () => ({ releases: [], indexerWarnings: [] }),
}));

mock.module("@rawkoon/api/services/mediaGrabberGrab", () => ({
  grabRelease,
}));

const { downloadInteractiveSearchRelease } = await import(
  "@rawkoon/api/routes/medias/search/index"
);

async function post(body: {
  token: string;
  library_media_id?: number;
  episode_id?: number;
  season?: number;
  is_upgrade?: boolean;
}) {
  const set: { status?: number | string } = {};
  const payload = await downloadInteractiveSearchRelease(body, set);
  return { status: (set.status as number | undefined) ?? 200, json: payload };
}

describe("downloadInteractiveSearchRelease", () => {
  beforeEach(() => {
    grabRelease.mockClear();
    adapterGrab.mockClear();
    adapterGrab.mockImplementation(async () => ({
      success: true,
      downloadUrl: "https://indexer.example/dl.torrent",
      title: "Movie.2024.1080p",
      indexer: "tracker-a",
    }));
    grabRelease.mockImplementation(async () => ({
      grabbed: true as const,
      releaseTitle: "Movie.2024.1080p",
    }));
    state.media = { id: 42 };
    state.episode = null;
  });

  it("enqueues via grabRelease when a library item is present", async () => {
    const res = await post({ token: "abc", library_media_id: 42 });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      grabbed: true,
      release_title: "Movie.2024.1080p",
      service: "jackett",
    });
    expect(adapterGrab).toHaveBeenCalledWith("abc");
    expect(grabRelease).toHaveBeenCalledWith({
      mediaId: 42,
      episodeId: undefined,
      season: undefined,
      downloadUrl: "https://indexer.example/dl.torrent",
      releaseTitle: "Movie.2024.1080p",
      indexer: "tracker-a",
      isUpgrade: false,
    });
  });

  it("returns 409 when no library item is resolvable", async () => {
    const res = await post({ token: "abc" });
    expect(res.status).toBe(409);
    const json = res.json as { error: string };
    expect(json.error).toContain("library item");
    expect(adapterGrab).toHaveBeenCalledWith("abc");
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("returns 409 when the library id does not exist", async () => {
    state.media = null;
    const res = await post({ token: "abc", library_media_id: 99 });
    expect(res.status).toBe(409);
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("resolves the library item from episode_id", async () => {
    state.episode = { mediaId: 42 };
    const res = await post({ token: "abc", episode_id: 7 });
    expect(res.status).toBe(200);
    expect(grabRelease).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 42, episodeId: 7 }),
    );
  });
});
