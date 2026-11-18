import type { FixtureRegistry } from "./types";

// shelves: an admin creates a shelf in bootstrap and deletes it last. Adding an
// entry needs a TMDB title the benign mock does not return, so entry routes
// target a missing id.
const MISSING = "999999999";

export const shelvesFixtures: FixtureRegistry = {
  "POST /api/shelves": {
    phase: "bootstrap",
    admin: true,
    body: () => ({ name: "E2E Shelf" }),
    negativeBody: { name: "", rules: {} },
    captures: (body, ctx) => {
      const id = (body as { shelf?: { id?: unknown } }).shelf?.id;
      if (typeof id === "number") ctx.set("shelfTempId", String(id));
    },
  },

  "GET /api/shelves": { phase: "read", negativeBody: null },
  "GET /api/shelves/:id": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId") }),
    negativeBody: null,
  },
  "GET /api/shelves/seeds": { phase: "read", admin: true, negativeBody: null },
  "GET /api/shelves/for-title": {
    phase: "read",
    admin: true,
    query: { tmdb_id: "990000001", type: "movie" },
    negativeBody: null,
  },
  "GET /api/shelves/lookup/:kind": {
    phase: "read",
    admin: true,
    pathParams: () => ({ kind: "keywords" }),
    query: { q: "space" },
    negativeBody: null,
  },
  "GET /api/shelves/cover-candidates": {
    phase: "read",
    admin: true,
    query: { tmdb_id: "990000001", type: "movie" },
    negativeBody: null,
  },
  "GET /api/shelves/covers/:filename": {
    phase: "read",
    public: true,
    pathParams: () => ({ filename: "missing.webp" }),
    expectedStatus: 404,
    negativeBody: null,
  },

  "PATCH /api/shelves/:id": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId") }),
    body: () => ({ description: "e2e", rules: { types: ["movie"] } }),
    negativeBody: { order_mode: "sideways" },
  },
  "PUT /api/shelves/order": {
    phase: "update",
    admin: true,
    body: (ctx) => ({ ids: [Number(ctx.get("shelfTempId"))] }),
    negativeBody: { ids: [] },
  },
  "PATCH /api/shelves/:id/entries": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId") }),
    body: () => ({ entries: [{ id: Number(MISSING), position: 0 }] }),
    negativeBody: { entries: [] },
    expectedStatus: 400,
  },

  "POST /api/shelves/:id/preview": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId") }),
    body: () => ({ rules: { types: ["movie"] } }),
    negativeBody: { rules: { colour: "red" } },
  },
  "POST /api/shelves/:id/seed-from-rules": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId") }),
    negativeBody: null,
  },
  "POST /api/shelves/:id/entries": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId") }),
    body: () => ({ tmdb_id: 990000001, type: "movie" }),
    negativeBody: { tmdb_id: "x", type: "book" },
  },
  "POST /api/shelves/:id/cover": {
    phase: "action",
    skipReason:
      "Multipart image upload; the e2e harness only sends JSON bodies.",
  },

  "DELETE /api/shelves/:id/entries/:entryId": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId"), entryId: MISSING }),
    expectedStatus: 404,
    negativeBody: null,
  },
  "DELETE /api/shelves/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("shelfTempId") }),
    negativeBody: null,
  },
};
