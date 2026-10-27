import { prisma } from "@rawkoon/api/db";
import type { ExportLibraryResponse, ExportMedia } from "@rawkoon/shared/types";

export async function buildLibraryExport(
  page: number,
  limit: number,
): Promise<ExportLibraryResponse> {
  const rows = await prisma.libraryMedia.findMany({
    where: { files: { some: {} } },
    orderBy: { id: "asc" },
    skip: (page - 1) * limit,
    // One extra row tells us whether another page exists.
    take: limit + 1,
    select: {
      id: true,
      tmdbId: true,
      type: true,
      title: true,
      originalTitle: true,
      originalLanguage: true,
      year: true,
      overview: true,
      posterUrl: true,
      overrides: true,
      updatedAt: true,
      files: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          episodeId: true,
          filePath: true,
          fileName: true,
          sizeBytes: true,
          durationSecs: true,
          releaseGroup: true,
          source: true,
          resolution: true,
          videoCodec: true,
          videoProfile: true,
          hdrFormat: true,
          bitDepth: true,
          width: true,
          height: true,
          frameRate: true,
          audioFormat: true,
          audioTracks: true,
          subtitleTracks: true,
          languageTags: true,
          episode: { select: { season: true, episode: true } },
        },
      },
      episodes: {
        orderBy: [{ season: "asc" }, { episode: "asc" }],
        select: {
          id: true,
          season: true,
          episode: true,
          airDate: true,
          status: true,
        },
      },
      downloadHistories: {
        where: { completedAt: { not: null }, failed: false },
        orderBy: { completedAt: "desc" },
        select: {
          releaseTitle: true,
          torrentHash: true,
          indexer: true,
          season: true,
          episodeId: true,
          completedAt: true,
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const items: ExportMedia[] = rows.slice(0, limit).map((row) => {
    const ov = (row.overrides ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tmdb_id: row.tmdbId,
      type: row.type,
      title: typeof ov.title === "string" ? ov.title : row.title,
      original_title: row.originalTitle,
      original_language: row.originalLanguage,
      year: typeof ov.year === "number" ? ov.year : row.year,
      overview: typeof ov.overview === "string" ? ov.overview : row.overview,
      poster_url:
        typeof ov.poster_url === "string" ? ov.poster_url : row.posterUrl,
      updated_at: row.updatedAt.toISOString(),
      files: row.files.map((f) => ({
        id: f.id,
        episode_id: f.episodeId,
        season: f.episode?.season ?? null,
        episode: f.episode?.episode ?? null,
        file_path: f.filePath,
        file_name: f.fileName,
        size_bytes: f.sizeBytes.toString(),
        duration_secs: f.durationSecs,
        release_group: f.releaseGroup,
        source: f.source,
        resolution: f.resolution,
        video_codec: f.videoCodec,
        video_profile: f.videoProfile,
        hdr_format: f.hdrFormat,
        bit_depth: f.bitDepth,
        width: f.width,
        height: f.height,
        frame_rate: f.frameRate,
        audio_format: f.audioFormat,
        audio_tracks: f.audioTracks,
        subtitle_tracks: f.subtitleTracks,
        language_tags: f.languageTags,
      })),
      episodes:
        row.type === "show"
          ? row.episodes.map((e) => ({
              id: e.id,
              season: e.season,
              episode: e.episode,
              air_date: e.airDate?.toISOString().slice(0, 10) ?? null,
              status: e.status,
            }))
          : [],
      downloads: row.downloadHistories.flatMap((d) =>
        d.completedAt
          ? [
              {
                release_title: d.releaseTitle,
                torrent_hash: d.torrentHash,
                indexer: d.indexer,
                season: d.season,
                episode_id: d.episodeId,
                completed_at: d.completedAt.toISOString(),
              },
            ]
          : [],
      ),
    };
  });

  return { items, page, limit, has_more: hasMore };
}
