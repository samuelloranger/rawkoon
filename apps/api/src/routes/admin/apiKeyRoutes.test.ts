import { beforeEach, describe, expect, it, mock } from "bun:test";

const createdAt = new Date("2026-06-16T00:00:00Z");

const row = {
  id: "key-1",
  name: "Labby",
  start: "rwk_ab",
  prefix: null,
  enabled: true,
  referenceId: "ref-1",
  permissions: JSON.stringify({ mcp: ["read", "request"] }),
  lastRequest: null,
  expiresAt: null,
  createdAt,
};

const del = mock(async () => ({}));
const createApiKey = mock(async () => ({
  id: "key-1",
  key: "rwk_secret_plaintext",
}));
const updateApiKey = mock(
  async ({ body }: { body: { permissions?: unknown } }) => {
    // Mirror the plugin's write so the re-read reflects the new scopes.
    row.permissions = JSON.stringify(body.permissions ?? {});
    return {};
  },
);

const findMany = mock(async () => [row]);
const findUnique = mock(async (): Promise<typeof row | null> => row);
const findFirst = mock(async () => null);

mock.module("@rawkoon/api/db", () => ({
  prisma: { baApiKey: { findMany, findUnique, findFirst, delete: del } },
}));

// Mock the narrow apiKeyApi seam (its own module) — avoids colliding with the
// many tests that mock @rawkoon/api/lib/auth.
mock.module("@rawkoon/api/lib/apiKeyApi", () => ({
  apiKeyApi: { createApiKey, updateApiKey },
}));

const { adminApiKeyRoutes } = await import("./apiKeyRoutes");
// Ported to Hono; drive its routes directly (no requireAdmin here — the guard
// lives on the admin parent). Router paths are /api-keys, matching the requests.
const app = { handle: (req: Request) => adminApiKeyRoutes.fetch(req) };

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
    updateApiKey.mockClear();
    row.permissions = JSON.stringify({ mcp: ["read", "request"] });
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

  it("lists the key's MCP scopes from the permissions column", async () => {
    const res = await app.handle(new Request("http://localhost/api-keys"));
    const json = (await res.json()) as any;
    expect(json.api_keys[0].mcp_scopes).toEqual(["read", "request"]);
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

  it("passes MCP scopes as the plugin's permissions body", async () => {
    await post({ name: "Labby", mcp_scopes: ["read", "approve"] });
    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          permissions: { mcp: ["read", "approve"] },
        }),
      }),
    );
  });

  it("keeps a key without scopes a plain service key (no permissions)", async () => {
    await post({ name: "Labby" });
    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.not.objectContaining({ permissions: expect.anything() }),
      }),
    );
  });

  it("rejects an unknown MCP scope", async () => {
    const res = await post({ name: "Labby", mcp_scopes: ["root"] });
    expect(res.status).toBe(400);
    expect(createApiKey).not.toHaveBeenCalled();
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

  it("edits the MCP scopes of an existing key", async () => {
    const res = await app.handle(
      new Request("http://localhost/api-keys/key-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mcp_scopes: ["read"] }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.api_key.mcp_scopes).toEqual(["read"]);
    expect(updateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          keyId: "key-1",
          userId: "ref-1",
          permissions: { mcp: ["read"] },
        }),
      }),
    );
  });

  it("refuses a scope edit for a missing key", async () => {
    findUnique.mockImplementationOnce(async () => null);
    const res = await app.handle(
      new Request("http://localhost/api-keys/ghost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mcp_scopes: [] }),
      }),
    );
    expect(res.status).toBe(404);
    expect(updateApiKey).not.toHaveBeenCalled();
  });

  it("refuses a scope edit with an invalid body", async () => {
    const res = await app.handle(
      new Request("http://localhost/api-keys/key-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mcp_scopes: "read" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(updateApiKey).not.toHaveBeenCalled();
  });
});
