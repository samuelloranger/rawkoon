import { Hono } from "hono";
import { z } from "zod";
import { badGateway, badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { queryV } from "@rawkoon/api/middleware/validate";
import {
  type TmdbSearchItem,
  mapTmdbSearchItem,
} from "@rawkoon/api/utils/medias/mappers";
import { toTmdbLanguage } from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import {
  libraryIdMapForTmdbIds,
  loadEnabledTmdbConfig,
} from "./tmdbRouteHelpers";

// Mounted under /api/medias; requireUser applied at the tmdb parent.
export const tmdbSearchRoutes = new Hono<Env>().get(
  "/tmdb-search",
  queryV(
    z.object({
      q: z.string(),
      language: z.string().optional(),
      kind: z
        .union([z.literal("movie"), z.literal("tv"), z.literal("any")])
        .optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query");
    const q = query.q.trim();
    if (q.length < 2) {
      return ok({ enabled: true, items: [] });
    }

    const response: {
      enabled: boolean;
      items: TmdbSearchItem[];
    } = {
      enabled: true,
      items: [],
    };

    try {
      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) {
        return badRequest("TMDB is not configured");
      }

      const searchUrl = new URL("https://api.themoviedb.org/3/search/multi");
      const language = toTmdbLanguage(query.language || "en-US");
      searchUrl.searchParams.set("api_key", tmdbConfig.api_key);
      searchUrl.searchParams.set("query", q);
      searchUrl.searchParams.set("include_adult", "false");
      searchUrl.searchParams.set("language", language);
      searchUrl.searchParams.set("page", "1");

      const searchRes = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!searchRes.ok) {
        return badGateway(`TMDB search failed with status ${searchRes.status}`);
      }

      const searchData = (await searchRes.json()) as Record<string, unknown>;
      let items = (Array.isArray(searchData.results) ? searchData.results : [])
        .map(mapTmdbSearchItem)
        .filter((item): item is TmdbSearchItem => Boolean(item));

      const kindFilter =
        typeof query.kind === "string" ? query.kind.trim().toLowerCase() : "";
      if (kindFilter === "movie") {
        items = items.filter((i) => i.media_type === "movie");
      } else if (kindFilter === "tv") {
        items = items.filter((i) => i.media_type === "tv");
      }

      items = items.slice(0, 20);

      const tmdbIds = items.map((i) => i.tmdb_id);
      const libraryIdByTmdbId = await libraryIdMapForTmdbIds(tmdbIds);

      items = items.map((item) => ({
        ...item,
        service: "prowlarr" as const,
        already_exists: libraryIdByTmdbId.has(item.tmdb_id),
        can_add: true,
        source_id: null,
        library_id: libraryIdByTmdbId.get(item.tmdb_id) ?? null,
      }));

      response.items = items;
      return ok(response);
    } catch (error) {
      console.error("Error searching TMDB medias:", error);
      return serverError("Failed to search TMDB medias");
    }
  },
);
