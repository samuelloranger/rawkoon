import type { FixtureRegistry } from "./types";

// /api/releases routes are admin-only and call into githubReleases service.
// External fetches are globally mocked in the e2e harness, so these should be 2xx.
export const releasesFixtures: FixtureRegistry = {
  "GET /api/releases/": { phase: "read", admin: true, negativeBody: null },
  "POST /api/releases/refresh": {
    phase: "action",
    admin: true,
    negativeBody: null,
  },
};
