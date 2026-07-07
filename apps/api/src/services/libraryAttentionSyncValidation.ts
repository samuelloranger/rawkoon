import { prisma } from "@rawkoon/api/db";
import {
  LIBRARY_ATTENTION_ISSUE_LOOKBACK_DAYS,
  LIBRARY_ATTENTION_STUCK_PENDING_HOURS,
  LIBRARY_ATTENTION_WARN_ATTEMPTS,
} from "@rawkoon/api/constants/libraryGrab";
import type { LibraryAttentionKind } from "@rawkoon/shared/types";

type ValidationContext = {
  issueCutoff: Date;
  staleCutoff: Date;
  dhMap: Map<
    number,
    {
      failed: boolean;
      postProcessError: string | null;
      completedAt: Date | null;
      grabbedAt: Date;
    }
  >;
  mediaMap: Map<
    number,
    {
      status: string;
      type: string;
      monitored: boolean;
      searchAttempts: number;
      fileCount: number;
    }
  >;
  episodeMap: Map<
    number,
    {
      status: string;
      monitored: boolean;
      searchAttempts: number;
      fileCount: number;
      mediaMonitored: boolean;
    }
  >;
  seasonEpisodes: Map<
    string,
    Array<{
      status: string;
      monitored: boolean;
      searchAttempts: number;
      fileCount: number;
      mediaMonitored: boolean;
    }>
  >;
};

