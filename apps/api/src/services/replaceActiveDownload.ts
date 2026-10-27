import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { revertToWantedIfNoActiveGrabs } from "@rawkoon/api/services/downloads/downloadOutcome";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { REPLACED_FAIL_REASON } from "@rawkoon/api/services/replacedDownload";
import { infoHashFromMagnet } from "@rawkoon/api/utils/medias/prowlarrSearchUtils";

export { REPLACED_FAIL_REASON };

export type ReplacePrep =
  /** The running download already is the requested release; nothing to do. */
  | { status: "already_active" }
  | { status: "cancelled"; cancelled: number }
  /** The replace did not go through; `stopped` downloads were already removed before it failed. */
  | { status: "refused"; reason: string; stopped: number };

const refused = (reason: string, stopped = 0): ReplacePrep => ({
  status: "refused",
  reason,
  stopped,
});

/**
 * Stop a movie's running download so another release can take its place.
 *
 * Every row is claimed first (failed = true, only while still active), so a
 * download that completes meanwhile is never deleted. Torrents are removed only
 * after all claims hold; a client error other than "already gone" undoes the
 * claims of the torrents still running and refuses. Rows are kept as failed
 * history, without the failure notification a genuine failure sends.
 *
 * The one-active-grab-per-target index forces stop-then-grab, so if the grab
 * that follows is refused the old download is already gone.
 */
export async function cancelActiveMovieDownloads(
  mediaId: number,
  release?: { releaseTitle: string; downloadUrl: string },
): Promise<ReplacePrep> {
  const rows = await prisma.downloadHistory.findMany({
    where: { mediaId, episodeId: null, completedAt: null, failed: false },
    select: {
      id: true,
      mediaId: true,
      episodeId: true,
      torrentHash: true,
      releaseTitle: true,
    },
  });

  if (release) {
    const title = release.releaseTitle.trim().toLowerCase();
    const hash = release.downloadUrl.startsWith("magnet:")
      ? (infoHashFromMagnet(release.downloadUrl)?.toLowerCase() ?? null)
      : null;
    const same = rows.some((r) => {
      const rowHash = r.torrentHash?.toLowerCase() ?? null;
      if (rowHash && hash) return rowHash === hash;
      if (!rowHash && !hash)
        return r.releaseTitle.trim().toLowerCase() === title;
      return false;
    });
    if (same) return { status: "already_active" };
  }

  const active = rows.some((r) => r.torrentHash)
    ? await resolveActiveAdapter()
    : null;
  if (rows.some((r) => r.torrentHash) && !active) {
    return refused("No download client configured");
  }

  const unclaim = async (ids: number[]): Promise<boolean> => {
    try {
      await prisma.downloadHistory.updateMany({
        where: { id: { in: ids } },
        data: { failed: false, failReason: null },
      });
      return true;
    } catch (error) {
      // Another grab took the target after the claim; the unique index refuses the restore.
      console.error("[replaceActiveDownload] could not restore rows:", error);
      return false;
    }
  };

  const claimed: typeof rows = [];
  for (const row of rows) {
    const claim = await prisma.downloadHistory.updateMany({
      where: { id: row.id, completedAt: null, failed: false },
      data: { failed: true, failReason: REPLACED_FAIL_REASON },
    });
    if (claim.count !== 1) {
      if (claimed.length > 0) await unclaim(claimed.map((r) => r.id));
      return refused("The download finished or changed while replacing it");
    }
    claimed.push(row);
  }

  const removed: typeof rows = [];
  let failure: string | null = null;
  for (const row of claimed) {
    if (row.torrentHash && active) {
      const hash = row.torrentHash;
      const sharedWithOthers = await prisma.downloadHistory.count({
        where: { torrentHash: hash, id: { not: row.id }, failed: false },
      });
      try {
        await active.adapter.remove(hash, sharedWithOthers === 0);
      } catch (error) {
        // Only a torrent the client no longer has counts as removed.
        const stillThere = await active.adapter
          .getTorrent(hash)
          .then((t) => t !== null)
          .catch(() => true);
        if (stillThere) {
          failure = `Could not stop the running download: ${
            error instanceof Error ? error.message : "download client error"
          }`;
          break;
        }
      }
    }
    removed.push(row);
  }

  if (failure) {
    const running = claimed.filter((r) => !removed.includes(r));
    if (!(await unclaim(running.map((r) => r.id)))) {
      failure +=
        ". Its history row could not be restored; check the download client";
    }
  }
  for (const row of removed) await revertToWantedIfNoActiveGrabs(row);

  if (failure) {
    if (removed.length > 0) emitLibraryUpdate(mediaId);
    return refused(failure, removed.length);
  }

  // A stale "downloading" status with no active row would still block the grab.
  await prisma.libraryMedia.updateMany({
    where: { id: mediaId, status: "downloading" },
    data: { status: "wanted" },
  });
  emitLibraryUpdate(mediaId);
  return { status: "cancelled", cancelled: removed.length };
}
