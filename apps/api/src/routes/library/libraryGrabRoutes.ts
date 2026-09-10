import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { grabRelease } from "@rawkoon/api/services/mediaGrabberGrab";
import {
  searchAndGrab,
  searchAndGrabWithTitleFallback,
} from "@rawkoon/api/services/mediaGrabberSearch";
import { resolveSearchTitles } from "@rawkoon/api/utils/medias/resolveSearchTitles";
import {
  episodeMapKey,
  resolveGrabEpisodeId,
} from "@rawkoon/api/services/grabEpisodeResolver";
import {
  addJob,
  QUEUE_NAMES,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";

const searchQueryBody = z.object({
  search_query: z.string().max(400).optional(),
});

/**
 * Grab / search / upgrade actions. All admin-only.
 * POST /api/library/:id/grab | search | seasons/:season/search |
 * seasons/:season/retry-skipped | episodes/:episodeId/search | upgrade
 */
export const libraryGrabRoutes = new Hono<Env>()
  .post(
    "/:id/grab",
    requireAdmin,
    jsonV(
      z.object({
        download_url: z.string().max(8192),
        release_title: z.string().max(500),
        indexer: z.string().max(200).optional(),
        quality_parsed: z.any().optional(),
        size_bytes: z.union([z.number(), z.null()]).optional(),
        episode_id: z.union([z.number(), z.null()]).optional(),
        season: z.union([z.number(), z.null()]).optional(),
        is_upgrade: z.boolean().optional(),
      }),
    ),
    async (c) => {
      try {
        const id = parseInt(c.req.param("id"), 10);
        const body = c.req.valid("json");
        const media = await prisma.libraryMedia.findUnique({ where: { id } });
        if (!media) return notFound("Library item not found");
        // For shows, episode-level status governs grabs — don't gate on media status
        if (media.type === "movie" && media.status === "downloading") {
          return badRequest("This item cannot be grabbed in its current state");
        }

        let episodeId = body.episode_id ?? undefined;

        // Reconcile the requested episode against the release's own SxxExx.
        // The interactive search panel tags every grab with a single episode
        // context, so grabbing a different episode's release from that panel
        // would mislink it and make the post-processor render every grab to
        // the same destination (later grabs then fail with EEXIST).
        if (media.type === "show" && episodeId != null) {
          const [requested, allEpisodes] = await Promise.all([
            prisma.libraryEpisode.findFirst({
              where: { id: episodeId, mediaId: id },
              select: { id: true, season: true, episode: true },
            }),
            prisma.libraryEpisode.findMany({
              where: { mediaId: id },
              select: { id: true, season: true, episode: true },
            }),
          ]);
          // A provided episode id that no longer belongs to this item is a
          // stale context — reject rather than silently degrade to a
          // season-pack grab.
          if (!requested) {
            return badRequest("Episode not found for this library item");
          }
          const resolved = resolveGrabEpisodeId({
            requested,
            releaseTitle: body.release_title,
            episodesBySeasonEpisode: new Map(
              allEpisodes.map((e) => [episodeMapKey(e.season, e.episode), e]),
            ),
          });
          if (!resolved.ok) {
            return badRequest(resolved.reason);
          }
          episodeId = resolved.episodeId ?? undefined;
        }

        const result = await grabRelease({
          mediaId: id,
          episodeId,
          season: body.season ?? null,
          downloadUrl: body.download_url,
          releaseTitle: body.release_title,
          indexer: body.indexer ?? null,
          qualityParsed: body.quality_parsed,
          isUpgrade: body.is_upgrade ?? false,
        });

        if (result.grabbed) {
          return ok({ grabbed: true, release_title: result.releaseTitle });
        }

        return ok({ grabbed: false, reason: result.reason });
      } catch (err) {
        console.error("Library grab error:", err);
        return serverError("Grab failed");
      }
    },
  )

  .post("/:id/search", requireAdmin, jsonV(searchQueryBody), async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      const body = c.req.valid("json");
      const media = await prisma.libraryMedia.findUnique({ where: { id } });
      if (!media) return notFound("Library item not found");
      if (media.type !== "movie") {
        return badRequest("Search is only available for movies");
      }
      if (media.status === "downloading") {
        return badRequest("This item cannot be grabbed in its current state");
      }

      // Manual search resets counter + status so users can always retry.
      await prisma.libraryMedia.update({
        where: { id },
        data: { searchAttempts: 0, status: "wanted" },
      });

      const explicit = body.search_query?.trim();
      const result = explicit
        ? await searchAndGrab({
            mediaId: id,
            mediaType: "movie",
            searchQuery: explicit,
            qualityProfileId: media.qualityProfileId,
          })
        : await searchAndGrabWithTitleFallback({
            mediaId: id,
            mediaType: "movie",
            titleBaseQueries: resolveSearchTitles({
              title: media.title,
              searchTitle: media.searchTitle,
              originalTitle: media.originalTitle,
            }).queries,
            suffix: media.year ? ` ${media.year}` : "",
            qualityProfileId: media.qualityProfileId,
          });

      if (result.grabbed) {
        return ok({ grabbed: true, release_title: result.releaseTitle });
      }

      return ok({ grabbed: false, reason: result.reason });
    } catch (err) {
      console.error("Library search error:", err);
      return serverError("Search failed");
    }
  })

  .post(
    "/:id/episodes/:episodeId/search",
    requireAdmin,
    jsonV(searchQueryBody),
    async (c) => {
      try {
        const mediaId = parseInt(c.req.param("id"), 10);
        const episodeId = parseInt(c.req.param("episodeId"), 10);
        const body = c.req.valid("json");

        const media = await prisma.libraryMedia.findUnique({
          where: { id: mediaId },
        });
        if (!media) return notFound("Library item not found");
        if (media.type !== "show") {
          return badRequest("Episode search only applies to TV shows");
        }

        const ep = await prisma.libraryEpisode.findFirst({
          where: { id: episodeId, mediaId },
        });
        if (!ep) return notFound("Episode not found");

        if (ep.status === "downloading") {
          return badRequest(
            "This episode cannot be grabbed in its current state",
          );
        }

        // Manual search resets counter + status so users can always retry.
        await prisma.libraryEpisode.update({
          where: { id: episodeId },
          data: { searchAttempts: 0, status: "wanted" },
        });

        const s = String(ep.season).padStart(2, "0");
        const e = String(ep.episode).padStart(2, "0");
        const explicit = body.search_query?.trim();
        const result = explicit
          ? await searchAndGrab({
              mediaId,
              episodeId,
              mediaType: "tv",
              searchQuery: explicit,
              qualityProfileId: media.qualityProfileId,
            })
          : await searchAndGrabWithTitleFallback({
              mediaId,
              episodeId,
              mediaType: "tv",
              titleBaseQueries: resolveSearchTitles({
                title: media.title,
                searchTitle: media.searchTitle,
                originalTitle: media.originalTitle,
              }).queries,
              suffix: ` S${s}E${e}`,
              qualityProfileId: media.qualityProfileId,
            });

        if (result.grabbed) {
          return ok({ grabbed: true, release_title: result.releaseTitle });
        }

        return ok({ grabbed: false, reason: result.reason });
      } catch (err) {
        console.error("Library episode search error:", err);
        return serverError("Search failed");
      }
    },
  )

  .post("/:id/seasons/:season/retry-skipped", requireAdmin, async (c) => {
    try {
      const mediaId = parseInt(c.req.param("id"), 10);
      const season = parseInt(c.req.param("season"), 10);
      const result = await prisma.libraryEpisode.updateMany({
        where: { mediaId, season, status: "skipped" },
        data: { status: "wanted", searchAttempts: 0 },
      });
      return ok({ retried: result.count });
    } catch {
      return serverError("Failed to retry skipped episodes");
    }
  })

  .post(
    "/:id/seasons/:season/search",
    requireAdmin,
    jsonV(searchQueryBody),
    async (c) => {
      try {
        const mediaId = parseInt(c.req.param("id"), 10);
        const season = parseInt(c.req.param("season"), 10);
        const body = c.req.valid("json");

        const media = await prisma.libraryMedia.findUnique({
          where: { id: mediaId },
        });
        if (!media) return notFound("Library item not found");
        if (media.type !== "show") {
          return badRequest("Season search only applies to TV shows");
        }

        const downloadingCount = await prisma.libraryEpisode.count({
          where: { mediaId, season, status: "downloading" },
        });
        if (downloadingCount > 0) {
          return badRequest(
            "One or more episodes in this season are already downloading",
          );
        }

        // Manual search resets skipped episodes so users can retry without being blocked.
        await prisma.libraryEpisode.updateMany({
          where: { mediaId, season, status: "skipped" },
          data: { status: "wanted", searchAttempts: 0 },
        });

        const wantedEpisodes = await prisma.libraryEpisode.findMany({
          where: { mediaId, season, status: "wanted" },
        });
        if (wantedEpisodes.length === 0) {
          return badRequest("No wanted episodes in this season");
        }

        const s = String(season).padStart(2, "0");
        const explicit = body.search_query?.trim();
        const result = explicit
          ? await searchAndGrab({
              mediaId,
              season,
              mediaType: "tv",
              searchQuery: explicit,
              qualityProfileId: media.qualityProfileId,
            })
          : await searchAndGrabWithTitleFallback({
              mediaId,
              season,
              mediaType: "tv",
              titleBaseQueries: resolveSearchTitles({
                title: media.title,
                searchTitle: media.searchTitle,
                originalTitle: media.originalTitle,
              }).queries,
              suffix: ` S${s}`,
              qualityProfileId: media.qualityProfileId,
            });

        if (result.grabbed) {
          return ok({ grabbed: true, release_title: result.releaseTitle });
        }

        return ok({ grabbed: false, reason: result.reason });
      } catch (err) {
        console.error("Library season search error:", err);
        return serverError("Search failed");
      }
    },
  )

  .post(
    "/:id/upgrade",
    requireAdmin,
    jsonV(
      z.object({ mode: z.union([z.literal("auto"), z.literal("manual")]) }),
    ),
    async (c) => {
      try {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return badRequest("Invalid library id");
        const body = c.req.valid("json");

        if (body.mode === "manual") {
          return ok({ queued: false, mode: "manual" as const });
        }

        // mode === "auto"
        const media = await prisma.libraryMedia.findUnique({
          where: { id },
          select: { id: true, type: true, status: true },
        });
        if (!media) return notFound("Library item not found");

        if (media.type === "movie") {
          await prisma.libraryMedia.update({
            where: { id },
            data: { status: "upgrading" },
          });
          await addJob(
            QUEUE_NAMES.SCHEDULED_TASKS,
            SCHEDULED_JOB_NAMES.UPGRADE_MEDIA_SEARCH,
            { mediaId: id, episodeId: null },
          );
          return ok({ queued: true, mode: "auto" as const, count: 1 });
        } else {
          // show — upgrade all downloaded episodes
          const episodes = await prisma.libraryEpisode.findMany({
            where: { mediaId: id, status: "downloaded" },
            select: { id: true },
          });

          await prisma.libraryEpisode.updateMany({
            where: { id: { in: episodes.map((ep) => ep.id) } },
            data: { status: "upgrading" },
          });

          await Promise.all(
            episodes.map((ep) =>
              addJob(
                QUEUE_NAMES.SCHEDULED_TASKS,
                SCHEDULED_JOB_NAMES.UPGRADE_MEDIA_SEARCH,
                { mediaId: id, episodeId: ep.id },
              ),
            ),
          );

          return ok({
            queued: true,
            mode: "auto" as const,
            count: episodes.length,
          });
        }
      } catch {
        return serverError("Failed to enqueue upgrade");
      }
    },
  );
