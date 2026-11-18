import type { FixtureRegistry } from "./types";

export const exportFixtures: FixtureRegistry = {
  "GET /api/export/library": {
    phase: "read",
    skipReason:
      "Route is guarded by an API key in the x-api-key/Authorization header; the e2e harness cannot attach custom headers.",
  },
};
