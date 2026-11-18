import type { FixtureRegistry } from "./types";

export const tvFixtures: FixtureRegistry = {
  "GET /api/tv/bootstrap": { phase: "read", negativeBody: null },
  "GET /api/tv/library-sorts": { phase: "read", negativeBody: null },
  "PUT /api/tv/library-sorts": {
    phase: "update",
    body: () => ({ page: "movies", sort: "TITLE" }),
    negativeBody: { page: "not a page!", sort: 1 },
  },
  "POST /api/tv/jellyfin/quick-connect": {
    phase: "action",
    body: () => ({ code: "123456" }),
    negativeBody: { code: "" },
    // The admin account is not linked to a Jellyfin user.
    expectedStatus: 403,
  },
};
