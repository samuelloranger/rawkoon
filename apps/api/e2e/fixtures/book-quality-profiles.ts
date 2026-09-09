import type { FixtureRegistry } from "./types";

export const bookQualityProfilesFixtures: FixtureRegistry = {
  "GET /api/book-quality-profiles/": { phase: "read", negativeBody: null },

  // Create a throwaway book quality profile so :id routes don't mutate/delete shared data.
  "POST /api/book-quality-profiles/": {
    phase: "bootstrap",
    admin: true,
    body: (ctx) => ({
      name: `e2e-temp-${ctx.get("requestId")}-book-quality-profile`,
      kind: "ebook",
      allowed_formats: ["epub", "azw3"],
      cutoff_format: "epub",
      prefer_retail: true,
      max_size_mb: 500,
      min_seeders: 1,
      min_audio_bitrate: null,
      preferred_languages: ["en"],
      prioritized_trackers: ["tracker-one"],
      prefer_tracker_over_quality: false,
    }),
    captures: (body, ctx) => {
      const b = body as { profile?: { id?: unknown } };
      const id = b.profile?.id;
      if (typeof id === "number") ctx.set("tmpBookQpId", String(id));
    },
    negativeBody: {
      name: 123,
      kind: 999,
      allowed_formats: "epub",
    },
  },

  "GET /api/book-quality-profiles/:id": {
    phase: "read",
    pathParams: (ctx) => ({ id: ctx.get("tmpBookQpId") }),
    negativeBody: null,
  },

  "PATCH /api/book-quality-profiles/:id": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("tmpBookQpId") }),
    body: (ctx) => ({
      name: `e2e-updated-${ctx.get("requestId")}-book-quality-profile`,
      allowed_formats: ["epub"],
      min_seeders: 2,
      max_size_mb: null,
      prefer_retail: false,
      prefer_tracker_over_quality: true,
      preferred_languages: ["en", "fr"],
      prioritized_trackers: [],
    }),
    negativeBody: {
      allowed_formats: "epub",
      max_size_mb: "not-a-number",
    },
  },

  "DELETE /api/book-quality-profiles/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("tmpBookQpId") }),
    negativeBody: null,
  },
};
