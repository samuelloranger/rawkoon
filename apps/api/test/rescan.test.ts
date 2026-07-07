import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mutable state shared across all mock factories
// ---------------------------------------------------------------------------

type MediaRecord = {
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

type FileRecord = {
  id: number;
  mediaId: number;
  filePath: string;
  fileName: string;
  releaseGroup: string | null;
  episodeId?: number | null;
  source?: string | null;
  videoCodec?: string | null;
  resolution?: number | null;
};

type MediaSettingsRecord = {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
  movieTemplate: string;
  episodeTemplate: string;
  fileOperation: string;
};

type State = {
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
  // discovery / rename
  mediaSettings: MediaSettingsRecord | null;
  createdFiles: object[];
  activeDownloadCount: number;
};

const state: State = {
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
  activeDownloadCount: 0,
};

// Files that exist on disk (by filePath) — stat will succeed for these
const statMap: Record<string, boolean> = {};

// Path remapping function — defaults to identity (no remap configured)
let remapFn: (path: string) => string = (p) => p;

// Files for which scanMediaInfo returns a result (by filePath)
type MiResult = {
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
const scanMap: Record<string, MiResult | null> = {};

// qBittorrent: hashes that are present AND completed
const qbCompleteHashes: Set<string> = new Set();

// readdir mock: maps remapped dir path → list of filenames
const readdirMap: Record<string, string[]> = {};

// rename mock: captures { from, to } for each fs.rename call
const renameCaptures: Array<{ from: string; to: string }> = [];

// ---------------------------------------------------------------------------
// Mock modules — MUST be registered before importing the module under test
// ---------------------------------------------------------------------------

mock.module("@rawkoon/api/db", () => ({
  prisma: {
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
      findMany: () => Promise.resolve(state.files),
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
  stat: (filePath: string) => {
    if (statMap[filePath]) return Promise.resolve({});
    return Promise.reject(new Error("ENOENT"));
  },
  readdir: (dirPath: string) => {
    const names = readdirMap[dirPath] ?? [];
    return Promise.resolve(names.map((name) => ({ name, isFile: () => true })));
  },
  rename: (from: string, to: string) => {
    renameCaptures.push({ from, to });
    return Promise.resolve();
  },
}));

mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => ({
  scanMediaInfo: (filePath: string) =>
    Promise.resolve(scanMap[filePath] ?? null),
  remapPath: (filePath: string) => remapFn(filePath),
}));

mock.module("@rawkoon/api/utils/medias/filenameParser", () => ({
  parseFilenameMetadata: () => ({
    hdrFormat: null,
    resolution: null,
    source: null,
    releaseGroup: null,
  }),
}));

mock.module("@rawkoon/api/services/postProcessorQueue", () => ({
  enqueueLibraryPostProcess: (dhId: number) => {
    state.enqueuedDhIds.push(dhId);
  },
}));

mock.module("@rawkoon/api/services/qbittorrent/config", () => ({
  getQbittorrentIntegrationConfig: () =>
    Promise.resolve({
      enabled: qbCompleteHashes.size > 0,
      config: qbCompleteHashes.size > 0 ? { url: "http://qb" } : null,
    }),
}));

mock.module("@rawkoon/api/services/qbittorrent/clientFetch", () => ({
  fetchMaindata: () => {
    const torrents = new Map<string, Record<string, unknown>>();
    for (const hash of qbCompleteHashes) {
      torrents.set(hash, { state: "uploading", progress: 1 });
    }
    return Promise.resolve({ torrents });
  },
}));

mock.module("@rawkoon/api/workers/checkDownloadCompletion", () => ({
  isCompletedDownloadState: (s: string) =>
    ["uploading", "stalledUP", "forcedUP", "queuedUP"].includes(s),
  reconcilePendingDownloads: () =>
    Promise.resolve({ completed: 0, failed: 0, missing: 0 }),
}));

mock.module("@rawkoon/shared", () => ({
  classifyLanguageTags: () => [],
}));

// ---------------------------------------------------------------------------
// Import the service — AFTER mock registrations
// ---------------------------------------------------------------------------

import { rescanLibraryItem } from "../src/services/library/rescan";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMi(overrides: Partial<MiResult> = {}): MiResult {
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

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
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
    ...overrides,
  };
}

beforeEach(() => {
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
  state.activeDownloadCount = 0;

  for (const k of Object.keys(statMap)) delete statMap[k];
  for (const k of Object.keys(scanMap)) delete scanMap[k];
  for (const k of Object.keys(readdirMap)) delete readdirMap[k];
  renameCaptures.length = 0;
  qbCompleteHashes.clear();
  remapFn = (p) => p; // reset to identity
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rescanLibraryItem", () => {
  // ── Existence ──────────────────────────────────────────────────────────────

  it("1. Media not found → returns null", async () => {
    state.media = null;
    const result = await rescanLibraryItem(999);
    expect(result).toBeNull();
  });

  // ── No-files, movie ────────────────────────────────────────────────────────

  it("2. Movie, no files, status 'wanted' → no DB writes", async () => {
    state.media = { id: 1, type: "movie", status: "wanted" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result).toEqual({
      rescanned: 0,
      failed: 0,
      deleted: 0,
      imported: 0,
      renamed: 0,
      requeued: 0,
      episodesReset: 0,
      mediaReset: false,
      pendingReconciled: { completed: 0, failed: 0, missing: 0 },
    });
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("3. Movie, no files, status 'downloading' → resets media to 'wanted'", async () => {
    state.media = { id: 1, type: "movie", status: "downloading" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(true);
    expect(state.mediaUpdateArgs).toBeTruthy();
  });

  it("4. Movie, no files, status 'downloaded' → resets media to 'wanted'", async () => {
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(true);
  });

  it("5. Movie, no files, status 'skipped' → does NOT reset media", async () => {
    state.media = { id: 1, type: "movie", status: "skipped" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  // ── File-level cases ───────────────────────────────────────────────────────

  it("6. Movie, 1 file on disk, MediaInfo succeeds → rescanned:1", async () => {
    const file = makeFile({ id: 1, filePath: "/media/movie.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.rescanned).toBe(1);
    expect(result?.failed).toBe(0);
    expect(result?.deleted).toBe(0);
    expect(state.updatedFileIds).toContain(1);
    expect(result?.mediaReset).toBe(false);
  });

  it("7. Movie, file on disk but MediaInfo null → failed:1, record kept, status unchanged", async () => {
    const file = makeFile({ id: 1, filePath: "/media/corrupt.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = null;

    const result = await rescanLibraryItem(1);
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
    expect(result?.rescanned).toBe(0);
    expect(result?.mediaReset).toBe(false);
    expect(state.deletedFileIds).toHaveLength(0);
  });

  it("8. Movie, file deleted from disk → deletes record, resets media to 'wanted'", async () => {
    const file = makeFile({ id: 1, filePath: "/media/gone.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    scanMap[file.filePath] = null;
    // stat will throw (not in statMap)

    const result = await rescanLibraryItem(1);
    expect(result?.deleted).toBe(1);
    expect(result?.failed).toBe(0);
    expect(state.deletedFileIds).toContain(1);
    expect(result?.mediaReset).toBe(true);
  });

  it("9. Movie, 2 files: 1 valid + 1 deleted → rescanned:1, deleted:1, media stays 'downloaded'", async () => {
    const file1 = makeFile({ id: 1, filePath: "/media/part1.mkv" });
    const file2 = makeFile({ id: 2, filePath: "/media/part2.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file1, file2];
    statMap[file1.filePath] = true;
    scanMap[file1.filePath] = makeMi();
    scanMap[file2.filePath] = null; // part2 gone, stat will throw

    const result = await rescanLibraryItem(1);
    expect(result?.rescanned).toBe(1);
    expect(result?.deleted).toBe(1);
    expect(result?.mediaReset).toBe(false); // 1 file still remains
  });

  // ── Show-specific ──────────────────────────────────────────────────────────

  it("10. Show, no files, 3 episodes 'downloaded' → episodesReset:3", async () => {
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.remainingFileCount = 0;
    state.episodeUpdateManyCount = 3;

    const result = await rescanLibraryItem(1);
    expect(result?.episodesReset).toBe(3);
    expect(state.episodeUpdateManyArgs).toBeTruthy();
  });

  it("11. Show, no files, media 'downloaded' → resets media to 'wanted'", async () => {
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(true);
  });

  it("12. Show, no files, 'skipped' episodes are excluded from reset", async () => {
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.remainingFileCount = 0;
    state.episodeUpdateManyCount = 0;

    await rescanLibraryItem(1);

    const args = state.episodeUpdateManyArgs as {
      where: { status: { notIn: string[] } };
    };
    expect(args.where.status.notIn).toContain("skipped");
  });

  it("13. Show, episodes already 'wanted' → updateMany where clause excludes 'wanted' (idempotent)", async () => {
    state.media = { id: 1, type: "show", status: "wanted" };
    state.remainingFileCount = 0;
    state.episodeUpdateManyCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.episodesReset).toBe(0);
    const args = state.episodeUpdateManyArgs as {
      where: { status: { notIn: string[] } };
    };
    expect(args.where.status.notIn).toContain("wanted");
  });

  it("14. Show, 1 file still present → media NOT reset to 'wanted'", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/media/show/s01e01.mkv",
      episodeId: 10,
    });
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("15. Show, all files deleted → deleted:N, episodes reset, media reset", async () => {
    const files = [
      makeFile({ id: 1, filePath: "/media/s01e01.mkv", episodeId: 1 }),
      makeFile({ id: 2, filePath: "/media/s01e02.mkv", episodeId: 2 }),
      makeFile({ id: 3, filePath: "/media/s01e03.mkv", episodeId: 3 }),
    ];
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.files = files;
    state.episodeUpdateManyCount = 3;
    for (const f of files) scanMap[f.filePath] = null; // all gone

    const result = await rescanLibraryItem(1);
    expect(result?.deleted).toBe(3);
    expect(result?.failed).toBe(0);
    expect(result?.episodesReset).toBe(3);
    expect(result?.mediaReset).toBe(true);
  });

  it("16. File exists on disk but MediaInfo null → failed:1, deleted:0, status unchanged", async () => {
    const file = makeFile({ id: 1, filePath: "/media/corrupt.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = null;

    const result = await rescanLibraryItem(1);
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  // ── Imported count (formerly automatic library-folder scan) ───────────────

  it("17. imported is always 0 (use Library → Downloads to add files manually)", async () => {
    state.media = { id: 1, type: "movie", status: "downloading" };
    state.remainingFileCount = 1;

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    // With no tracked files remaining, reconcile still runs (handled by steps 18+)
    expect(result?.rescanned).toBe(0);
  });

  it("18. Tracked files rescanned regardless of obsolete import semantics", async () => {
    const file = makeFile({ id: 1, filePath: "/media/movie.mkv" });
    state.media = { id: 1, type: "movie", status: "downloading" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(result?.rescanned).toBe(1);
    expect(result?.mediaReset).toBe(false);
  });

  // ── qBittorrent re-queue ───────────────────────────────────────────────────

  it("19. Completed DH with torrent still in qBittorrent (completed state) → requeued:1", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      downloadHistories: [{ id: 42, torrentHash: "abc123", episodeId: null }],
    };
    state.remainingFileCount = 0;
    qbCompleteHashes.add("abc123"); // torrent present and completed in qB

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(1);
    expect(state.enqueuedDhIds).toContain(42);
    // Status reconciliation skipped because requeued > 0
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("20. Completed DH but torrent NOT in qBittorrent → requeued:0, status reset to 'wanted'", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      downloadHistories: [{ id: 42, torrentHash: "abc123", episodeId: null }],
    };
    state.remainingFileCount = 0;
    // qbCompleteHashes is empty → torrent not found

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(0);
    expect(state.enqueuedDhIds).toHaveLength(0);
    // Status reconciliation runs → resets to wanted
    expect(result?.mediaReset).toBe(true);
  });

  it("21. Show: episode DH in qBittorrent but that episode already has a file → not re-queued", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/media/s01e01.mkv",
      episodeId: 10,
    });
    state.media = {
      id: 1,
      type: "show",
      status: "downloaded",
      downloadHistories: [{ id: 55, torrentHash: "ep10hash", episodeId: 10 }],
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    qbCompleteHashes.add("ep10hash"); // torrent present but episode already imported

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(0); // episode 10 has a file → no requeue
    expect(state.enqueuedDhIds).toHaveLength(0);
  });

  it("22. Show: episode DH in qBittorrent, file missing → re-queued, reconciliation skipped", async () => {
    state.media = {
      id: 1,
      type: "show",
      status: "downloading",
      downloadHistories: [{ id: 77, torrentHash: "ephash", episodeId: 20 }],
    };
    state.remainingFileCount = 0;
    qbCompleteHashes.add("ephash"); // torrent present, episode 20 has no file

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(1);
    expect(state.enqueuedDhIds).toContain(77);
    expect(result?.episodesReset).toBe(0); // skipped
    expect(result?.mediaReset).toBe(false); // skipped
  });

  // ── Path remapping (statFile must use remapPath) ───────────────────────────

  it("24. remapPath identity (no env vars) → statFile receives original path, file found → failed:1", async () => {
    // remapFn is identity by default — verifies existing tests still hold
    const file = makeFile({ id: 1, filePath: "/library/show.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap["/library/show.mkv"] = true; // file exists at raw path
    scanMap[file.filePath] = null; // MediaInfo fails

    const result = await rescanLibraryItem(1);
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
  });

  it("25. remapPath active → statFile uses remapped path, file found there → failed:1 not deleted:1", async () => {
    // Simulates: MEDIA_PATH_FROM=/data/library MEDIA_PATH_TO=/mnt/library
    remapFn = (p) => p.replace("/data/library/", "/mnt/library/");

    const file = makeFile({ id: 1, filePath: "/data/library/show.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    // File does NOT exist at raw path — only at the remapped path
    statMap["/mnt/library/show.mkv"] = true;
    scanMap[file.filePath] = null; // MediaInfo fails (same path scanMediaInfo uses)

    const result = await rescanLibraryItem(1);
    // statFile uses remapped path → file found → failed, not deleted
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
    expect(state.deletedFileIds).toHaveLength(0);
  });

  it("26. remapPath active → statFile uses remapped path, file absent at remapped path → deleted:1", async () => {
    remapFn = (p) => p.replace("/data/library/", "/mnt/library/");

    const file = makeFile({ id: 1, filePath: "/data/library/gone.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    scanMap[file.filePath] = null;
    // statMap has neither raw nor remapped path → stat throws

    const result = await rescanLibraryItem(1);
    // statFile uses remapped path → file not found → record deleted
    expect(result?.deleted).toBe(1);
    expect(result?.failed).toBe(0);
    expect(state.deletedFileIds).toContain(1);
  });

  it("23. DH has null torrentHash → never re-queued regardless of qBittorrent state", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      downloadHistories: [{ id: 99, torrentHash: null, episodeId: null }],
    };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(0);
    expect(state.enqueuedDhIds).toHaveLength(0);
    // Falls through to status reset
    expect(result?.mediaReset).toBe(true);
  });
});

it("27. RescanResult includes renamed field", async () => {
  state.media = { id: 1, type: "movie", status: "downloaded" };
  state.remainingFileCount = 0;

  const result = await rescanLibraryItem(1);
  expect(result).toHaveProperty("renamed");
  expect(result?.renamed).toBe(0);
});

// ---------------------------------------------------------------------------
// Discovery (Step 1b)
// ---------------------------------------------------------------------------

describe("Discovery (Step 1b)", () => {
  it("28. Movie, matching file on disk not yet tracked → imported:1, mediaFile.create called", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 1;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];
    scanMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(1);
    expect(state.createdFiles).toHaveLength(1);
  });

  it("29. File on disk with wrong title → not imported", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    readdirMap["/movies"] = ["Unrelated Movie (2005) [1080p].mkv"];
    scanMap["/movies/Unrelated Movie (2005) [1080p].mkv"] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(state.createdFiles).toHaveLength(0);
  });

  it("30. Matching file on disk but scanMediaInfo returns null → not imported", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];
    scanMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = null;

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(state.createdFiles).toHaveLength(0);
  });

  it("31. Importing a file updates media status from 'wanted' to 'downloaded'", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "wanted",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];
    scanMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = makeMi();

    await rescanLibraryItem(1);
    expect(state.allMediaUpdateArgs).toContainEqual(
      expect.objectContaining({ data: { status: "downloaded" } }),
    );
  });

  it("32. File path already tracked in media_files → not re-imported", async () => {
    const existingFile = makeFile({
      id: 1,
      filePath: "/movies/The Matrix (1999) [1080p BluRay].mkv",
      fileName: "The Matrix (1999) [1080p BluRay].mkv",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [existingFile];
    state.remainingFileCount = 1;
    statMap[existingFile.filePath] = true;
    scanMap[existingFile.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "none", // skip rename so only import is tested
    };
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(state.createdFiles).toHaveLength(0);
  });

  it("33. Non-video file extension in library dir → skipped", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "none",
    };
    readdirMap["/movies"] = ["The Matrix (1999).nfo", "The Matrix (1999).srt"];

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rename (Step 1c)
// ---------------------------------------------------------------------------

describe("Rename (Step 1c)", () => {
  it("34. File name doesn't match template → renamed:1, fs.rename called, DB updated", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(1);
    expect(renameCaptures).toHaveLength(1);
    expect(renameCaptures[0].from).toBe("/movies/matrix.mkv");
    expect(renameCaptures[0].to).toBe(
      "/movies/The Matrix (1999) [1080p BluRay].mkv",
    );
  });

  it("35. File name already matches template → renamed:0", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/The Matrix (1999) [1080p BluRay].mkv",
      fileName: "The Matrix (1999) [1080p BluRay].mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("36. file_operation is 'none' → no rename attempted", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "none",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("37. Active download in progress → rename skipped", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.activeDownloadCount = 1;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("38. Rename target already exists on disk → skipped (no overwrite)", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    // Target name already exists on disk (e.g. a stale leftover)
    statMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("39. Two files resolving to same template stem → only first renames", async () => {
    const file1 = makeFile({
      id: 1,
      filePath: "/movies/matrix-a.mkv",
      fileName: "matrix-a.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    const file2 = makeFile({
      id: 2,
      filePath: "/movies/matrix-b.mkv",
      fileName: "matrix-b.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file1, file2];
    state.remainingFileCount = 2;
    statMap[file1.filePath] = true;
    statMap[file2.filePath] = true;
    scanMap[file1.filePath] = makeMi();
    scanMap[file2.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(1);
    expect(renameCaptures).toHaveLength(1);
    expect(renameCaptures[0].from).toBe("/movies/matrix-a.mkv");
  });

  it("40. Rename uses fresh MediaInfo, not stale file row", async () => {
    // DB row says 720p WEB, but MediaInfo rescan reveals 1080p BluRay.
    // Template should be built from the fresh values.
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 720,
      source: "WEB",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi({ resolution: 1080, source: "BluRay" });
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(1);
    expect(renameCaptures[0].to).toBe(
      "/movies/The Matrix (1999) [1080p BluRay].mkv",
    );
  });
});

// Restore node:fs/promises after all tests so the mock doesn't leak into other
// test files that run in the same worker context (e.g. downloadsAssign.test.ts).
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mock.module("node:fs/promises", () => require("node:fs").promises);
});
