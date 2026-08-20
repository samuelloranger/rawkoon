import { Prisma } from "@prisma/client";

import { claimExistingQbTorrent } from "@rawkoon/api/services/qbittorrent/adoptExisting";
import { adoptDownload } from "@rawkoon/api/services/downloadOutcome";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { qbCategoryForLibraryType } from "@rawkoon/api/services/mediaGrabberHelpers";

/**
 * If qBittorrent rejected an add because the infohash already exists,
 * adopt the existing torrent into Rawkoon instead of marking the grab as failed.
 *
 * The client-side half (category, tag, completion state) lives in
 * claimExistingQbTorrent, which the book path shares; this function owns the
 * media-side database half: finalising the DownloadHistory row and updating the
 * library status — marking it `downloaded` immediately when the existing
 * torrent is already complete in qBittorrent.
 *
 * Returns null when adoption is not applicable (no hash, qB unreachable, or
 * no matching torrent). Returns a success descriptor when the torrent was
 * adopted.
 */
export async function tryAdoptQbDuplicate(ctx: {
  dhRowId: number;
  mediaId: number;
  episodeId: number | null;
  mediaType: string;
  torrentHash: string | null;
  releaseTitle: string;
  qJson: Prisma.InputJsonValue;
  isUpgrade?: boolean;
}): Promise<{ adopted: true; completed: boolean } | null> {
  const {
    dhRowId,
    mediaId,
    episodeId,
    mediaType,
    torrentHash,
    releaseTitle,
    qJson,
    isUpgrade,
  } = ctx;

  const claimed = await claimExistingQbTorrent({
    torrentHash,
    expectedCategory: qbCategoryForLibraryType(mediaType),
    logPrefix: "[mediaGrabber]",
  });
  if (!claimed) return null;
  const { completed } = claimed;

  try {
    await adoptDownload({
      // Non-null: claimExistingQbTorrent returns null without a hash.
      dh: { id: dhRowId, mediaId, episodeId },
      torrentHash: torrentHash as string,
      completed,
      isUpgrade,
    });
  } catch (e) {
    console.warn(
      "[mediaGrabber] adopted qB torrent but failed to record the outcome:",
      e,
    );
  }

  await logActivity({
    type: "media_grab",
    payload: {
      media_id: mediaId,
      episode_id: episodeId ?? null,
      release_title: releaseTitle,
      quality: qJson,
      adopted: true,
      completed,
    },
  });

  console.log(
    `[mediaGrabber] adopted existing qB torrent hash=${torrentHash} media=${mediaId} episode=${episodeId ?? "none"} completed=${completed}`,
  );

  return { adopted: true, completed };
}
