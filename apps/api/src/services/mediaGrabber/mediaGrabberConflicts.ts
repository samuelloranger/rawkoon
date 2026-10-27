import { prisma } from "@rawkoon/api/db";
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
export type GrabTarget = {
  mediaId: number;
  episodeId: number | null;
  season: number | null;
};

export function duplicateGrabReason(
  target: GrabTarget,
  activeId?: number,
): string {
  const scope =
    target.episodeId != null
      ? `episode ${target.episodeId}`
      : target.season != null
        ? `season ${target.season}`
        : "this item";
  const ref = activeId != null ? ` (download #${activeId})` : "";
  return `A download is already active for ${scope}${ref} — cancel it before grabbing another release`;
}

/** The refusal for a target that already has an active grab, or null when the way is clear. */
export async function findGrabConflict(
  media: { type: string },
  target: GrabTarget,
  releaseTitle: string,
): Promise<GrabResult | null> {
  const { mediaId } = target;
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

  return null;
}
