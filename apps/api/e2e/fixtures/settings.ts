import type { FixtureRegistry } from "./types";

// settings: router is fully admin-gated (requireAdmin on the whole group).
// PATCH uses a Zod body with optional fields — we still send a full valid payload
// to exercise the update path and a wrong-typed field for the 400 validation check.
export const settingsFixtures: FixtureRegistry = {
  "GET /api/settings/": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  "PATCH /api/settings/": {
    phase: "update",
    admin: true,
    body: () => ({
      country_code: "CA",
      upcoming_window_months: 6,
      upcoming_languages: "en,fr",
      books_enabled: true,
    }),
    negativeBody: { upcoming_window_months: "6" },
  },
};
