import { mock } from "bun:test";
import * as realFs from "node:fs/promises";
import * as shared from "@rawkoon/shared";
import * as realFilenameParser from "@rawkoon/api/utils/medias/filenameParser";

export type MediaRecord = {
  id: number;
  type: "movie" | "show";
  status: string;
  title?: string;
  year?: number | null;
  downloadHistories?: Array<{
    id: number;
    torrentHash: string | null;
    episodeId: number | null;
  }>;
};

export type FileRecord = {
  id: number;
  mediaId: number;
  filePath: string;
  fileName: string;
  releaseGroup: string | null;
  episodeId?: number | null;
  source?: string | null;
  videoCodec?: string | null;
  resolution?: number | null;
  sizeBytes?: bigint;
  fileMtimeMs?: bigint | null;
  fileDev?: bigint | null;
  fileIno?: bigint | null;
};

export type MediaSettingsRecord = {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
  movieTemplate: string;
  episodeTemplate: string;
  fileOperation: string;
};

export type State = {
  media: MediaRecord | null;
  files: FileRecord[];
  remainingFileCount: number | null;
  deletedFileIds: number[];
  updatedFileIds: number[];
  episodeUpdateManyArgs: object | null;
  episodeUpdateManyCount: number;
  mediaUpdateArgs: object | null;
  allMediaUpdateArgs: object[];
  enqueuedDhIds: number[]; // IDs passed to enqueueLibraryPostProcess
  mediaSettings: MediaSettingsRecord | null;
  createdFiles: object[];
  // Paths tracked by a different library item (discovery must skip them).
  otherOwnedPaths: string[];
  activeDownloadCount: number;
  activeTranscodeFileIds: number[];
};

export const state: State = {
  activeTranscodeFileIds: [],
  media: null,
  files: [],
  remainingFileCount: null,
  deletedFileIds: [],
  updatedFileIds: [],
  episodeUpdateManyArgs: null,
  episodeUpdateManyCount: 0,
  mediaUpdateArgs: null,
  allMediaUpdateArgs: [],
  enqueuedDhIds: [],
  mediaSettings: null,
  createdFiles: [],
  otherOwnedPaths: [],
  activeDownloadCount: 0,
};

// Files that exist on disk (by filePath) — stat will succeed for these.
// Optional overrides supply fingerprint fields for incremental-skip tests.
export type StatOverride = {
  size?: number;
  mtimeMs?: number;
  dev?: number;
  ino?: number;
};
export const statMap: Record<string, true | StatOverride> = {};

// Path remapping function — defaults to identity (no remap configured)
export const remap = { fn: (path: string): string => path };

// Files for which scanMediaInfo returns a result (by filePath)
export type MiResult = {
  sizeBytes: bigint;
  durationSecs: number | null;
  releaseGroup: string | null;
  videoCodec: string | null;
  videoProfile: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  bitDepth: number | null;
  videoBitrate: number | null;
  hdrFormat: string | null;
  resolution: number | null;
  source: string | null;
  audioTracks: object[];
  subtitleTracks: object[];
};
export const scanMap: Record<string, MiResult | null> = {};

// qBittorrent: hashes that are present AND completed
export const qbCompleteHashes: Set<string> = new Set();

// readdir mock: maps remapped dir path → list of filenames
export const readdirMap: Record<string, string[]> = {};

// rename mock: captures { from, to } for each fs.rename call
export const renameCaptures: Array<{ from: string; to: string }> = [];

