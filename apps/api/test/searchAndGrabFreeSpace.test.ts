import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { tmpdir } from "node:os";
import { dbModule } from "./mocks/prisma";
import { makeNotifyLibraryEventsMock } from "./mocks/notifyLibraryEvents";

// Real statfs on a real directory; sizes force each outcome.
const addedTorrents: { magnetOrUrl?: string }[] = [];
const blocklistWrites: unknown[] = [];

const realIndexerManager = {
  ...(await import("@rawkoon/api/services/indexerManager")),
};
const realAiClient = {
  ...(await import("@rawkoon/api/services/aiProvider/client")),
};
const realRegistry = {
  ...(await import("@rawkoon/api/services/downloadClient/registry")),
};

const release = (n: number, sizeBytes: number) => ({
  guid: `g${n}`,
  title: `Some Movie 2026 1080p Release${n}`,
  indexer: "idx",
  indexerId: 1,
  languages: [],
  protocol: "torrent",
  sizeBytes,
  age: 1,
  seeders: 10,
  leechers: 0,
  rejected: false,
  rejections: [],
  infoUrl: null,
  downloadUrl: null,
  magnetUrl: `magnet:?xt=urn:btih:${String(n).repeat(40).slice(0, 40)}`,
  infoHash: null,
  tmdbId: null,
  freeleech: false,
});

let releases: ReturnType<typeof release>[] = [];

mock.module("@rawkoon/api/services/indexerManager", () => ({
  ...realIndexerManager,
  getActiveIndexerManager: async () => ({
    search: async () => ({ releases }),
  }),
}));
mock.module("@rawkoon/api/services/aiProvider/client", () => ({
  ...realAiClient,
  loadEnabledAiProviderConfig: async () => null,
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  ...realRegistry,
  resolveActiveAdapter: async () => ({
    label: "qbittorrent",
    savePath: "/downloads",
    adapter: {
      type: "qbittorrent",
      addTorrent: async (a: { magnetOrUrl?: string }) => {
        addedTorrents.push(a);
        return { hash: "deadbeef" };
      },
    },
  }),
}));
mock.module("@rawkoon/api/workers/notifyLibraryEvents", () =>
  makeNotifyLibraryEventsMock(),
);
mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      mediaSettings: {
        findUnique: async () => ({
          minFreeSpaceGb: 1,
          downloadsPath: tmpdir(),
          moviesLibraryPath: null,
          showsLibraryPath: null,
        }),
      },
      libraryMedia: {
        findUnique: async () => ({
          id: 42,
          type: "movie",
          title: "Some Movie",
          year: 2026,
          searchTitle: null,
          originalTitle: null,
        }),
        update: async () => ({}),
      },
      libraryEpisode: {
        findUnique: async () => null,
        update: async () => ({}),
      },
      qualityProfile: { findUnique: async () => null },
      grabBlocklist: {
        findMany: async () => [],
        findFirst: async () => null,
        create: async (a: unknown) => {
          blocklistWrites.push(a);
          return {};
        },
      },
      downloadHistory: {
        findFirst: async () => null,
        create: async () => ({ id: 9001 }),
        update: async () => ({ id: 9001 }),
      },
      activityLog: { create: async () => ({ id: 1 }) },
    },
  }),
);

const { searchAndGrab } = await import(
  "@rawkoon/api/services/mediaGrabber/mediaGrabberSearch"
);

afterAll(() => {
  mock.module("@rawkoon/api/services/indexerManager", () => realIndexerManager);
  mock.module("@rawkoon/api/services/aiProvider/client", () => realAiClient);
  mock.module(
    "@rawkoon/api/services/downloadClient/registry",
    () => realRegistry,
  );
});

const search = () =>
  searchAndGrab({
    mediaId: 42,
    mediaType: "movie",
    searchQuery: "Some Movie 2026",
    qualityProfileId: null,
  });

beforeEach(() => {
  addedTorrents.length = 0;
  blocklistWrites.length = 0;
});

describe("searchAndGrab free-space handling", () => {
  it("skips a space-refused large candidate and grabs a smaller one", async () => {
    releases = [release(1, 1024 ** 6), release(2, 1024)];
    const r = await search();
    expect(r.grabbed).toBe(true);
    expect(r.grabbed && r.releaseTitle).toContain("Release2");
    expect(addedTorrents).toHaveLength(1);
    expect(blocklistWrites).toHaveLength(0);
  });

  it("reports the space reason when no candidate fits", async () => {
    releases = [release(1, 1024 ** 6), release(2, 1024 ** 5)];
    const r = await search();
    expect(r.grabbed).toBe(false);
    expect(r.grabbed === false && r.reason).toStartWith(
      "Not enough free space",
    );
    expect(addedTorrents).toHaveLength(0);
    expect(blocklistWrites).toHaveLength(0);
  });
});
