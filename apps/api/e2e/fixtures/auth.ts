import type { FixtureRegistry } from "./types";

export const authFixtures: FixtureRegistry = {
  "GET /api/auth/accept-invitation": {
    phase: "read",
    skipReason:
      "No seeded invitation token; this route requires a real pending invitation token to exercise meaningfully.",
  },

  "POST /api/auth/accept-invitation": {
    phase: "action",
    skipReason:
      "No seeded invitation token; this route creates a user and needs a real pending invitation token.",
  },

  "GET /api/auth/me": { phase: "read", negativeBody: null },

  "GET /api/auth/setup-status": {
    phase: "read",
    public: true,
    negativeBody: null,
  },

  "GET /api/auth/sso-providers": {
    phase: "read",
    public: true,
    negativeBody: null,
  },
};
