import type { FixtureRegistry } from "./types";

// transcode: the whole router is requireAdmin. Nothing seeds a transcode job, so
// per-job routes target a missing id and assert their documented 404.
const MISSING_JOB = "999999999";
const MISSING_BATCH = "0b7e8f2c-3d4a-4b5c-9d6e-7f8a9b0c1d2e";
const INSTALLATION = "6f1c2a7e-9a4b-4c3d-8e2f-1a2b3c4d5e6f";
const HEX_TOKEN = "ab".repeat(32);
const settings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};
const badSelection = { selection: {}, settings: { codec: "mpeg2" } };

export const transcodeFixtures: FixtureRegistry = {
  "GET /api/transcode/capabilities": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "GET /api/transcode/jobs": { phase: "read", admin: true, negativeBody: null },
  "GET /api/transcode/settings": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "GET /api/transcode/summary": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "GET /api/transcode/jobs/:id/free-source": {
    phase: "read",
    admin: true,
    pathParams: () => ({ id: MISSING_JOB }),
    expectedStatus: 404,
    negativeBody: null,
  },

  "PATCH /api/transcode/settings": {
    phase: "update",
    admin: true,
    body: () => ({ paused: false }),
    negativeBody: { paused: "no" },
  },

  "POST /api/transcode/estimate": {
    phase: "action",
    admin: true,
    body: (ctx) => ({
      selection: { media_id: Number(ctx.get("libraryMediaId")) },
      settings,
    }),
    negativeBody: badSelection,
  },
  "POST /api/transcode/jobs": {
    phase: "action",
    admin: true,
    body: (ctx) => ({
      selection: { media_id: Number(ctx.get("libraryMediaId")) },
      settings,
    }),
    negativeBody: badSelection,
  },
  "POST /api/transcode/jobs/:id/move": {
    phase: "action",
    admin: true,
    pathParams: () => ({ id: MISSING_JOB }),
    body: () => ({ top: true }),
    negativeBody: { top: "yes" },
    expectedStatus: 404,
  },
  "POST /api/transcode/jobs/:id/retry": {
    phase: "action",
    admin: true,
    pathParams: () => ({ id: MISSING_JOB }),
    expectedStatus: 404,
    negativeBody: null,
  },
  "POST /api/transcode/jobs/:id/free-source": {
    phase: "action",
    admin: true,
    pathParams: () => ({ id: MISSING_JOB }),
    expectedStatus: 404,
    negativeBody: null,
  },
  "POST /api/transcode/batches/:batchId/move": {
    phase: "action",
    admin: true,
    pathParams: () => ({ batchId: MISSING_BATCH }),
    body: () => ({ top: true }),
    negativeBody: { top: false },
  },
  "POST /api/transcode/live-activity/register": {
    phase: "action",
    admin: true,
    body: () => ({ installation_id: INSTALLATION, start_token: HEX_TOKEN }),
    negativeBody: { installation_id: "not-a-uuid", start_token: "zz" },
  },
  // No job is running, so the token never matches a current activity: 409 tells the phone to end it.
  "POST /api/transcode/live-activity/token": {
    phase: "action",
    admin: true,
    body: () => ({
      installation_id: INSTALLATION,
      job_id: 1,
      activity_token: HEX_TOKEN,
    }),
    negativeBody: { installation_id: INSTALLATION, job_id: 0 },
    expectedStatus: 409,
  },

  "DELETE /api/transcode/jobs/:id": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ id: MISSING_JOB }),
    expectedStatus: 404,
    negativeBody: null,
  },
  "DELETE /api/transcode/batches/:batchId": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ batchId: MISSING_BATCH }),
    negativeBody: null,
  },
  "DELETE /api/transcode/history/:id": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ id: MISSING_JOB }),
    expectedStatus: 404,
    negativeBody: null,
  },
  "DELETE /api/transcode/history": {
    phase: "delete",
    admin: true,
    negativeBody: null,
  },
  "DELETE /api/transcode/live-activity/devices/:installationId": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ installationId: INSTALLATION }),
    negativeBody: null,
  },
};
