import { Elysia } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { serverError } from "@rawkoon/api/errors";
import {
  loadTmdbConfig,
  toTmdbLanguage,
} from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import { fetchMediaDetails } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import { fetchCollectionDetails } from "@rawkoon/api/utils/medias/tmdbFetcherEndpoints";

export const mediasCollectionsRoutes = new Elysia()
  .use(auth)
  .use(requireUser)
  .get("/collections/missing", async ({ set, query }) => {
    try {
      const tmdbConfig = await loadTmdbConfig();
      if (!tmdbConfig) return { collections: [] };

      const language = toTmdbLanguage(
        (query as Record<string, string | undefined>).language || "en-US",
      );

      const ownedMovies = await prisma.libraryMedia.findMany({
        where: { type: "movie" },
        select: { tmdbId: true },
      });
      const ownedTmdb = new Set(ownedMovies.map((m) => m.tmdbId));

      // Cap the TMDB details inspection to the 100 most recently added movies
      // to avoid rate-limiting/timeouts on large libraries.
      const recentMovies = await prisma.libraryMedia.findMany({
        where: { type: "movie" },
        select: { tmdbId: true },
        orderBy: { addedAt: "desc" },
        take: 100,
      });
      const tmdbIds = recentMovies.map((m) => m.tmdbId);

      const BATCH_SIZE = 15;
      const detailsMap = new Map<
        number,
        Awaited<ReturnType<typeof fetchMediaDetails>>
      >();
      for (let i = 0; i < tmdbIds.length; i += BATCH_SIZE) {
        const batch = tmdbIds.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((id) =>
            fetchMediaDetails(tmdbConfig.api_key, "movie", id, language).catch(
              () => null,
            ),
          ),
        );
        batch.forEach((id, j) => {
          if (results[j]) detailsMap.set(id, results[j]!);
        });
      }

      const collectionIds = new Set<number>();
      for (const details of detailsMap.values()) {
        if (details.belongs_to_collection) {
          collectionIds.add(details.belongs_to_collection.id);
        }
      }

      if (collectionIds.size === 0) return { collections: [] };

      const collectionResults = await Promise.all(
        Array.from(collectionIds).map((id) =>
          fetchCollectionDetails(tmdbConfig.api_key, id, language),
        ),
      );

      const collections = collectionResults
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .map((collection) => {
          const movies = collection.parts.map((part) => {
            const already_exists = ownedTmdb.has(part.tmdb_id);
            return {
              id: String(part.tmdb_id),
              tmdb_id: part.tmdb_id,
              media_type: "movie" as const,
              title: part.title,
              release_year: part.release_year,
              poster_url: part.poster_url,
              overview: part.overview,
              vote_average: part.vote_average,
              already_exists,
              can_add: !already_exists,
              source_id: null,
            };
          });

          const owned_count = movies.filter((m) => m.already_exists).length;
          const missing_count = movies.length - owned_count;

          return {
            id: collection.id,
            name: collection.name,
            overview: collection.overview,
            poster_url: collection.poster_url,
            backdrop_url: collection.backdrop_url,
            movies,
            owned_count,
            total_count: movies.length,
            missing_count,
          };
        })
        .filter((c) => c.missing_count > 0 && c.owned_count > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      return { collections };
    } catch (error) {
      console.error("Error fetching missing collections:", error);
      return serverError(set, "Failed to fetch missing collections");
    }
  });
