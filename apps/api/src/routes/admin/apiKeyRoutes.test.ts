import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const createdAt = new Date("2026-06-16T00:00:00Z");

const row = {
  id: "key-1",
  name: "Labby",
  start: "rwk_ab",
  prefix: null,
  enabled: true,
  lastRequest: null,
  expiresAt: null,
  createdAt,
};

const del = mock(async () => ({}));
const createApiKey = mock(async () => ({
  id: "key-1",
  key: "rwk_secret_plaintext",
}));

const findMany = mock(async () => [row]);
const findUnique = mock(async () => row);
const findFirst = mock(async () => null);

mock.module("@rawkoon/api/db", () => ({
  prisma: { baApiKey: { findMany, findUnique, findFirst, delete: del } },
}));

// Mock the narrow apiKeyApi seam (its own module) — avoids colliding with the
// many tests that mock @rawkoon/api/lib/auth.
mock.module("@rawkoon/api/lib/apiKeyApi", () => ({
  apiKeyApi: { createApiKey },
}));

const { adminApiKeyRoutes } = await import("./apiKeyRoutes");
const app = new Elysia().use(adminApiKeyRoutes);

const post = (body: unknown) =>
  app.handle(
    new Request("http://localhost/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("admin api-keys routes", () => {
  beforeEach(() => {
    createApiKey.mockClear();
    del.mockClear();
  });

  it("lists keys without exposing the secret", async () => {
    const res = await app.handle(new Request("http://localhost/api-keys"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.api_keys).toHaveLength(1);
    expect(json.api_keys[0]).toMatchObject({
      id: "key-1",
      name: "Labby",
      start: "rwk_ab",
      created_at: createdAt.toISOString(),
    });
    expect(JSON.stringify(json)).not.toContain("plaintext");
  });

  it("creates a key and returns the plaintext once", async () => {
    const res = await post({ name: "Labby" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.key).toBe("rwk_secret_plaintext");
    expect(json.api_key.id).toBe("key-1");
    expect(createApiKey).toHaveBeenCalledTimes(1);
  });

  it("converts expiry days to seconds for the plugin", async () => {
    await post({ name: "Labby", expires_in_days: 30 });
    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ name: "Labby", expiresIn: 30 * 86400 }),
      }),
    );
  });

  it("rejects an empty name", async () => {
    const res = await post({ name: "   " });
    expect(res.status).toBe(400);
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range expiry", async () => {
    const res = await post({ name: "Labby", expires_in_days: 999 });
    expect(res.status).toBe(400);
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("deletes a key", async () => {
    const res = await app.handle(
      new Request("http://localhost/api-keys/key-1", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: "key-1" } });
  });
});
