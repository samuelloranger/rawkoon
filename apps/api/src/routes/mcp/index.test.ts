import { beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Seams: apiKeyApi (verify), prisma (owner row), Valkey (confirm + rate
// counters), and the in-process dispatcher (canned inner route responses).

const ownerRow = {
  id: "user-1",
  email: "owner@example.test",
  firstName: "Ow",
  lastName: "Ner",
  isAdmin: true,
  locale: "en",
  lastLogin: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
};

const memberRow = { ...ownerRow, id: "user-2", isAdmin: false };

let findUniqueRow: typeof ownerRow | null = ownerRow;
let verifyResult: {
  valid: boolean;
  key: {
    id: string;
    name: string | null;
    referenceId: string;
    permissions: Record<string, string[]> | null;
  } | null;
} = {
  valid: true,
  key: {
    id: "key-1",
    name: "mcp-key",
    referenceId: "user-1",
    permissions: { mcp: ["read", "request", "approve", "admin"] },
  },
};

// Middleware/auth imports lib/auth; stub it so the real better-auth instance
// (with its OIDC provider load) never boots in this suite.
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: { api: { getSession: async () => null } },
}));

mock.module("@rawkoon/api/lib/apiKeyApi", () => ({
  apiKeyApi: {
    verifyApiKey: async () => verifyResult,
  },
}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: {
      findUnique: async () => findUniqueRow,
    },
  },
}));

const store = new Map<string, string>();
const counters = new Map<string, number>();

mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async (k: string) => {
    const raw = store.get(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  },
  setJsonCache: async (k: string, v: unknown) => {
    store.set(k, JSON.stringify(v));
  },
  deleteCache: async (k: string) => {
    store.delete(k);
  },
  // GETDEL semantics: a stored value can be taken exactly once.
  takeJsonCache: async (k: string) => {
    const raw = store.get(k);
    if (!raw) return null;
    store.delete(k);
    return JSON.parse(raw) as unknown;
  },
  incrCache: async (k: string) => {
    const next = (counters.get(k) ?? 0) + 1;
    counters.set(k, next);
    return next;
  },
  ttlCache: async () => 42,
}));

const { mcpRoutes } = await import("./index");
const { setMcpDispatcher } = await import("./dispatcher");

// Captured inner requests; each test installs its own responder.
const dispatched: { method: string; url: string; body?: unknown }[] = [];
let respond: (req: Request) => Promise<Response> = async () =>
  Response.json({});

setMcpDispatcher(async (req) => {
  const cloned = req.clone();
  dispatched.push({
    method: req.method,
    url: req.url,
    body:
      req.method === "POST" ? await cloned.json().catch(() => null) : undefined,
  });
  return respond(req);
});

