import type { FixtureRegistry } from "./types";

// dashboard: all protected (requireUser). Upcoming add/status take a Zod body
// (media_type + numeric tmdb_id) — good negative-check targets.
export const dashboardFixtures: FixtureRegistry = {
  "GET /api/dashboard/activities/feed": { phase: "read", negativeBody: null },
  "GET /api/dashboard/pipeline": { phase: "read", negativeBody: null },
  "GET /api/dashboard/downloads/speed": { phase: "read", negativeBody: null },
  // Binary image proxy: the mocked Jellyfin serves no image bytes, so the route
  // correctly returns 404 "Image not found". We assert reachability + that path.
  "GET /api/dashboard/jellyfin/image": {
    phase: "read",
    query: { itemId: "mock-item-1" },
    expectedStatus: 404,
    negativeBody: null,
  },
  "GET /api/dashboard/jellyfin/now-playing": {
    phase: "read",
    negativeBody: null,
  },
  "GET /api/dashboard/upcoming": { phase: "read", negativeBody: null },
};
