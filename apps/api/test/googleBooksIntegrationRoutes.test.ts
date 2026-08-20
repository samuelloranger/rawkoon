import { describe, it, expect, beforeEach, mock } from "bun:test";

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

type Handler = (ctx: {
  user: { id: string };
  body: { api_key: string; enabled?: boolean };
  set: { status?: number };
}) => Promise<unknown>;

/** Pull the PUT handler out of the Elysia instance to call it directly. */
function putHandler(): Handler {
  const routes = (
    googleBooksIntegrationRoutes as unknown as {
      routes: Array<{ method: string; path: string; handler: Handler }>;
    }
  ).routes;
  const route = routes.find(
    (r) => r.method === "PUT" && r.path === "/googlebooks",
  );
  if (!route) throw new Error("PUT /googlebooks route not found");
  return route.handler;
}

describe("PUT /api/integrations/googlebooks", () => {
  beforeEach(() => {
    state.stored = null;
    state.upserts = [];
  });

  it("keeps the stored key when the field is submitted empty", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:existing-key" } };
    const set: { status?: number } = {};

    await putHandler()({
      user: { id: "admin" },
      body: { api_key: "", enabled: true },
      set,
    });

    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]?.config).toEqual({ api_key: "enc:existing-key" });
    expect(set.status).toBeUndefined();
  });

  it("replaces the stored key when a new one is given", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:old" } };

    await putHandler()({
      user: { id: "admin" },
      body: { api_key: "  new-key  ", enabled: true },
      set: {},
    });

    expect(state.upserts[0]?.config).toEqual({ api_key: "enc:new-key" });
  });

  it("refuses to enable the integration with no key at all", async () => {
    const set: { status?: number } = {};

    const result = (await putHandler()({
      user: { id: "admin" },
      body: { api_key: "", enabled: true },
      set,
    })) as { error?: string };

    expect(set.status).toBe(400);
    expect(result.error).toContain("api_key");
    expect(state.upserts).toEqual([]);
  });

  // Turning the integration off with no key is legitimate — that is how an
  // instance is put back to a clean state.
  it("allows disabling with no key", async () => {
    const set: { status?: number } = {};

    await putHandler()({
      user: { id: "admin" },
      body: { api_key: "", enabled: false },
      set,
    });

    expect(set.status).toBeUndefined();
    expect(state.upserts[0]?.enabled).toBe(false);
  });

  it("never echoes the key back to the client", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:secret" } };

    const result = (await putHandler()({
      user: { id: "admin" },
      body: { api_key: "brand-new-secret", enabled: true },
      set: {},
    })) as { integration: { api_key: string; has_api_key: boolean } };

    expect(result.integration.api_key).toBe("");
    expect(result.integration.has_api_key).toBe(true);
  });
});
