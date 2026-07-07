import { Prisma } from "@prisma/client";

import { prisma } from "@rawkoon/api/db";
import { fetchQbittorrentTorrent } from "@rawkoon/api/services/qbittorrent/torrentQueries";
import {
  setQbittorrentTorrentCategory,
  setQbittorrentTorrentTags,
} from "@rawkoon/api/services/qbittorrent/torrentMutations";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import { isCompletedDownloadState } from "@rawkoon/api/workers/checkDownloadCompletion";
import { enqueueLibraryPostProcess } from "@rawkoon/api/services/postProcessorQueue";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { qbCategoryForLibraryType } from "@rawkoon/api/services/mediaGrabberHelpers";

/**
 * If qBittorrent rejected an add because the infohash already exists,
 * adopt the existing torrent into Rawkoon instead of marking the grab as failed.
 *
 * Flips the torrent's category to the expected Rawkoon category, adds the
 * `rawkoon` tag, finalises the DownloadHistory row, and updates the library
 * status — marking it `downloaded` immediately when the existing torrent is
 * already complete in qBittorrent.
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
  if (!torrentHash) return null;

  const qb = await getQbittorrentIntegrationConfig();
  if (!qb.enabled || !qb.config) return null;

  const info = await fetchQbittorrentTorrent(
    qb.config,
    qb.enabled,
    torrentHash,
  );
  if (!info.torrent) return null;

  const expectedCategory = qbCategoryForLibraryType(mediaType);
  const currentCategory = info.torrent.category ?? "";
  if (currentCategory !== expectedCategory) {
    const setCat = await setQbittorrentTorrentCategory(qb.config, qb.enabled, {
      hash: torrentHash,
      category: expectedCategory,
    });
    if (!setCat.success) {
      console.warn(
        `[mediaGrabber] adoption: failed to set category on ${torrentHash}: ${setCat.error ?? "unknown error"}`,
      );
      return null;
    }
  }

  const currentTags = info.torrent.tags ?? [];
  if (!currentTags.includes("rawkoon")) {
    // Non-fatal: tag update failure shouldn't block adoption.
    const tagRes = await setQbittorrentTorrentTags(qb.config, qb.enabled, {
      hash: torrentHash,
      tags: ["rawkoon"],
      previous_tags: null,
    });
    if (!tagRes.success) {
      console.warn(
        `[mediaGrabber] adoption: failed to add 'rawkoon' tag to ${torrentHash}: ${tagRes.error ?? "unknown error"}`,
      );
    }
  }

  const completed =
    isCompletedDownloadState(info.torrent.state ?? "") &&
    (info.torrent.progress ?? 0) >= 1;

  const now = new Date();
  await prisma.downloadHistory.update({
    where: { id: dhRowId },
    data: {
      torrentHash,
      failed: false,
      failReason: null,
      ...(completed ? { completedAt: now } : {}),
    },
  });

  try {
    const nextStatus: "downloading" | "downloaded" | "upgrading" = completed
      ? "downloaded"
      : isUpgrade
        ? "upgrading"
        : "downloading";
    if (episodeId != null) {
      await prisma.libraryEpisode.update({
        where: { id: episodeId },
        data: {
          status: nextStatus,
          searchAttempts: 0,
          ...(completed ? { downloadedAt: now } : {}),
        },
      });
    } else {
      await prisma.libraryMedia.update({
        where: { id: mediaId },
        data: { status: nextStatus, searchAttempts: 0 },
      });
    }
  } catch (e) {
    console.warn(
      "[mediaGrabber] adopted qB torrent but failed to update library status:",
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

  if (completed) {
    enqueueLibraryPostProcess(dhRowId);
  }

  return { adopted: true, completed };
}
