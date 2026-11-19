import { Hono } from "hono";
import { z } from "zod";

import { withKeyedLock } from "@rawkoon/api/utils/keyedLock";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { cancelActiveMovieDownloads } from "@rawkoon/api/services/replaceActiveDownload";
import {
  grabRelease,
  preflightGrab,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab";
import { targetHasFileOnDisk } from "@rawkoon/api/services/library/targetHasFileOnDisk";
import type {
  LanguageFallbackSummary,
  SearchResultPayload,
} from "@rawkoon/shared/types";
import { searchLibraryTarget } from "@rawkoon/api/services/searchLibraryTarget";
import {
  countDownloadingEpisodes,
  enqueueAutoUpgrade,
  findEpisodeOfMedia,
  findLibraryMediaForUpgrade,
  findLibraryMediaRow,
  listWantedEpisodes,
  resetEpisodeForManualSearch,
  resetMovieForManualSearch,
  resolveShowGrabEpisode,
  retrySkippedEpisodes,
} from "@rawkoon/api/services/library/libraryGrabQueries";

function missBody(
  miss: {
    reason: string;
    languageFallback?: LanguageFallbackSummary;
  },
  searchResult: SearchResultPayload,
) {
  return {
    grabbed: false,
    reason: miss.reason,
    search_result: searchResult,
    ...(miss.languageFallback
      ? { language_fallback_summary: miss.languageFallback }
      : {}),
  };
}

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
        replace: z.boolean().optional(),
      }),
    ),
    async (c) => {
      try {
        const id = parseInt(c.req.param("id"), 10);
        const body = c.req.valid("json");
        const media = await findLibraryMediaRow(id);
        if (!media) return notFound("Library item not found");
        // For shows, episode-level status governs grabs — don't gate on media status
        if (body.replace && media.type !== "movie") {
          return badRequest("Replace is only available for movies");
        }
        // A grab over an existing file is in flight as "upgrading", so both count as active.
        const active =
          media.status === "downloading" || media.status === "upgrading";
        const replacing =
          body.replace === true && media.type === "movie" && active;
        if (media.type === "movie" && active) {
          if (!replacing) {
            return badRequest(
              "This item cannot be grabbed in its current state",
            );
          }
        }

        let episodeId = body.episode_id ?? undefined;

        if (media.type === "show") {
          const resolved = await resolveShowGrabEpisode(
            id,
            episodeId,
            body.release_title,
          );
          if (!resolved.ok) return badRequest(resolved.reason);
          episodeId = resolved.episodeId;
        }

        const execute = async () => {
          if (replacing) {
            // Refusals the grab would give anyway must not cost the running download.
            const pre = await preflightGrab({
              downloadUrl: body.download_url,
              releaseTitle: body.release_title,
            });
            if ("refusal" in pre) {
              return ok({
                grabbed: false,
                reason: (pre.refusal as { reason: string }).reason,
              });
            }
            const prep = await cancelActiveMovieDownloads(id, {
              releaseTitle: body.release_title,
              downloadUrl: body.download_url,
            });
            if (prep.status === "already_active") {
              return ok({ grabbed: true, release_title: body.release_title });
            }
            if (prep.status === "refused") {
              return ok({
                grabbed: false,
                reason: prep.reason,
                ...(prep.stopped > 0 ? { replaced_previous: true } : {}),
              });
            }
          }

          let result: Awaited<ReturnType<typeof grabRelease>>;
          try {
            result = await grabRelease({
              mediaId: id,
              episodeId,
              season: body.season ?? null,
              downloadUrl: body.download_url,
              releaseTitle: body.release_title,
              indexer: body.indexer ?? null,
              qualityParsed: body.quality_parsed,
              isUpgrade: body.is_upgrade ?? false,
              sizeBytes: body.size_bytes,
              urlChecked: replacing,
            });
          } catch (err) {
            if (!replacing) throw err;
            console.error("Library replace grab error:", err);
            return ok({
              grabbed: false,
              reason: "Grab failed",
              replaced_previous: true,
            });
          }

          if (result.grabbed) {
            return ok({ grabbed: true, release_title: result.releaseTitle });
          }

          return ok({
            grabbed: false,
            reason: result.reason,
            ...(replacing ? { replaced_previous: true } : {}),
          });
        };
        // Serializes double-taps and retries on the same item.
        return replacing
          ? await withKeyedLock(`replace:${id}`, execute)
          : await execute();
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
      const media = await findLibraryMediaRow(id);
      if (!media) return notFound("Library item not found");
      if (media.type !== "movie") {
        return badRequest("Search is only available for movies");
      }
      if (media.status === "downloading") {
        return badRequest("This item cannot be grabbed in its current state");
      }
      // Search grabs the top-scored release with no quality comparison, so it must not replace a file.
      if (await targetHasFileOnDisk({ mediaId: id, episodeId: null })) {
        return badRequest(
          "This movie already has a file. Use Upgrade to look for a better release.",
        );
      }

      // Manual search resets counter + status so users can always retry.
      await resetMovieForManualSearch(id);

      const { result, payload: searchResult } = await searchLibraryTarget(
        media,
        { kind: "movie" },
        { trigger: "manual_search", query: body.search_query?.trim() },
      );

      if (result.grabbed) {
        return ok({
          grabbed: true,
          release_title: result.releaseTitle,
          ai_picked: result.aiPicked === true,
          search_result: searchResult,
        });
      }

      return ok(missBody(result, searchResult));
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

        const media = await findLibraryMediaRow(mediaId);
        if (!media) return notFound("Library item not found");
        if (media.type !== "show") {
          return badRequest("Episode search only applies to TV shows");
        }

        const ep = await findEpisodeOfMedia(mediaId, episodeId);
        if (!ep) return notFound("Episode not found");

        if (ep.status === "downloading") {
          return badRequest(
            "This episode cannot be grabbed in its current state",
          );
        }
        if (await targetHasFileOnDisk({ mediaId, episodeId })) {
          return badRequest(
            "This episode already has a file. Use Upgrade to look for a better release.",
          );
        }

        // Manual search resets counter + status so users can always retry.
        await resetEpisodeForManualSearch(mediaId, episodeId);

        const { result, payload: searchResult } = await searchLibraryTarget(
          media,
          {
            kind: "episode",
            episodeId,
            season: ep.season,
            episode: ep.episode,
          },
          { trigger: "manual_search", query: body.search_query?.trim() },
        );

        if (result.grabbed) {
          return ok({
            grabbed: true,
            release_title: result.releaseTitle,
            ai_picked: result.aiPicked === true,
            search_result: searchResult,
          });
        }

        return ok(missBody(result, searchResult));
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
      return ok({ retried: await retrySkippedEpisodes(mediaId, season) });
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

        const media = await findLibraryMediaRow(mediaId);
        if (!media) return notFound("Library item not found");
        if (media.type !== "show") {
          return badRequest("Season search only applies to TV shows");
        }

        const downloadingCount = await countDownloadingEpisodes(
          mediaId,
          season,
        );
        if (downloadingCount > 0) {
          return badRequest(
            "One or more episodes in this season are already downloading",
          );
        }

        // Manual search resets skipped episodes so users can retry without being blocked.
        await retrySkippedEpisodes(mediaId, season);

        const wantedEpisodes = await listWantedEpisodes(mediaId, season);
        if (wantedEpisodes.length === 0) {
          return badRequest("No wanted episodes in this season");
        }

        const { result, payload: searchResult } = await searchLibraryTarget(
          media,
          { kind: "season", season },
          { trigger: "manual_search", query: body.search_query?.trim() },
        );

        if (result.grabbed) {
          return ok({
            grabbed: true,
            release_title: result.releaseTitle,
            ai_picked: result.aiPicked === true,
            search_result: searchResult,
          });
        }

        return ok(missBody(result, searchResult));
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
        const media = await findLibraryMediaForUpgrade(id);
        if (!media) return notFound("Library item not found");

        const count = await enqueueAutoUpgrade(media);
        return ok({ queued: true, mode: "auto" as const, count });
      } catch {
        return serverError("Failed to enqueue upgrade");
      }
    },
  );
