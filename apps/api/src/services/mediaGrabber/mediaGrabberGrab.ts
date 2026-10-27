import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { infoHashFromMagnet } from "@rawkoon/api/utils/medias/prowlarrSearchUtils";
import { MAX_TORRENT_FILE_BYTES } from "@rawkoon/api/constants/libraryGrab";
import {
  fetchHttpWithSafeRedirects,
  isServerTorrentFetchUrlAllowed,
  MagnetRedirectError,
} from "@rawkoon/api/utils/medias/safeTorrentFetchUrl";
import {
  checkBlocklist,
  infoHashFromTorrentBuffer,
  prowlarrHeadersForTorrentUrl,
  qbCategoryForLibraryType,
  qualityJsonValue,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import { tryAdoptQbDuplicate } from "@rawkoon/api/services/mediaGrabber/mediaGrabberAdopt";
import { checkFreeSpaceForGrab } from "@rawkoon/api/services/grab/grabSpaceCheck";
import { resolveGrabSeason } from "@rawkoon/api/services/grab/grabEpisodeResolver";
import {
  activeShowGrabCover,
  inFlightGrabWhere,
  SHOW_GRAB_ACTIVE_PREFIX,
} from "@rawkoon/api/services/activeShowGrab";
import { isMultiSeasonRelease } from "@rawkoon/api/utils/medias/completeSeries";
import { parseReleaseSeasonSpan } from "@rawkoon/shared/utils/releaseStructure";

/**
 * Why a grab was refused before anything was sent to the download client.
 * Callers branch on this, never on the reason text.
 */
export type GrabRefusal =
  | "blocklisted"
  | "no_space"
  | "already_active"
  | "show_grab_active";

export type GrabResult =
  | { grabbed: true; releaseTitle: string }
  | { grabbed: false; reason: string; refusal?: GrabRefusal };

/**
 * Identifies what a grab is FOR. Movies are (media, null, null), single
 * episodes (media, episode, null), season packs (media, null, season).
 * Mirrors the key of the ux_download_history_active_target unique index.
 */
type GrabTarget = {
  mediaId: number;
  episodeId: number | null;
  season: number | null;
};

function duplicateGrabReason(target: GrabTarget, activeId?: number): string {
  const scope =
    target.episodeId != null
      ? `episode ${target.episodeId}`
      : target.season != null
        ? `season ${target.season}`
        : "this item";
  const ref = activeId != null ? ` (download #${activeId})` : "";
  return `A download is already active for ${scope}${ref} — cancel it before grabbing another release`;
}

/**
 * The refusals that need nothing but the release itself: a usable URL, a
 * configured client, and no blocklist hit. Free space is left to the grab, since
 * a replace frees the old download's space first.
 */
export async function preflightGrab(opts: {
  downloadUrl: string;
  releaseTitle: string;
  /** The URL already passed this check (it resolves DNS), so don't repeat it. */
  skipUrlCheck?: boolean;
}): Promise<
  | { refusal: GrabResult }
  | {
      downloadUrl: string;
      releaseTitle: string;
      isMagnet: boolean;
      active: NonNullable<Awaited<ReturnType<typeof resolveActiveAdapter>>>;
    }
> {
  const downloadUrl = opts.downloadUrl.trim();
  const releaseTitle = opts.releaseTitle.trim();
  const refuse = (reason: string, refusal?: GrabRefusal) => ({
    refusal: {
      grabbed: false as const,
      reason,
      ...(refusal ? { refusal } : {}),
    },
  });
  if (!downloadUrl) return refuse("Missing download URL");
  if (!releaseTitle) return refuse("Missing release title");

  const isMagnet = downloadUrl.startsWith("magnet:");
  if (isMagnet) {
    if (downloadUrl.length > 16_384) return refuse("Magnet link too long");
  } else if (
    !opts.skipUrlCheck &&
    !(await isServerTorrentFetchUrlAllowed(downloadUrl))
  ) {
    return refuse("Download URL is not allowed for server-side fetch");
  }

  const active = await resolveActiveAdapter();
  if (!active) return refuse("No download client configured");

  const earlyHash = isMagnet ? infoHashFromMagnet(downloadUrl) : null;
  const blockReason = await checkBlocklist(releaseTitle, earlyHash);
  if (blockReason) {
    return refuse(`Blocklisted: ${blockReason}`, "blocklisted");
  }
  return { downloadUrl, releaseTitle, isMagnet, active };
}

/**
 * Add a known release URL to the active download client,
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
  /** True when AI Provider selected this release over classic scoring. */
  aiPicked?: boolean;
  aiReasoning?: string;
  /**
   * Season targeted by a season-pack grab. Part of the grab target, so two
   * packs for different seasons of one show stay independent.
   */
  season?: number | null;
  /** The caller already ran `preflightGrab`, so skip its DNS-resolving URL check. */
  urlChecked?: boolean;
  /** Release size from the indexer; unknown (null/0) skips the free-space check. */
  sizeBytes?: number | null;
}): Promise<GrabResult> {
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

    if (!rawUrl.trim())
      return { grabbed: false, reason: "Missing download URL" };
    if (!rawTitle.trim())
      return { grabbed: false, reason: "Missing release title" };

    const media = await prisma.libraryMedia.findUnique({
      where: { id: mediaId },
    });
    if (!media) return { grabbed: false, reason: "Library item not found" };

    const pre = await preflightGrab({
      downloadUrl: rawUrl,
      releaseTitle: rawTitle,
      skipUrlCheck: opts.urlChecked,
    });
    if ("refusal" in pre) return pre.refusal;
    const { downloadUrl, releaseTitle, isMagnet, active } = pre;
    const { adapter } = active;

    const category = qbCategoryForLibraryType(media.type);
    const qJson = qualityJsonValue(releaseTitle, qualityParsed);

    const spaceReason = await checkFreeSpaceForGrab({
      mediaType: media.type,
      sizeBytes: opts.sizeBytes,
    });
    if (spaceReason) {
      return { grabbed: false, reason: spaceReason, refusal: "no_space" };
    }

    // One active grab per target. Two scheduled jobs can fire on the same tick
    // (RSS poll + the 6-hourly release sweep) off the same "wanted" snapshot,
    // and a slow release pick makes that snapshot stale, so without this both
    // hand a torrent to the client for the same item.
    const season = resolveGrabSeason({
      mediaType: media.type,
      episodeId: episodeId ?? null,
      season: opts.season ?? null,
      releaseTitle,
    });
    const target: GrabTarget = {
      mediaId,
      episodeId: episodeId ?? null,
      season,
    };
    const activeGrab = await prisma.downloadHistory.findFirst({
      where: { ...target, completedAt: null, failed: false },
      select: { id: true },
      orderBy: { id: "desc" },
    });
    if (activeGrab) {
      return {
        grabbed: false,
        reason: duplicateGrabReason(target, activeGrab.id),
        refusal: "already_active",
      };
    }
    // A show-level pack would overwrite a season or episode grab already running inside its seasons.
    if (
      media.type === "show" &&
      target.episodeId == null &&
      target.season == null &&
      isMultiSeasonRelease(releaseTitle)
    ) {
      const span = parseReleaseSeasonSpan(releaseTitle);
      const inside = (
        await prisma.downloadHistory.findMany({
          where: {
            ...(await inFlightGrabWhere()),
            mediaId,
            AND: [
              { OR: [{ episodeId: { not: null } }, { season: { not: null } }] },
            ],
          },
          select: { season: true, episode: { select: { season: true } } },
        })
      ).some((r) => {
        const s = r.season ?? r.episode?.season;
        return span == null || s == null || (s >= span.from && s <= span.to);
      });
      if (inside) {
        return {
          grabbed: false,
          reason:
            "A season or episode download is already active inside this pack's seasons — cancel it first",
          refusal: "already_active",
        };
      }
    }
    // A show-level pack already carries the seasons it names; a season or episode of those would double-grab.
    if (target.episodeId != null || target.season != null) {
      const cover = await activeShowGrabCover(mediaId);
      if (cover) {
        const episodeSeason =
          target.episodeId != null
            ? (
                await prisma.libraryEpisode.findUnique({
                  where: { id: target.episodeId },
                  select: { season: true },
                })
              )?.season
            : target.season;
        if (episodeSeason == null || cover(episodeSeason)) {
          return {
            grabbed: false,
            reason: `${SHOW_GRAB_ACTIVE_PREFIX} — cancel it before grabbing a single season or episode`,
            refusal: "show_grab_active",
          };
        }
      }
    }

    let dhRow: { id: number };
    try {
      dhRow = await prisma.downloadHistory.create({
        data: {
          ...target,
          releaseTitle,
          indexer: indexer?.trim() || null,
          torrentHash: null,
          downloadUrl,
          qualityParsed: qJson,
          isUpgrade: opts.isUpgrade ?? false,
          aiPicked: opts.aiPicked ?? false,
        },
      });
    } catch (e) {
      // ux_download_history_active_target — the check above lost the race to a
      // concurrent grab that inserted between our read and this write.
      if ((e as { code?: string }).code === "P2002") {
        return {
          grabbed: false,
          reason: duplicateGrabReason(target),
          refusal: "already_active",
        };
      }
      throw e;
    }
    pendingDownloadHistoryId = dhRow.id;
    const tag = `rawkoon-dh-${dhRow.id}`;

    let torrentHash: string | null = isMagnet
      ? infoHashFromMagnet(downloadUrl)
      : null;

    if (isMagnet) {
      try {
        const added = await adapter.addTorrent({
          magnetOrUrl: downloadUrl,
          category,
          tag,
          savePath: active.savePath,
        });
        if (added.hash) torrentHash = added.hash;
      } catch (error) {
        if (adapter.type === "qbittorrent") {
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
        }
        const reason =
          error instanceof Error ? error.message : "Magnet add failed";
        await prisma.downloadHistory.update({
          where: { id: dhRow.id },
          data: { failed: true, failReason: reason },
        });
        return { grabbed: false, reason };
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
        try {
          const added = await adapter.addTorrent({
            magnetOrUrl: magnetFallback,
            category,
            tag,
            savePath: active.savePath,
          });
          if (added.hash) torrentHash = added.hash;
        } catch (error) {
          if (adapter.type === "qbittorrent") {
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
          }
          const reason =
            error instanceof Error ? error.message : "Magnet add failed";
          await prisma.downloadHistory.update({
            where: { id: dhRow.id },
            data: { failed: true, failReason: reason },
          });
          return { grabbed: false, reason };
        }
      } else if (fetchedFile) {
        try {
          const added = await adapter.addTorrent({
            fileBuffer: new Uint8Array(await fetchedFile.arrayBuffer()),
            fileName: fetchedFile.name,
            category,
            tag,
            savePath: active.savePath,
          });
          if (added.hash) torrentHash = added.hash;
        } catch (error) {
          if (adapter.type === "qbittorrent") {
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
          }
          const reason =
            error instanceof Error ? error.message : "Torrent add failed";
          await prisma.downloadHistory.update({
            where: { id: dhRow.id },
            data: { failed: true, failReason: reason },
          });
          return { grabbed: false, reason };
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
      // The torrent was already handed to the client — don't mark DH as failed.
      // A failed status update leaves the row active so the poller can still
      // process it when the download finishes.
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

    try {
      const { notifyAdminsLibraryGrabbed } = await import(
        "@rawkoon/api/workers/notifyLibraryEvents"
      );
      await notifyAdminsLibraryGrabbed({
        mediaId,
        episodeId: episodeId ?? null,
        season,
        releaseTitle,
        isUpgrade: opts.isUpgrade,
      });
    } catch (e) {
      console.warn("[mediaGrabber] grab notification failed:", e);
    }

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
