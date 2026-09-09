import type { FixtureRegistry } from "./types";
import { mockState } from "../mocks/externals";

// Seeded library TMDB ids:
// - movie: 990000001
// - show:  990000002
const WATCHLIST_TMDB_ID = 990_000_900; // distinct from seeded rows
const DISCOVER_DISMISS_TMDB_ID = 990_000_901;

function ensureProwlarrArrayResponses(): void {
  // Prowlarr adapter endpoints typically expect arrays; the fetch shim's default
  // for unknown hosts is `{}` which can crash those parsers.
  mockState.fetchResponses["mock-prowlarr.local"] = { json: [] };
}

export const mediasFixtures: FixtureRegistry = {
  // Watchlist (requireUser)
  "GET /api/medias/watchlist/": { phase: "read", negativeBody: null },
  "POST /api/medias/watchlist/": {
    phase: "bootstrap",
    body: (ctx) => {
      // Keep indexer-backed medias endpoints on their happy path if they run later.
      ensureProwlarrArrayResponses();
      return {
        tmdb_id: WATCHLIST_TMDB_ID,
        media_type: "movie",
        title: `E2E Watchlist ${ctx.get("requestId")}`,
        poster_url: null,
        overview: null,
        release_year: 2020,
        vote_average: 7.2,
        release_date: "2020-01-01",
      };
    },
    negativeBody: { tmdb_id: "nope", media_type: "movie", title: 123 },
  },
  "DELETE /api/medias/watchlist/:tmdbId": {
    phase: "delete",
    pathParams: () => ({ tmdbId: String(WATCHLIST_TMDB_ID) }),
    query: { type: "movie" },
    negativeBody: null,
  },

  // Blocklist (requireAdmin)
  "GET /api/medias/blocklist": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "POST /api/medias/blocklist": {
    phase: "bootstrap",
    admin: true,
    body: (ctx) => ({
      release_title: `E2E Blocked ${ctx.get("requestId")}`,
      torrent_hash: "0123456789abcdef0123456789abcdef01234567",
      indexer: "e2e",
      media_id: parseInt(ctx.get("libraryMediaId"), 10),
      episode_id: parseInt(ctx.get("libraryEpisodeId"), 10),
      reason: "e2e",
    }),
    captures: (body, ctx) => {
      const b = body as { entry?: { id?: unknown } };
      const id = b.entry?.id;
      if (typeof id === "number") ctx.set("grabBlocklistTempId", String(id));
    },
    negativeBody: { release_title: 123 },
  },
  "DELETE /api/medias/blocklist/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("grabBlocklistTempId") }),
    negativeBody: null,
  },

  // Collections (requireUser)
  "GET /api/medias/collections/missing": {
    phase: "read",
    query: { language: "en-US" },
    negativeBody: null,
  },

  // Discover (TMDB-backed, requireUser)
  "GET /api/medias/discover": {
    phase: "read",
    query: {
      type: "movie",
      page: "1",
      sort_by: "popularity.desc",
      language: "en-US",
    },
    negativeBody: null,
  },
  "GET /api/medias/discover/deck": {
    phase: "read",
    query: { limit: "5", exclude: String(WATCHLIST_TMDB_ID) },
    negativeBody: null,
  },
  "POST /api/medias/discover/dismiss": {
    phase: "bootstrap",
    body: () => ({ tmdb_id: DISCOVER_DISMISS_TMDB_ID, type: "movie" }),
    negativeBody: { tmdb_id: "nope", type: "movie" },
  },
  "DELETE /api/medias/discover/dismiss/:tmdbId": {
    phase: "delete",
    pathParams: () => ({ tmdbId: String(DISCOVER_DISMISS_TMDB_ID) }),
    query: { type: "movie" },
    negativeBody: null,
  },

  // TMDB explore/meta (requireUser)
  "GET /api/medias/explore": {
    phase: "read",
    query: { skipCache: "true", language: "en-US" },
    negativeBody: null,
  },
  "GET /api/medias/explore/:category": {
    phase: "read",
    pathParams: () => ({ category: "popular_movies" }),
    query: { page: "1", language: "en-US" },
    negativeBody: null,
  },
  "GET /api/medias/similar/:tmdbId": {
    phase: "read",
    pathParams: () => ({ tmdbId: "990000001" }),
    query: { type: "movie", language: "en-US" },
    negativeBody: null,
  },
  "GET /api/medias/tmdb-search": {
    phase: "read",
    // q < 2 returns 200 with empty results without hitting TMDB config/network.
    query: { q: "a", kind: "any", language: "en-US" },
    negativeBody: null,
  },
  "GET /api/medias/streaming-providers": {
    phase: "read",
    query: { type: "movie", language: "en-US" },
    negativeBody: null,
  },
  "GET /api/medias/genres": {
    phase: "read",
    query: { type: "movie", language: "en-US" },
    negativeBody: null,
  },
  "GET /api/medias/modal/:mediaType/:tmdbId": {
    phase: "read",
    pathParams: () => ({ mediaType: "movie", tmdbId: "990000001" }),
    query: { language: "en-US" },
    negativeBody: null,
  },

  // Indexer-backed search (requireAdmin)
  "GET /api/medias/indexers": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "GET /api/medias/interactive-search": {
    phase: "read",
    admin: true,
    query: {
      q: "e2e",
      tmdb_id: "990000001",
      media_type: "movie",
    },
    negativeBody: null,
  },
  "POST /api/medias/interactive-search/download": {
    phase: "action",
    admin: true,
    // Unknown token -> deterministic 404 via adapter.grabRelease() resolution.
    expectedStatus: 404,
    body: (ctx) => ({
      token: `e2e-missing-${ctx.get("requestId")}`,
      library_media_id: parseInt(ctx.get("libraryMediaId"), 10),
    }),
    negativeBody: { token: 123 },
  },

  // Local-AI assisted picking (requireAdmin)
  "POST /api/medias/search/ai-pick": {
    phase: "action",
    admin: true,
    // 404 when local-ai integration is disabled; 422 when enabled but no releases.
    expectedStatus: [404, 422],
    body: () => ({
      media_context: { title: "E2E", year: 2020, type: "movie" },
      releases: [],
    }),
    negativeBody: { media_context: { title: 123 }, releases: "nope" },
  },
  "GET /api/medias/search/ai-warm": {
    phase: "action",
    admin: true,
    negativeBody: null,
  },
};
