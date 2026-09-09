import { mockState } from "../mocks/externals";
import type { FixtureRegistry } from "./types";

export const booksFixtures: FixtureRegistry = {
  "GET /api/books/": {
    phase: "read",
    query: {
      q: "E2E",
      kind: "ebook",
      page: "1",
      limit: "25",
      sort_by: "addedAt",
      sort_dir: "desc",
    },
    negativeBody: null,
  },

  // Provider-backed search runs before integrations/googlebooks is configured in
  // phase order, so the deterministic outcome is the "not configured" 400.
  "GET /api/books/search": {
    phase: "read",
    query: { q: "e2e" },
    expectedStatus: 400,
    negativeBody: null,
  },

  "GET /api/books/:id": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("bookId") }),
    negativeBody: null,
  },

  "GET /api/books/listening-stats": { phase: "read", negativeBody: null },

  "GET /api/books/progress": { phase: "read", negativeBody: null },
  "GET /api/books/reading-progress": { phase: "read", negativeBody: null },

  "GET /api/books/metadata-sources": { phase: "read", negativeBody: null },

  "PUT /api/books/metadata-sources": {
    phase: "update",
    admin: true,
    body: () => ({
      order: ["openlibrary", "googlebooks", "local", "audnexus"],
    }),
    negativeBody: { order: "not-an-array" },
  },

  "PATCH /api/books/:id/overrides": {
    phase: "update",
    pathParams: (ctx) => ({ id: ctx.get("bookId") }),
    body: () => ({
      // Valid ISO date (YYYY-MM-DD) and ISO 639-1 language code.
      published_date: "2020-01-01",
      language: "en",
      genres: ["fantasy"],
    }),
    negativeBody: { published_date: "not-a-date" },
  },

  "PUT /api/books/:id/read": {
    phase: "update",
    pathParams: (ctx) => ({ id: ctx.get("bookId") }),
    body: () => ({ read: true }),
    negativeBody: { read: "true" },
  },

  // Per-edition state and files
  "PATCH /api/books/:id/editions/:kind": {
    phase: "update",
    pathParams: (ctx) => ({ id: ctx.get("bookId"), kind: "ebook" }),
    body: () => ({
      monitored: true,
      status: "wanted",
      book_quality_profile_id: null,
    }),
    // Zod accepts any string; handler rejects non-allowed statuses with 400.
    negativeBody: { status: "not-a-real-status" },
  },

  "POST /api/books/:id/editions": {
    phase: "action",
    pathParams: (ctx) => ({ id: ctx.get("bookId") }),
    body: () => ({ kind: "audiobook", monitored: true }),
    negativeBody: { kind: 123 },
  },

  "GET /api/books/:id/editions/:kind/files": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("bookId"), kind: "ebook" }),
    negativeBody: null,
  },

  "POST /api/books/:id/editions/:kind/rescan": {
    phase: "action",
    pathParams: (ctx) => ({ id: ctx.get("bookId"), kind: "ebook" }),
    // In e2e the seeded book has no library path configured, so rescan returns 400.
    expectedStatus: 400,
    negativeBody: null,
  },

  // Indexer search / grab
  "GET /api/books/:id/editions/:kind/search": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("bookId"), kind: "ebook" }),
    negativeBody: null,
  },

  "POST /api/books/:id/editions/:kind/grab": {
    phase: "action",
    pathParams: (ctx) => ({ id: ctx.get("bookId"), kind: "ebook" }),
    body: (ctx) => {
      // qBittorrent client uses a login flow + "Ok." legacy sentinel parsing.
      // The fetch shim otherwise returns `{}` which fails auth and add parsing.
      mockState.fetchResponses["/api/v2/auth/login"] = { text: "Ok." };
      mockState.fetchResponses["/api/v2/torrents/add"] = { text: "Ok." };
      return {
        release_title: `e2e-release-${ctx.get("requestId")}`,
        magnet_url:
          "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
        indexer: null,
      };
    },
    negativeBody: { release_title: 123 },
  },

  // With the benign fetch shim, indexer search yields 0 viable releases -> 409.
  "POST /api/books/:id/editions/:kind/auto": {
    phase: "action",
    pathParams: (ctx) => ({ id: ctx.get("bookId"), kind: "ebook" }),
    expectedStatus: 409,
    negativeBody: null,
  },

  // Refresh metadata for a known seeded book id.
  "POST /api/books/:id/refresh-metadata": {
    phase: "action",
    pathParams: (ctx) => ({ id: ctx.get("bookId") }),
    negativeBody: null,
  },

  // Playback
  // Manifest is JSON (not a stream), but the seeded ebook edition is not offline-ready.
  "GET /api/books/editions/:id/manifest": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("editionId") }),
    expectedStatus: 400,
    negativeBody: null,
  },

  "PUT /api/books/editions/:id/progress": {
    phase: "update",
    pathParams: (ctx) => ({ id: ctx.get("editionId") }),
    body: () => ({
      position_secs: 12.5,
      total_duration_secs: 100,
      finished: false,
      updated_at: new Date().toISOString(),
      device_id: "e2e-device",
    }),
    negativeBody: { position_secs: "12.5" },
  },

  "PUT /api/books/editions/:id/reading-progress": {
    phase: "update",
    pathParams: (ctx) => ({ id: ctx.get("editionId") }),
    body: () => ({
      file_id: null,
      spine_index: 0,
      spine_path: "e2e.xhtml",
      spine_count: 1,
      scroll_fraction: 0.25,
      locator: null,
      finished: false,
      updated_at: new Date().toISOString(),
      device_id: "e2e-device",
    }),
    negativeBody: { spine_index: -1, spine_count: 1 },
  },

  // File management / content serving
  "DELETE /api/books/:id/files/:fileId": {
    phase: "delete",
    skipReason:
      "Seeded book has no files, and the harness has no route to create a BookFile without a configured library path; cannot produce a deterministic fileId",
  },

  "GET /api/books/files/:fileId/content": {
    phase: "read",
    skipReason:
      "Streams binary bytes and requires a signed grant + real file; no seeded book fileId/grant available in e2e",
  },

  // Create a throwaway book in action phase so DELETE can be exercised safely.
  "POST /api/books/": {
    phase: "action",
    body: (ctx) => {
      // Google Books volume fetch uses a different response shape than the
      // default `{ items: [] }` shim; provide one deterministic volume.
      mockState.fetchResponses["/books/v1/volumes/e2e-vol-2"] = {
        json: {
          id: "e2e-vol-2",
          volumeInfo: {
            title: "E2E Temp Book",
            subtitle: "Fixture-created",
            authors: ["E2E Author"],
            language: "en",
            publishedDate: "2020-01-01",
            description: "<p>e2e</p>",
            categories: ["Fiction"],
            industryIdentifiers: [
              { type: "ISBN_13", identifier: "9781234567897" },
            ],
            imageLinks: {
              thumbnail: "http://mock-covers.local/e2e.png",
              smallThumbnail: "http://mock-covers.local/e2e-small.png",
            },
          },
        },
      };
      return {
        google_volume_id: "e2e-vol-2",
        isbn13: null,
        kinds: ["ebook"],
        book_quality_profile_id: null,
        monitored: true,
      };
    },
    captures: (body, ctx) => {
      const b = body as { item?: { id?: unknown } };
      const id = b.item?.id;
      if (typeof id === "number") ctx.set("bookTempId", String(id));
    },
    negativeBody: { google_volume_id: 123 },
  },

  "DELETE /api/books/:id": {
    phase: "delete",
    pathParams: (ctx) => ({ id: ctx.get("bookTempId") }),
    negativeBody: null,
  },
};
