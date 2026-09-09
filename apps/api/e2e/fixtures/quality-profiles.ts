import type { FixtureRegistry } from "./types";

export const qualityProfilesFixtures: FixtureRegistry = {
  "GET /api/quality-profiles/": { phase: "read", negativeBody: null },

  // Create a throwaway quality profile so DELETE doesn't remove the shared seeded row.
  "POST /api/quality-profiles/": {
    phase: "bootstrap",
    admin: true,
    expectedStatus: 201,
    body: (ctx) => ({
      name: `e2e-temp-${ctx.get("requestId")}-quality-profile`,
      min_resolution: 1080,
      preferred_sources: ["web"],
      preferred_codecs: ["h265"],
      preferred_languages: ["en"],
      preferred_search_language: "fr",
      prioritized_trackers: ["tracker-one"],
      prefer_tracker_over_quality: false,
      max_size_gb: 15,
      require_hdr: false,
      prefer_hdr: false,
      cutoff_resolution: 1080,
      min_seeders: 0,
      custom_formats: [
        {
          custom_format_id: Number(ctx.get("customFormatId")),
          score: 100,
          required: false,
          forbidden: false,
        },
      ],
    }),
    captures: (body, ctx) => {
      const b = body as { profile?: { id?: unknown } };
      const id = b.profile?.id;
      if (typeof id === "number") ctx.set("tmpQpId", String(id));
    },
    negativeBody: {
      name: 123,
      min_resolution: "1080",
      preferred_sources: "web",
    },
  },

  "PUT /api/quality-profiles/:id": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("qualityProfileId") }),
    body: (ctx) => ({
      name: `e2e-updated-${ctx.get("requestId")}-quality-profile`,
      min_resolution: 1080,
      preferred_sources: ["web"],
      preferred_codecs: ["h265"],
      preferred_languages: ["en"],
      preferred_search_language: "en",
      prioritized_trackers: [],
      prefer_tracker_over_quality: false,
      max_size_gb: null,
      require_hdr: false,
      prefer_hdr: false,
      cutoff_resolution: null,
      min_seeders: 2,
    }),
    negativeBody: {
      name: 123,
      min_resolution: 1080,
      preferred_sources: ["web"],
      preferred_codecs: ["h265"],
      require_hdr: false,
      prefer_hdr: "no",
    },
  },

  "DELETE /api/quality-profiles/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("tmpQpId") }),
    negativeBody: null,
  },
};
