import type { FixtureRegistry } from "./types";

// clips: preview clips are off on a fresh install, so the public file lookup
// answers 404, recut is refused and delete-all is allowed.
export const clipsFixtures: FixtureRegistry = {
  "GET /api/clips/status": { phase: "read", negativeBody: null },
  "GET /api/clips/file": {
    phase: "read",
    query: { tmdbId: "990000001", type: "movie" },
    expectedStatus: 404,
    negativeBody: null,
  },
  "GET /api/clips/settings": { phase: "read", admin: true, negativeBody: null },
  "GET /api/clips/progress": { phase: "read", admin: true, negativeBody: null },
  "GET /api/clips/media/:mediaId": {
    phase: "read",
    admin: true,
    pathParams: (ctx) => ({ mediaId: ctx.get("libraryMediaId") }),
    negativeBody: null,
  },
  "PUT /api/clips/settings": {
    phase: "update",
    admin: true,
    body: () => ({ enabled: false }),
    negativeBody: { enabled: "no" },
  },
  "POST /api/clips/retry": { phase: "action", admin: true, negativeBody: null },
  "POST /api/clips/:id/recut": {
    phase: "action",
    admin: true,
    pathParams: () => ({ id: "999999999" }),
    body: () => ({ start_sec: 5 }),
    negativeBody: { start_sec: -1 },
    // Clips are off on a fresh install, which is checked before the clip lookup.
    expectedStatus: 409,
  },
  "POST /api/clips/delete-all": {
    phase: "delete",
    admin: true,
    negativeBody: null,
  },
};
