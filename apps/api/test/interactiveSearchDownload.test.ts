import { beforeEach, describe, expect, it, mock } from "bun:test";
import { dbModule } from "./mocks/prisma";

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
  media: { id: 42, type: "movie" } as { id: number; type: string } | null,
  episode: null as { mediaId: number } | null,
  showEpisodes: [] as Array<{ id: number; season: number; episode: number }>,
};

mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      libraryMedia: {
        findUnique: async () => state.media,
      },
      libraryEpisode: {
        findUnique: async () => state.episode,
        findFirst: async ({ where }: { where: { id: number } }) =>
          state.showEpisodes.find((e) => e.id === where.id) ?? null,
        findMany: async () => state.showEpisodes,
      },
    },
  }),
);

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

mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberGrab", () => ({
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
  if (payload instanceof Response) {
    return { status: payload.status, json: await payload.json() };
  }
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
    state.media = { id: 42, type: "movie" };
    state.episode = null;
    state.showEpisodes = [];
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

  it("records a show's episode release under its episode, not the searched season", async () => {
    state.media = { id: 42, type: "show" };
    state.showEpisodes = [
      { id: 501, season: 5, episode: 2 },
      { id: 502, season: 5, episode: 3 },
    ];
    adapterGrab.mockImplementation(async () => ({
      success: true,
      downloadUrl: "https://indexer.example/dl.torrent",
      title: "Show.S05E03.1080p.WEB",
      indexer: "tracker-a",
    }));
    const res = await post({ token: "abc", library_media_id: 42, season: 5 });
    expect(res.status).toBe(200);
    expect(grabRelease).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 42, episodeId: 502, season: 5 }),
    );
  });

  it("rejects a show's episode release that is not in the library", async () => {
    state.media = { id: 42, type: "show" };
    state.showEpisodes = [{ id: 501, season: 5, episode: 2 }];
    adapterGrab.mockImplementation(async () => ({
      success: true,
      downloadUrl: "https://indexer.example/dl.torrent",
      title: "Show.S05E03.1080p.WEB",
      indexer: "tracker-a",
    }));
    const res = await post({
      token: "abc",
      library_media_id: 42,
      episode_id: 501,
    });
    expect(res.status).toBe(400);
    expect(grabRelease).not.toHaveBeenCalled();
  });
});
