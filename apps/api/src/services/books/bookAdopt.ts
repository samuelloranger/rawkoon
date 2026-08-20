import { claimExistingQbTorrent } from "@rawkoon/api/services/qbittorrent/adoptExisting";
import { adoptDownload } from "@rawkoon/api/services/downloadOutcome";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import type { BookEditionKind } from "@rawkoon/shared/types";

import { qbCategoryForEditionKind } from "./bookCategories";

/**
 * Book counterpart to tryAdoptQbDuplicate.
 *
 * When the download client already holds the torrent, take it over instead of
 * failing the grab: an edition whose earlier attempt was removed from Rawkoon
 * but not from the client was otherwise unreachable — the re-grab hit 409 every
 * time, with no way forward but manual intervention in qBittorrent.
 *
 * The client-side work is shared with the media path (claimExistingQbTorrent);
 * only the DownloadHistory finalisation differs, and adoptDownload already
 * knows how to finish a book row.
 *
 * Returns null when adoption does not apply, leaving the caller to fail the
 * grab with its own reason.
 */
export async function tryAdoptQbDuplicateForBook(ctx: {
  dhRowId: number;
  editionId: number;
  kind: BookEditionKind;
  torrentHash: string | null;
  releaseTitle: string;
  bookTitle: string;
  isUpgrade?: boolean;
}): Promise<{ adopted: true; completed: boolean } | null> {
  const {
    dhRowId,
    editionId,
    kind,
    torrentHash,
    releaseTitle,
    bookTitle,
    isUpgrade,
  } = ctx;

  const claimed = await claimExistingQbTorrent({
    torrentHash,
    expectedCategory: qbCategoryForEditionKind(kind),
    logPrefix: "[bookGrabber]",
  });
  if (!claimed) return null;
  const { completed } = claimed;

  try {
    await adoptDownload({
      // Non-null: claimExistingQbTorrent returns null without a hash.
      dh: {
        id: dhRowId,
        mediaId: null,
        episodeId: null,
        bookEditionId: editionId,
      },
      torrentHash: torrentHash as string,
      completed,
      isUpgrade,
    });
  } catch (e) {
    console.warn(
      "[bookGrabber] adopted qB torrent but failed to record the outcome:",
      e,
    );
  }

  // No edition write here on purpose: last_grabbed_at is maintained by the
  // trg_download_history_sync_book_edition trigger, and adoptDownload owns the
  // status transition (including emitting the SSE update).
  try {
    await logActivity({
      type: "book_grab",
      payload: {
        editionId,
        kind,
        bookTitle,
        releaseTitle,
        adopted: true,
        completed,
      },
    });
  } catch {
    // Best-effort; never fail an adoption on activity logging.
  }

  console.log(
    `[bookGrabber] adopted existing qB torrent hash=${torrentHash} edition=${editionId} completed=${completed}`,
  );

  return { adopted: true, completed };
}