const post = (body: unknown, headers?: Record<string, string>) =>
  mcpRoutes.fetch(
    new Request("http://localhost/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "rwk_test",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const rpc = (
  method: string,
  params: unknown,
  headers?: Record<string, string>,
) => post({ jsonrpc: "2.0", id: 1, method, params }, headers);

beforeEach(() => {
  verifyResult = {
    valid: true,
    key: {
      id: "key-1",
      name: "mcp-key",
      referenceId: "user-1",
      permissions: { mcp: ["read", "request", "approve", "admin"] },
    },
  };
  findUniqueRow = ownerRow;
  store.clear();
  counters.clear();
  dispatched.length = 0;
  respond = async () => Response.json({});
});

describe("POST /api/mcp (JSON-RPC transport)", () => {
  it("answers initialize with a negotiated protocol version and server info", async () => {
    const res = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.serverInfo.name).toBe("rawkoon");
  });

  it("falls back to the newest supported version when the client asks for another", async () => {
    const res = await rpc("initialize", { protocolVersion: "1999-01-01" });
    const body = (await res.json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  it("accepts a notification with 202 and an empty body", async () => {
    const res = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("answers ping with an empty result object", async () => {
    const res = await rpc("ping", {});
    const body = (await res.json()) as { result: unknown };
    expect(body.result).toEqual({});
  });

  it("reports an unknown method with -32601", async () => {
    const res = await rpc("resources/list", {});
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it("reports malformed JSON with -32700", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("reports a non-JSON-RPC body with -32600", async () => {
    const res = await post({ hello: "world" });
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32600);
  });

  it("handles a batch and answers one response per non-notification", async () => {
    const res = await post([
      { jsonrpc: "2.0", method: "ping", id: 7 },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "nope", id: 8 },
    ]);
    const body = (await res.json()) as { id: number; error?: unknown }[];
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(7);
    expect((body[1].error as { code: number }).code).toBe(-32601);
  });

  it("answers 202 when a batch is only notifications", async () => {
    const res = await post([
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(res.status).toBe(202);
  });

  it("refuses GET with 405 (no SSE stream)", async () => {
    const res = await mcpRoutes.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(405);
  });

  it("refuses a body over 64 KiB", async () => {
    const res = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { pad: "x".repeat(65 * 1024) },
    });
    expect(res.status).toBe(413);
  });
});

describe("MCP authentication", () => {
  it("is 401 without any key", async () => {
    const res = await rpc("ping", {}, { "x-api-key": "" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32001);
  });

  it("is 401 for an invalid key", async () => {
    verifyResult = { valid: false, key: null };
    const res = await rpc("ping", {}, { "x-api-key": "nope" });
    expect(res.status).toBe(401);
  });

  it("accepts the same key via x-api-key and via Authorization Bearer", async () => {
    const header = await rpc("ping", {}, { "x-api-key": "rwk_test" });
    expect(header.status).toBe(200);

    // Bearer only: many MCP clients never send x-api-key (Codex never does).
    const bearer = await rpc(
      "ping",
      {},
      {
        "x-api-key": "",
        Authorization: "Bearer rwk_test",
      },
    );
    expect(bearer.status).toBe(200);
  });

  it("refuses a valid key with no mcp permission (plain service key)", async () => {
    verifyResult = {
      valid: true,
      key: {
        id: "key-svc",
        name: "labby",
        referenceId: "user-1",
        permissions: null,
      },
    };
    const res = await rpc("ping", {}, { "x-api-key": "rwk_svc" });
    expect(res.status).toBe(401);
  });

  it("drops the admin scope when the owner is not an admin at call time", async () => {
    verifyResult.key = {
      id: "key-1",
      name: "mcp-key",
      referenceId: "user-1",
      permissions: { mcp: ["admin", "read"] },
    };
    findUniqueRow = memberRow;

    const res = await rpc("tools/list", {});
    const body = (await res.json()) as {
      result: { tools: { name: string }[] };
    };
    expect(body.result.tools.map((t) => t.name)).not.toContain("health");

    // And the call itself is refused with a tool error, not a dispatch.
    const call = await rpc("tools/call", { name: "health", arguments: {} });
    const callBody = (await call.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(callBody.result.isError).toBe(true);
    expect(callBody.result.content[0].text).toContain("admin");
    expect(dispatched).toHaveLength(0);
  });

  it("lists only the tools the key's scopes allow", async () => {
    verifyResult.key = {
      id: "key-1",
      name: "mcp-key",
      referenceId: "user-1",
      permissions: { mcp: ["read"] },
    };
    const res = await rpc("tools/list", {});
    const body = (await res.json()) as {
      result: { tools: { name: string; inputSchema: unknown }[] };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toEqual([
      "search",
      "library_lookup",
      "downloads",
      "calendar",
      "my_requests",
      "listening_progress",
    ]);
    expect(body.result.tools[0].inputSchema).toBeTypeOf("object");
  });

  it("refuses a tool outside the key's scopes with a plain-English tool error", async () => {
    verifyResult.key = {
      id: "key-1",
      name: "mcp-key",
      referenceId: "user-1",
      permissions: { mcp: ["read"] },
    };
    const res = await rpc("tools/call", {
      name: "request_title",
      arguments: { kind: "movie", tmdb_id: 1, title: "X" },
    });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('"request"');
  });

  it("reports an unknown tool with -32602", async () => {
    const res = await rpc("tools/call", { name: "ghost", arguments: {} });
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32602);
  });
});
