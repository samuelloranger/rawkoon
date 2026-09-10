import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import type { Env } from "@rawkoon/api/honoEnv";

// Two behaviours carry the weight here. An empty api_key must KEEP the stored
// key, because the form never receives the secret back and submitting the page
// would otherwise wipe it. And enabling without any key must fail loudly rather
// than leaving a Books section whose every search dies on authentication.

const state: {
  stored: { enabled: boolean; config: unknown } | null;
  upserts: Array<{ enabled: boolean; config: Record<string, unknown> }>;
} = { stored: null, upserts: [] };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    // The auth plugin loads OIDC providers at import time; without this it logs
    // a caught TypeError that looks like a test failure but is not one.
    oidcProvider: { findMany: () => Promise.resolve([]) },
    integration: {
      upsert: (args: {
        update: { enabled: boolean; config: Record<string, unknown> };
      }) => {
        state.upserts.push(args.update);
        return Promise.resolve({
          type: "googlebooks",
          enabled: args.update.enabled,
        });
      },
    },
  },
}));

const realCache = await import("@rawkoon/api/services/integrationConfigCache");
mock.module("@rawkoon/api/services/integrationConfigCache", () => ({
  ...realCache,
  getIntegrationConfigRecord: () => Promise.resolve(state.stored),
  invalidateIntegrationConfigCache: () => undefined,
}));

// encrypt/decrypt need a SECRET_KEY; the routes only care that the value round
// trips, so a marker keeps the assertions readable.
mock.module("@rawkoon/api/services/crypto", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) =>
    value.startsWith("enc:") ? value.slice(4) : value,
}));

mock.module("@rawkoon/api/utils/activityLogs", () => ({
  logActivity: () => Promise.resolve(undefined),
}));

const { googleBooksIntegrationRoutes } = await import(
  "@rawkoon/api/routes/integrations/googlebooks"
);

// The child router is unguarded (requireAdmin lives on the integrations parent);
// drive it through a harness that injects an admin user on the context.
const app = new Hono<Env>().use("*", (c, next) => {
  c.set("user", { id: "admin" } as never);
  return next();
});
app.route("/", googleBooksIntegrationRoutes);

const putGoogleBooks = (body: { api_key: string; enabled?: boolean }) =>
  app.request("/googlebooks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PUT /api/integrations/googlebooks", () => {
  beforeEach(() => {
    state.stored = null;
    state.upserts = [];
  });

  it("keeps the stored key when the field is submitted empty", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:existing-key" } };

    const res = await putGoogleBooks({ api_key: "", enabled: true });

    expect(res.status).toBe(200);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]?.config).toEqual({ api_key: "enc:existing-key" });
  });

  it("replaces the stored key when a new one is given", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:old" } };

    await putGoogleBooks({ api_key: "  new-key  ", enabled: true });

    expect(state.upserts[0]?.config).toEqual({ api_key: "enc:new-key" });
  });

  it("refuses to enable the integration with no key at all", async () => {
    const res = await putGoogleBooks({ api_key: "", enabled: true });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "api_key",
    );
    expect(state.upserts).toEqual([]);
  });

  // Turning the integration off with no key is legitimate — that is how an
  // instance is put back to a clean state.
  it("allows disabling with no key", async () => {
    const res = await putGoogleBooks({ api_key: "", enabled: false });

    expect(res.status).toBe(200);
    expect(state.upserts[0]?.enabled).toBe(false);
  });

  it("never echoes the key back to the client", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:secret" } };

    const res = await putGoogleBooks({
      api_key: "brand-new-secret",
      enabled: true,
    });
    const json = (await res.json()) as {
      integration: { api_key: string; has_api_key: boolean };
    };

    expect(json.integration.api_key).toBe("");
    expect(json.integration.has_api_key).toBe(true);
  });
});
