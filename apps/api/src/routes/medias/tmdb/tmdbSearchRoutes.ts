import { Elysia, t } from "elysia";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { badGateway, badRequest, serverError } from "@rawkoon/api/errors";
import {
  type TmdbSearchItem,
  mapTmdbSearchItem,
} from "@rawkoon/api/utils/medias/mappers";
import { toTmdbLanguage } from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import {
  libraryIdMapForTmdbIds,
  loadEnabledTmdbConfig,
} from "./tmdbRouteHelpers";

export const tmdbSearchRoutes = new Elysia().use(requireUser).get(
  "/tmdb-search",
  async ({ user: _user, set, query }) => {
    const q = query.q.trim();
    if (q.length < 2) {
      return {
        enabled: true,
        items: [],
      };
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
        return badRequest(set, "TMDB is not configured");
      }

      const searchUrl = new URL("https://api.themoviedb.org/3/search/multi");
      const language = toTmdbLanguage(
        (query as Record<string, string | undefined>).language || "en-US",
      );
      searchUrl.searchParams.set("api_key", tmdbConfig.api_key);
      searchUrl.searchParams.set("query", q);
      searchUrl.searchParams.set("include_adult", "false");
      searchUrl.searchParams.set("language", language);
      searchUrl.searchParams.set("page", "1");

      const searchRes = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!searchRes.ok) {
        return badGateway(
          set,
          `TMDB search failed with status ${searchRes.status}`,
        );
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
      return response;
    } catch (error) {
      console.error("Error searching TMDB medias:", error);
      return serverError(set, "Failed to search TMDB medias");
    }
  },
  {
    query: t.Object({
      q: t.String(),
      language: t.Optional(t.String()),
      kind: t.Optional(
        t.Union([t.Literal("movie"), t.Literal("tv"), t.Literal("any")]),
      ),
    }),
  },
);