export async function buildValidationContext(
  openAlerts: Array<{
    kind: string;
    scopeType: string;
    mediaId: number;
    episodeId: number | null;
    season: number | null;
    downloadHistoryId: number | null;
  }>,
): Promise<ValidationContext> {
  const lookbackMs =
    LIBRARY_ATTENTION_ISSUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const issueCutoff = new Date(Date.now() - lookbackMs);
  const staleCutoff = new Date(
    Date.now() - LIBRARY_ATTENTION_STUCK_PENDING_HOURS * 60 * 60 * 1000,
  );

  const dhKinds = new Set([
    "download_failed",
    "post_process_error",
    "download_stuck",
  ]);
  const dhIds = [
    ...new Set(
      openAlerts
        .filter((a) => dhKinds.has(a.kind) && a.downloadHistoryId != null)
        .map((a) => a.downloadHistoryId!),
    ),
  ];
  const mediaIds = [...new Set(openAlerts.map((a) => a.mediaId))];
  const episodeIds = [
    ...new Set(
      openAlerts.filter((a) => a.episodeId != null).map((a) => a.episodeId!),
    ),
  ];
  const seasonPairs = openAlerts
    .filter((a) => a.scopeType === "season_pack" && a.season != null)
    .map((a) => ({ mediaId: a.mediaId, season: a.season! }));

  const [dhs, medias, episodes, seasonEps] = await Promise.all([
    dhIds.length > 0
      ? prisma.downloadHistory.findMany({
          where: { id: { in: dhIds } },
          select: {
            id: true,
            failed: true,
            postProcessError: true,
            completedAt: true,
            grabbedAt: true,
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: number;
            failed: boolean;
            postProcessError: string | null;
            completedAt: Date | null;
            grabbedAt: Date;
          }>,
        ),
    prisma.libraryMedia.findMany({
      where: { id: { in: mediaIds } },
      select: {
        id: true,
        status: true,
        type: true,
        monitored: true,
        searchAttempts: true,
        _count: { select: { files: true } },
      },
    }),
    episodeIds.length > 0
      ? prisma.libraryEpisode.findMany({
          where: { id: { in: episodeIds } },
          select: {
            id: true,
            mediaId: true,
            status: true,
            monitored: true,
            searchAttempts: true,
            _count: { select: { files: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: number;
            mediaId: number;
            status: string;
            monitored: boolean;
            searchAttempts: number;
            _count: { files: number };
          }>,
        ),
    seasonPairs.length > 0
      ? prisma.libraryEpisode.findMany({
          where: { OR: seasonPairs },
          select: {
            mediaId: true,
            season: true,
            status: true,
            monitored: true,
            searchAttempts: true,
            _count: { select: { files: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            mediaId: number;
            season: number;
            status: string;
            monitored: boolean;
            searchAttempts: number;
            _count: { files: number };
          }>,
        ),
  ]);

  const dhMap = new Map(dhs.map((dh) => [dh.id, dh]));
  const mediaMap = new Map(
    medias.map((m) => [
      m.id,
      {
        status: m.status,
        type: m.type,
        monitored: m.monitored,
        searchAttempts: m.searchAttempts,
        fileCount: m._count.files,
      },
    ]),
  );
  const episodeMap = new Map(
    episodes.map((ep) => [
      ep.id,
      {
        status: ep.status,
        monitored: ep.monitored,
        searchAttempts: ep.searchAttempts,
        fileCount: ep._count.files,
        mediaMonitored: mediaMap.get(ep.mediaId)?.monitored ?? false,
      },
    ]),
  );

  const seasonEpisodes = new Map<
    string,
    Array<{
      status: string;
      monitored: boolean;
      searchAttempts: number;
      fileCount: number;
      mediaMonitored: boolean;
    }>
  >();
  for (const ep of seasonEps) {
    const key = `${ep.mediaId}|${ep.season}`;
    const arr = seasonEpisodes.get(key) ?? [];
    arr.push({
      status: ep.status,
      monitored: ep.monitored,
      searchAttempts: ep.searchAttempts,
      fileCount: ep._count.files,
      mediaMonitored: mediaMap.get(ep.mediaId)?.monitored ?? false,
    });
    seasonEpisodes.set(key, arr);
  }

  return {
    issueCutoff,
    staleCutoff,
    dhMap,
    mediaMap,
    episodeMap,
    seasonEpisodes,
  };
}

export function alertStillValidFromContext(
  alert: {
    kind: string;
    scopeType: string;
    mediaId: number;
    episodeId: number | null;
    season: number | null;
    downloadHistoryId: number | null;
  },
  ctx: ValidationContext,
): boolean {
  switch (alert.kind as LibraryAttentionKind) {
    case "download_failed": {
      if (alert.downloadHistoryId == null) return false;
      const dh = ctx.dhMap.get(alert.downloadHistoryId);
      return !!(
        dh?.failed && dh.grabbedAt.getTime() >= ctx.issueCutoff.getTime()
      );
    }
    case "post_process_error": {
      if (alert.downloadHistoryId == null) return false;
      const dh = ctx.dhMap.get(alert.downloadHistoryId);
      return !!(
        dh &&
        !dh.failed &&
        dh.postProcessError != null &&
        dh.postProcessError !== "" &&
        dh.grabbedAt.getTime() >= ctx.issueCutoff.getTime()
      );
    }
    case "download_stuck": {
      if (alert.downloadHistoryId == null) return false;
      const dh = ctx.dhMap.get(alert.downloadHistoryId);
      return !!(
        dh &&
        !dh.failed &&
        dh.completedAt == null &&
        dh.grabbedAt.getTime() < ctx.staleCutoff.getTime()
      );
    }
    case "grab_skipped": {
      if (alert.scopeType === "movie") {
        return ctx.mediaMap.get(alert.mediaId)?.status === "skipped";
      }
      if (alert.scopeType === "season_pack") {
        if (alert.season == null) return false;
        const eps =
          ctx.seasonEpisodes.get(`${alert.mediaId}|${alert.season}`) ?? [];
        // Match creation semantics (ALL monitored episodes skipped), not ANY —
        // otherwise a single leftover skipped episode keeps the season alert open forever.
        const monitored = eps.filter((ep) => ep.monitored);
        return (
          monitored.length > 0 &&
          monitored.every((ep) => ep.status === "skipped")
        );
      }
      if (alert.episodeId == null) return false;
      return ctx.episodeMap.get(alert.episodeId)?.status === "skipped";
    }
    case "auto_grab_stalled": {
      if (alert.scopeType === "movie") {
        const m = ctx.mediaMap.get(alert.mediaId);
        return !!(
          m &&
          m.type === "movie" &&
          m.status === "wanted" &&
          m.monitored &&
          m.searchAttempts >= LIBRARY_ATTENTION_WARN_ATTEMPTS &&
          m.fileCount === 0
        );
      }
      if (alert.scopeType === "episode") {
        if (alert.episodeId == null) return false;
        const ep = ctx.episodeMap.get(alert.episodeId);
        return !!(
          ep &&
          ep.status === "wanted" &&
          ep.monitored &&
          ep.searchAttempts >= LIBRARY_ATTENTION_WARN_ATTEMPTS &&
          ep.fileCount === 0 &&
          ep.mediaMonitored
        );
      }
      if (alert.season == null) return false;
      const eps =
        ctx.seasonEpisodes.get(`${alert.mediaId}|${alert.season}`) ?? [];
      // Match creation semantics (ALL monitored episodes stalled), not ANY.
      const monitored = eps.filter((ep) => ep.monitored && ep.mediaMonitored);
      return (
        monitored.length > 0 &&
        monitored.every(
          (ep) =>
            ep.status === "wanted" &&
            ep.searchAttempts >= LIBRARY_ATTENTION_WARN_ATTEMPTS &&
            ep.fileCount === 0,
        )
      );
    }
    default:
      return false;
  }
}
