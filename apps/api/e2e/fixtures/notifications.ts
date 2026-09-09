import type { FixtureRegistry } from "./types";

function ensureVapidKeys(): void {
  // Provide deterministic keys for e2e so subscribe + vapid-public-key succeed
  // even when the environment doesn't set VAPID_PUBLIC_KEY/PRIVATE_KEY.
  if (!process.env.VAPID_PUBLIC_KEY)
    process.env.VAPID_PUBLIC_KEY = "A".repeat(87);
  if (!process.env.VAPID_PRIVATE_KEY)
    process.env.VAPID_PRIVATE_KEY = "B".repeat(43);
}

export const notificationsFixtures: FixtureRegistry = {
  // SSE stream never completes, and the harness reads the full body via res.text().
  "GET /api/notifications/stream": {
    phase: "read",
    skipReason:
      "SSE stream does not terminate; harness would hang reading res.text()",
  },

  // Create notifications so :id endpoints have a throwaway row to act on.
  "POST /api/notifications/test": {
    phase: "bootstrap",
    body: () => ({}),
    negativeBody: { subscription: { endpoint: 123 } },
  },

  "GET /api/notifications/": {
    phase: "read",
    query: { page: "1", limit: "20", read: "false" },
    captures: (body, ctx) => {
      const b = body as { notifications?: Array<{ id?: unknown }> };
      const id = b.notifications?.[0]?.id;
      if (typeof id === "number") ctx.set("notificationTempId", String(id));
    },
    negativeBody: null,
  },

  "GET /api/notifications/unread-count": { phase: "read", negativeBody: null },
  "GET /api/notifications/unread-ids": { phase: "read", negativeBody: null },

  "PUT /api/notifications/:id/read": {
    phase: "update",
    pathParams: (ctx) => ({ id: ctx.get("notificationTempId") }),
    negativeBody: null,
  },

  "PUT /api/notifications/read-all": { phase: "update", negativeBody: null },

  "DELETE /api/notifications/:id": {
    phase: "delete",
    pathParams: (ctx) => ({ id: ctx.get("notificationTempId") }),
    negativeBody: null,
  },

  // Web push subscription (devices)
  "POST /api/notifications/subscribe": {
    phase: "bootstrap",
    body: (ctx) => {
      ensureVapidKeys();
      return {
        subscription: {
          endpoint: `https://e2e-push.example/endpoint/${ctx.get("requestId")}`,
          keys: { p256dh: "p256dh-e2e", auth: "auth-e2e" },
        },
        device_info: {
          deviceName: "E2E Device",
          osName: "linux",
          osVersion: "e2e",
          browserName: "bun",
          browserVersion: "e2e",
          platform: "e2e",
        },
      };
    },
    negativeBody: { subscription: { endpoint: 123, keys: "nope" } },
  },

  "POST /api/notifications/unsubscribe": {
    phase: "action",
    body: () => undefined,
    negativeBody: { subscription: { endpoint: 123 } },
  },

  "GET /api/notifications/vapid-public-key": {
    phase: "read",
    public: true,
    expectedStatus: [200, 503],
    negativeBody: null,
  },

  "GET /api/notifications/devices": {
    phase: "read",
    captures: (body, ctx) => {
      const b = body as { devices?: Array<{ id?: unknown }> };
      const id = b.devices?.[0]?.id;
      if (typeof id === "number") ctx.set("subscriptionTempId", String(id));
    },
    negativeBody: null,
  },

  "DELETE /api/notifications/devices/:id": {
    phase: "delete",
    pathParams: (ctx) => ({ id: ctx.get("subscriptionTempId") }),
    negativeBody: null,
  },

  // APNS devices
  "POST /api/notifications/apns/register": {
    phase: "bootstrap",
    body: (ctx) => ({
      device_token: `e2e-apns-token-${ctx.get("requestId")}`,
      device_info: {
        device_name: "E2E iPhone",
        os_version: "e2e",
        app_version: "e2e",
        bundle_id: "com.rawkoon.e2e",
      },
    }),
    negativeBody: { device_token: 123 },
  },

  "POST /api/notifications/apns/unregister": {
    phase: "action",
    body: (ctx) => ({
      device_token: `e2e-apns-token-miss-${ctx.get("requestId")}`,
    }),
    negativeBody: { device_token: 123 },
  },

  "GET /api/notifications/apns/devices": {
    phase: "read",
    captures: (body, ctx) => {
      const b = body as { devices?: Array<{ id?: unknown }> };
      const id = b.devices?.[0]?.id;
      if (typeof id === "number") ctx.set("apnsTempId", String(id));
    },
    negativeBody: null,
  },

  "DELETE /api/notifications/apns/devices/:id": {
    phase: "delete",
    pathParams: (ctx) => ({ id: ctx.get("apnsTempId") }),
    negativeBody: null,
  },

  // Notification channels
  "GET /api/notifications/channels/": { phase: "read", negativeBody: null },

  "POST /api/notifications/channels/": {
    phase: "bootstrap",
    body: (ctx) => ({
      type: "webhook",
      label: `e2e-temp-${ctx.get("requestId")}-channel`,
      config: { url: "https://e2e-webhook.example/rawkoon", method: "POST" },
    }),
    captures: (body, ctx) => {
      const b = body as { channel?: { id?: unknown } };
      const id = b.channel?.id;
      if (typeof id === "number")
        ctx.set("notificationChannelTempId", String(id));
    },
    negativeBody: { type: 123, label: "", config: "not-a-record" },
  },

  "PATCH /api/notifications/channels/:id": {
    phase: "update",
    pathParams: (ctx) => ({ id: ctx.get("notificationChannelTempId") }),
    body: (ctx) => ({
      label: `e2e-temp-${ctx.get("requestId")}-channel-updated`,
      enabled: false,
    }),
    negativeBody: { enabled: "nope" },
  },

  // The channel test does a real DNS/SSRF check on the webhook host before
  // sending; the sentinel host doesn't resolve, so a 400 is the correct outcome.
  "POST /api/notifications/channels/:id/test": {
    phase: "action",
    pathParams: (ctx) => ({ id: ctx.get("notificationChannelTempId") }),
    expectedStatus: 400,
    negativeBody: null,
  },

  "DELETE /api/notifications/channels/:id": {
    phase: "delete",
    pathParams: (ctx) => ({ id: ctx.get("notificationChannelTempId") }),
    negativeBody: null,
  },
};
