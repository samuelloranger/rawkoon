import { prisma } from "@rawkoon/api/db";

type LibraryEntry = { id: number; status: string };

/** Map key for a library title; a movie and a show can share a TMDB id. */
export const libraryKey = (
  tmdbId: number,
  mediaType: "movie" | "show" | "tv",
): string => `${mediaType === "movie" ? "movie" : "show"}:${tmdbId}`;

export async function libraryEntriesForTmdbItems(
  items: { tmdb_id: number; media_type: "movie" | "tv" }[],
): Promise<Map<string, LibraryEntry>> {
  if (items.length === 0) return new Map();
  const entries = await prisma.libraryMedia.findMany({
    where: { tmdbId: { in: items.map((i) => i.tmdb_id) } },
    select: { tmdbId: true, type: true, id: true, status: true },
  });
  return new Map(
    entries.map((e) => [
      libraryKey(e.tmdbId, e.type === "movie" ? "movie" : "show"),
      { id: e.id, status: e.status },
    ]),
  );
}

export async function loadAllLibraryTmdbIds(): Promise<{
  libraryByKey: Map<string, LibraryEntry>;
  allTmdbIds: Set<number>;
  movieTmdbIds: number[];
  showTmdbIds: number[];
}> {
  const libraryAllEntries = await prisma.libraryMedia.findMany({
    select: { tmdbId: true, id: true, type: true, status: true },
  });

  return {
    libraryByKey: new Map(
      libraryAllEntries.map((e) => [
        libraryKey(e.tmdbId, e.type === "movie" ? "movie" : "show"),
        { id: e.id, status: e.status },
      ]),
    ),
    allTmdbIds: new Set(libraryAllEntries.map((e) => e.tmdbId)),
    movieTmdbIds: libraryAllEntries
      .filter((e) => e.type === "movie")
      .map((e) => e.tmdbId),
    showTmdbIds: libraryAllEntries
      .filter((e) => e.type === "show")
      .map((e) => e.tmdbId),
  };
}

export async function fetchModalLibraryEpisodes(
  mediaType: "movie" | "tv",
  tmdbId: number,
) {
  if (mediaType !== "tv") return null;
  const show = await prisma.libraryMedia.findFirst({
    where: { tmdbId, type: "show" },
    select: {
      episodes: {
        where: { status: "downloaded" },
        select: { season: true, episode: true },
      },
    },
  });
  if (!show) return { in_library: false, downloaded: [] };
  return {
    in_library: true,
    downloaded: show.episodes.map((e) => ({
      season_number: e.season,
      episode_number: e.episode,
    })),
  };
}
