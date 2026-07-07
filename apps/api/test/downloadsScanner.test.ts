import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, open, unlink, link, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

// ── prisma mock ─────────────────────────────────────────────────────────────

type MF = { filePath: string };
let settingsRow: {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
  fileOperation?: string;
} | null;
let mediaPaths: MF[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaSettings: {
      findUnique: async () => settingsRow,
    },
    mediaFile: {
      findMany: async () => mediaPaths,
    },
  },
}));

mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => ({
  remapPath: (p: string) => p,
  scanMediaInfo: async () => null,
}));

import {
  scanDownloads,
  invalidateDownloadsScannerCache,
  deriveDownloadsScanRoots,
  pathIsInsideRoot,
} from "../src/services/downloadsScanner";

async function truncateBigFile(path: string, bytes: number) {
  const fh = await open(path, "w");
  await fh.truncate(bytes);
  await fh.close();
}

describe("downloadsScanner helpers", () => {
  it("deriveDownloadsScanRoots uses dirname(library_paths)", () => {
    expect(
      deriveDownloadsScanRoots({
        moviesLibraryPath: "/srv/media/deep/Movies-folder",
        showsLibraryPath: null,
      }),
    ).toEqual(["/srv/media/deep"]);
    expect(
      deriveDownloadsScanRoots({
        moviesLibraryPath: "/a/b/movies/",
        showsLibraryPath: "/a/b/shows/something",
      }),
    ).toEqual(["/a/b", "/a/b/shows"]);
  });

  it("pathIsInsideRoot rejects traversals outside root", () => {
    expect(pathIsInsideRoot("/tmp/dl/a.mkv", "/tmp/dl")).toBe(true);
    expect(pathIsInsideRoot("/tmp/dl/sub/x.mkv", "/tmp/dl")).toBe(true);
    expect(pathIsInsideRoot("/other/x.mkv", "/tmp/dl")).toBe(false);
  });
});

describe.serial("scanDownloads integration (mocked prisma)", () => {
  let tmp: string;

  beforeEach(async () => {
    invalidateDownloadsScannerCache();
    mediaPaths = [];
    tmp = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "dlscan-"));
  });

  afterEach(async () => {
    invalidateDownloadsScannerCache();
    settingsRow = null;
    mediaPaths = [];
    try {
      await rm(tmp, { recursive: true });
    } catch {
      /** ignore cleanup */
    }
  });

  it("drops files smaller than 100 MiB", async () => {
    const vidPath = join(tmp, "tiny.mkv");
    await truncateBigFile(vidPath, 10 * 1024 * 1024);

    settingsRow = {
      moviesLibraryPath: join(tmp, "library_marker"),
      showsLibraryPath: null,
    };

    const { entries: rows } = await scanDownloads({ refresh: true });
    expect(rows).toHaveLength(0);
  });

  it("collects recursive videos and parses TV kind when SxxEyy present", async () => {
    const nested = join(tmp, "movies_cfg/nested/path");
    await mkdir(nested, { recursive: true });
    const vidPath = join(nested, "My.Show.S02E07.1080p.x264-GROUP.mkv");
    await truncateBigFile(vidPath, 101 * 1024 * 1024);

    settingsRow = {
      moviesLibraryPath: join(tmp, "movies_cfg/x"),
      showsLibraryPath: null,
    };

    const { entries: rows } = await scanDownloads({ refresh: true });
    expect(rows.length).toBe(1);
    expect(rows[0]!.file_name).toContain(".mkv");
    expect(rows[0]!.parsed.kind).toBe("tv");
    expect(rows[0]!.parsed.season).toBe(2);
    expect(rows[0]!.parsed.episode).toBe(7);
    expect(rows[0]!.is_imported).toBe(false);
  });

  it("detects a real hardlink via library MediaFile inode", async () => {
    const vidPath = join(tmp, "source.mkv");
    const libTwin = join(tmp, "linked.mkv");
    await truncateBigFile(vidPath, 105 * 1024 * 1024);
    await link(vidPath, libTwin);

    settingsRow = {
      moviesLibraryPath: join(tmp, "lib_marker"),
      showsLibraryPath: null,
    };
    mediaPaths = [{ filePath: libTwin }];

    const { entries: rows } = await scanDownloads({ refresh: true });
    const hit = rows.find(
      (r) => r.file_path === vidPath || r.file_path === libTwin,
    );
    expect(hit).toBeTruthy();
    expect(hit!.is_imported).toBe(true);
  });

  it("excludes files inside the configured library subtree", async () => {
    // Downloads root = dirname(libraryPath). The library subtree lives inside
    // the Downloads tree, but its files are NOT Downloads candidates and must
    // not be reported (would falsely show as imported because their inodes
    // are in the library set).
    const downloadsRoot = join(tmp, "shared_root");
    const libRoot = join(downloadsRoot, "Movies");
    const orphanDir = join(downloadsRoot, "Downloads", "release");
    await mkdir(libRoot, { recursive: true });
    await mkdir(orphanDir, { recursive: true });

    const libFile = join(libRoot, "Inception.2010.1080p.mkv");
    const downloadFile = join(orphanDir, "Other.Movie.2024.1080p.mkv");
    await truncateBigFile(libFile, 101 * 1024 * 1024);
    await truncateBigFile(downloadFile, 101 * 1024 * 1024);

    settingsRow = {
      moviesLibraryPath: libRoot,
      showsLibraryPath: null,
    };
    mediaPaths = [{ filePath: libFile }];

    const { entries } = await scanDownloads({ refresh: true });
    const paths = entries.map((e) => e.file_path);
    expect(paths).toContain(downloadFile);
    expect(paths).not.toContain(libFile);
    expect(entries[0]!.is_imported).toBe(false);
  });

  it("honours the 30s cache and bypasses via refresh=true", async () => {
    const vidPath = join(tmp, "solo.mkv");
    await truncateBigFile(vidPath, 105 * 1024 * 1024);

    settingsRow = {
      moviesLibraryPath: join(tmp, "m"),
      showsLibraryPath: null,
    };

    const a = await scanDownloads({ refresh: true });
    const b = await scanDownloads({});
    expect(a.entries).toEqual(b.entries);

    invalidateDownloadsScannerCache();
    await unlink(vidPath);
    const fresh = await scanDownloads({ refresh: true });
    expect(fresh.entries.length).toBe(0);
  });
});
