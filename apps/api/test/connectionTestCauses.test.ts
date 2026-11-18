import { afterEach, describe, it, expect, mock } from "bun:test";
import { Hono } from "hono";
import type { Env } from "@rawkoon/api/honoEnv";

// A failed "Test connection" must name the real cause, never echo the key, and
// leave the success shape alone.

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

import { createTransmissionAdapter } from "@rawkoon/api/services/downloadClient/transmissionAdapter";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stubFetch = (impl: () => Promise<Response>) => {
  globalThis.fetch = impl as unknown as typeof fetch;
};
const errno = (code: string) => Object.assign(new Error(code), { code });

const testNyt = async () => {
  const res = await app.request("/nyt/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "SECRETKEY" }),
  });
  return res.json() as Promise<Record<string, unknown>>;
};

describe("NYT test connection names the cause", () => {
  it.each([
    ["ENOTFOUND", "dns"],
    ["ECONNREFUSED", "refused"],
    ["ETIMEDOUT", "timeout"],
  ])("%s -> %s", async (code, cause) => {
    stubFetch(() => Promise.reject(errno(code)));
    const body = await testNyt();
    expect(body.success).toBe(false);
    expect(body.cause).toBe(cause);
    expect(body.message).toContain("NYT Books");
    expect(JSON.stringify(body)).not.toContain("SECRETKEY");
  });

  it("401 -> auth", async () => {
    stubFetch(() => Promise.resolve(new Response("no", { status: 401 })));
    const body = await testNyt();
    expect(body).toMatchObject({ success: false, cause: "auth" });
    expect(body.error).toBe("NYT rejected that key.");
  });

  it("success is unchanged", async () => {
    stubFetch(() => Promise.resolve(new Response("{}", { status: 200 })));
    expect(await testNyt()).toEqual({ success: true });
  });
});

describe("download client adapter test connection", () => {
  const adapter = createTransmissionAdapter({
    website_url: "http://tx.example:9091",
    username: "u",
    password: "pw",
  } as never);

  it("names host:port and the cause on refusal", async () => {
    stubFetch(() => Promise.reject(errno("ECONNREFUSED")));
    expect(await adapter.testConnection()).toMatchObject({
      ok: false,
      cause: "refused",
      message: expect.stringContaining("tx.example:9091"),
    });
  });

  it("classifies DNS failure", async () => {
    stubFetch(() => Promise.reject(errno("ENOTFOUND")));
    expect(await adapter.testConnection()).toMatchObject({ cause: "dns" });
  });

  it("classifies a timeout", async () => {
    stubFetch(() => Promise.reject(errno("ETIMEDOUT")));
    expect(await adapter.testConnection()).toMatchObject({ cause: "timeout" });
  });

  it("classifies HTTP 401 as auth", async () => {
    stubFetch(() => Promise.resolve(new Response("", { status: 401 })));
    expect(await adapter.testConnection()).toMatchObject({
      ok: false,
      cause: "auth",
    });
  });

  it("success is unchanged", async () => {
    stubFetch(() =>
      Promise.resolve(
        Response.json({ result: "success", arguments: {} }, { status: 200 }),
      ),
    );
    expect(await adapter.testConnection()).toEqual({ ok: true });
  });
});
