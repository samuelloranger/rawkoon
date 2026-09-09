import type { FixtureRegistry } from "./types";

import { mockState } from "../mocks/externals";
import { valkey } from "@rawkoon/api/db/valkey";
import {
  libraryMigrateQueue,
  libraryReindexLanguagesQueue,
} from "@rawkoon/api/services/queueService";

function patchStubValkeyListOps(): void {
  // e2e mocks stub ioredis but not list ops; rss-status needs lrange.
  const v = valkey as unknown as Record<string, unknown>;
  if (typeof v.lrange !== "function") v.lrange = async () => [];
  if (typeof v.lpush !== "function") v.lpush = async () => 0;
  if (typeof v.ltrim !== "function") v.ltrim = async () => "OK";
}

function patchStubQueueAddToReturnJobWithGetState(queue: unknown): void {
  // e2e StubQueue.add returns `{ id }`, but some endpoints call `job.getState()`.
  const q = queue as unknown as { add?: (...args: unknown[]) => unknown };
  if (typeof q.add !== "function") return;
  q.add = async (..._args: unknown[]) => ({
    id: "mock-job",
    getState: async () => "completed",
  });
}

patchStubValkeyListOps();
patchStubQueueAddToReturnJobWithGetState(libraryReindexLanguagesQueue);
patchStubQueueAddToReturnJobWithGetState(libraryMigrateQueue);

