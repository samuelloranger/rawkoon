import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { dbModule } from "./mocks/prisma";

const findUnique = mock(async (..._: unknown[]) => null as unknown);
mock.module("@rawkoon/api/db", () =>
  dbModule({ prisma: { libraryMedia: { findUnique } } }),
);

const deleteLibraryMediaWithRequests = mock(async (_id: number) => {});
mock.module("@rawkoon/api/services/mediaRequests", () => ({
  deleteLibraryMediaWithRequests,
}));
mock.module("@rawkoon/api/services/library/pruneLibraryDirs", () => ({
  pruneLibraryDirsAfterDelete: async () => {},
}));

const releaseTorrentNow = mock(async (_hash: string) => ({
  status: "released",
}));
const protectedHashes = mock(
  async (..._: unknown[]): Promise<Set<string>> => new Set<string>(),
);
mock.module("@rawkoon/api/services/seeding/seedSweep", () => ({
  abandonPendingDownloads: async () => {},
  protectedHashes,
  releaseTorrentNow,
}));

const logActivity = mock(async (_input: unknown): Promise<void> => {});
mock.module("@rawkoon/api/utils/activityLogs", () => ({ logActivity }));

const { deleteLibraryItem } = await import(
  "@rawkoon/api/services/library/deleteLibraryItem"
);

const existing = {
  id: 7,
  tmdbId: 603,
  type: "movie",
  title: "Some Title",
  year: 1999,
  files: [{ filePath: "/nonexistent/library/a.mkv" }] as {
    filePath: string;
  }[],
  downloadHistories: [
    {
      id: 1,
      torrentHash: "ABC",
      completedAt: new Date(),
      failed: false,
      seedReleasedAt: null,
      postProcessDestinationPath: null,
    },
  ],
};

describe("deleteLibraryItem activity log", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockImplementation(async () => existing);
    deleteLibraryMediaWithRequests.mockReset();
    deleteLibraryMediaWithRequests.mockImplementation(async () => {});
    releaseTorrentNow.mockClear();
    protectedHashes.mockClear();
    logActivity.mockReset();
    logActivity.mockImplementation(async () => {});
  });

  it("logs a media_deleted entry with the acting user and outcome", async () => {
    const result = await deleteLibraryItem(7, {
      deleteFiles: true,
      releaseTorrents: true,
      userId: "admin-1",
    });

    expect(result).toEqual({ released: 1 });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0]?.[0]).toEqual({
      type: "media_deleted",
      userId: "admin-1",
      payload: {
        media_id: 7,
        tmdb_id: 603,
        media_type: "movie",
        title: "Some Title",
        year: 1999,
        delete_files: true,
        release_torrents: true,
        files_removed: 0,
        torrents_released: 1,
      },
    });
  });

  it("counts only files that existed and were removed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lib-delete-"));
    const real = join(dir, "a.mkv");
    writeFileSync(real, "x");
    findUnique.mockImplementation(async () => ({
      ...existing,
      files: [{ filePath: real }, { filePath: join(dir, "missing.mkv") }],
    }));

    await deleteLibraryItem(7, {
      deleteFiles: true,
      releaseTorrents: false,
      userId: "admin-1",
    });

    expect(existsSync(real)).toBe(false);
    const payload = (
      logActivity.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.files_removed).toBe(1);
  });

  it("still logs when a torrent step throws after the delete", async () => {
    protectedHashes.mockImplementationOnce(async () => {
      throw new Error("client down");
    });

    await expect(
      deleteLibraryItem(7, {
        deleteFiles: false,
        releaseTorrents: true,
        userId: "admin-1",
      }),
    ).rejects.toThrow("client down");

    expect(deleteLibraryMediaWithRequests).toHaveBeenCalledWith(7);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0]?.[0]).toMatchObject({
      type: "media_deleted",
      payload: { media_id: 7, torrents_released: 0 },
    });
  });

  it("records zero files and releases when neither flag is set", async () => {
    await deleteLibraryItem(7, {
      deleteFiles: false,
      releaseTorrents: false,
      userId: "admin-1",
    });

    const payload = (
      logActivity.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    ).payload;
    expect(payload).toMatchObject({
      delete_files: false,
      release_torrents: false,
      files_removed: 0,
      torrents_released: 0,
    });
  });

  it("logs nothing when the item does not exist", async () => {
    findUnique.mockImplementation(async () => null);

    const result = await deleteLibraryItem(7, {
      deleteFiles: false,
      releaseTorrents: false,
      userId: "admin-1",
    });

    expect(result).toBeNull();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("logs nothing when the delete itself fails", async () => {
    deleteLibraryMediaWithRequests.mockImplementationOnce(async () => {
      throw new Error("db down");
    });

    await expect(
      deleteLibraryItem(7, { deleteFiles: false, releaseTorrents: false }),
    ).rejects.toThrow("db down");
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("still succeeds when logActivity rejects", async () => {
    logActivity.mockImplementation(async () => {
      throw new Error("queue down");
    });

    const result = await deleteLibraryItem(7, {
      deleteFiles: false,
      releaseTorrents: false,
      userId: "admin-1",
    });

    expect(result).toEqual({ released: 0 });
    expect(deleteLibraryMediaWithRequests).toHaveBeenCalledWith(7);
  });
});
