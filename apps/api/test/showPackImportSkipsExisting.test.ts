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
const createdFiles: Array<{ episodeId: number; filePath: string }> = [];
const updatedFiles: unknown[] = [];
const historyUpdates: Record<string, unknown>[] = [];
const blocklisted: number[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryEpisode: {
      findMany: async () => episodes,
      update: async () => ({}),
      updateMany: async () => ({}),
    },
    mediaFile: {
      findMany: async () =>
        filesFor.map((episodeId) => ({
          episodeId,
          filePath: `/lib/${episodeId}.mkv`,
        })),
      findFirst: async () => null,
      create: async (a: { data: { episodeId: number; filePath: string } }) => {
        createdFiles.push(a.data);
        return {};
      },
      update: async (a: unknown) => {
        updatedFiles.push(a);
        return {};
      },
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
      create: async () => {
        blocklisted.push(1);
        return {};
      },
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
  createdFiles.length = 0;
  updatedFiles.length = 0;
  historyUpdates.length = 0;
  blocklisted.length = 0;
});

describe("show-level pack import", () => {
  it("leaves an episode that already has a file alone and imports the rest", async () => {
    filesFor = [101];
    const result = await run(false);
    expect(result).toMatchObject({ success: true, episodeCount: 1 });
    expect(createdFiles.map((f) => f.episodeId)).toEqual([201]);
    expect(updatedFiles).toHaveLength(0);
  });

  it("imports nothing when every episode already has a file", async () => {
    filesFor = [101, 201];
    const result = await run(false);
    // A harmless duplicate: a skip, not a failure, so no failure notice or attention alert.
    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: "all-episodes-present",
    });
    expect(createdFiles).toHaveLength(0);
    expect(blocklisted).toHaveLength(0);
    expect(historyUpdates).toEqual([
      {
        postProcessDestinationPath: "/lib/101.mkv",
        postProcessError: null,
        postProcessSkipReason: "all-episodes-present",
      },
    ]);
  });

  it("replaces existing files for an upgrade", async () => {
    filesFor = [101, 201];
    const result = await run(true);
    expect(result).toMatchObject({ success: true, episodeCount: 2 });
  });
});
