import { prisma } from "@rawkoon/api/db";
import { deleteLibraryMediaWithRequests } from "@rawkoon/api/services/mediaRequests";
import { pruneLibraryDirsAfterDelete } from "@rawkoon/api/services/library/pruneLibraryDirs";
import { logActivity } from "@rawkoon/api/utils/activityLogs";

/** Returns null when the item doesn't exist, else how many torrents were released. */
export async function deleteLibraryItem(
  id: number,
  opts: {
    deleteFiles: boolean;
    releaseTorrents: boolean;
    /** The acting user, recorded in the activity log. */
    userId?: string | null;
  },
): Promise<{ released: number } | null> {
  const existing = await prisma.libraryMedia.findUnique({
    where: { id },
    include: {
      files: { select: { filePath: true } },
      downloadHistories: {
        select: {
          id: true,
          torrentHash: true,
          completedAt: true,
          failed: true,
          seedReleasedAt: true,
          postProcessDestinationPath: true,
        },
      },
    },
  });
  if (!existing) return null;

  let filesRemoved = 0;
  if (opts.deleteFiles) {
    const { rm, stat } = await import("node:fs/promises");
    const paths = new Set<string>();
    for (const f of existing.files) paths.add(f.filePath);
    for (const dh of existing.downloadHistories) {
      if (dh.postProcessDestinationPath)
        paths.add(dh.postProcessDestinationPath);
    }
    // rm({ force }) succeeds for missing paths, so only count paths that existed.
    const removals = await Promise.all(
      [...paths].map(async (p) => {
        const existed = await stat(p).then(
          () => true,
          () => false,
        );
        const removed = await rm(p, { force: true }).then(
          () => true,
          () => false,
        );
        return existed && removed;
      }),
    );
    filesRemoved = removals.filter(Boolean).length;
    await pruneLibraryDirsAfterDelete(paths);
  }

  // DownloadHistory rows are kept (media_id → NULL) so their torrents keep seeding to target.
  // Cascade deletes episodes + MediaFile records.
  await deleteLibraryMediaWithRequests(id);

  let released = 0;
  try {
    // Torrents are touched only after the title is gone, so a failed delete leaves both intact.
    const pending = existing.downloadHistories.filter(
      (dh) => dh.completedAt == null && !dh.failed,
    );
    const { abandonPendingDownloads, protectedHashes, releaseTorrentNow } =
      await import("@rawkoon/api/services/seeding/seedSweep");
    await abandonPendingDownloads(pending);

    if (opts.releaseTorrents) {
      const held = new Set(
        existing.downloadHistories
          .filter(
            (dh) =>
              dh.completedAt != null &&
              !dh.failed &&
              dh.seedReleasedAt == null &&
              dh.torrentHash,
          )
          .map((dh) => (dh.torrentHash as string).toLowerCase()),
      );
      // Never release (and stamp) a torrent another title still owns.
      const shared = await protectedHashes(
        [...held],
        existing.downloadHistories.map((dh) => dh.id),
      );
      for (const hash of held) {
        if (shared.has(hash)) continue;
        const result = await releaseTorrentNow(hash).catch(() => null);
        if (result?.status === "released") released += 1;
      }
    }
  } finally {
    // The title is gone once the DB delete succeeded, so record it even if a
    // torrent step throws; `released` is the count reached so far.
    // Defence in depth: logActivity already swallows enqueue errors, but a
    // logging failure must never fail a delete that has already happened.
    try {
      await logActivity({
        type: "media_deleted",
        userId: opts.userId ?? null,
        payload: {
          media_id: existing.id,
          tmdb_id: existing.tmdbId,
          media_type: existing.type,
          title: existing.title,
          year: existing.year,
          delete_files: opts.deleteFiles,
          release_torrents: opts.releaseTorrents,
          files_removed: filesRemoved,
          torrents_released: released,
        },
      });
    } catch (error) {
      console.warn("[Library] Failed to log media deletion:", error);
    }
  }

  return { released };
}
