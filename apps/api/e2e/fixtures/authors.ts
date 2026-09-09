import type { FixtureRegistry } from "./types";

// Authors live under books routes in the API, but are exposed at /api/authors.
// All routes requireUser; only PATCH requires admin.
export const authorsFixtures: FixtureRegistry = {
  "GET /api/authors/": { phase: "read", negativeBody: null },

  // Query is optional, but provide one so the filtered path is exercised.
  "GET /api/authors/search": {
    phase: "read",
    query: { q: "e2e" },
    negativeBody: null,
  },

  "PATCH /api/authors/:id": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("authorId") }),
    body: () => ({
      monitored: true,
      monitor_from: "2020-01-01T00:00:00.000Z",
      monitor_edition_kinds: ["ebook", "audiobook"],
      monitor_languages: ["en"],
    }),
    // Valid Zod shape but invalid date -> route returns 400.
    negativeBody: { monitor_from: "not-a-date" },
  },
};
