import type { FixtureRegistry } from "./types";

// Jellyfin account flows. The seeded Jellyfin integration points at a mocked host.
export const jellyfinFixtures: FixtureRegistry = {
  "POST /api/jellyfin/session": {
    phase: "action",
    public: true,
    body: () => ({ jellyfin_token: "e2e-token" }),
    negativeBody: { jellyfin_token: "" },
    // The mocked Jellyfin knows no token.
    expectedStatus: 401,
  },
  "GET /api/profile/jellyfin": { phase: "read", negativeBody: null },
  "POST /api/profile/jellyfin": {
    phase: "action",
    body: () => ({ username: "e2e", password: "e2e" }),
    negativeBody: { username: "", password: 1 },
    // Jellyfin sign-in is off unless an admin enables it.
    expectedStatus: 404,
  },
  "DELETE /api/profile/jellyfin": { phase: "delete", negativeBody: null },
};
