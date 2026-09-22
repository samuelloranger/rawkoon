import type { FixtureRegistry } from "./types";

const SAMPLE_HASH = "0123456789abcdef0123456789abcdef01234567";

// The download client may or may not be configured when these run (fixture order), so reads
// accept 503 "unreachable" alongside 200, and the write paths accept their not-found/refused outcomes.
export const downloadsFixtures: FixtureRegistry = {
  "GET /api/downloads/seeding": {
    phase: "read",
    admin: true,
    query: { preview: "1" },
    expectedStatus: [200, 503],
    negativeBody: null,
  },
  "POST /api/downloads/seeding/:hash/release": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ hash: SAMPLE_HASH }),
    expectedStatus: 404,
    negativeBody: null,
  },
  "GET /api/downloads/orphans": {
    phase: "read",
    admin: true,
    expectedStatus: [200, 503],
    negativeBody: null,
  },
  "POST /api/downloads/orphans/remove": {
    phase: "delete",
    admin: true,
    body: () => ({ hashes: [SAMPLE_HASH], delete_data: false }),
    expectedStatus: [200, 503],
    negativeBody: { hashes: "nope", delete_data: "x" },
  },
  "GET /api/downloads/seed-rules": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/downloads/seed-rules/:indexer": {
    phase: "bootstrap",
    admin: true,
    pathParams: () => ({ indexer: "e2e-indexer" }),
    body: () => ({ ratio: 1.5, seed_time_mins: 120 }),
    negativeBody: { ratio: "high" },
  },
  "DELETE /api/downloads/seed-rules/:indexer": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ indexer: "e2e-indexer" }),
    negativeBody: null,
  },
  "GET /api/downloads/janitor-stats": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
};
