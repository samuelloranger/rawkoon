import { Elysia, t } from "elysia";

import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import { grabRelease } from "@rawkoon/api/services/mediaGrabberGrab";
import { searchAndGrab } from "@rawkoon/api/services/mediaGrabberSearch";
import {
  episodeMapKey,
  resolveGrabEpisodeId,
} from "@rawkoon/api/services/grabEpisodeResolver";
import {
  addJob,
  QUEUE_NAMES,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";

/**
 * Grab / search / upgrade actions.
 * POST /api/library/:id/grab
 * POST /api/library/:id/search
 * POST /api/library/:id/seasons/:season/search
 * POST /api/library/:id/seasons/:season/retry-skipped
 * POST /api/library/:id/episodes/:episodeId/search
 * POST /api/library/:id/upgrade
 */
export const libraryGrabRoutes = new Elysia()
  .use(requireAdmin)

  // POST /api/library/:id/grab — interactive grab (known download URL → qB + history)
  .post(
    "/:id/grab",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        const media = await prisma.libraryMedia.findUnique({ where: { id } });
        if (!media) return notFound(set, "Library item not found");
        // For shows, episode-level status governs grabs — don't gate on media status
        if (media.type === "movie" && media.status === "downloading") {
          return badRequest(
            set,
            "This item cannot be grabbed in its current state",
          );
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
          const resolved = resolveGrabEpisodeId({
            requested,
            releaseTitle: body.release_title,
            episodesBySeasonEpisode: new Map(
              allEpisodes.map((e) => [episodeMapKey(e.season, e.episode), e]),
            ),
          });
          if (!resolved.ok) {
            return badRequest(set, resolved.reason);
          }
          episodeId = resolved.episodeId ?? undefined;
        }

        const result = await grabRelease({
          mediaId: id,
          episodeId,
          downloadUrl: body.download_url,
          releaseTitle: body.release_title,
          indexer: body.indexer ?? null,
          qualityParsed: body.quality_parsed,
          isUpgrade: body.is_upgrade ?? false,
        });

        if (result.grabbed) {
          return { grabbed: true, release_title: result.releaseTitle };
        }

        return { grabbed: false, reason: result.reason };
      } catch (err) {
        console.error("Library grab error:", err);
        return serverError(set, "Grab failed");
      }
    },
    {
      body: t.Object({
        download_url: t.String({ maxLength: 8192 }),
        release_title: t.String({ maxLength: 500 }),
        indexer: t.Optional(t.String({ maxLength: 200 })),
        quality_parsed: t.Optional(t.Any()),
        size_bytes: t.Optional(t.Union([t.Number(), t.Null()])),
        episode_id: t.Optional(t.Union([t.Number(), t.Null()])),
        is_upgrade: t.Optional(t.Boolean()),
      }),
    },
  )

  // POST /api/library/:id/search — manual Prowlarr search + grab (movies)
  .post(
    "/:id/search",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        const media = await prisma.libraryMedia.findUnique({ where: { id } });
        if (!media) return notFound(set, "Library item not found");
        if (media.type !== "movie") {
          return badRequest(set, "Search is only available for movies");
        }
        if (media.status === "downloading") {
          return badRequest(
            set,
            "This item cannot be grabbed in its current state",
          );
        }

        // Manual search resets counter + status so users can always retry.
        await prisma.libraryMedia.update({
          where: { id },
          data: { searchAttempts: 0, status: "wanted" },
        });

        const q =
          body.search_query?.trim() ||
          (media.year ? `${media.title} ${media.year}` : media.title);

        const result = await searchAndGrab({
          mediaId: id,
          mediaType: "movie",
          searchQuery: q,
          qualityProfileId: media.qualityProfileId,
        });

        if (result.grabbed) {
          return { grabbed: true, release_title: result.releaseTitle };
        }

        return { grabbed: false, reason: result.reason };
      } catch (err) {
        console.error("Library search error:", err);
        return serverError(set, "Search failed");
      }
    },
    {
      body: t.Object({
        search_query: t.Optional(t.String({ maxLength: 400 })),
      }),
    },
  )

  // POST /api/library/:id/episodes/:episodeId/search — episode grab (shows)
  .post(
    "/:id/episodes/:episodeId/search",
    async ({ params, body, set }) => {
      try {
        const mediaId = parseInt(params.id, 10);
        const episodeId = parseInt(params.episodeId, 10);

        const media = await prisma.libraryMedia.findUnique({
          where: { id: mediaId },
        });
        if (!media) return notFound(set, "Library item not found");
        if (media.type !== "show") {
          return badRequest(set, "Episode search only applies to TV shows");
        }

        const ep = await prisma.libraryEpisode.findFirst({
          where: { id: episodeId, mediaId },
        });
        if (!ep) return notFound(set, "Episode not found");

        if (ep.status === "downloading") {
          return badRequest(
            set,
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
        const defaultQ = `${media.title} S${s}E${e}`;
        const q = body.search_query?.trim() || defaultQ;

        const result = await searchAndGrab({
          mediaId,
          episodeId,
          mediaType: "tv",
          searchQuery: q,
          qualityProfileId: media.qualityProfileId,
        });

        if (result.grabbed) {
          return { grabbed: true, release_title: result.releaseTitle };
        }

        return { grabbed: false, reason: result.reason };
      } catch (err) {
        console.error("Library episode search error:", err);
        return serverError(set, "Search failed");
      }
    },
    {
      body: t.Object({
        search_query: t.Optional(t.String({ maxLength: 400 })),
      }),
    },
  )

  // POST /api/library/:id/seasons/:season/retry-skipped — reset all skipped episodes in a season
  .post("/:id/seasons/:season/retry-skipped", async ({ params, set }) => {
    try {
      const mediaId = parseInt(params.id, 10);
      const season = parseInt(params.season, 10);
      const result = await prisma.libraryEpisode.updateMany({
        where: { mediaId, season, status: "skipped" },
        data: { status: "wanted", searchAttempts: 0 },
      });
      return { retried: result.count };
    } catch {
      return serverError(set, "Failed to retry skipped episodes");
    }
  })

  // POST /api/library/:id/seasons/:season/search — auto-grab best season pack
  .post(
    "/:id/seasons/:season/search",
    async ({ params, body, set }) => {
      try {
        const mediaId = parseInt(params.id, 10);
        const season = parseInt(params.season, 10);

        const media = await prisma.libraryMedia.findUnique({
          where: { id: mediaId },
        });
        if (!media) return notFound(set, "Library item not found");
        if (media.type !== "show") {
          return badRequest(set, "Season search only applies to TV shows");
        }

        const downloadingCount = await prisma.libraryEpisode.count({
          where: { mediaId, season, status: "downloading" },
        });
        if (downloadingCount > 0) {
          return badRequest(
            set,
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
          return badRequest(set, "No wanted episodes in this season");
        }

        const s = String(season).padStart(2, "0");
        const defaultQ = `${media.title} S${s}`;
        const q = body.search_query?.trim() || defaultQ;

        const result = await searchAndGrab({
          mediaId,
          mediaType: "tv",
          searchQuery: q,
          qualityProfileId: media.qualityProfileId,
        });

        if (result.grabbed) {
          return { grabbed: true, release_title: result.releaseTitle };
        }

        return { grabbed: false, reason: result.reason };
      } catch (err) {
        console.error("Library season search error:", err);
        return serverError(set, "Search failed");
      }
    },
    {
      body: t.Object({
        search_query: t.Optional(t.String({ maxLength: 400 })),
      }),
    },
  )

  // POST /api/library/:id/upgrade
  .post(
    "/:id/upgrade",
    async ({ params, body, set }) => {
      try {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) return badRequest(set, "Invalid library id");

        if (body.mode === "manual") {
          return { queued: false, mode: "manual" as const };
        }

        // mode === "auto"
        const media = await prisma.libraryMedia.findUnique({
          where: { id },
          select: { id: true, type: true, status: true },
        });
        if (!media) return notFound(set, "Library item not found");

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
          return { queued: true, mode: "auto" as const, count: 1 };
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

          return {
            queued: true,
            mode: "auto" as const,
            count: episodes.length,
          };
        }
      } catch {
        return serverError(set, "Failed to enqueue upgrade");
      }
    },
    {
      body: t.Object({
        mode: t.Union([t.Literal("auto"), t.Literal("manual")]),
      }),
    },
  );
