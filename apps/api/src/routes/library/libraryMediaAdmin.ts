import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { parseReleaseStructure } from "@rawkoon/shared/utils/releaseStructure";
import { stat } from "node:fs/promises";
import { Hono } from "hono";

import { prisma } from "@rawkoon/api/db";
import {
  DEFAULT_RELEASE_CHECK_CRON,
  DEFAULT_RSS_POLL_INTERVAL_MINUTES,
  isRssPollInterval,
  normalizeCron,
  RSS_POLL_INTERVAL_MINUTES,
  type RssPollIntervalMinutes,
} from "@rawkoon/shared/utils";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { getGrabReadiness } from "@rawkoon/api/services/grabReadiness";
import {
  parseReleaseCheckCron,
  rescheduleThenPersist,
} from "@rawkoon/api/services/releaseCheckSchedule";
import {
  loadRssPollInterval,
  rescheduleRssPollThenPersist,
} from "@rawkoon/api/services/rssPollSchedule";
import { normalizeExtension } from "@rawkoon/api/services/seeding/seedPolicy";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import { listVideoFilesUnder } from "@rawkoon/api/utils/medias/fileIdentifier";
import {
  getLibraryTmdbApiKey,
  resolveDownloadedStatus,
  sortTitleFromName,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

export function parseFilenameForScan(nameWithoutExt: string): {
  title: string;
  year: number | null;
} {
  const { title, year } = parseReleaseStructure(nameWithoutExt);
  return { title, year };
}

export function mapSettings(row: {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
  downloadsPath: string | null;
  fileOperation: string;
  movieTemplate: string;
  episodeTemplate: string;
  minSeedRatio: number;
  postProcessingEnabled: boolean;
  defaultMovieQualityProfileId?: number | null;
  defaultShowQualityProfileId?: number | null;
  searchOnAdd?: boolean;
  releaseCheckCron?: string;
  rssPollIntervalMinutes?: number;
  activeIndexerManager?: string | null;
  booksLibraryPath?: string | null;
  audiobooksLibraryPath?: string | null;
  bookTemplate?: string;
  audiobookTemplate?: string;
  defaultBookQualityProfileId?: number | null;
  publicSeedTimeMins?: number | null;
  privateSeedRatio?: number | null;
  privateSeedTimeMins?: number | null;
  seedSweepEnabled?: boolean;
  blockedExtensions?: string[];
  minFreeSpaceGb?: number;
  updatedAt: Date;
}) {
  return {
    movies_library_path: row.moviesLibraryPath,
    shows_library_path: row.showsLibraryPath,
    downloads_path: row.downloadsPath,
    file_operation: row.fileOperation,
    movie_template: row.movieTemplate,
    episode_template: row.episodeTemplate,
    min_seed_ratio: row.minSeedRatio,
    post_processing_enabled: row.postProcessingEnabled,
    default_movie_quality_profile_id: row.defaultMovieQualityProfileId ?? null,
    default_show_quality_profile_id: row.defaultShowQualityProfileId ?? null,
    search_on_add: row.searchOnAdd ?? true,
    release_check_cron: row.releaseCheckCron ?? DEFAULT_RELEASE_CHECK_CRON,
    rss_poll_interval_minutes: isRssPollInterval(row.rssPollIntervalMinutes)
      ? row.rssPollIntervalMinutes
      : DEFAULT_RSS_POLL_INTERVAL_MINUTES,
    active_indexer_manager: row.activeIndexerManager ?? null,
    // Book paths and templates live on the same row: post-processing settings
    // are per-instance, not per-media-kind, and splitting them would mean two
    // places to look for "where does my library go".
    books_library_path: row.booksLibraryPath ?? null,
    audiobooks_library_path: row.audiobooksLibraryPath ?? null,
    book_template: row.bookTemplate ?? "",
    audiobook_template: row.audiobookTemplate ?? "",
    default_book_quality_profile_id: row.defaultBookQualityProfileId ?? null,
    public_seed_time_mins: row.publicSeedTimeMins ?? null,
    private_seed_ratio:
      row.privateSeedRatio === undefined ? 1 : row.privateSeedRatio,
    private_seed_time_mins: row.privateSeedTimeMins ?? null,
    seed_sweep_enabled: row.seedSweepEnabled ?? false,
    blocked_extensions: row.blockedExtensions ?? [],
    min_free_space_gb: row.minFreeSpaceGb ?? 10,
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Admin-only library media settings (post-processing) + one-time disk scan.
 * Registered before `libraryRoutes` so paths are not captured as `/:id`.
 */
export const libraryMediaAdminRoutes = new Hono<Env>()
  .get("/post-processing/settings", requireAdmin, async () => {
    try {
      let row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
      if (!row) {
        row = await prisma.mediaSettings.create({ data: { id: 1 } });
      }
      return ok({ settings: mapSettings(row) });
    } catch {
      return serverError("Failed to load media settings");
    }
  })
  .get("/post-processing/grab-readiness", requireAdmin, async (c) => {
    try {
      const refresh = c.req.query("refresh") === "1";
      return ok({ checks: await getGrabReadiness({ refresh }) });
    } catch {
      return serverError("Failed to check grab readiness");
    }
  })
  .patch(
    "/post-processing/settings",
    requireAdmin,
    jsonV(
      z.object({
        movies_library_path: z.union([z.string(), z.null()]).optional(),
        shows_library_path: z.union([z.string(), z.null()]).optional(),
        downloads_path: z.union([z.string(), z.null()]).optional(),
        file_operation: z
          .union([z.literal("hardlink"), z.literal("move")])
          .optional(),
        movie_template: z.string().max(500).optional(),
        episode_template: z.string().max(500).optional(),
        min_seed_ratio: z.number().min(0).max(100).optional(),
        post_processing_enabled: z.boolean().optional(),
        default_movie_quality_profile_id: z
          .union([z.number(), z.null()])
          .optional(),
        default_show_quality_profile_id: z
          .union([z.number(), z.null()])
          .optional(),
        search_on_add: z.boolean().optional(),
        release_check_cron: z.string().max(100).optional(),
        rss_poll_interval_minutes: z.number().int().optional(),
        active_indexer_manager: z
          .union([z.literal("prowlarr"), z.literal("jackett"), z.null()])
          .optional(),
        books_library_path: z.union([z.string(), z.null()]).optional(),
        audiobooks_library_path: z.union([z.string(), z.null()]).optional(),
        book_template: z.string().max(500).optional(),
        audiobook_template: z.string().max(500).optional(),
        default_book_quality_profile_id: z
          .union([z.number(), z.null()])
          .optional(),
        public_seed_time_mins: z
          .number()
          .int()
          .min(0)
          .max(525_600)
          .nullable()
          .optional(),
        private_seed_ratio: z.number().min(0).max(100).nullable().optional(),
        private_seed_time_mins: z
          .number()
          .int()
          .min(0)
          .max(525_600)
          .nullable()
          .optional(),
        seed_sweep_enabled: z.boolean().optional(),
        blocked_extensions: z.array(z.string().max(12)).max(100).optional(),
        min_free_space_gb: z.number().int().min(0).max(100_000).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const update: {
          moviesLibraryPath?: string | null;
          showsLibraryPath?: string | null;
          downloadsPath?: string | null;
          fileOperation?: string;
          movieTemplate?: string;
          episodeTemplate?: string;
          minSeedRatio?: number;
          postProcessingEnabled?: boolean;
          defaultMovieQualityProfileId?: number | null;
          defaultShowQualityProfileId?: number | null;
          searchOnAdd?: boolean;
          releaseCheckCron?: string;
          rssPollIntervalMinutes?: number;
          activeIndexerManager?: string | null;
          booksLibraryPath?: string | null;
          audiobooksLibraryPath?: string | null;
          bookTemplate?: string;
          audiobookTemplate?: string;
          defaultBookQualityProfileId?: number | null;
          publicSeedTimeMins?: number | null;
          privateSeedRatio?: number | null;
          privateSeedTimeMins?: number | null;
          seedSweepEnabled?: boolean;
          blockedExtensions?: string[];
          minFreeSpaceGb?: number;
        } = {};
        if (body.movies_library_path !== undefined)
          update.moviesLibraryPath = body.movies_library_path;
        if (body.shows_library_path !== undefined)
          update.showsLibraryPath = body.shows_library_path;
        if (body.downloads_path !== undefined)
          update.downloadsPath = body.downloads_path;
        if (body.file_operation !== undefined) {
          if (
            body.file_operation !== "hardlink" &&
            body.file_operation !== "move"
          ) {
            return badRequest("file_operation must be hardlink or move");
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
        if (body.default_movie_quality_profile_id !== undefined)
          update.defaultMovieQualityProfileId =
            body.default_movie_quality_profile_id;
        if (body.default_show_quality_profile_id !== undefined)
          update.defaultShowQualityProfileId =
            body.default_show_quality_profile_id;
        if (body.search_on_add !== undefined)
          update.searchOnAdd = body.search_on_add;
        if (body.release_check_cron !== undefined) {
          const parsed = parseReleaseCheckCron(body.release_check_cron);
          if (!parsed.ok) return badRequest(parsed.error);
          update.releaseCheckCron = parsed.cron;
        }
        let rssPollInterval: RssPollIntervalMinutes | undefined;
        if (body.rss_poll_interval_minutes !== undefined) {
          if (!isRssPollInterval(body.rss_poll_interval_minutes)) {
            return badRequest(
              `rss_poll_interval_minutes must be one of ${RSS_POLL_INTERVAL_MINUTES.join(", ")}`,
            );
          }
          rssPollInterval = body.rss_poll_interval_minutes;
          update.rssPollIntervalMinutes = rssPollInterval;
        }
        if (body.active_indexer_manager !== undefined) {
          if (
            body.active_indexer_manager !== null &&
            body.active_indexer_manager !== "prowlarr" &&
            body.active_indexer_manager !== "jackett"
          ) {
            return badRequest(
              "active_indexer_manager must be prowlarr, jackett, or null",
            );
          }
          update.activeIndexerManager = body.active_indexer_manager;
        }
        if (body.books_library_path !== undefined)
          update.booksLibraryPath = body.books_library_path;
        if (body.audiobooks_library_path !== undefined)
          update.audiobooksLibraryPath = body.audiobooks_library_path;
        if (body.book_template !== undefined)
          update.bookTemplate = body.book_template;
        if (body.audiobook_template !== undefined)
          update.audiobookTemplate = body.audiobook_template;
        if (body.default_book_quality_profile_id !== undefined)
          update.defaultBookQualityProfileId =
            body.default_book_quality_profile_id;
        if (body.public_seed_time_mins !== undefined)
          update.publicSeedTimeMins = body.public_seed_time_mins;
        if (body.private_seed_ratio !== undefined)
          update.privateSeedRatio = body.private_seed_ratio;
        if (body.private_seed_time_mins !== undefined)
          update.privateSeedTimeMins = body.private_seed_time_mins;
        if (body.seed_sweep_enabled !== undefined)
          update.seedSweepEnabled = body.seed_sweep_enabled;
        if (body.min_free_space_gb !== undefined)
          update.minFreeSpaceGb = body.min_free_space_gb;
        if (body.blocked_extensions !== undefined) {
          const normalized = body.blocked_extensions.map(normalizeExtension);
          if (normalized.some((e) => e === null)) {
            return badRequest(
              "blocked_extensions must be file extensions like exe or .lnk",
            );
          }
          update.blockedExtensions = [...new Set(normalized as string[])];
        }

        let row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
        const previousCron =
          row?.releaseCheckCron ?? DEFAULT_RELEASE_CHECK_CRON;
        const existing = row;
        const persist = async () => {
          if (!existing) {
            row = await prisma.mediaSettings.create({
              data: { id: 1, ...update },
            });
          } else if (Object.keys(update).length > 0) {
            row = await prisma.mediaSettings.update({
              where: { id: 1 },
              data: update,
            });
          }
        };
        let save = persist;
        if (
          update.releaseCheckCron !== undefined &&
          update.releaseCheckCron !== previousCron
        ) {
          const cron = update.releaseCheckCron;
          // Schedule before saving so a cron BullMQ rejects is never stored.
          save = () => rescheduleThenPersist(cron, previousCron, persist);
        }
        if (rssPollInterval !== undefined) {
          const previousInterval = await loadRssPollInterval(
            async () => existing?.rssPollIntervalMinutes,
          );
          if (rssPollInterval !== previousInterval) {
            const inner = save;
            save = () =>
              rescheduleRssPollThenPersist(
                rssPollInterval,
                previousInterval,
                inner,
              );
          }
        }
        await save();
        return ok({ settings: mapSettings(row!) });
      } catch {
        return serverError("Failed to update media settings");
      }
    },
  )
  .post(
    "/scan",
    requireAdmin,
    jsonV(
      z.object({
        path: z.string().max(4096),
        type: z.union([z.literal("movie"), z.literal("show")]),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const key = await getLibraryTmdbApiKey();
      if (!key) return badRequest("TMDB is not configured");

      const absPath = resolve(body.path);
      try {
        await stat(absPath);
      } catch {
        return badRequest("Path does not exist or is not accessible");
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

      return ok({ matched, unmatched });
    },
  );
