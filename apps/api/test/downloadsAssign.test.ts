import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, mkdtemp, open, rm, link, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Settings = {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
  postProcessingEnabled: boolean;
  fileOperation: string;
  movieTemplate: string;
  episodeTemplate: string;
};

let settingsRow: Settings | null;
let mediaFiles: Array<{ filePath: string; id: number }>;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaSettings: { findUnique: async () => settingsRow },
    mediaFile: {
      findMany: async () => mediaFiles,
      findFirst: async () => null,
      create: async ({ data }: { data: object }) => ({
        id: 1,
        ...(data as object),
      }),
      update: async ({ data }: { data: object }) => ({
        id: 1,
        ...(data as object),
      }),
    },
    libraryEpisode: {
      findUnique: async () => null,
      update: async ({ data }: { data: object }) => ({
        id: 1,
        ...(data as object),
      }),
    },
    libraryMedia: {
      update: async ({ data }: { data: object }) => ({
        id: 1,
        ...(data as object),
      }),
    },
  },
}));

mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => ({
  remapPath: (p: string) => p,
  scanMediaInfo: async () => null,
}));

mock.module("@rawkoon/api/services/libraryFromTmdb", () => ({
  addOrUpdateLibraryFromTmdb: async () => {
    throw new Error("TMDB not reached in this test");
  },
}));

// NOTE: do NOT mock @rawkoon/api/services/libraryEvents here. It's a pure
// in-process EventEmitter (no external side effects), so the real
// emitLibraryUpdate is harmless in these tests — and bun's mock.module is
// process-global with no teardown, so a no-op mock here leaks into other test
// files (e.g. completeDownloadByHash.test.ts) and silently breaks their emit
// assertions under CI's file-discovery order.

mock.module("@rawkoon/api/services/jellyfinLibraryRefresh", () => ({
  triggerJellyfinLibraryScan: async () => {},
}));

import { assignDownloadFromDisk } from "../src/services/downloadsAssign";
import { invalidateDownloadsScannerCache, invalidateLibraryInodeKeySetCache } from "../src/services/downloadsScanner";

const MIN_BYTES = 100 * 1024 * 1024;

async function makeFile(path: string, bytes: number) {
  const fh = await open(path, "w");
  await fh.truncate(bytes);
  await fh.close();
}

function defaultSettings(downloadsRoot: string, libRoot: string): Settings {
  return {
    moviesLibraryPath: join(libRoot, "Movies"),
    showsLibraryPath: join(libRoot, "Shows"),
    postProcessingEnabled: true,
    fileOperation: "hardlink",
    movieTemplate: "{title} ({year})/{title} ({year})",
    episodeTemplate:
      "{show}/Season {season}/{show} - S{season:02}E{episode:02}",
  };
}

describe("assignDownloadFromDisk validation", () => {
  let root: string;
  let downloadsRoot: string;
  let libRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rawkoon-assign-"));
    downloadsRoot = join(root, "downloads");
    libRoot = join(root, "lib");
    await mkdir(join(downloadsRoot, "movies"), { recursive: true });
    await mkdir(join(downloadsRoot, "shows"), { recursive: true });
    await mkdir(join(libRoot, "Movies"), { recursive: true });
    await mkdir(join(libRoot, "Shows"), { recursive: true });
    // dirname(moviesLibraryPath) is downloadsRoot only when library is under it;
    // to make downloads roots = downloadsRoot, place libs at <downloads>/Movies
    settingsRow = {
      ...defaultSettings(downloadsRoot, libRoot),
      moviesLibraryPath: join(downloadsRoot, "Movies"),
      showsLibraryPath: join(downloadsRoot, "Shows"),
    };
    await mkdir(join(downloadsRoot, "Movies"), { recursive: true });
    await mkdir(join(downloadsRoot, "Shows"), { recursive: true });
    mediaFiles = [];
    invalidateDownloadsScannerCache();
    invalidateLibraryInodeKeySetCache();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    settingsRow = null;
    mediaFiles = [];
    invalidateDownloadsScannerCache();
    invalidateLibraryInodeKeySetCache();
  });

  it("returns 404 when source file does not exist", async () => {
    const res = await assignDownloadFromDisk({
      file_path: join(downloadsRoot, "missing.mkv"),
      tmdb_id: 1,
      kind: "movie",
    });
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.status).toBe(404);
  });

  it("returns 400 when post-processing is disabled", async () => {
    settingsRow!.postProcessingEnabled = false;
    const fp = join(downloadsRoot, "movies", "Movie.2024.1080p.mkv");
    await makeFile(fp, MIN_BYTES);
    const res = await assignDownloadFromDisk({
      file_path: fp,
      tmdb_id: 1,
      kind: "movie",
    });
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/post-processing/i);
    }
  });

  it("returns 400 when file is below minimum size", async () => {
    const fp = join(downloadsRoot, "movies", "Tiny.2024.mkv");
    await makeFile(fp, 50 * 1024 * 1024); // 50 MiB
    const res = await assignDownloadFromDisk({
      file_path: fp,
      tmdb_id: 1,
      kind: "movie",
    });
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/minimum size/i);
    }
  });

  it("returns 400 when file_path is outside a downloads root", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "rawkoon-outside-"));
    const fp = join(outsideDir, "Movie.2024.mkv");
    await makeFile(fp, MIN_BYTES);
    try {
      const res = await assignDownloadFromDisk({
        file_path: fp,
        tmdb_id: 1,
        kind: "movie",
      });
      expect("error" in res).toBe(true);
      if ("error" in res) {
        expect(res.status).toBe(400);
        expect(res.error).toMatch(/downloads root/i);
      }
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("returns 409 when source inode already exists in library", async () => {
    const srcPath = join(downloadsRoot, "movies", "Movie.2024.1080p.mkv");
    await makeFile(srcPath, MIN_BYTES);
    const libPath = join(libRoot, "Existing.mkv");
    await link(srcPath, libPath);
    mediaFiles = [{ filePath: libPath, id: 1 }];

    const res = await assignDownloadFromDisk({
      file_path: srcPath,
      tmdb_id: 1,
      kind: "movie",
    });
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.status).toBe(409);
      expect(res.error).toMatch(/already linked/i);
    }
    await unlink(libPath).catch(() => {});
  });

  it("returns 422 for TV when filename has no S/E and none provided", async () => {
    // Place a TV-shaped path-but-no-SE in shows downloads root
    const fp = join(downloadsRoot, "Shows", "Random.Movie.Looking.1080p.mkv");
    await makeFile(fp, MIN_BYTES);
    // We need the TMDB stub to succeed for the kind=tv branch to reach the
    // season/episode check. Re-mock with a passing stub for this test only.
    mock.module("@rawkoon/api/services/libraryFromTmdb", () => ({
      addOrUpdateLibraryFromTmdb: async () => ({
        id: 1,
        type: "show",
        title: "Show",
        year: 2024,
        tmdbStatus: null,
      }),
    }));
    const { assignDownloadFromDisk: assignWithStubTmdb } =
      await import("../src/services/downloadsAssign");
    const res = await assignWithStubTmdb({
      file_path: fp,
      tmdb_id: 1,
      kind: "tv",
    });
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.status).toBe(422);
      expect(res.error).toMatch(/season and episode/i);
    }
  });
});
