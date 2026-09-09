import type { FixtureRegistry } from "./types";

export const adminFixtures: FixtureRegistry = {
  // API keys
  "GET /api/admin/api-keys": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  "POST /api/admin/api-keys": {
    phase: "bootstrap",
    admin: true,
    expectedStatus: 201,
    body: (ctx) => ({
      name: `e2e-temp-${ctx.get("requestId")}-api-key`,
      expires_in_days: 7,
    }),
    captures: (body, ctx) => {
      const b = body as { api_key?: { id?: unknown } };
      const id = b.api_key?.id;
      if (typeof id === "string") ctx.set("apiKeyTempId", id);
    },
    negativeBody: { name: "", expires_in_days: "nope" },
  },

  "DELETE /api/admin/api-keys/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("apiKeyTempId") }),
    negativeBody: null,
  },

  // Invitations
  "GET /api/admin/invitations": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  "POST /api/admin/invitations": {
    phase: "bootstrap",
    admin: true,
    expectedStatus: 201,
    body: (ctx) => ({
      email: `e2e-invite-${ctx.get("requestId")}@example.com`,
      is_admin: false,
      locale: "en",
    }),
    captures: (body, ctx) => {
      const b = body as { invitation?: { id?: unknown } };
      const id = b.invitation?.id;
      if (typeof id === "number") ctx.set("invitationTempId", String(id));
    },
    negativeBody: { email: 123, is_admin: "nope" },
  },

  "POST /api/admin/invitations/:id/resend": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("invitationTempId") }),
    negativeBody: null,
  },

  "DELETE /api/admin/invitations/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("invitationTempId") }),
    negativeBody: null,
  },

  // Jobs / queues
  "GET /api/admin/jobs/events": {
    phase: "read",
    admin: true,
    skipReason:
      "SSE stream never terminates; harness would hang reading res.text()",
  },

  // The e2e StubQueue implements getJobs/getJob/getJobSchedulers/clean/count as
  // empty results, so these read/act on an empty queue deterministically.
  "GET /api/admin/jobs/history": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  "DELETE /api/admin/queues/:name/clean": {
    phase: "delete",
    admin: true,
    pathParams: () => ({ name: "scheduled-tasks" }),
    negativeBody: null,
  },

  "GET /api/admin/queues/:name/jobs": {
    phase: "read",
    admin: true,
    pathParams: () => ({ name: "scheduled-tasks" }),
    negativeBody: null,
  },

  // getJob returns null under the stub -> the route reports the job is missing (404).
  "POST /api/admin/queues/:name/jobs/:jobId/retry": {
    phase: "action",
    admin: true,
    pathParams: () => ({ name: "scheduled-tasks", jobId: "missing-job" }),
    expectedStatus: [200, 404],
    negativeBody: null,
  },

  "POST /api/admin/queues/:name/retry-failed": {
    phase: "action",
    admin: true,
    pathParams: () => ({ name: "scheduled-tasks" }),
    negativeBody: null,
  },

  "GET /api/admin/scheduled-jobs": {
    phase: "read",
    admin: true,
    skipReason:
      "Aggregates per-queue scheduler state + latest-instance getState beyond the e2e StubQueue's empty results (500 under mocks)",
  },

  // Library health
  "GET /api/admin/library-health": {
    phase: "read",
    admin: true,
    query: { limit: "5" },
    negativeBody: null,
  },

  // Sessions
  "GET /api/admin/sessions": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  "DELETE /api/admin/sessions/:id": {
    phase: "delete",
    admin: true,
    skipReason:
      "No admin route exists to create a throwaway session; deleting an arbitrary session could revoke the harness' own current session",
  },

  "DELETE /api/admin/sessions/user/:userId": {
    phase: "delete",
    admin: true,
    skipReason:
      "No admin route exists to create a throwaway session for a throwaway user; revoking sessions risks deleting the harness' own admin/user sessions mid-run",
  },

  // Trigger scheduled actions (queue add is stubbed as a no-op in e2e)
  "POST /api/admin/trigger-action": {
    phase: "action",
    admin: true,
    body: () => ({ action: "refresh_upcoming" }),
    negativeBody: { action: 123 },
  },

  // Users
  "GET /api/admin/users": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  "POST /api/admin/users": {
    phase: "bootstrap",
    admin: true,
    expectedStatus: 201,
    body: (ctx) => ({
      email: `e2e-admin-temp-${ctx.get("requestId")}@example.com`,
      password: `e2e-pass-${ctx.get("requestId")}`,
      first_name: "E2E",
      last_name: "Temp",
      is_admin: false,
      locale: "en",
    }),
    captures: (body, ctx) => {
      const b = body as { user?: { id?: unknown } };
      const id = b.user?.id;
      if (typeof id === "string") ctx.set("adminTempUserId", id);
    },
    negativeBody: { email: 123, password: 456 },
  },

  "POST /api/admin/users/:id/reset-password": {
    phase: "action",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("adminTempUserId") }),
    body: (ctx) => ({
      password: `e2e-new-pass-${ctx.get("requestId")}`,
    }),
    negativeBody: { password: "short" },
  },

  "PATCH /api/admin/users/:id/role": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("adminTempUserId") }),
    body: () => ({ is_admin: true }),
    negativeBody: { is_admin: "nope" },
  },

  "DELETE /api/admin/users/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("adminTempUserId") }),
    negativeBody: null,
  },

  // Web push subscriptions
  "GET /api/admin/web-push": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  "DELETE /api/admin/web-push/:id": {
    phase: "delete",
    admin: true,
    skipReason:
      "No admin route exists to create a throwaway web-push subscription; deleting an arbitrary id could destroy shared seeded data or the harness' own device",
  },
};
