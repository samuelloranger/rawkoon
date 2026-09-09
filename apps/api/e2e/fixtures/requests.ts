import type { FixtureRegistry } from "./types";

// requests: user can create; admin can approve/deny.
//
// NOTE: The seed includes a single pending movie request at ctx.get("requestId").
// Approving it flips the status away from "pending", so the deny route's
// deterministic behavior in this sweep is the "not pending" 400 path.
export const requestsFixtures: FixtureRegistry = {
  "GET /api/requests/": { phase: "read", negativeBody: null },

  "POST /api/requests/": {
    phase: "action",
    body: (ctx) => ({
      type: "movie",
      tmdb_id: 999_123_456,
      title: `E2E New Request ${ctx.get("requestId")}`,
      poster_url: null,
      year: 2026,
    }),
    negativeBody: { type: "movie", tmdb_id: "not-a-number", title: 123 },
  },

  // Approve runs the full TMDB -> library-add pipeline, which needs a shaped TMDB
  // catalog response beyond the harness's benign external mocks. Skipped (whole
  // fixture) as documented; revisit if a TMDB catalog mock is added.
  "POST /api/requests/:id/approve": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("requestId") }),
    body: (ctx) => ({
      quality_profile_id: Number(ctx.get("qualityProfileId")),
    }),
    negativeBody: { quality_profile_id: "not-a-number" },
    skipReason:
      "approve triggers TMDB->library add; needs a shaped TMDB catalog",
  },

  // Deny the seeded pending request -> 200. (Approve is skipped, so it stays pending.)
  "POST /api/requests/:id/deny": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("requestId") }),
    body: () => ({ deny_reason: "e2e" }),
    negativeBody: { deny_reason: 123 },
  },
};
