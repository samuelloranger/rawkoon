import type { FixtureRegistry } from "./types";

// users: profile + notification preferences are authenticated (`user` required).
// Avatar upload is multipart/form-data (not supported by this harness's JSON-only
// http client). Password change clears sessions and would break the sweep mid-run.
export const usersFixtures: FixtureRegistry = {
  "GET /api/users/avatar/:filename": {
    phase: "read",
    public: true,
    pathParams: (ctx) => ({
      filename: `e2e-missing-${ctx.get("requestId")}.png`,
    }),
    expectedStatus: 404,
    negativeBody: null,
  },

  "PUT /api/users/me": {
    phase: "update",
    body: (ctx) => ({
      first_name: `E2E ${ctx.get("requestId")}`,
      nav_position: "left",
    }),
    negativeBody: { first_name: 123, nav_position: "nope" },
  },

  "POST /api/users/me/avatar": {
    phase: "action",
    skipReason:
      "requires multipart/form-data File upload; e2e http client always sends JSON",
  },

  "PUT /api/users/me/notification-preferences": {
    phase: "update",
    body: () => ({
      notification_preferences: { email: true, web_push: false },
    }),
    negativeBody: { notification_preferences: { email: "yes" } },
  },

  "POST /api/users/me/password": {
    phase: "action",
    skipReason:
      "changes the logged-in user's password and clears sessions; would break subsequent requests in the same run",
  },
};
