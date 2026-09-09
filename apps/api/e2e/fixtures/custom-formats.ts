import type { FixtureRegistry } from "./types";

export const customFormatsFixtures: FixtureRegistry = {
  "GET /api/custom-formats/": { phase: "read", negativeBody: null },

  // Create a throwaway custom format so PUT/DELETE don't mutate shared seeded rows.
  "POST /api/custom-formats/": {
    phase: "bootstrap",
    admin: true,
    expectedStatus: 201,
    body: (ctx) => ({
      name: `e2e-temp-${ctx.get("requestId")}-custom-format`,
      conditions: [
        { type: "title_regex", operator: "matches", value: "atmos" },
      ],
    }),
    captures: (body, ctx) => {
      const b = body as { custom_format?: { id?: unknown } };
      const id = b.custom_format?.id;
      if (typeof id === "number") ctx.set("customFormatTempId", String(id));
    },
    negativeBody: { name: 123, conditions: "not-an-array" },
  },

  "PUT /api/custom-formats/:id": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("customFormatTempId") }),
    body: (ctx) => ({
      name: `e2e-temp-${ctx.get("requestId")}-custom-format-updated`,
      conditions: [{ type: "seeders", operator: "gte", value: 5 }],
    }),
    negativeBody: { name: "", conditions: "not-an-array" },
  },

  "DELETE /api/custom-formats/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("customFormatTempId") }),
    negativeBody: null,
  },
};
