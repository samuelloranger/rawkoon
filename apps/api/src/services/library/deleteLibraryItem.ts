import { prisma } from "@rawkoon/api/db";
import { deleteLibraryMediaWithRequests } from "@rawkoon/api/services/mediaRequests";
import { pruneLibraryDirsAfterDelete } from "@rawkoon/api/services/library/pruneLibraryDirs";

/** Returns null when the item doesn't exist, else how many torrents were released. */
export async function deleteLibraryItem(
  id: number,
  opts: { deleteFiles: boolean; releaseTorrents: boolean },
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

  if (opts.deleteFiles) {
    const { rm } = await import("node:fs/promises");
    const paths = new Set<string>();
    for (const f of existing.files) paths.add(f.filePath);
    for (const dh of existing.downloadHistories) {
      if (dh.postProcessDestinationPath)
        paths.add(dh.postProcessDestinationPath);
    }
    await Promise.allSettled([...paths].map((p) => rm(p, { force: true })));
    await pruneLibraryDirsAfterDelete(paths);
  }

  // DownloadHistory rows are kept (media_id → NULL) so their torrents keep seeding to target.
  // Cascade deletes episodes + MediaFile records.
  await deleteLibraryMediaWithRequests(id);

  // Torrents are touched only after the title is gone, so a failed delete leaves both intact.
  const pending = existing.downloadHistories.filter(
    (dh) => dh.completedAt == null && !dh.failed,
  );
  const { abandonPendingDownloads, protectedHashes, releaseTorrentNow } =
    await import("@rawkoon/api/services/seeding/seedSweep");
  await abandonPendingDownloads(pending);

  let released = 0;
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

  return { released };
}
