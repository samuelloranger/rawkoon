import type { FixtureRegistry } from "./types";

// Library routes beyond library.ts, which sits at the file-length limit.
export const libraryExtraFixtures: FixtureRegistry = {
  "GET /api/library/growth": { phase: "read", negativeBody: null },
  "GET /api/library/random": { phase: "read", negativeBody: null },
  "GET /api/library/post-processing/grab-readiness": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PATCH /api/library/:id/monitored-seasons": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("libraryShowId") }),
    body: () => ({ monitor_new_seasons: false }),
    negativeBody: { monitor_new_seasons: "no" },
  },
};
