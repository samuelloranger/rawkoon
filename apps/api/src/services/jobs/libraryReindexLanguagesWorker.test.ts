import { describe, expect, it, mock } from "bun:test";

const rows = [
  {
    // Unchanged on disk, tracks stored, tags/format never derived.
    id: 1,
    filePath: "/lib/a.mkv",
    fileName: "Movie.2020.VFQ.mkv", // ignored: tags come from tracks
    sizeBytes: 10n,
    fileMtimeMs: 5n,
    audioTracks: [
      {
        index: 0,
        language: "fr",
        language_name: "French",
        title: null,
        codec: "AC3",
        channels: 6,
        channel_layout: "5.1",
        bitrate_kbps: 448,
        default: true,
        forced: false,
      },
    ],
    languageTags: [] as string[],
    audioFormat: null as string | null,
  },
  {
    // Unchanged and complete: left alone.
    id: 2,
    filePath: "/lib/b.mkv",
    fileName: "b.mkv",
    sizeBytes: 10n,
    fileMtimeMs: 5n,
    audioTracks: [],
    languageTags: ["EN"],
    audioFormat: "AAC",
  },
];
const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> =
  [];
const scanMediaInfo = mock(async () => null);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaFile: {
      count: async () => rows.length,
      findMany: async ({ cursor }: { cursor?: unknown }) =>
        cursor ? [] : rows,
      update: async (a: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        updates.push(a);
        return {};
      },
    },
  },
}));
mock.module("node:fs/promises", () => ({
  stat: async () => ({
    isFile: () => true,
    size: 10n,
    mtimeMs: 5n,
    dev: 1n,
    ino: 2n,
  }),
}));
mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => ({
  remapPath: (p: string) => p,
  scanMediaInfo,
}));

const { processLibraryReindexLanguagesJob } = await import(
  "./libraryReindexLanguagesWorker"
);

describe("processLibraryReindexLanguagesJob", () => {
  it("fills missing audio fields on unchanged files from stored tracks, without re-probing", async () => {
    const result = await processLibraryReindexLanguagesJob({
      updateProgress: async () => {},
    } as never);
    expect(scanMediaInfo).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { where: { id: 1 }, data: { languageTags: ["FR"], audioFormat: "AC3" } },
    ]);
    expect(result).toEqual({ updated: 1, skipped: 1, errors: 0 });
  });
});
