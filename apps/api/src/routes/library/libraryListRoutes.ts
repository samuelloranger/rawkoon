import { Hono } from "hono";
import { strictInt } from "@rawkoon/api/utils/strictInt";
import { z } from "zod";

import {
  badRequest,
  notFound,
  ok,
  serverError,
  tmdbNotConfigured,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { ensureAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import { qualityProfileExists } from "@rawkoon/api/services/library/libraryMetaMutations";
import {
  resolveSeasonChoiceWithSettings,
  seasonModeSchema,
  type ResolvedSeasonChoice,
} from "@rawkoon/api/services/library/seasonMonitoring";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";
import { deleteCache } from "@rawkoon/api/services/cache";
import { deleteLibraryItem } from "@rawkoon/api/services/library/deleteLibraryItem";
import {
  findLibraryItemById,
  queryLibraryList,
  queryRandomLibraryItems,
} from "@rawkoon/api/services/library/libraryListQueries";
import { queueSearchOnAdd } from "@rawkoon/api/services/searchOnAdd";
import { invalidateUpcomingCache } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";

import { normalizeTitleLanguage } from "@rawkoon/shared/constants";

import { adminView, mapLibraryMedia } from "./libraryHelpers";

const listQuery = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  airing: z.enum(["returning", "in_production", "planned", "ended"]).optional(),
  q: z.string().optional(),
  language: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  sort_by: z.string().optional(),
  sort_dir: z.string().optional(),
  title_language: z.string().optional(),
});

const randomQuery = z.object({
  limit: z.coerce.number().optional(),
  exclude: z.string().optional(),
  title_language: z.string().optional(),
});

/**
 * Core CRUD: list, add, delete, and single-item fetch.
 * GET /api/library
 * GET /api/library/random
 * POST /api/library
 * DELETE /api/library/:id
 * GET /api/library/item/:id
 */
export const libraryListRoutes = new Hono<Env>()
  .get("/", requireUser, queryV(listQuery), async (c) => {
    const query = c.req.valid("query");
    try {
      const result = await queryLibraryList({
        ...query,
        titleLanguage: normalizeTitleLanguage(query.title_language),
      });
      const mappedItems = result.rows.map((r) =>
        mapLibraryMedia(r, result.mapTitleLanguage, adminView(c)),
      );
      const { resortLanguage } = result;
      if (resortLanguage !== undefined) {
        mappedItems.sort((a, b) =>
          a.title.localeCompare(b.title, resortLanguage, {
            sensitivity: "base",
          }),
        );
      }
      return ok({
        items: mappedItems,
        movie_count: result.movie_count,
        show_count: result.show_count,
        has_more: result.has_more,
      });
    } catch {
      return serverError("Failed to fetch library");
    }
  })

  // Random titles with something playable; `exclude` is tried first, then topped up when too few remain.
  .get("/random", requireUser, queryV(randomQuery), async (c) => {
    const query = c.req.valid("query");
    try {
      const take = Math.min(Math.max(1, query.limit ?? 6), 24);
      const exclude = (query.exclude ?? "")
        .split(",")
        .map((v) => Number.parseInt(v, 10))
        .filter((v) => Number.isInteger(v) && v > 0)
        .slice(0, 200);
      const rows = await queryRandomLibraryItems(take, exclude);
      const titleLanguage = normalizeTitleLanguage(query.title_language);
      return ok({
        items: rows.map((r) => mapLibraryMedia(r, titleLanguage, adminView(c))),
      });
    } catch {
      return serverError("Failed to fetch random library items");
    }
  })

  .get("/item/:id", requireUser, async (c) => {
    try {
      const id = strictInt(c.req.param("id"));
      if (!Number.isFinite(id)) return badRequest("Invalid id");
      const item = await findLibraryItemById(id);
      if (!item) return notFound("Library item not found");
      const itemTitleLanguage = normalizeTitleLanguage(
        c.req.query("title_language"),
      );
      return ok({
        item: mapLibraryMedia(item, itemTitleLanguage, adminView(c)),
      });
    } catch {
      return serverError("Failed to fetch library item");
    }
  })

  .post(
    "/",
    requireUser,
    jsonV(
      z.object({
        tmdb_id: z.number(),
        type: z.union([z.literal("movie"), z.literal("show")]),
        search_on_add: z.boolean().optional(),
        quality_profile_id: z.number().int().optional(),
        season_mode: seasonModeSchema.optional(),
        seasons: z.array(z.number().int().positive()).optional(),
        monitor_new_seasons: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      try {
        const body = c.req.valid("json");
        const { tmdb_id, type, search_on_add } = body;
        if (type !== "movie" && type !== "show") {
          return badRequest("type must be 'movie' or 'show'");
        }
        if (
          type === "movie" &&
          (body.season_mode !== undefined ||
            body.seasons !== undefined ||
            body.monitor_new_seasons !== undefined)
        ) {
          return badRequest("Season options are only valid for shows");
        }
        if (body.quality_profile_id !== undefined) {
          if (!(await qualityProfileExists(body.quality_profile_id))) {
            return badRequest("Quality profile not found");
          }
        }
        let seasonChoice: ResolvedSeasonChoice | undefined;
        if (type === "show") {
          const resolved = await resolveSeasonChoiceWithSettings({
            seasonMode: body.season_mode,
            seasons: body.seasons,
            monitorNewSeasons: body.monitor_new_seasons,
          });
          if ("error" in resolved) return badRequest(resolved.error);
          seasonChoice = resolved;
        }
        try {
          const region = await getGlobalTmdbRegion();
          const item = await addOrUpdateLibraryFromTmdb({
            tmdb_id,
            type,
            region,
            seasonChoice,
            ...(body.quality_profile_id !== undefined
              ? { qualityProfileId: body.quality_profile_id }
              : {}),
          });
          await invalidateUpcomingCache(region);
          const search = await queueSearchOnAdd(item, search_on_add);
          return ok({
            item: mapLibraryMedia(item, undefined, adminView(c)),
            ...search,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg === "TMDB is not configured") {
            return tmdbNotConfigured();
          }
          throw e;
        }
      } catch (err) {
        console.error("Library add error:", err);
        return serverError("Failed to add item to library");
      }
    },
  )

  // DELETE /api/library/:id — remove item (cascade deletes episodes + files)
  // ?delete_files=true also removes hardlinked/moved files from disk
  // ?release_torrents=true removes still-seeding torrents now instead of at their target
  .delete(
    "/:id",
    requireUser,
    queryV(
      z.object({
        delete_files: z.string().optional(),
        release_torrents: z.string().optional(),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      try {
        const id = strictInt(c.req.param("id"));
        if (!Number.isFinite(id)) return badRequest("Invalid id");
        const query = c.req.valid("query");
        const result = await deleteLibraryItem(id, {
          deleteFiles: query.delete_files === "true",
          releaseTorrents: query.release_torrents === "true",
          userId: c.get("user").id,
        });
        if (!result) return notFound("Library item not found");

        return ok({ success: true, released: result.released });
      } catch {
        return serverError("Failed to remove library item");
      }
    },
  );
