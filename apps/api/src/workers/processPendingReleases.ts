import { prisma } from "@rawkoon/api/db";
import {
  recordEpisodeMiss,
  recordMovieMiss,
  recordSeasonPackMiss,
} from "@rawkoon/api/services/grab/grabAttempts";
import { blocklistedTitles } from "@rawkoon/api/utils/medias/pickReleaseForGrab";
import { grabRelease } from "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab";
import {
  profileToScoreInput,
  qualityProfileFormatsInclude,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import type { GrabPendingReason } from "@rawkoon/shared/types";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import { scoreReleasesForProfile } from "@rawkoon/api/utils/medias/pickBestRelease";

/** Rows older than this are leftovers from a target that never came due. */
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PendingRow = {
  id: number;
  targetKey: string;
  mediaId: number;
  episodeId: number | null;
  season: number | null;
  release: unknown;
  score: number;
  source: string | null;
};

// The column is written only by evaluateDelay from a NormalizedRelease.
const asRelease = (v: unknown) => v as NormalizedRelease;

/** True while nothing has satisfied the target: still monitored, wanted, and fileless. */
async function isStillWanted(row: PendingRow): Promise<boolean> {
  if (row.episodeId != null) {
    const ep = await prisma.libraryEpisode.findUnique({
      where: { id: row.episodeId },
      select: {
        monitored: true,
        status: true,
        media: { select: { monitored: true } },
        _count: { select: { files: true } },
      },
    });
    return Boolean(
      ep &&
        ep.monitored &&
        ep.media.monitored &&
        ep.status === "wanted" &&
        ep._count.files === 0,
    );
  }
  const media = await prisma.libraryMedia.findUnique({
    where: { id: row.mediaId },
    select: {
      monitored: true,
      status: true,
      _count: { select: { files: true } },
    },
  });
  if (!media?.monitored) return false;
  if (row.season != null) {
    const wanted = await prisma.libraryEpisode.count({
      where: {
        mediaId: row.mediaId,
        season: row.season,
        monitored: true,
        status: "wanted",
        files: { none: {} },
      },
    });
    return wanted > 0;
  }
  return media.status === "wanted" && media._count.files === 0;
}

/** Count a failed replay like a failed sweep, so a persistent failure still reaches the skip cap. */
async function recordMiss(row: PendingRow, reason: string): Promise<void> {
  if (row.episodeId != null) {
    const ep = await prisma.libraryEpisode.findUnique({
      where: { id: row.episodeId },
      select: { id: true, mediaId: true, searchAttempts: true },
    });
    if (ep) await recordEpisodeMiss(ep, reason);
    return;
  }
  if (row.season != null) {
    const episodes = await prisma.libraryEpisode.findMany({
      where: {
        mediaId: row.mediaId,
        season: row.season,
        monitored: true,
        status: "wanted",
        files: { none: {} },
      },
      select: { id: true, searchAttempts: true },
    });
    await recordSeasonPackMiss(row.mediaId, row.season, episodes, reason);
    return;
  }
  const media = await prisma.libraryMedia.findUnique({
    where: { id: row.mediaId },
    select: { id: true, searchAttempts: true },
  });
  if (media) await recordMovieMiss(media, reason);
}

/**
 * Grab the best held release for every target whose delay window has ended.
 * Targets that were satisfied or unmonitored meanwhile are dropped without a grab.
 * `onlyTargetKey` limits the pass to one target, for a manual "grab now".
 */
export async function processPendingReleases(
  now = new Date(),
  onlyTargetKey?: string,
): Promise<{
  grabbed: number;
  dropped: number;
  /** Why the last target that was not grabbed was not; null when nothing missed. */
  reason: GrabPendingReason | null;
}> {
  await prisma.pendingRelease.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - PENDING_TTL_MS) } },
  });

  const due = await prisma.pendingRelease.findMany({
    where: {
      grabAfter: { lte: now },
      ...(onlyTargetKey ? { targetKey: onlyTargetKey } : {}),
    },
    select: { targetKey: true },
    distinct: ["targetKey"],
  });

  let grabbed = 0;
  let dropped = 0;
  let reason: GrabPendingReason | null = null;
  for (const { targetKey } of due) {
    try {
      const rows = await prisma.pendingRelease.findMany({
        where: { targetKey },
        select: {
          id: true,
          targetKey: true,
          source: true,
          mediaId: true,
          episodeId: true,
          season: true,
          release: true,
          score: true,
        },
      });
      const first = rows[0];
      if (!first) continue;

      if (!(await isStillWanted(first))) {
        await prisma.pendingRelease.deleteMany({ where: { targetKey } });
        dropped++;
        reason = "not_wanted";
        continue;
      }

      const media = await prisma.libraryMedia.findUnique({
        where: { id: first.mediaId },
        select: { qualityProfileId: true },
      });
      const profile = media?.qualityProfileId
        ? await prisma.qualityProfile.findUnique({
            where: { id: media.qualityProfileId },
            include: qualityProfileFormatsInclude,
          })
        : null;

      // Re-score so a profile edited during the window is honoured; without a
      // profile the scorer is a no-op, so fall back to the score stored at pick time.
      const storedScore = new Map(
        rows.map((r) => [asRelease(r.release).guid, r.score]),
      );
      const ordered = scoreReleasesForProfile(
        rows.map((r) => asRelease(r.release)),
        profile ? profileToScoreInput(profile) : null,
      )
        .map((s) => ({
          ...s,
          score: profile ? s.score : (storedScore.get(s.release.guid) ?? 0),
        }))
        .sort((a, b) => b.score - a.score);

      // Same title filter searchAndGrab applies before it tries a release.
      const blocked = await blocklistedTitles(
        ordered.map((s) => s.release.title),
      );
      const sourceByGuid = new Map(
        rows.map((r) => [asRelease(r.release).guid, r.source]),
      );

      let success = false;
      let alreadyActive = false;
      let spaceRefused = false;
      let lastReason = "No release could be grabbed";
      for (const candidate of ordered) {
        if (blocked.has(candidate.release.title.toLowerCase())) {
          lastReason = "Blocklisted";
          continue;
        }
        const result = await grabRelease({
          mediaId: first.mediaId,
          episodeId: first.episodeId ?? undefined,
          season: first.season,
          downloadUrl: candidate.downloadUrl,
          releaseTitle: candidate.release.title,
          indexer: candidate.release.indexer,
          sizeBytes: candidate.release.sizeBytes,
          // The type only allows "rss"; scheduled-search rows leave it unset.
          grabSource:
            sourceByGuid.get(candidate.release.guid) === "rss"
              ? "rss"
              : undefined,
        });
        if (result.grabbed) {
          success = true;
          grabbed++;
          break;
        }
        lastReason = result.reason;
        if (result.refusal === "no_space") spaceRefused = true;
        // Another grab already owns the target; later candidates would hit the same wall.
        if (
          result.refusal === "already_active" ||
          result.refusal === "show_grab_active"
        ) {
          alreadyActive = true;
          break;
        }
      }

      if (success || alreadyActive) {
        if (!success) reason = "already_active";
        await prisma.pendingRelease.deleteMany({ where: { targetKey } });
      } else if (spaceRefused) {
        reason = "no_space";
        // A full disk isn't a miss; keep the held set and retry once space frees up.
        continue;
      } else {
        reason = "all_failed";
        await recordMiss(first, lastReason);
        // Only the rows this pass read: a poll may have added fresh candidates meanwhile.
        await prisma.pendingRelease.deleteMany({
          where: { id: { in: rows.map((r) => r.id) } },
        });
      }
    } catch (e) {
      console.warn(`[processPendingReleases] ${targetKey} failed:`, e);
    }
  }

  if (grabbed > 0 || dropped > 0) {
    console.log(
      `[processPendingReleases] grabbed ${grabbed}, dropped ${dropped} target(s)`,
    );
  }
  return { grabbed, dropped, reason };
}
