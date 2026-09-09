import type { FixtureRegistry } from "./types";

// search: protected (requireUser). `q` and `limit` are optional query params,
// but we pass a valid 2+ char `q` to exercise the non-empty branch.
export const searchFixtures: FixtureRegistry = {
  "GET /api/search/quick": {
    phase: "read",
    query: { q: "ra", limit: "6" },
    negativeBody: null,
  },
};
