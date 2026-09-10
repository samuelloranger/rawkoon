import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  profileToScoreInput,
  loadProfileWithFormats,
} from "@rawkoon/api/services/mediaGrabberHelpers";
import { filesFailProfile } from "@rawkoon/api/services/upgradeDetection";

import { mapLibraryMedia, libraryMediaInclude } from "./libraryHelpers";
import {
  getLibraryTmdbApiKey,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { extractTitleTranslations } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import { buildSearchTitleOptions } from "@rawkoon/api/utils/medias/resolveSearchTitles";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import { toStringOrNull } from "@rawkoon/api/utils/medias/mappers";

const statusBody = z.object({
  status: z.union([
    z.literal("wanted"),
    z.literal("downloading"),
    z.literal("downloaded"),
    z.literal("skipped"),
  ]),
});
const monitoredBody = z.object({ monitored: z.boolean() });

/**
 * Metadata mutations: status, monitored, quality-profile, and season/episode toggles.
 * All admin-only. PATCH /api/library/:id/status | monitored | quality-profile |
 * search-title | seasons/:season/monitored | episodes/:episodeId/monitored |
 * overrides | episodes/:episodeId/status
 */
export const libraryMetaRoutes = new Hono<Env>()
  // PATCH /api/library/:id/status — update status
  .patch("/:id/status", requireAdmin, jsonV(statusBody), async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      if (!Number.isFinite(id)) return badRequest("Invalid ID");
      const body = c.req.valid("json");
      const item = await prisma.libraryMedia.update({
        where: { id },
        data: {
          status: body.status,
          ...(body.status === "wanted" ? { searchAttempts: 0 } : {}),
        },
        include: libraryMediaInclude,
      });
      return ok({ item: mapLibraryMedia(item) });
    } catch {
      return serverError("Failed to update status");
    }
  })

  // PATCH /api/library/:id/monitored — toggle monitoring for a movie or show
  .patch("/:id/monitored", requireAdmin, jsonV(monitoredBody), async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      if (!Number.isFinite(id)) return badRequest("Invalid ID");
      const item = await prisma.libraryMedia.update({
        where: { id },
        data: { monitored: c.req.valid("json").monitored },
        include: libraryMediaInclude,
      });
      return ok({ item: mapLibraryMedia(item) });
    } catch {
      return serverError("Failed to update monitored status");
    }
  })

  // PATCH /api/library/:id/quality-profile
  .patch(
    "/:id/quality-profile",
    requireAdmin,
    jsonV(z.object({ quality_profile_id: z.union([z.number(), z.null()]) })),
    async (c) => {
      try {
        const id = parseInt(c.req.param("id"), 10);
        if (!Number.isFinite(id)) return badRequest("Invalid ID");
        const body = c.req.valid("json");
        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
        });
        if (!existing) return notFound("Library item not found");

        let newProfile: Awaited<ReturnType<typeof loadProfileWithFormats>> =
          null;
        if (body.quality_profile_id != null) {
          newProfile = await loadProfileWithFormats(body.quality_profile_id);
          if (!newProfile) {
            return badRequest("Quality profile not found");
          }
        }

        const item = await prisma.libraryMedia.update({
          where: { id },
          data: { qualityProfileId: body.quality_profile_id },
          include: libraryMediaInclude,
        });

        // Detect whether existing files fail the new profile
        let needs_upgrade = false;
        let affected_episodes: number | undefined = undefined;

        const profileChanged =
          body.quality_profile_id !== existing.qualityProfileId;
        if (
          profileChanged &&
          existing.status === "downloaded" &&
          newProfile != null
        ) {
          const profileInput = profileToScoreInput(newProfile);

          const fileSelect = {
            episodeId: true,
            resolution: true,
            source: true,
            videoCodec: true,
            hdrFormat: true,
            sizeBytes: true,
            languageTags: true,
            releaseGroup: true,
          } as const;

          if (existing.type === "movie") {
            const files = await prisma.mediaFile.findMany({
              where: { mediaId: id, episodeId: null },
              select: fileSelect,
            });
            needs_upgrade = filesFailProfile(files, profileInput);
          } else {
            // show — check each downloaded episode
            const episodes = await prisma.libraryEpisode.findMany({
              where: { mediaId: id, status: "downloaded" },
              select: { id: true },
            });

            // Bulk fetch all files for these episodes in one query
            const episodeIds = episodes.map((ep) => ep.id);
            const allFiles = await prisma.mediaFile.findMany({
              where: { episodeId: { in: episodeIds } },
              select: fileSelect,
            });

            const byEpisode = new Map<number, typeof allFiles>();
            for (const f of allFiles) {
              if (f.episodeId == null) continue;
              const bucket = byEpisode.get(f.episodeId) ?? [];
              bucket.push(f);
              byEpisode.set(f.episodeId, bucket);
            }

            let failCount = 0;
            for (const ep of episodes) {
              const files = byEpisode.get(ep.id) ?? [];
              if (filesFailProfile(files, profileInput)) failCount++;
            }

            if (failCount > 0) {
              needs_upgrade = true;
              affected_episodes = failCount;
            }
          }
        }

        return ok({
          item: {
            ...mapLibraryMedia(item),
            ...(needs_upgrade ? { needs_upgrade: true } : {}),
            ...(affected_episodes !== undefined ? { affected_episodes } : {}),
          },
        });
      } catch {
        return serverError("Failed to update quality profile");
      }
    },
  )

  // PATCH /api/library/:id/search-title — set preferred indexer search title
  .patch(
    "/:id/search-title",
    requireAdmin,
    jsonV(
      z.object({
        search_title_language: z.string().min(2).max(2),
        search_title: z.string().min(1).max(500),
      }),
    ),
    async (c) => {
      try {
        const id = parseInt(c.req.param("id"), 10);
        if (!Number.isFinite(id)) return badRequest("Invalid ID");
        const body = c.req.valid("json");

        const language = body.search_title_language.trim().toLowerCase();
        const title = body.search_title.trim();
        if (!/^[a-z]{2}$/.test(language)) {
          return badRequest(
            "search_title_language must be a 2-letter ISO code",
          );
        }
        if (!title) return badRequest("search_title is required");

        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
          select: {
            id: true,
            tmdbId: true,
            type: true,
            title: true,
          },
        });
        if (!existing) return notFound("Library item not found");

        const apiKey = await getLibraryTmdbApiKey();
        if (!apiKey) return badRequest("TMDB is not configured");

        const mediaType = existing.type === "show" ? "tv" : "movie";
        const path =
          mediaType === "movie"
            ? `movie/${existing.tmdbId}`
            : `tv/${existing.tmdbId}`;
        const details = await tmdbApiFetch<{
          original_title?: string | null;
          original_name?: string | null;
          original_language?: string | null;
          translations?: unknown;
        }>(path, apiKey, {
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
          append_to_response: "translations",
        });

        const originalTitle = toStringOrNull(
          mediaType === "movie"
            ? details.original_title
            : (details.original_name ?? details.original_title),
        );
        const originalLanguage = toStringOrNull(details.original_language);
        const translations = extractTitleTranslations(
          details.translations,
          mediaType,
        );
        const options = buildSearchTitleOptions({
          englishTitle: existing.title,
          originalTitle,
          originalLanguage,
          translations,
        });
        const allowed = options.some(
          (opt) =>
            opt.languageCode === language &&
            opt.title.toLocaleLowerCase() === title.toLocaleLowerCase(),
        );
        if (!allowed) {
          return badRequest(
            "search_title must match a TMDB title for the given language",
          );
        }

        const item = await prisma.libraryMedia.update({
          where: { id },
          data: {
            searchTitle: title,
            searchTitleLanguage: language,
          },
          include: libraryMediaInclude,
        });
        return ok({ item: mapLibraryMedia(item) });
      } catch (e) {
        console.warn("[library] search-title update failed:", e);
        return serverError("Failed to update search title");
      }
    },
  )

  // PATCH /api/library/:id/seasons/:season/monitored — bulk toggle a season
  .patch(
    "/:id/seasons/:season/monitored",
    requireAdmin,
    jsonV(monitoredBody),
    async (c) => {
      try {
        const mediaId = parseInt(c.req.param("id"), 10);
        const season = parseInt(c.req.param("season"), 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(season)) {
          return badRequest("Invalid ID or season");
        }
        const result = await prisma.libraryEpisode.updateMany({
          where: { mediaId, season },
          data: { monitored: c.req.valid("json").monitored },
        });
        return ok({ updated: result.count });
      } catch {
        return serverError("Failed to update season monitored status");
      }
    },
  )

  // PATCH /api/library/:id/episodes/:episodeId/monitored — toggle an episode
  .patch(
    "/:id/episodes/:episodeId/monitored",
    requireAdmin,
    jsonV(monitoredBody),
    async (c) => {
      try {
        const mediaId = parseInt(c.req.param("id"), 10);
        const episodeId = parseInt(c.req.param("episodeId"), 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(episodeId)) {
          return badRequest("Invalid ID or episode ID");
        }
        const ep = await prisma.libraryEpisode.update({
          where: { id: episodeId, mediaId },
          data: { monitored: c.req.valid("json").monitored },
        });
        return ok({ episode: { id: ep.id, monitored: ep.monitored } });
      } catch {
        return serverError("Failed to update episode monitored status");
      }
    },
  )

  // PATCH /api/library/:id/overrides — set/clear manual metadata overrides
  .patch(
    "/:id/overrides",
    requireAdmin,
    jsonV(
      z.object({
        title: z.union([z.string(), z.null()]).optional(),
        sort_title: z.union([z.string(), z.null()]).optional(),
        year: z.union([z.number(), z.null()]).optional(),
        overview: z.union([z.string(), z.null()]).optional(),
        poster_url: z.union([z.string(), z.null()]).optional(),
      }),
    ),
    async (c) => {
      try {
        const id = parseInt(c.req.param("id"), 10);
        if (!Number.isFinite(id)) return badRequest("Invalid ID");
        const body = c.req.valid("json");
        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
          select: { overrides: true },
        });
        if (!existing) return notFound("Library item not found");

        // Merge: existing overrides + incoming fields; null values remove the key
        const current = (existing.overrides ?? {}) as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...current };
        for (const [key, val] of Object.entries(body)) {
          if (val === null) {
            delete merged[key];
          } else {
            merged[key] = val;
          }
        }

        const item = await prisma.libraryMedia.update({
          where: { id },
          data: { overrides: merged as object },
          include: libraryMediaInclude,
        });
        return ok({ item: mapLibraryMedia(item) });
      } catch {
        return serverError("Failed to update overrides");
      }
    },
  )

  // PATCH /api/library/:id/episodes/:episodeId/status — reset episode status
  .patch(
    "/:id/episodes/:episodeId/status",
    requireAdmin,
    jsonV(statusBody),
    async (c) => {
      try {
        const mediaId = parseInt(c.req.param("id"), 10);
        const episodeId = parseInt(c.req.param("episodeId"), 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(episodeId)) {
          return badRequest("Invalid ID or episode ID");
        }
        const body = c.req.valid("json");
        const ep = await prisma.libraryEpisode.update({
          where: { id: episodeId, mediaId },
          data: {
            status: body.status,
            ...(body.status === "wanted" ? { searchAttempts: 0 } : {}),
          },
        });
        return ok({
          episode: {
            id: ep.id,
            status: ep.status,
            search_attempts: ep.searchAttempts,
          },
        });
      } catch {
        return serverError("Failed to update episode status");
      }
    },
  );
