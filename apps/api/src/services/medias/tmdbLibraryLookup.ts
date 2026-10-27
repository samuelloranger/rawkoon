import { prisma } from "@rawkoon/api/db";

type LibraryEntry = { id: number; status: string };

export async function libraryEntriesForTmdbIds(
  tmdbIds: number[],
): Promise<Map<number, { id: number; status: string }>> {
  if (tmdbIds.length === 0) return new Map();
  const entries = await prisma.libraryMedia.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: { tmdbId: true, id: true, status: true },
  });
  return new Map(
    entries.map((e) => [e.tmdbId, { id: e.id, status: e.status }]),
  );
}

export async function loadAllLibraryTmdbIds(): Promise<{
  libraryIdByTmdbId: Map<number, number>;
  libraryByTmdbId: Map<number, LibraryEntry>;
  allTmdbIds: Set<number>;
  movieTmdbIds: number[];
  showTmdbIds: number[];
}> {
  const libraryAllEntries = await prisma.libraryMedia.findMany({
    select: { tmdbId: true, id: true, type: true, status: true },
  });

  const libraryIdByTmdbId = new Map(
    libraryAllEntries.map((e) => [e.tmdbId, e.id]),
  );

  return {
    libraryIdByTmdbId,
    libraryByTmdbId: new Map(
      libraryAllEntries.map((e) => [e.tmdbId, { id: e.id, status: e.status }]),
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
