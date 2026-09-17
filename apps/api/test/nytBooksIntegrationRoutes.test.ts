import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import type { Env } from "@rawkoon/api/honoEnv";

// Same two behaviours as the Google Books integration carry the weight: an
// empty api_key must KEEP the stored key (the form never receives the secret
// back), and enabling without any key must fail loudly rather than leaving a
// bestseller shelf whose every fetch dies on authentication.

const state: {
  stored: { enabled: boolean; config: unknown } | null;
  upserts: Array<{ enabled: boolean; config: Record<string, unknown> }>;
} = { stored: null, upserts: [] };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    oidcProvider: { findMany: () => Promise.resolve([]) },
    integration: {
      upsert: (args: {
        update: { enabled: boolean; config: Record<string, unknown> };
      }) => {
        state.upserts.push(args.update);
        return Promise.resolve({ type: "nyt", enabled: args.update.enabled });
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

mock.module("@rawkoon/api/services/crypto", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) =>
    value.startsWith("enc:") ? value.slice(4) : value,
}));

mock.module("@rawkoon/api/utils/activityLogs", () => ({
  logActivity: () => Promise.resolve(undefined),
}));

const { nytBooksIntegrationRoutes } = await import(
  "@rawkoon/api/routes/integrations/nyt"
);

const app = new Hono<Env>().use("*", (c, next) => {
  c.set("user", { id: "admin" } as never);
  return next();
});
app.route("/", nytBooksIntegrationRoutes);

const putNyt = (body: { api_key: string; enabled?: boolean }) =>
  app.request("/nyt", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PUT /api/integrations/nyt", () => {
  beforeEach(() => {
    state.stored = null;
    state.upserts = [];
  });

  it("keeps the stored key when the field is submitted empty", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:existing-key" } };
    const res = await putNyt({ api_key: "", enabled: true });
    expect(res.status).toBe(200);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]?.config).toEqual({ api_key: "enc:existing-key" });
  });

  it("replaces the stored key when a new one is given", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:old" } };
    await putNyt({ api_key: "  new-key  ", enabled: true });
    expect(state.upserts[0]?.config).toEqual({ api_key: "enc:new-key" });
  });

  it("refuses to enable the integration with no key at all", async () => {
    const res = await putNyt({ api_key: "", enabled: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "api_key",
    );
    expect(state.upserts).toEqual([]);
  });

  it("allows disabling with no key", async () => {
    const res = await putNyt({ api_key: "", enabled: false });
    expect(res.status).toBe(200);
    expect(state.upserts[0]?.enabled).toBe(false);
  });

  it("never echoes the key back to the client", async () => {
    state.stored = { enabled: true, config: { api_key: "enc:secret" } };
    const res = await putNyt({ api_key: "brand-new-secret", enabled: true });
    const json = (await res.json()) as {
      integration: { api_key: string; has_api_key: boolean };
    };
    expect(json.integration.api_key).toBe("");
    expect(json.integration.has_api_key).toBe(true);
  });
});
