import { beforeEach, describe, expect, it, mock } from "bun:test";

const addTorrent = mock(async () => ({ hash: "resolvedhash" }));
const downloadHistoryUpdate = mock(async () => ({}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: async () => ({ id: 1, type: "movie" }),
      update: async () => ({}),
    },
    libraryEpisode: { update: async () => ({}) },
    downloadHistory: {
      create: async () => ({ id: 123 }),
      update: downloadHistoryUpdate,
    },
  },
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  buildAdapter: (type: string) => ({ type }),
  resolveActiveAdapter: async () => ({
    adapter: {
      type: "transmission",
      addTorrent,
      listTorrents: async () => [],
      getTorrent: async () => null,
      pause: async () => {},
      resume: async () => {},
      remove: async () => {},
      testConnection: async () => ({ ok: true }),
    },
    label: "rawkoon",
  }),
}));
mock.module("@rawkoon/api/services/mediaGrabberHelpers", () => ({
  checkBlocklist: async () => null,
  infoHashFromTorrentBuffer: () => null,
  prowlarrHeadersForTorrentUrl: async () => ({}),
  qbCategoryForLibraryType: () => "rawkoon-movies",
  qualityJsonValue: () => null,
}));
mock.module("@rawkoon/api/utils/activityLogs", () => ({
  logActivity: async () => {},
}));

describe("grabRelease via adapter", () => {
  beforeEach(() => {
    addTorrent.mockClear();
    downloadHistoryUpdate.mockClear();
  });

  it("adds a magnet with the download-history tag and stores returned hash", async () => {
    const { grabRelease } = await import(
      "@rawkoon/api/services/mediaGrabberGrab"
    );

    const result = await grabRelease({
      mediaId: 1,
      downloadUrl:
        "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
      releaseTitle: "Movie 2024 1080p",
    });

    expect(result).toEqual({
      grabbed: true,
      releaseTitle: "Movie 2024 1080p",
    });
    expect(addTorrent).toHaveBeenCalledTimes(1);
    expect(addTorrent.mock.calls[0]?.[0]).toMatchObject({
      tag: "rawkoon-dh-123",
      category: "rawkoon-movies",
      magnetOrUrl:
        "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    });
    expect(downloadHistoryUpdate).toHaveBeenCalledWith({
      where: { id: 123 },
      data: { torrentHash: "resolvedhash" },
    });
  });
});
