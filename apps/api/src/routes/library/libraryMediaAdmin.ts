import { basename, extname, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { Elysia, t } from "elysia";

import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, serverError } from "@rawkoon/api/errors";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import { listVideoFilesUnder } from "@rawkoon/api/utils/medias/fileIdentifier";
import {
  getLibraryTmdbApiKey,
  resolveDownloadedStatus,
  sortTitleFromName,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

function parseFilenameForScan(nameWithoutExt: string): {
  title: string;
  year: number | null;
} {
  const m = nameWithoutExt.match(/^(.+?)[\s.]+(?:\(?(\d{4})\)?)\s*$/);
  if (m) {
    return {
      title: m[1]
        .replace(/[.\s]+$/g, "")
        .replace(/\./g, " ")
        .trim(),
      year: parseInt(m[2], 10),
    };
  }
  return { title: nameWithoutExt.replace(/\./g, " ").trim(), year: null };
}

function mapSettings(row: {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
  fileOperation: string;
  movieTemplate: string;
  episodeTemplate: string;
  minSeedRatio: number;
  postProcessingEnabled: boolean;
  defaultQualityProfileId?: number | null;
  activeIndexerManager?: string | null;
  updatedAt: Date;
}) {
  return {
    movies_library_path: row.moviesLibraryPath,
    shows_library_path: row.showsLibraryPath,
    file_operation: row.fileOperation,
    movie_template: row.movieTemplate,
    episode_template: row.episodeTemplate,
    min_seed_ratio: row.minSeedRatio,
    post_processing_enabled: row.postProcessingEnabled,
    default_quality_profile_id: row.defaultQualityProfileId ?? null,
    active_indexer_manager: row.activeIndexerManager ?? null,
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Admin-only library media settings (post-processing) + one-time disk scan.
 * Registered before `libraryRoutes` so paths are not captured as `/:id`.
 */
export const libraryMediaAdminRoutes = new Elysia({ prefix: "/api/library" })
  .use(requireAdmin)
  .get("/post-processing/settings", async ({ set }) => {
    try {
      let row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
      if (!row) {
        row = await prisma.mediaSettings.create({ data: { id: 1 } });
      }
      return { settings: mapSettings(row) };
    } catch {
      return serverError(set, "Failed to load media settings");
    }
  })
  .patch(
    "/post-processing/settings",
    async ({ body, set }) => {
      try {
        const update: {
          moviesLibraryPath?: string | null;
          showsLibraryPath?: string | null;
          fileOperation?: string;
          movieTemplate?: string;
          episodeTemplate?: string;
          minSeedRatio?: number;
          postProcessingEnabled?: boolean;
          defaultQualityProfileId?: number | null;
          activeIndexerManager?: string | null;
        } = {};
        if (body.movies_library_path !== undefined)
          update.moviesLibraryPath = body.movies_library_path;
        if (body.shows_library_path !== undefined)
          update.showsLibraryPath = body.shows_library_path;
        if (body.file_operation !== undefined) {
          if (
            body.file_operation !== "hardlink" &&
            body.file_operation !== "move"
          ) {
            return badRequest(set, "file_operation must be hardlink or move");
          }
          update.fileOperation = body.file_operation;
        }
        if (body.movie_template !== undefined)
          update.movieTemplate = body.movie_template;
        if (body.episode_template !== undefined)
          update.episodeTemplate = body.episode_template;
        if (body.min_seed_ratio !== undefined)
          update.minSeedRatio = body.min_seed_ratio;
        if (body.post_processing_enabled !== undefined)
          update.postProcessingEnabled = body.post_processing_enabled;
        if (body.default_quality_profile_id !== undefined)
          update.defaultQualityProfileId = body.default_quality_profile_id;
        if (body.active_indexer_manager !== undefined) {
          if (
            body.active_indexer_manager !== null &&
            body.active_indexer_manager !== "prowlarr" &&
            body.active_indexer_manager !== "jackett"
          ) {
            return badRequest(
              set,
              "active_indexer_manager must be prowlarr, jackett, or null",
            );
          }
          update.activeIndexerManager = body.active_indexer_manager;
        }

        let row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
        if (!row) {
          row = await prisma.mediaSettings.create({
            data: { id: 1, ...update },
          });
        } else if (Object.keys(update).length > 0) {
          row = await prisma.mediaSettings.update({
            where: { id: 1 },
            data: update,
          });
        }
        return { settings: mapSettings(row) };
      } catch {
        return serverError(set, "Failed to update media settings");
      }
    },
    {
      body: t.Object({
        movies_library_path: t.Optional(t.Union([t.String(), t.Null()])),
        shows_library_path: t.Optional(t.Union([t.String(), t.Null()])),
        file_operation: t.Optional(
          t.Union([t.Literal("hardlink"), t.Literal("move")]),
        ),
        movie_template: t.Optional(t.String({ maxLength: 500 })),
        episode_template: t.Optional(t.String({ maxLength: 500 })),
        min_seed_ratio: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        post_processing_enabled: t.Optional(t.Boolean()),
        default_quality_profile_id: t.Optional(t.Union([t.Number(), t.Null()])),
        active_indexer_manager: t.Optional(
          t.Union([t.Literal("prowlarr"), t.Literal("jackett"), t.Null()]),
        ),
      }),
    },
  )
  .post(
    "/scan",
    async ({ body, set }) => {
      const key = await getLibraryTmdbApiKey();
      if (!key) return badRequest(set, "TMDB is not configured");

      const absPath = resolve(body.path);
      try {
        await stat(absPath);
      } catch {
        return badRequest(set, "Path does not exist or is not accessible");
      }
      const videos = await listVideoFilesUnder(absPath);
      const unmatched: string[] = [];
      let matched = 0;

      for (const filePath of videos) {
        const base = basename(filePath, extname(filePath));
        const { title, year } = parseFilenameForScan(base);
        if (!title) {
          unmatched.push(base);
          continue;
        }

        try {
          if (body.type === "movie") {
            const search = await tmdbApiFetch<{
              results: Array<{
                id: number;
                title: string;
                release_date?: string;
              }>;
            }>("search/movie", key, {
              query: title,
              language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
              ...(year ? { year: String(year) } : {}),
            });
            const top = search.results[0];
            if (!top) {
              unmatched.push(base);
              continue;
            }
            const exists = await prisma.libraryMedia.findUnique({
              where: { tmdbId: top.id },
            });
            if (exists) continue;

            const details = await tmdbApiFetch<{
              title: string;
              release_date: string;
              poster_path: string | null;
              overview: string;
            }>(`movie/${top.id}`, key, {
              language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
            });

            const y = details.release_date
              ? parseInt(details.release_date.slice(0, 4), 10)
              : year;
            const posterUrl = details.poster_path
              ? `${TMDB_IMAGE_BASE}${details.poster_path}`
              : null;

            await prisma.libraryMedia.create({
              data: {
                tmdbId: top.id,
                type: "movie",
                title: details.title,
                sortTitle: sortTitleFromName(details.title),
                year: y,
                status: "downloaded",
                posterUrl,
                overview: details.overview || null,
              },
            });
            matched++;
          } else {
            const search = await tmdbApiFetch<{
              results: Array<{
                id: number;
                name: string;
                first_air_date?: string;
              }>;
            }>("search/tv", key, {
              query: title,
              language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
            });
            const top = search.results[0];
            if (!top) {
              unmatched.push(base);
              continue;
            }
            const exists = await prisma.libraryMedia.findUnique({
              where: { tmdbId: top.id },
            });
            if (exists) continue;

            const details = await tmdbApiFetch<{
              name: string;
              first_air_date: string;
              poster_path: string | null;
              overview: string;
              status: string | null;
            }>(`tv/${top.id}`, key, {
              language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
            });

            const y = details.first_air_date
              ? parseInt(details.first_air_date.slice(0, 4), 10)
              : year;
            const posterUrl = details.poster_path
              ? `${TMDB_IMAGE_BASE}${details.poster_path}`
              : null;

            await prisma.libraryMedia.create({
              data: {
                tmdbId: top.id,
                type: "show",
                title: details.name,
                sortTitle: sortTitleFromName(details.name),
                year: y,
                status: resolveDownloadedStatus("show", details.status ?? null),
                tmdbStatus: details.status ?? null,
                posterUrl,
                overview: details.overview || null,
              },
            });
            await prisma.$executeRaw`
              UPDATE "library_media"
              SET "tmdb_status_refreshed_at" = NOW()
              WHERE "tmdb_id" = ${top.id}
                AND "type" = 'show'
            `;
            matched++;
          }
        } catch {
          unmatched.push(base);
        }
      }

      return { matched, unmatched };
    },
    {
      body: t.Object({
        path: t.String({ maxLength: 4096 }),
        type: t.Union([t.Literal("movie"), t.Literal("show")]),
      }),
    },
  );
