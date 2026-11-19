import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realDb = { ...(await import("@rawkoon/api/db")) };
const realScanner = {
  ...(await import("@rawkoon/api/utils/medias/mediainfoScanner")),
};

type Ep = { id: number; season: number; episode: number; title: string | null };
const episodes: Ep[] = [
  { id: 101, season: 1, episode: 1, title: null },
  { id: 201, season: 2, episode: 1, title: null },
];
let filesFor: number[] = [];
let failCreateFor = 0;
let throwInSync = false;
const seasonSyncs: { season: number; after: number }[] = [];
const downloadedEpisodes: number[] = [];
const createdFiles: Array<{ episodeId: number; filePath: string }> = [];
const historyUpdates: Record<string, unknown>[] = [];

mock.module(
  "@rawkoon/api/services/libraryAttention/audioLanguageAlert",
  () => ({
    syncAudioLanguageAlert: async () => {},
    syncSeasonAudioLanguageAlert: async (a: { season: number }) => {
      seasonSyncs.push({ season: a.season, after: downloadedEpisodes.length });
      if (throwInSync) throw new Error("sync down");
    },
  }),
);
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryEpisode: {
      findMany: async () => episodes,
      update: async (a: { where: { id: number } }) => {
        downloadedEpisodes.push(a.where.id);
        return {};
      },
      updateMany: async () => ({}),
    },
    mediaFile: {
      findMany: async (args: { where?: { filePath?: unknown } }) =>
        args.where?.filePath
          ? []
          : filesFor.map((episodeId) => ({
              episodeId,
              filePath: `/lib/${episodeId}.mkv`,
            })),
      deleteMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      create: async (a: { data: { episodeId: number; filePath: string } }) => {
        if (a.data.episodeId === failCreateFor) throw new Error("db down");
        createdFiles.push(a.data);
        return {};
      },
      update: async () => ({}),
    },
    libraryMedia: { update: async () => ({}) },
    downloadHistory: {
      update: async (a: { data: Record<string, unknown> }) => {
        historyUpdates.push(a.data);
        return {};
      },
      findMany: async () => [],
    },
    grabBlocklist: {
      create: async () => ({}),
    },
  },
}));
mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => ({
  ...realScanner,
  scanMediaInfo: async () => null,
}));

const { postProcessSeasonPack } = await import(
  "@rawkoon/api/services/postProcessor/postProcessorSeasonPack"
);

afterAll(() => {
  mock.module("@rawkoon/api/db", () => realDb);
  mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => realScanner);
});

const adapter = (dir: string) =>
  new Proxy(
    {
      type: "qbittorrent",
      getTorrent: async () => ({
        contentPath: dir,
        savePath: dir,
        name: "pack",
        ratio: 0,
        seedingTimeSecs: 0,
      }),
    },
    { get: (t, k) => (t as never)[k] ?? (async () => undefined) },
  ) as never;

function run(isUpgrade: boolean) {
  const root = mkdtempSync(join(tmpdir(), "pack-"));
  const dl = join(root, "dl");
  mkdirSync(dl, { recursive: true });
  writeFileSync(join(dl, "Show.S01E01.1080p.mkv"), "a");
  writeFileSync(join(dl, "Show.S02E01.1080p.mkv"), "b");
  return postProcessSeasonPack(
    1,
    {
      id: 1,
      media: {
        id: 7,
        type: "show",
        title: "Show",
        year: 2020,
        tmdbStatus: null,
      },
      episode: null,
      season: null,
      torrentHash: "abc",
      indexer: null,
      releaseTitle: "Show.S01-S02.COMPLETE.1080p",
      qualityParsed: null,
      isUpgrade,
    },
    {
      showsLibraryPath: join(root, "lib"),
      episodeTemplate:
        "{show}/Season {season}/{show} - S{season:02}E{episode:02}",
      fileOperation: "hardlink",
      seedSweepEnabled: true,
    },
    "hardlink",
    adapter(dl),
  );
}

beforeEach(() => {
  filesFor = [];
  failCreateFor = 0;
  throwInSync = false;
  seasonSyncs.length = 0;
  createdFiles.length = 0;
  downloadedEpisodes.length = 0;
  historyUpdates.length = 0;
});

describe("pack import when a MediaFile upsert fails", () => {
  it("does not mark that episode downloaded and keeps the error on the row", async () => {
    failCreateFor = 201;
    const result = await run(false);
    expect(downloadedEpisodes).toEqual([101]);
    expect(result).toMatchObject({
      success: true,
      episodeCount: 1,
      partialError: expect.stringContaining("S2E1"),
    });
    expect(historyUpdates.at(-1)?.postProcessError).toContain("S2E1");
  });

  it("syncs the audio alert once per season, after every episode is imported", async () => {
    await run(true);
    expect(seasonSyncs.sort((a, b) => a.season - b.season)).toEqual([
      { season: 1, after: 2 },
      { season: 2, after: 2 },
    ]);
  });

  it("still syncs what was imported when one episode failed, and a sync error never fails the import", async () => {
    failCreateFor = 201;
    throwInSync = true;
    const result = await run(false);
    expect(result).toMatchObject({ success: true, episodeCount: 1 });
    expect(seasonSyncs.map((s) => s.season).sort()).toEqual([1, 2]);
  });
});
