import type { FixtureRegistry } from "./types";

export const labbyFixtures: FixtureRegistry = {
  "GET /api/labby/summary": {
    phase: "read",
    skipReason:
      "Route is guarded by requireApiKey (x-api-key header); the e2e harness exercises cookie auth and cannot attach custom headers.",
  },
};
