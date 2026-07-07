import { prisma } from "@rawkoon/api/db";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";
import { toIsoDate } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";

const TMDB_WEB_BASE_URL = "https://www.themoviedb.org";

type LibraryMediaBase = {
  id: number;
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  overview: string | null;
};

const buildUpcomingId = (
  media: LibraryMediaBase,
  mediaType: "movie" | "tv",
  releaseDateIso?: string,
  episode?: { season: number; episode: number } | null,
): string => {
  if (mediaType === "movie" || !releaseDateIso) {
    return `${mediaType}-${media.tmdbId}`;
  }
  if (!episode) return `${mediaType}-${media.tmdbId}-${releaseDateIso}`;
  return `${mediaType}-${media.tmdbId}-${releaseDateIso}-s${episode.season}e${episode.episode}`;
};

const mapToItem = (
  media: LibraryMediaBase,
  mediaType: "movie" | "tv",
  releaseDateIso: string,
  episode?: { season: number; episode: number } | null,
): DashboardUpcomingItem => ({
  id: buildUpcomingId(media, mediaType, releaseDateIso, episode),
  title: media.title,
  media_type: mediaType,
  release_date: releaseDateIso,
  poster_url: media.posterUrl,
  backdrop_url: null,
  overview: media.overview,
  tmdb_url: `${TMDB_WEB_BASE_URL}/${mediaType}/${media.tmdbId}`,
  providers: [],
  library_id: media.id,
  season_number: episode?.season ?? null,
  episode_number: episode?.episode ?? null,
  vote_average: null,
});

/**
 * Collect upcoming TV episodes and movies from the user's library within the
 * date window. For shows, returns one entry per series (earliest upcoming
 * episode). Items bypass popularity filters — the user is already tracking them.
 */
export const collectLibraryUpcoming = async (
  fromDateIso: string,
  toDateIso: string,
): Promise<DashboardUpcomingItem[]> => {
  const fromDate = new Date(`${fromDateIso}T00:00:00.000Z`);
  const toDate = new Date(`${toDateIso}T23:59:59.999Z`);

  const [episodes, movies] = await Promise.all([
    prisma.libraryEpisode.findMany({
      where: {
        airDate: { gte: fromDate, lte: toDate },
        monitored: true,
        media: { type: "show", monitored: true },
      },
      orderBy: { airDate: "asc" },
      include: {
        media: {
          select: {
            tmdbId: true,
            id: true,
            title: true,
            posterUrl: true,
            overview: true,
          },
        },
      },
    }),
    prisma.libraryMedia.findMany({
      where: {
        type: "movie",
        monitored: true,
        digitalReleaseDate: { gte: fromDate, lte: toDate },
      },
      select: {
        tmdbId: true,
        id: true,
        title: true,
        posterUrl: true,
        overview: true,
        digitalReleaseDate: true,
      },
    }),
  ]);

  const byMediaDate = new Map<
    string,
    {
      item: DashboardUpcomingItem;
      episodeCountOnDate: number;
    }
  >();
  for (const ep of episodes) {
    if (!ep.airDate) continue;
    const releaseDateIso = toIsoDate(ep.airDate);
    const groupKey = `${ep.mediaId}:${releaseDateIso}`;
    const existing = byMediaDate.get(groupKey);
    if (existing) {
      existing.episodeCountOnDate += 1;
      existing.item.id = buildUpcomingId(ep.media, "tv", releaseDateIso, null);
      existing.item.season_number = null;
      existing.item.episode_number = null;
      continue;
    }

    byMediaDate.set(groupKey, {
      item: mapToItem(ep.media, "tv", releaseDateIso, {
        season: ep.season,
        episode: ep.episode,
      }),
      episodeCountOnDate: 1,
    });
  }

  const movieItems = movies
    .filter((m) => m.digitalReleaseDate)
    .map((m) => mapToItem(m, "movie", toIsoDate(m.digitalReleaseDate!)));

  return [
    ...Array.from(byMediaDate.values(), ({ item }) => item),
    ...movieItems,
  ];
};

/**
 * Merge upcoming items, preferring `base` on id collision. Use to add library
 * entries on top of a popularity-filtered TMDB list without clobbering TMDB
 * enrichment (providers, backdrops).
 */
export const mergeUpcomingById = (
  base: DashboardUpcomingItem[],
  additions: DashboardUpcomingItem[],
): DashboardUpcomingItem[] => {
  const seen = new Set(base.map((item) => item.id));
  const merged = [...base];
  for (const item of additions) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
};

export const attachLibraryIds = async (
  items: DashboardUpcomingItem[],
): Promise<DashboardUpcomingItem[]> => {
  const tmdbIds = [
    ...new Set(
      items
        .map((item) => {
          const [source, numericPart] = item.id.split("-", 2);
          if (source !== "movie" && source !== "tv") return null;
          const id = numericPart ? parseInt(numericPart, 10) : Number.NaN;
          return Number.isFinite(id) && id > 0 ? id : null;
        })
        .filter((id): id is number => id != null),
    ),
  ];

  if (tmdbIds.length === 0) return items;

  const libraryRows = await prisma.libraryMedia.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: { id: true, tmdbId: true },
  });
  const libraryIdByTmdbId = new Map(
    libraryRows.map((row) => [row.tmdbId, row.id]),
  );

  return items.map((item) => {
    if (item.library_id != null) return item;
    const [source, numericPart] = item.id.split("-", 2);
    if (source !== "movie" && source !== "tv") return item;
    const tmdbId = numericPart ? parseInt(numericPart, 10) : Number.NaN;
    const libraryId = Number.isFinite(tmdbId)
      ? (libraryIdByTmdbId.get(tmdbId) ?? null)
      : null;
    return libraryId == null ? item : { ...item, library_id: libraryId };
  });
};
