import { prisma } from "@rawkoon/api/db";
import {
  addQbittorrentMagnet,
  addQbittorrentTorrentFile,
} from "@rawkoon/api/services/qbittorrent/torrentAdd";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { infoHashFromMagnet } from "@rawkoon/api/utils/medias/prowlarrSearchUtils";
import { MAX_TORRENT_FILE_BYTES } from "@rawkoon/api/constants/libraryGrab";
import {
  fetchHttpWithSafeRedirects,
  isHttpUrlSafeForServerTorrentFetch,
  MagnetRedirectError,
} from "@rawkoon/api/utils/medias/safeTorrentFetchUrl";
import {
  checkBlocklist,
  infoHashFromTorrentBuffer,
  prowlarrHeadersForTorrentUrl,
  qbCategoryForLibraryType,
  qualityJsonValue,
} from "@rawkoon/api/services/mediaGrabberHelpers";
import { tryAdoptQbDuplicate } from "@rawkoon/api/services/mediaGrabberAdopt";

/**
 * Add a known release URL to qBittorrent with Rawkoon categories/tags,
 * create DownloadHistory, set library status, and log activity.
 */
export async function grabRelease(opts: {
  mediaId: number;
  episodeId?: number;
  downloadUrl: string;
  releaseTitle: string;
  indexer?: string | null;
  qualityParsed?: unknown;
  isUpgrade?: boolean;
  /** Where the grab was initiated (e.g. RSS cron). */
  grabSource?: "rss";
  /** True when Local AI selected this release over classic scoring. */
  aiPicked?: boolean;
  aiReasoning?: string;
}): Promise<
  { grabbed: true; releaseTitle: string } | { grabbed: false; reason: string }
