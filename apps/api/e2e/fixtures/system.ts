import type { FixtureRegistry } from "./types";

// system + health: public, no-param, no-body GET endpoints.
export const systemFixtures: FixtureRegistry = {
  "GET /api/health": { phase: "read", public: true, negativeBody: null },
  "GET /api/system/version": {
    phase: "read",
    public: true,
    negativeBody: null,
  },
  "GET /api/system/features": {
    phase: "read",
    public: true,
    negativeBody: null,
  },
};
