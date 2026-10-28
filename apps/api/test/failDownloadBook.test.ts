import { beforeEach, describe, expect, it, mock } from "bun:test";
import { recordingEffects } from "./mocks/outcomeEffects";

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      update: async () => ({}),
      count: async () => 0,
    },
    libraryMedia: {
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    libraryEpisode: {
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    bookEdition: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ bookId: 3 }),
    },
  },
}));
mock.module("@rawkoon/api/services/downloads/downloadJanitor", () => ({
  rejectRelease: async () => {},
  findBlockedFileInTorrent: async () => null,
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => null,
}));

const { failDownload } = await import(
  "@rawkoon/api/services/downloads/downloadOutcome"
);

let effects = recordingEffects();
beforeEach(() => {
  effects = recordingEffects();
});

describe("failDownload for a book grab", () => {
  it("tells admins, keyed to the grab, so its notice never stays at Grabbed", async () => {
    await failDownload(
      {
        id: 5,
        mediaId: null,
        episodeId: null,
        bookEditionId: 11,
        isUpgrade: true,
      },
      "torrent missing from download client",
      effects,
    );

    expect(effects.named("importFailed")).toEqual([
      [
        {
          downloadHistoryId: 5,
          reason: "torrent missing from download client",
          mediaId: null,
          episodeId: null,
          bookEditionId: 11,
          isUpgrade: true,
        },
      ],
    ]);
    expect(effects.named("downloadFailed")).toHaveLength(0);
  });

  it("sends the media notice, not the book one, for a media grab", async () => {
    await failDownload(
      { id: 6, mediaId: 42, episodeId: null },
      "stalled",
      effects,
    );

    expect(effects.named("downloadFailed")).toEqual([
      [
        {
          mediaId: 42,
          downloadHistoryId: 6,
          episodeId: null,
          reason: "stalled",
        },
      ],
    ]);
    expect(effects.named("importFailed")).toHaveLength(0);
  });
});
