import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

let verify: { valid: boolean; key: { referenceId: string } | null } = {
  valid: false,
  key: null,
};
let owner: { isAdmin: boolean } | null = null;

mock.module("@rawkoon/api/lib/apiKeyApi", () => ({
  apiKeyApi: { verifyApiKey: async () => verify },
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: { user: { findUnique: async () => owner } },
}));

const { requireApiKey } = await import("@rawkoon/api/middleware/hono/apiKey");
const app = new Hono().use("*", requireApiKey).get("/", (c) => c.text("ok"));
const call = (headers: Record<string, string> = {}) =>
  app.fetch(new Request("http://x/", { headers }));

beforeEach(() => {
  verify = { valid: true, key: { referenceId: "u1" } };
  owner = { isAdmin: true };
});

describe("requireApiKey", () => {
  it("401s a missing header with a specific message", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /Missing API key/,
    );
  });
  it("401s an invalid or expired key", async () => {
    verify = { valid: false, key: null };
    const res = await call({ "x-api-key": "k" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Invalid or expired API key",
    );
  });
  it("403s a valid key whose owner is not an admin", async () => {
    owner = { isAdmin: false };
    const res = await call({ "x-api-key": "k" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /administrator/,
    );
  });
  it("lets an admin's key through", async () => {
    expect((await call({ "x-api-key": "k" })).status).toBe(200);
  });
});
