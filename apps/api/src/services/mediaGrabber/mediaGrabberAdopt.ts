import { Prisma } from "@prisma/client";

import { claimExistingTorrent } from "@rawkoon/api/services/downloadClient/claimExisting";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import { adoptDownload } from "@rawkoon/api/services/downloads/downloadOutcome";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { qbCategoryForLibraryType } from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";

/**
 * If the download client rejected an add because the infohash already exists,
 * adopt the existing torrent into Rawkoon instead of marking the grab as failed.
 *
 * The client-side half (category, tag, completion state) lives in
 * claimExistingTorrent, which the book path shares; this function owns the
 * media-side database half: finalising the DownloadHistory row and updating the
 * library status — marking it `downloaded` immediately when the existing
 * torrent is already complete in the client.
 *
 * Returns null when adoption is not applicable (no hash, client unsupported or
 * unreachable, or no matching torrent). Returns a success descriptor when the torrent was
 * adopted.
 */
export async function tryAdoptDuplicate(ctx: {
  adapter: DownloadClientAdapter;
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
    adapter,
    dhRowId,
    mediaId,
    episodeId,
    mediaType,
    torrentHash,
    releaseTitle,
    qJson,
    isUpgrade,
  } = ctx;

  const claimed = await claimExistingTorrent(adapter, {
    hash: torrentHash,
    category: qbCategoryForLibraryType(mediaType),
    logPrefix: "[mediaGrabber]",
  });
  if (!claimed) return null;
  const { completed } = claimed;

  try {
    await adoptDownload({
      // Non-null: claimExistingTorrent returns null without a hash.
      dh: { id: dhRowId, mediaId, episodeId },
      torrentHash: torrentHash as string,
      completed,
      isUpgrade,
    });
  } catch (e) {
    console.warn(
      "[mediaGrabber] adopted torrent but failed to record the outcome:",
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
    `[mediaGrabber] adopted existing torrent hash=${torrentHash} media=${mediaId} episode=${episodeId ?? "none"} completed=${completed}`,
  );

  return { adopted: true, completed };
}
