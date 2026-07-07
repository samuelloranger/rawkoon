/**
 * Shared helpers used across library sub-routers.
 * Exported for use in libraryListRoutes, libraryMetaRoutes, libraryGrabRoutes, etc.
 */

export function computeTotalSizeBytes(
  files: { sizeBytes: bigint }[],
  episodes: { files: { sizeBytes: bigint }[] }[],
): string | null {
  let total = 0n;
  for (const f of files) total += f.sizeBytes;
  for (const ep of episodes) for (const f of ep.files) total += f.sizeBytes;
  return total === 0n ? null : total.toString();
}

type MappableFile = {
  sizeBytes: bigint;
  resolution: number | null;
  videoCodec: string | null;
  hdrFormat: string | null;
  audioFormat: string | null;
  durationSecs: number | null;
  languageTags: string[];
};

type MappableEpisode = {
  status: string;
  season: number;
  files: { sizeBytes: bigint }[];
};

export function mapLibraryMedia(item: {
  id: number;
  tmdbId: number;
  type: string;
  title: string;
  sortTitle: string | null;
  year: number | null;
  status: string;
  monitored: boolean;
  posterUrl: string | null;
  overview: string | null;
  overrides?: unknown;
  digitalReleaseDate: Date | null;
  qualityProfileId: number | null;
  searchAttempts: number;
  qualityProfile: { id: number; name: string } | null;
  downloadHistories?: { grabbedAt: Date }[];
  addedAt: Date;
  updatedAt: Date;
  files?: MappableFile[];
  episodes?: MappableEpisode[];
}) {
  const files = item.files ?? [];
  const episodes = item.episodes ?? [];

  // Parse the overrides JSON (Prisma returns it as unknown)
  const ov = (item.overrides ?? {}) as Record<string, unknown>;

  // Pick the file with the highest resolution (falls back to first file)
  const bestFile = files.length
    ? files.reduce((best, f) =>
        (f.resolution ?? 0) > (best.resolution ?? 0) ? f : best,
      )
    : null;

  const episodeCount = episodes.length || null;
  const downloadedEpisodeCount =
    episodes.length > 0
      ? episodes.filter((e) => e.status === "downloaded").length
      : null;
  const seasonCount =
    episodes.length > 0 ? new Set(episodes.map((e) => e.season)).size : null;

  return {
    id: item.id,
    tmdb_id: item.tmdbId,
    type: item.type,
    title: typeof ov.title === "string" ? ov.title : item.title,
    sort_title:
      typeof ov.sort_title === "string" ? ov.sort_title : item.sortTitle,
    year: typeof ov.year === "number" ? ov.year : item.year,
    status: item.status,
    monitored: item.monitored,
    poster_url:
      typeof ov.poster_url === "string" ? ov.poster_url : item.posterUrl,
    overview: typeof ov.overview === "string" ? ov.overview : item.overview,
    overrides: ov,
    digital_release_date: item.digitalReleaseDate?.toISOString() ?? null,
    quality_profile_id: item.qualityProfileId,
    search_attempts: item.searchAttempts,
    quality_profile: item.qualityProfile
      ? { id: item.qualityProfile.id, name: item.qualityProfile.name }
      : null,
    added_at: item.addedAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
    last_grabbed_at:
      item.downloadHistories?.[0]?.grabbedAt.toISOString() ?? null,
    total_size_bytes: computeTotalSizeBytes(files, episodes),
    resolution: bestFile?.resolution ?? null,
    video_codec: bestFile?.videoCodec ?? null,
    hdr_format: bestFile?.hdrFormat ?? null,
    audio_format: bestFile?.audioFormat ?? null,
    duration_secs: bestFile?.durationSecs ?? null,
    language_tags: bestFile?.languageTags ?? [],
    episode_count: episodeCount,
    downloaded_episode_count: downloadedEpisodeCount,
    season_count: seasonCount,
  };
}

export const libraryMediaInclude = {
  qualityProfile: { select: { id: true, name: true } },
  downloadHistories: {
    orderBy: { grabbedAt: "desc" as const },
    take: 1,
    select: { grabbedAt: true },
  },
  files: {
    select: {
      sizeBytes: true,
      resolution: true,
      videoCodec: true,
      hdrFormat: true,
      audioFormat: true,
      durationSecs: true,
      languageTags: true,
    },
  },
  episodes: {
    select: {
      status: true,
      season: true,
      files: { select: { sizeBytes: true } },
    },
  },
} as const;
