import { prisma } from "@rawkoon/api/db";
import {
  LIBRARY_ATTENTION_ISSUE_LOOKBACK_DAYS,
  LIBRARY_ATTENTION_MAX_ITEMS,
  LIBRARY_ATTENTION_PER_SOURCE_DH_TAKE,
  LIBRARY_ATTENTION_PER_SOURCE_EPISODE_TAKE,
  LIBRARY_ATTENTION_PER_SOURCE_MOVIE_TAKE,
  LIBRARY_ATTENTION_STUCK_PENDING_HOURS,
  LIBRARY_ATTENTION_WARN_ATTEMPTS,
} from "@rawkoon/api/constants/libraryGrab";
import {
  type AttentionCandidate,
  type LibraryAttentionScopeType,
  attentionKindPriority,
} from "@rawkoon/api/services/libraryAttentionTypes";
import {
  inferSeasonFromReleaseTitle,
  pushEpisodePackOrIndividuals,
} from "@rawkoon/api/services/libraryAttentionCandidatesSeason";

type DhRow = {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  releaseTitle: string;
  grabbedAt: Date;
  failReason: string | null;
  postProcessError: string | null;
  failed: boolean;
  completedAt: Date | null;
  media: {
    id: number;
    title: string;
    type: string;
    status: string;
  } | null;
  episode: {
    id: number;
    season: number;
    episode: number;
    status: string;
    media: { id: number; title: string; type: string; status: string };
  } | null;
};

function dhScopeFromRow(dh: DhRow): {
  scope_type: LibraryAttentionScopeType;
  episode_id: number | null;
  season: number | null;
  episode_number: number | null;
  media_id: number;
  media_title: string;
  media_type: "movie" | "show";
  library_status: string;
} | null {
  if (dh.media) {
    const mt = dh.media.type as "movie" | "show";
    if (mt === "movie") {
      return {
        scope_type: "movie",
        episode_id: null,
        season: null,
        episode_number: null,
        media_id: dh.media.id,
        media_title: dh.media.title,
        media_type: "movie",
        library_status: dh.media.status,
      };
    }
    if (dh.episodeId != null && dh.episode) {
      return {
        scope_type: "episode",
        episode_id: dh.episode.id,
        season: dh.episode.season,
        episode_number: dh.episode.episode,
        media_id: dh.media.id,
        media_title: dh.media.title,
        media_type: "show",
        library_status: dh.episode.status,
      };
    }
    const inferred = inferSeasonFromReleaseTitle(dh.releaseTitle);
    if (inferred == null) {
      console.warn(
        `[libraryAttention] skipping show-level DH ${dh.id}: no season parseable from "${dh.releaseTitle}"`,
      );
      return null;
    }
    return {
      scope_type: "season_pack",
      episode_id: null,
      season: inferred,
      episode_number: null,
      media_id: dh.media.id,
      media_title: dh.media.title,
      media_type: "show",
      library_status: dh.media.status,
    };
  }
  if (dh.episode?.media) {
    return {
      scope_type: "episode",
      episode_id: dh.episode.id,
      season: dh.episode.season,
      episode_number: dh.episode.episode,
      media_id: dh.episode.media.id,
      media_title: dh.episode.media.title,
      media_type: "show",
      library_status: dh.episode.status,
    };
  }
  return null;
}

const dhInclude = {
  media: { select: { id: true, title: true, type: true, status: true } },
  episode: {
    select: {
      id: true,
      season: true,
      episode: true,
      status: true,
      media: { select: { id: true, title: true, type: true, status: true } },
    },
  },
} as const;

export async function buildAttentionCandidates(): Promise<
  AttentionCandidate[]