export const libraryFixtures: FixtureRegistry = {
  // ── Core list/item CRUD ────────────────────────────────────────────────────
  "GET /api/library/": {
    phase: "read",
    query: {
      page: "1",
      limit: "25",
      type: "movie",
      sort_by: "title",
      sort_dir: "asc",
    },
    negativeBody: null,
  },

  // Create a throwaway media row so DELETE /api/library/:id doesn't remove the seeded movie/show.
  "POST /api/library/": {
    phase: "bootstrap",
    admin: true,
    body: (ctx) => {
      // The fetch shim's default TMDB payload doesn't include required fields.
      // Override TMDB host responses with a superset that satisfies detail + release_dates calls.
      mockState.fetchResponses["api.themoviedb.org"] = {
        json: {
          title: `E2E Temp Movie ${ctx.get("requestId")}`,
          release_date: "2020-01-01",
          poster_path: null,
          overview: "E2E temp movie created by endpoint harness",
          original_title: "E2E Temp Movie",
          original_language: "en",
          translations: { translations: [] },
          results: [],
          total_results: 0,
          total_pages: 0,
        },
      };
      return {
        tmdb_id: 990_100_000 + Number(ctx.get("requestId")),
        type: "movie",
      };
    },
    captures: (body, ctx) => {
      const b = body as { item?: { id?: unknown } };
      const id = b.item?.id;
      if (typeof id === "number") ctx.set("libraryTempMediaId", String(id));
    },
    negativeBody: { tmdb_id: "nope", type: "movie" },
  },

  "DELETE /api/library/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryTempMediaId") }),
    negativeBody: null,
  },

  "GET /api/library/item/:id": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    negativeBody: null,
  },

  // ── File + episode views ───────────────────────────────────────────────────
  "GET /api/library/:id/files": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    negativeBody: null,
  },

  "GET /api/library/:id/episodes": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("libraryShowId") }),
    negativeBody: null,
  },

  "DELETE /api/library/:id/episodes/:episodeId": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({
      id: ctx.get("libraryShowId"),
      episodeId: ctx.get("libraryEpisodeId"),
    }),
    negativeBody: null,
  },

  // ── Download history (per-media) ───────────────────────────────────────────
  // Bootstrap a failed download history entry so :dhId routes have a throwaway row to act on.
  "POST /api/library/:id/grab": {
    phase: "bootstrap",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: (ctx) => {
      // Force qB magnet add to fail deterministically (default shim `{}` parses but is rejected).
      mockState.fetchResponses["mock-qbittorrent.local"] = { json: {} };
      return {
        download_url:
          "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=e2e",
        release_title: `E2E.Movie.${ctx.get("requestId")}.1080p.WEB-DL`,
        indexer: "e2e-indexer",
        quality_parsed: null,
        size_bytes: null,
        episode_id: null,
        season: null,
        is_upgrade: false,
      };
    },
    // Validation failure is deterministic; business outcome is "grabbed: false" with 200.
    negativeBody: { download_url: 123, release_title: 456 },
  },

  "GET /api/library/:id/downloads": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    captures: (body, ctx) => {
      const b = body as { items?: Array<{ id?: unknown }> };
      const id = b.items?.[0]?.id;
      if (typeof id === "number")
        ctx.set("libraryDownloadHistoryTempId", String(id));
    },
    negativeBody: null,
  },

  "POST /api/library/:id/downloads/:dhId/action": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({
      id: ctx.get("libraryMediaId"),
      dhId: ctx.get("libraryDownloadHistoryTempId"),
    }),
    body: () => ({ action: "pause" }),
    // The seeded grab fails before setting torrentHash, so pause/resume is a deterministic 400.
    expectedStatus: 400,
    negativeBody: { action: 123 },
  },

  "DELETE /api/library/:id/downloads/:dhId": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({
      id: ctx.get("libraryMediaId"),
      dhId: ctx.get("libraryDownloadHistoryTempId"),
    }),
    negativeBody: null,
  },

  "DELETE /api/library/:id/downloads/failed": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    negativeBody: null,
  },

  // ── Download history (global) ──────────────────────────────────────────────
  "GET /api/library/download-history": { phase: "read", negativeBody: null },
  "GET /api/library/download-history/stats": {
    phase: "read",
    negativeBody: null,
  },

  "POST /api/library/downloads/:dhId/retry-post-process": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ dhId: ctx.get("libraryDownloadHistoryTempId") }),
    // The seeded DH is marked failed → deterministic 400 ("Download is marked as failed").
    expectedStatus: 400,
    negativeBody: null,
  },

  // ── Metadata mutations (admin) ─────────────────────────────────────────────
  "PATCH /api/library/:id/status": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: () => ({ status: "wanted" }),
    negativeBody: { status: "nope" },
  },

  "PATCH /api/library/:id/monitored": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: () => ({ monitored: true }),
    negativeBody: { monitored: "nope" },
  },

  "PATCH /api/library/:id/quality-profile": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: (ctx) => ({
      quality_profile_id: Number(ctx.get("qualityProfileId")),
    }),
    negativeBody: { quality_profile_id: "nope" },
  },

  "PATCH /api/library/:id/overrides": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: () => ({ title: "E2E Movie (override)" }),
    negativeBody: { title: 123 },
  },

  "PATCH /api/library/:id/search-title": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: () => ({
      search_title_language: "en",
      search_title: "E2E Movie",
    }),
    negativeBody: { search_title_language: "english", search_title: "" },
  },

  "PATCH /api/library/:id/seasons/:season/monitored": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryShowId"), season: "1" }),
    body: () => ({ monitored: false }),
    negativeBody: { monitored: "nope" },
  },

  "PATCH /api/library/:id/episodes/:episodeId/monitored": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({
      id: ctx.get("libraryShowId"),
      episodeId: ctx.get("libraryEpisodeId"),
    }),
    body: () => ({ monitored: false }),
    negativeBody: { monitored: "nope" },
  },

  "PATCH /api/library/:id/episodes/:episodeId/status": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({
      id: ctx.get("libraryShowId"),
      episodeId: ctx.get("libraryEpisodeId"),
    }),
    body: () => ({ status: "wanted" }),
    negativeBody: { status: "nope" },
  },

  // ── Searches / grabs / upgrade (admin) ─────────────────────────────────────
  "POST /api/library/:id/search": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: () => {
      // ProwlarrAdapter.getIndexers expects a JSON array; pin empty results.
      mockState.fetchResponses["mock-prowlarr.local"] = { json: [] };
      return { search_query: "e2e" };
    },
    negativeBody: { search_query: 123 },
  },

  "POST /api/library/:id/episodes/:episodeId/search": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({
      id: ctx.get("libraryShowId"),
      episodeId: ctx.get("libraryEpisodeId"),
    }),
    body: () => {
      mockState.fetchResponses["mock-prowlarr.local"] = { json: [] };
      return { search_query: "e2e" };
    },
    negativeBody: { search_query: 123 },
  },

  "POST /api/library/:id/seasons/:season/search": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryShowId"), season: "1" }),
    body: () => {
      mockState.fetchResponses["mock-prowlarr.local"] = { json: [] };
      return {};
    },
    negativeBody: { search_query: 123 },
  },

  "POST /api/library/:id/seasons/:season/retry-skipped": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryShowId"), season: "1" }),
    negativeBody: null,
  },

  "POST /api/library/:id/upgrade": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    body: () => ({ mode: "manual" }),
    negativeBody: { mode: "nope" },
  },

  // ── Rescan / file mutations ────────────────────────────────────────────────
  "POST /api/library/:id/rescan": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryMediaId") }),
    negativeBody: null,
  },

  // No seeded MediaFile ids exist in the minimal seed; assert the 404 path deterministically.
  "PATCH /api/library/files/:fileId": {
    phase: "update",
    admin: true,
    pathParams: () => ({ fileId: "999999" }),
    body: () => ({ release_group: null }),
    expectedStatus: 404,
    negativeBody: { release_group: 123 },
  },

  "DELETE /api/library/files/:fileId": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ fileId: "999999" }),
    expectedStatus: 404,
    negativeBody: null,
  },

  // Remux jobs do not validate file existence; queue is stubbed → deterministic 2xx.
  "POST /api/library/files/:fileId/remux": {
    phase: "action",
    admin: true,
    pathParams: () => ({ fileId: "123" }),
    body: () => ({
      keep_audio_track_indices: [0],
      keep_subtitle_track_indices: [],
    }),
    negativeBody: { keep_audio_track_indices: "nope" },
  },

  "GET /api/library/files/:fileId/remux/status": {
    phase: "read",
    pathParams: () => ({ fileId: "123" }),
    negativeBody: null,
  },

  // ── Attention + events ─────────────────────────────────────────────────────
  "GET /api/library/attention": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  // No seeded alert ids; dismissing an arbitrary id is a deterministic 400.
  "PATCH /api/library/attention/:alertId/dismiss": {
    phase: "update",
    admin: true,
    pathParams: () => ({ alertId: "999999" }),
    expectedStatus: 400,
    negativeBody: null,
  },

  "GET /api/library/events": {
    phase: "read",
    skipReason:
      "SSE stream does not terminate; harness would hang reading res.text()",
  },

  // ── Jobs + status endpoints ────────────────────────────────────────────────
  "POST /api/library/reindex-languages": {
    phase: "action",
    admin: true,
    negativeBody: null,
  },

  "GET /api/library/reindex-languages/status": {
    phase: "read",
    negativeBody: null,
  },

  "POST /api/library/migrate": {
    phase: "action",
    admin: true,
    body: () => ({
      source: "both",
      radarr_url: "http://mock-radarr.local",
      radarr_api_key: "k",
      sonarr_url: "http://mock-sonarr.local",
      sonarr_api_key: "k",
    }),
    negativeBody: { source: 123 },
  },

  "GET /api/library/migrate/status": {
    phase: "read",
    skipReason:
      "SSE stream does not terminate; harness would hang reading res.text()",
  },

  // ── Post-processing settings + disk scan (admin) ───────────────────────────
  "GET /api/library/post-processing/settings": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  // Ensure the singleton media_settings row exists before downloads/list runs.
  "PATCH /api/library/post-processing/settings": {
    phase: "bootstrap",
    admin: true,
    body: () => ({
      post_processing_enabled: false,
      file_operation: "hardlink",
    }),
    negativeBody: { file_operation: "nope" },
  },

  // With no configured roots and a seeded singleton row, downloads/list is deterministic empty 200.
  "GET /api/library/downloads/list": {
    phase: "read",
    admin: true,
    query: { refresh: "false" },
    negativeBody: null,
  },

  // Post-processing disabled → deterministic 400 before any filesystem access.
  "POST /api/library/downloads/assign": {
    phase: "action",
    admin: true,
    expectedStatus: 400,
    body: (ctx) => ({
      file_path: `/tmp/e2e-missing-${ctx.get("requestId")}.mkv`,
      tmdb_id: 990_100_000 + Number(ctx.get("requestId")),
      kind: "movie",
    }),
    negativeBody: { file_path: 123, tmdb_id: "nope", kind: "movie" },
  },

  // Path must exist; provide a unique missing path to keep it deterministic and fast.
  "POST /api/library/scan": {
    phase: "action",
    admin: true,
    expectedStatus: 400,
    body: (ctx) => ({
      path: `/tmp/e2e-scan-miss-${ctx.get("requestId")}`,
      type: "movie",
    }),
    negativeBody: { path: 123, type: "movie" },
  },

  // ── Stats / tags ───────────────────────────────────────────────────────────
  "GET /api/library/stats": { phase: "read", negativeBody: null },
  "GET /api/library/language-tags": { phase: "read", negativeBody: null },

  // rss-status relies on valkey list ops; patched above so it returns 200 under mocks.
  "GET /api/library/rss-status": { phase: "read", negativeBody: null },
};