/** Registers the module mocks; must run before the module under test is imported. */
export async function installRescanMocks(): Promise<void> {
  // Mock modules — MUST be registered before importing the module under test
  mock.module("@rawkoon/api/db", () => ({
    prisma: {
      transcodeJob: {
        findMany: () =>
          Promise.resolve(
            state.activeTranscodeFileIds.map((mediaFileId) => ({
              mediaFileId,
            })),
          ),
      },
      libraryMedia: {
        findUnique: () =>
          Promise.resolve(
            state.media
              ? {
                  ...state.media,
                  downloadHistories: state.media.downloadHistories ?? [],
                }
              : null,
          ),
        update: (args: object) => {
          state.mediaUpdateArgs = args;
          state.allMediaUpdateArgs.push(args);
          return Promise.resolve(state.media);
        },
      },
      mediaFile: {
        findMany: (args?: { where?: { filePath?: { in: string[] } } }) => {
          const paths = args?.where?.filePath?.in;
          if (paths)
            return Promise.resolve(
              state.otherOwnedPaths
                .filter((p) => paths.includes(p))
                .map((filePath) => ({ filePath })),
            );
          return Promise.resolve(state.files);
        },
        update: (args: { where: { id: number } }) => {
          state.updatedFileIds.push(args.where.id);
          return Promise.resolve({});
        },
        create: (args: object) => {
          state.createdFiles.push(args);
          return Promise.resolve({ id: 99 });
        },
        delete: (args: { where: { id: number } }) => {
          state.deletedFileIds.push(args.where.id);
          state.files = state.files.filter((f) => f.id !== args.where.id);
          return Promise.resolve({});
        },
        deleteMany: (args: { where: { id: { in: number[] } } }) => {
          const ids = args.where.id.in;
          ids.forEach((id) => state.deletedFileIds.push(id));
          state.files = state.files.filter((f) => !ids.includes(f.id));
          return Promise.resolve({ count: ids.length });
        },
        count: () => {
          const count =
            state.remainingFileCount !== null
              ? state.remainingFileCount
              : state.files.length;
          return Promise.resolve(count);
        },
      },
      mediaSettings: {
        findUnique: () => Promise.resolve(state.mediaSettings),
      },
      libraryEpisode: {
        updateMany: (args: object) => {
          state.episodeUpdateManyArgs = args;
          return Promise.resolve({ count: state.episodeUpdateManyCount });
        },
      },
      downloadHistory: {
        findMany: () => Promise.resolve([]),
        count: () => Promise.resolve(state.activeDownloadCount),
      },
    },
  }));

  mock.module("node:fs/promises", () => ({
    ...realFs,
    stat: (filePath: string) => {
      const entry = statMap[filePath];
      if (!entry) return Promise.reject(new Error("ENOENT"));
      const ov = entry === true ? {} : entry;
      // Production always stats with { bigint: true } so unsigned 64-bit inodes
      // survive; mirror that here or fileUnchanged compares 1_000_000n to
      // 1_000_000 and never takes the skip path.
      return Promise.resolve({
        size: BigInt(ov.size ?? 1_000_000),
        mtimeMs: BigInt(ov.mtimeMs ?? 1_700_000_000_000),
        dev: BigInt(ov.dev ?? 1),
        ino: BigInt(ov.ino ?? 100 + (filePath.length % 50)),
        isFile: () => true,
      });
    },
    readdir: (dirPath: string) => {
      const names = readdirMap[dirPath] ?? [];
      return Promise.resolve(
        names.map((name) => ({ name, isFile: () => true })),
      );
    },
    rename: (from: string, to: string) => {
      renameCaptures.push({ from, to });
      return Promise.resolve();
    },
  }));

  mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => ({
    scanMediaInfo: (filePath: string) =>
      Promise.resolve(scanMap[filePath] ?? null),
    remapPath: (filePath: string) => remap.fn(filePath),
  }));

  mock.module("@rawkoon/api/utils/medias/filenameParser", () => ({
    ...realFilenameParser,
    parseFilenameMetadata: () => ({
      hdrFormat: null,
      resolution: null,
      source: null,
      releaseGroup: null,
    }),
  }));

  // rescan only re-queues post-processing; the rest of the download outcome
  // module is not exercised here, so stub just the enqueue.
  const realDownloadOutcome = await import(
    "@rawkoon/api/services/downloads/downloadOutcome"
  );
  // The availability re-check needs the request tables and the notification
  // queue; rescan only has to call it.
  mock.module("@rawkoon/api/services/mediaRequestNotifications", () => ({
    recheckRequestAvailable: () => Promise.resolve(),
  }));
  mock.module("@rawkoon/api/services/downloads/downloadOutcome", () => ({
    ...realDownloadOutcome,
    enqueuePostProcess: (dhId: number) => {
      state.enqueuedDhIds.push(dhId);
      return Promise.resolve(true);
    },
  }));

  mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
    buildAdapter: (type: string) => ({ type }),
    resolveActiveAdapter: () =>
      Promise.resolve(
        qbCompleteHashes.size > 0
          ? {
              adapter: {
                listTorrents: () =>
                  Promise.resolve(
                    [...qbCompleteHashes].map((hash) => ({
                      hash,
                      state: "completed",
                      progress: 1,
                    })),
                  ),
              },
            }
          : null,
      ),
  }));

  mock.module("@rawkoon/shared", () => ({
    ...shared,
    classifyLanguageTags: () => [],
  }));
}

export function makeMi(overrides: Partial<MiResult> = {}): MiResult {
  return {
    sizeBytes: BigInt(1_000_000),
    durationSecs: 5400,
    releaseGroup: "GROUP",
    videoCodec: "H.264",
    videoProfile: "High",
    width: 1920,
    height: 1080,
    frameRate: 23.976,
    bitDepth: 8,
    videoBitrate: 4000,
    hdrFormat: null,
    resolution: 1080,
    source: "BluRay",
    audioTracks: [],
    subtitleTracks: [],
    ...overrides,
  };
}

export function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 1,
    mediaId: 1,
    filePath: "/media/movie.mkv",
    fileName: "movie.mkv",
    releaseGroup: null,
    episodeId: null,
    source: null,
    videoCodec: null,
    resolution: null,
    sizeBytes: 1_000_000n,
    fileMtimeMs: null,
    fileDev: null,
    fileIno: null,
    ...overrides,
  };
}

export function resetRescanState(): void {
  state.media = null;
  state.files = [];
  state.remainingFileCount = null;
  state.deletedFileIds = [];
  state.updatedFileIds = [];
  state.episodeUpdateManyArgs = null;
  state.episodeUpdateManyCount = 0;
  state.mediaUpdateArgs = null;
  state.allMediaUpdateArgs = [];
  state.enqueuedDhIds = [];
  state.mediaSettings = null;
  state.createdFiles = [];
  state.otherOwnedPaths = [];
  state.activeDownloadCount = 0;
  state.activeTranscodeFileIds = [];

  for (const k of Object.keys(statMap)) delete statMap[k];
  for (const k of Object.keys(scanMap)) delete scanMap[k];
  for (const k of Object.keys(readdirMap)) delete readdirMap[k];
  renameCaptures.length = 0;
  qbCompleteHashes.clear();
  remap.fn = (p) => p;
}
