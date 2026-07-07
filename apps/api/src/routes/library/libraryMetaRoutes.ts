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