> {
  let pendingDownloadHistoryId: number | null = null;
  let grabCommittedOk = false;
  let successReleaseTitle: string | null = null;

  try {
    const {
      mediaId,
      episodeId,
      downloadUrl: rawUrl,
      releaseTitle: rawTitle,
      indexer,
      qualityParsed,
    } = opts;

    const downloadUrl = rawUrl.trim();
    const releaseTitle = rawTitle.trim();
    if (!downloadUrl) return { grabbed: false, reason: "Missing download URL" };
    if (!releaseTitle)
      return { grabbed: false, reason: "Missing release title" };

    const media = await prisma.libraryMedia.findUnique({
      where: { id: mediaId },
    });
    if (!media) return { grabbed: false, reason: "Library item not found" };

    const isMagnet = downloadUrl.startsWith("magnet:");
    if (isMagnet) {
      if (downloadUrl.length > 16_384) {
        return { grabbed: false, reason: "Magnet link too long" };
      }
    } else if (!isHttpUrlSafeForServerTorrentFetch(downloadUrl)) {
      return {
        grabbed: false,
        reason: "Download URL is not allowed for server-side fetch",
      };
    }

    const qb = await getQbittorrentIntegrationConfig();
    if (!qb.enabled || !qb.config) {
      return { grabbed: false, reason: "qBittorrent not configured" };
    }

    const category = qbCategoryForLibraryType(media.type);
    const qJson = qualityJsonValue(releaseTitle, qualityParsed);

    const earlyHash = isMagnet ? infoHashFromMagnet(downloadUrl) : null;
    const blockReason = await checkBlocklist(releaseTitle, earlyHash);
    if (blockReason) {
      return { grabbed: false, reason: `Blocklisted: ${blockReason}` };
    }

    const dhRow = await prisma.downloadHistory.create({
      data: {
        mediaId,
        episodeId: episodeId ?? null,
        releaseTitle,
        indexer: indexer?.trim() || null,
        torrentHash: null,
        downloadUrl,
        qualityParsed: qJson,
        isUpgrade: opts.isUpgrade ?? false,
        aiPicked: opts.aiPicked ?? false,
      },
    });
    pendingDownloadHistoryId = dhRow.id;

    let torrentHash: string | null = isMagnet
      ? infoHashFromMagnet(downloadUrl)
      : null;

    if (isMagnet) {
      const add = await addQbittorrentMagnet(qb.config, qb.enabled, {
        magnet: downloadUrl,
        category,
        tags: ["rawkoon"],
      });
      if (!add.success) {
        const adopted = await tryAdoptQbDuplicate({
          dhRowId: dhRow.id,
          mediaId,
          episodeId: episodeId ?? null,
          mediaType: media.type,
          torrentHash,
          releaseTitle,
          qJson,
          isUpgrade: opts.isUpgrade,
        });
        if (adopted) {
          grabCommittedOk = true;
          successReleaseTitle = releaseTitle;
          return { grabbed: true, releaseTitle };
        }
        await prisma.downloadHistory.update({
          where: { id: dhRow.id },
          data: { failed: true, failReason: add.error ?? "Magnet add failed" },
        });
        return { grabbed: false, reason: add.error ?? "Failed to add magnet" };
      }
    } else {
      // Try to fetch the .torrent file. Some indexers redirect to a magnet instead.
      let fetchedFile: File | null = null;
      let magnetFallback: string | null = null;

      try {
        const headers: Record<string, string> = {
          ...(await prowlarrHeadersForTorrentUrl(downloadUrl)),
        };
        const torrentRes = await fetchHttpWithSafeRedirects(downloadUrl, {
          headers,
          signal: AbortSignal.timeout(60_000),
        });
        if (!torrentRes.ok) {
          throw new Error(`HTTP ${torrentRes.status}`);
        }
        const cl = torrentRes.headers.get("content-length");
        if (cl) {
          const n = Number(cl);
          if (Number.isFinite(n) && n > MAX_TORRENT_FILE_BYTES) {
            throw new Error("Torrent file too large");
          }
        }
        const buf = await torrentRes.arrayBuffer();
        if (buf.byteLength > MAX_TORRENT_FILE_BYTES) {
          throw new Error("Torrent file too large");
        }
        torrentHash = infoHashFromTorrentBuffer(buf);
        fetchedFile = new File([buf], "release.torrent", {
          type: "application/x-bittorrent",
        });
      } catch (e) {
        if (e instanceof MagnetRedirectError) {
          magnetFallback = e.magnetUrl;
        } else {
          await prisma.downloadHistory.update({
            where: { id: dhRow.id },
            data: {
              failed: true,
              failReason:
                e instanceof Error ? e.message : "Torrent download failed",
            },
          });
          return { grabbed: false, reason: "Could not download .torrent file" };
        }
      }

      if (magnetFallback) {
        torrentHash = infoHashFromMagnet(magnetFallback);
        const add = await addQbittorrentMagnet(qb.config, qb.enabled, {
          magnet: magnetFallback,
          category,
          tags: ["rawkoon"],
        });
        if (!add.success) {
          const adopted = await tryAdoptQbDuplicate({
            dhRowId: dhRow.id,
            mediaId,
            episodeId: episodeId ?? null,
            mediaType: media.type,
            torrentHash,
            releaseTitle,
            qJson,
            isUpgrade: opts.isUpgrade,
          });
          if (adopted) {
            grabCommittedOk = true;
            successReleaseTitle = releaseTitle;
            return { grabbed: true, releaseTitle };
          }
          await prisma.downloadHistory.update({
            where: { id: dhRow.id },
            data: {
              failed: true,
              failReason: add.error ?? "Magnet add failed",
            },
          });
          return {
            grabbed: false,
            reason: add.error ?? "Failed to add magnet",
          };
        }
      } else if (fetchedFile) {
        const add = await addQbittorrentTorrentFile(qb.config, qb.enabled, {
          torrent: fetchedFile,
          category,
          tags: ["rawkoon"],
        });
        if (!add.success) {
          const adopted = await tryAdoptQbDuplicate({
            dhRowId: dhRow.id,
            mediaId,
            episodeId: episodeId ?? null,
            mediaType: media.type,
            torrentHash,
            releaseTitle,
            qJson,
            isUpgrade: opts.isUpgrade,
          });
          if (adopted) {
            grabCommittedOk = true;
            successReleaseTitle = releaseTitle;
            return { grabbed: true, releaseTitle };
          }
          await prisma.downloadHistory.update({
            where: { id: dhRow.id },
            data: {
              failed: true,
              failReason: add.error ?? "Torrent add failed",
            },
          });
          return {
            grabbed: false,
            reason: add.error ?? "Failed to add torrent",
          };
        }
      }
    }

    await prisma.downloadHistory.update({
      where: { id: dhRow.id },
      data: { torrentHash },
    });

    try {
      const nextStatus = opts.isUpgrade ? "upgrading" : "downloading";
      if (episodeId != null) {
        await prisma.libraryEpisode.update({
          where: { id: episodeId },
          data: { status: nextStatus, searchAttempts: 0 },
        });
      } else {
        await prisma.libraryMedia.update({
          where: { id: mediaId },
          data: { status: nextStatus, searchAttempts: 0 },
        });
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Library status update failed";
      // The torrent was already handed to qBittorrent — don't mark DH as failed.
      // A failed status update leaves the row active so the completion webhook
      // and the safety-net poller can still process it when the download finishes.
      console.warn(
        `[mediaGrabber] Library status update failed for DH ${dhRow.id} (torrent already queued): ${msg}`,
      );
    }

    grabCommittedOk = true;
    successReleaseTitle = releaseTitle;

    await logActivity({
      type: "media_grab",
      payload: {
        media_id: mediaId,
        episode_id: episodeId ?? null,
        release_title: releaseTitle,
        quality: qJson,
        ...(opts.grabSource ? { grab_source: opts.grabSource } : {}),
        ...(opts.aiPicked ? { ai_picked: true } : {}),
        ...(opts.aiReasoning ? { ai_reasoning: opts.aiReasoning } : {}),
      },
    });

    return { grabbed: true, releaseTitle };
  } catch (e) {
    console.warn("[mediaGrabber] grabRelease failed:", e);
    if (grabCommittedOk && successReleaseTitle) {
      console.warn(
        "[mediaGrabber] Error after torrent was queued; treating as success:",
        e,
      );
      return { grabbed: true, releaseTitle: successReleaseTitle };
    }
    if (pendingDownloadHistoryId != null) {
      try {
        await prisma.downloadHistory.update({
          where: { id: pendingDownloadHistoryId },
          data: {
            failed: true,
            failReason:
              e instanceof Error ? e.message : "Unexpected error during grab",
          },
        });
      } catch (e) {
        console.warn(
          "[mediaGrabber] failed to mark download history as failed:",
          e,
        );
      }
    }
    return {
      grabbed: false,
      reason: e instanceof Error ? e.message : "Unexpected error during grab",
    };
  }
}
