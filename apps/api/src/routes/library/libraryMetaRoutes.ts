import { Elysia, t } from "elysia";

import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
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

/**
 * Metadata mutations: status, monitored, quality-profile, and season/episode toggles.
 * PATCH /api/library/:id/status
 * PATCH /api/library/:id/monitored
 * PATCH /api/library/:id/quality-profile
 * PATCH /api/library/:id/seasons/:season/monitored
 * PATCH /api/library/:id/episodes/:episodeId/monitored
 * PATCH /api/library/:id/episodes/:episodeId/status
 * PATCH /api/library/attention/:alertId/dismiss
 */
export const libraryMetaRoutes = new Elysia()
  .use(requireAdmin)

  // PATCH /api/library/:id/status — update status
  .patch(
    "/:id/status",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) return badRequest(set, "Invalid ID");
        const item = await prisma.libraryMedia.update({
          where: { id },
          data: {
            status: body.status,
            ...(body.status === "wanted" ? { searchAttempts: 0 } : {}),
          },
          include: libraryMediaInclude,
        });
        return { item: mapLibraryMedia(item) };
      } catch {
        return serverError(set, "Failed to update status");
      }
    },
    {
      body: t.Object({
        status: t.Union([
          t.Literal("wanted"),
          t.Literal("downloading"),
          t.Literal("downloaded"),
          t.Literal("skipped"),
        ]),
      }),
    },
  )

  // PATCH /api/library/:id/monitored — toggle monitoring for a movie or show
  .patch(
    "/:id/monitored",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) return badRequest(set, "Invalid ID");
        const item = await prisma.libraryMedia.update({
          where: { id },
          data: { monitored: body.monitored },
          include: libraryMediaInclude,
        });
        return { item: mapLibraryMedia(item) };
      } catch {
        return serverError(set, "Failed to update monitored status");
      }
    },
    { body: t.Object({ monitored: t.Boolean() }) },
  )

  // PATCH /api/library/:id/quality-profile
  .patch(
    "/:id/quality-profile",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) return badRequest(set, "Invalid ID");
        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
        });
        if (!existing) return notFound(set, "Library item not found");

        let newProfile: Awaited<ReturnType<typeof loadProfileWithFormats>> =
          null;
        if (body.quality_profile_id != null) {
          newProfile = await loadProfileWithFormats(body.quality_profile_id);
          if (!newProfile) {
            return badRequest(set, "Quality profile not found");
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

            // Group files by episodeId
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

        return {
          item: {
            ...mapLibraryMedia(item),
            ...(needs_upgrade ? { needs_upgrade: true } : {}),
            ...(affected_episodes !== undefined ? { affected_episodes } : {}),
          },
        };
      } catch {
        return serverError(set, "Failed to update quality profile");
      }
    },
    {
      body: t.Object({
        quality_profile_id: t.Union([t.Number(), t.Null()]),
      }),
    },
  )

  // PATCH /api/library/:id/search-title — set preferred indexer search title
  .patch(
    "/:id/search-title",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) return badRequest(set, "Invalid ID");

        const language = body.search_title_language.trim().toLowerCase();
        const title = body.search_title.trim();
        if (!/^[a-z]{2}$/.test(language)) {
          return badRequest(
            set,
            "search_title_language must be a 2-letter ISO code",
          );
        }
        if (!title) return badRequest(set, "search_title is required");

        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
          select: {
            id: true,
            tmdbId: true,
            type: true,
            title: true,
          },
        });
        if (!existing) return notFound(set, "Library item not found");

        const apiKey = await getLibraryTmdbApiKey();
        if (!apiKey) return badRequest(set, "TMDB is not configured");

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
            set,
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
        return { item: mapLibraryMedia(item) };
      } catch (e) {
        console.warn("[library] search-title update failed:", e);
        return serverError(set, "Failed to update search title");
      }
    },
    {
      body: t.Object({
        search_title_language: t.String({ minLength: 2, maxLength: 2 }),
        search_title: t.String({ minLength: 1, maxLength: 500 }),
      }),
    },
  )

  // PATCH /api/library/:id/seasons/:season/monitored — bulk toggle monitoring for a season
  .patch(
    "/:id/seasons/:season/monitored",
    async ({ params, body, set }) => {
      try {
        const mediaId = parseInt(params.id, 10);
        const season = parseInt(params.season, 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(season)) {
          return badRequest(set, "Invalid ID or season");
        }
        const result = await prisma.libraryEpisode.updateMany({
          where: { mediaId, season },
          data: { monitored: body.monitored },
        });
        return { updated: result.count };
      } catch {
        return serverError(set, "Failed to update season monitored status");
      }
    },
    { body: t.Object({ monitored: t.Boolean() }) },
  )

  // PATCH /api/library/:id/episodes/:episodeId/monitored — toggle monitoring for an episode
  .patch(
    "/:id/episodes/:episodeId/monitored",
    async ({ params, body, set }) => {
      try {
        const mediaId = parseInt(params.id, 10);
        const episodeId = parseInt(params.episodeId, 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(episodeId)) {
          return badRequest(set, "Invalid ID or episode ID");
        }
        const ep = await prisma.libraryEpisode.update({
          where: { id: episodeId, mediaId },
          data: { monitored: body.monitored },
        });
        return {
          episode: {
            id: ep.id,
            monitored: ep.monitored,
          },
        };
      } catch {
        return serverError(set, "Failed to update episode monitored status");
      }
    },
    { body: t.Object({ monitored: t.Boolean() }) },
  )

  // PATCH /api/library/:id/overrides — set/clear manual metadata overrides
  .patch(
    "/:id/overrides",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) return badRequest(set, "Invalid ID");
        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
          select: { overrides: true },
        });
        if (!existing) return notFound(set, "Library item not found");

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
        return { item: mapLibraryMedia(item) };
      } catch {
        return serverError(set, "Failed to update overrides");
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.Union([t.String(), t.Null()])),
        sort_title: t.Optional(t.Union([t.String(), t.Null()])),
        year: t.Optional(t.Union([t.Number(), t.Null()])),
        overview: t.Optional(t.Union([t.String(), t.Null()])),
        poster_url: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )

  // PATCH /api/library/:id/episodes/:episodeId/status — reset episode status (e.g. retry skipped)
  .patch(
    "/:id/episodes/:episodeId/status",
    async ({ params, body, set }) => {
      try {
        const mediaId = parseInt(params.id, 10);
        const episodeId = parseInt(params.episodeId, 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(episodeId)) {
          return badRequest(set, "Invalid ID or episode ID");
        }
        const ep = await prisma.libraryEpisode.update({
          where: { id: episodeId, mediaId },
          data: {
            status: body.status,
            ...(body.status === "wanted" ? { searchAttempts: 0 } : {}),
          },
        });
        return {
          episode: {
            id: ep.id,
            status: ep.status,
            search_attempts: ep.searchAttempts,
          },
        };
      } catch {
        return serverError(set, "Failed to update episode status");
      }
    },
    {
      body: t.Object({
        status: t.Union([
          t.Literal("wanted"),
          t.Literal("downloading"),
          t.Literal("downloaded"),
          t.Literal("skipped"),
        ]),
      }),
    },
  );
