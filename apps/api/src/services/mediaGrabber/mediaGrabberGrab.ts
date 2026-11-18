import { stat } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import {
  qbCategoryForLibraryType,
  qualityJsonValue,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import { tryAdoptDuplicate } from "@rawkoon/api/services/mediaGrabber/mediaGrabberAdopt";
import { resolveGrabSeason } from "@rawkoon/api/services/grab/grabEpisodeResolver";
import {
  grabTarget,
  preflightGrab,
} from "@rawkoon/api/services/grab/grabPipeline";
import {
  duplicateGrabReason,
  findGrabConflict,
  type GrabRefusal,
  type GrabResult,
  type GrabTarget,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberConflicts";

export type { GrabRefusal, GrabResult };
export { preflightGrab };

/** True when a movie or single episode already has a library file on disk. */
export async function targetHasFileOnDisk(target: {
  mediaId: number;
  episodeId: number | null;
}): Promise<boolean> {
  const files = await prisma.mediaFile.findMany({
    where:
      target.episodeId != null
        ? { episodeId: target.episodeId }
        : { mediaId: target.mediaId, episodeId: null },
    select: { filePath: true },
  });
  for (const f of files) {
    try {
      await stat(f.filePath);
      return true;
    } catch {
      // Missing file: the import will treat this target as empty.
    }
  }
  return false;
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
  const { mediaId, episodeId } = opts;
  const releaseTitle = opts.releaseTitle.trim();
  try {
    if (!opts.downloadUrl.trim())
      return { grabbed: false, reason: "Missing download URL" };
    if (!releaseTitle)
      return { grabbed: false, reason: "Missing release title" };

    const media = await prisma.libraryMedia.findUnique({
      where: { id: mediaId },
    });
    if (!media) return { grabbed: false, reason: "Library item not found" };

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
    const qJson = qualityJsonValue(releaseTitle, opts.qualityParsed);
    // A grab over an existing file replaces it; unflagged, the import would skip it as a duplicate. Packs keep their per-episode import.
    const isUpgrade =
      opts.isUpgrade === true ||
      ((media.type === "movie" || target.episodeId != null) &&
        (await targetHasFileOnDisk(target)));

    return await grabTarget(
      {
        logPrefix: "[mediaGrabber]",
        category: qbCategoryForLibraryType(media.type),
        spaceKind: media.type,
        findConflict: (title) => findGrabConflict(media, target, title),
        historyData: () => ({ ...target, qualityParsed: qJson }),
        raceRefusal: {
          grabbed: false,
          reason: duplicateGrabReason(target),
          refusal: "already_active",
        },
        adopt: async ({ client, dhRowId, torrentHash }) =>
          !!(await tryAdoptDuplicate({
            adapter: client,
            dhRowId,
            mediaId,
            episodeId: episodeId ?? null,
            mediaType: media.type,
            torrentHash,
            releaseTitle,
            qJson,
            isUpgrade,
          })),
        markGrabbed: async () => {
          const status = isUpgrade ? "upgrading" : "downloading";
          if (episodeId != null) {
            await prisma.libraryEpisode.update({
              where: { id: episodeId },
              data: { status, searchAttempts: 0 },
            });
          } else {
            await prisma.libraryMedia.update({
              where: { id: mediaId },
              data: { status, searchAttempts: 0 },
            });
          }
        },
        announce: async (dhRowId) => {
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
              downloadHistoryId: dhRowId,
              episodeId: episodeId ?? null,
              season,
              releaseTitle,
              isUpgrade,
            });
          } catch (e) {
            console.warn("[mediaGrabber] grab notification failed:", e);
          }
        },
      },
      { ...opts, isUpgrade },
    );
  } catch (e) {
    console.warn("[mediaGrabber] grabRelease failed:", e);
    return {
      grabbed: false,
      reason: e instanceof Error ? e.message : "Unexpected error during grab",
    };
  }
}