> {
  const lookbackMs =
    LIBRARY_ATTENTION_ISSUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const issueCutoff = new Date(Date.now() - lookbackMs);
  const staleCutoff = new Date(
    Date.now() - LIBRARY_ATTENTION_STUCK_PENDING_HOURS * 60 * 60 * 1000,
  );

  const [
    failedRows,
    postProcessRows,
    stuckRows,
    skippedMovies,
    skippedEpisodes,
    stalledMovies,
    stalledEpisodes,
  ] = await Promise.all([
    prisma.downloadHistory.findMany({
      where: { failed: true, grabbedAt: { gte: issueCutoff } },
      orderBy: { grabbedAt: "desc" },
      take: LIBRARY_ATTENTION_PER_SOURCE_DH_TAKE,
      include: dhInclude,
    }),
    prisma.downloadHistory.findMany({
      where: {
        failed: false,
        postProcessError: { not: null },
        NOT: { postProcessError: "" },
        grabbedAt: { gte: issueCutoff },
      },
      orderBy: { grabbedAt: "desc" },
      take: LIBRARY_ATTENTION_PER_SOURCE_DH_TAKE,
      include: dhInclude,
    }),
    prisma.downloadHistory.findMany({
      where: {
        completedAt: null,
        failed: false,
        grabbedAt: { lt: staleCutoff },
      },
      orderBy: { grabbedAt: "asc" },
      take: LIBRARY_ATTENTION_PER_SOURCE_DH_TAKE,
      include: dhInclude,
    }),
    prisma.libraryMedia.findMany({
      where: { type: "movie", status: "skipped", monitored: true },
      select: {
        id: true,
        title: true,
        type: true,
        searchAttempts: true,
        status: true,
      },
      take: LIBRARY_ATTENTION_PER_SOURCE_MOVIE_TAKE,
    }),
    prisma.libraryEpisode.findMany({
      where: {
        status: "skipped",
        monitored: true,
        media: { monitored: true },
      },
      include: {
        media: { select: { id: true, title: true, type: true, status: true } },
      },
      take: LIBRARY_ATTENTION_PER_SOURCE_EPISODE_TAKE,
    }),
    prisma.libraryMedia.findMany({
      where: {
        type: "movie",
        status: "wanted",
        monitored: true,
        searchAttempts: { gte: LIBRARY_ATTENTION_WARN_ATTEMPTS },
        files: { none: {} },
      },
      select: {
        id: true,
        title: true,
        type: true,
        searchAttempts: true,
        status: true,
      },
      take: LIBRARY_ATTENTION_PER_SOURCE_MOVIE_TAKE,
    }),
    prisma.libraryEpisode.findMany({
      where: {
        status: "wanted",
        monitored: true,
        searchAttempts: { gte: LIBRARY_ATTENTION_WARN_ATTEMPTS },
        files: { none: {} },
        media: { type: "show", monitored: true },
      },
      include: {
        media: { select: { id: true, title: true, type: true, status: true } },
      },
      take: LIBRARY_ATTENTION_PER_SOURCE_EPISODE_TAKE,
    }),
  ]);

  const packCache = new Map<string, boolean>();
  const out: AttentionCandidate[] = [];

  for (const dh of failedRows) {
    const meta = dhScopeFromRow(dh as DhRow);
    if (!meta) continue;
    out.push({
      ...meta,
      kind: "download_failed",
      detail: dh.failReason,
      search_attempts: null,
      download_history_id: dh.id,
      grabbed_at: dh.grabbedAt,
    });
  }

  for (const dh of postProcessRows) {
    const meta = dhScopeFromRow(dh as DhRow);
    if (!meta) continue;
    out.push({
      ...meta,
      kind: "post_process_error",
      detail: dh.postProcessError,
      search_attempts: null,
      download_history_id: dh.id,
      grabbed_at: dh.grabbedAt,
    });
  }

  for (const dh of stuckRows) {
    const meta = dhScopeFromRow(dh as DhRow);
    if (!meta) continue;
    out.push({
      ...meta,
      kind: "download_stuck",
      detail: null,
      search_attempts: null,
      download_history_id: dh.id,
      grabbed_at: dh.grabbedAt,
    });
  }

  for (const m of skippedMovies) {
    if (m.type === "movie") {
      out.push({
        media_id: m.id,
        media_title: m.title,
        media_type: "movie",
        scope_type: "movie",
        episode_id: null,
        season: null,
        episode_number: null,
        kind: "grab_skipped",
        detail: null,
        search_attempts: m.searchAttempts,
        library_status: m.status,
        download_history_id: null,
        grabbed_at: null,
      });
    }
  }

  await pushEpisodePackOrIndividuals(
    skippedEpisodes.map((ep) => ({
      id: ep.id,
      mediaId: ep.mediaId,
      season: ep.season,
      episode: ep.episode,
      searchAttempts: ep.searchAttempts,
      status: ep.status,
      media: ep.media,
    })),
    "grab_skipped",
    packCache,
    out,
  );

  for (const m of stalledMovies) {
    out.push({
      media_id: m.id,
      media_title: m.title,
      media_type: "movie",
      scope_type: "movie",
      episode_id: null,
      season: null,
      episode_number: null,
      kind: "auto_grab_stalled",
      detail: null,
      search_attempts: m.searchAttempts,
      library_status: m.status,
      download_history_id: null,
      grabbed_at: null,
    });
  }

  await pushEpisodePackOrIndividuals(
    stalledEpisodes.map((ep) => ({
      id: ep.id,
      mediaId: ep.mediaId,
      season: ep.season,
      episode: ep.episode,
      searchAttempts: ep.searchAttempts,
      status: ep.status,
      media: ep.media,
    })),
    "auto_grab_stalled",
    packCache,
    out,
  );

  out.sort((a, b) => {
    const p = attentionKindPriority(a.kind) - attentionKindPriority(b.kind);
    if (p !== 0) return p;
    return (b.grabbed_at?.getTime() ?? 0) - (a.grabbed_at?.getTime() ?? 0);
  });

  return out.slice(0, LIBRARY_ATTENTION_MAX_ITEMS);
}
