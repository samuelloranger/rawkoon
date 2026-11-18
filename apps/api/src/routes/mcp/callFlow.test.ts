import { beforeEach, describe, expect, it, mock } from "bun:test";

// Same seams as index.test.ts (apiKeyApi, prisma owner row, Valkey, and the
// inner dispatcher); this file exercises the tools/call pipeline end to end.

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
      findUnique: async () => ownerRow,
    },
  },
}));

const store = new Map<string, string>();
const counters = new Map<string, number>();
let storeConfirmFails = false;

mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async (k: string) => {
    const raw = store.get(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  },
  setJsonCache: async (k: string, v: unknown) => {
    store.set(k, JSON.stringify(v));
  },
  // Reports the write honestly so the fail-closed confirm path is reachable.
  setJsonCacheChecked: async (k: string, v: unknown) => {
    if (storeConfirmFails) return false;
    store.set(k, JSON.stringify(v));
    return true;
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

const rpc = (method: string, params: unknown) =>
  mcpRoutes.fetch(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "rwk_test" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );

const call = (name: string, arguments_: unknown) =>
  rpc("tools/call", { name, arguments: arguments_ });

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
  store.clear();
  counters.clear();
  storeConfirmFails = false;
  dispatched.length = 0;
  respond = async () =>
    Response.json({
      item: { id: 9, title: "Dune", status: "monitored" },
      search_queued: true,
    });
});

describe("the two-step confirm flow (request_title)", () => {
  const args = { kind: "movie", tmdb_id: 438631, title: "Dune" };

  it("returns a summary and token without performing anything", async () => {
    const res = await call("request_title", args);
    const body = (await res.json()) as {
      result: {
        isError: boolean;
        structuredContent: {
          confirmation_required: boolean;
          summary: string;
          confirm_token: string;
          expires_in_s: number;
          next: string;
        };
      };
    };
    const result = body.result.structuredContent;
    expect(body.result.isError).toBe(false);
    expect(result.confirmation_required).toBe(true);
    expect(result.confirm_token).toHaveLength(32);
    expect(result.expires_in_s).toBe(300);
    expect(result.summary).toContain("Dune");
    expect(result.next).toContain("confirm_token");
    expect(dispatched).toHaveLength(0);
  });

  it("performs on the second call with the token and the same arguments", async () => {
    const first = (await (await call("request_title", args)).json()) as {
      result: { structuredContent: { confirm_token: string } };
    };
    const token = first.result.structuredContent.confirm_token;

    const second = await call("request_title", {
      ...args,
      confirm_token: token,
    });
    const body = (await second.json()) as {
      result: { isError: boolean; structuredContent: Record<string, unknown> };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.added).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].url).toContain("/api/library");
    expect(dispatched[0].body).toMatchObject({
      tmdb_id: 438631,
      type: "movie",
      search_on_add: true,
    });
  });

  it("refuses a reused token and tells the AI to start over", async () => {
    const first = (await (await call("request_title", args)).json()) as {
      result: { structuredContent: { confirm_token: string } };
    };
    await call("request_title", {
      ...args,
      confirm_token: first.result.structuredContent.confirm_token,
    });

    const third = await call("request_title", {
      ...args,
      confirm_token: first.result.structuredContent.confirm_token,
    });
    const body = (await third.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Start over");
    expect(dispatched).toHaveLength(1);
  });

  it("refuses a token bound to different arguments", async () => {
    const first = (await (await call("request_title", args)).json()) as {
      result: { structuredContent: { confirm_token: string } };
    };
    const other = await call("request_title", {
      kind: "movie",
      tmdb_id: 2,
      title: "B",
      confirm_token: first.result.structuredContent.confirm_token,
    });
    const body = (await other.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("different arguments");
    expect(dispatched).toHaveLength(0);
  });

  it("refuses an expired or unknown token", async () => {
    const res = await call("request_title", {
      ...args,
      confirm_token: "deadbeefdeadbeefdeadbeefdeadbeef",
    });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Start over");
  });

  it("fails before issuing a token when the caller can't run the tool", async () => {
    // Approve without a quality profile: zod rejects it on the first call.
    const res = await call("decide_request", {
      request_id: 5,
      decision: "approve",
    });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("quality_profile_id");
    expect(store.size).toBe(0);
  });

  it("binds the token to the calling key", async () => {
    const first = (await (
      await call("request_title", {
        kind: "movie",
        tmdb_id: 1,
        title: "A",
      })
    ).json()) as {
      result: { structuredContent: { confirm_token: string } };
    };
    verifyResult = {
      valid: true,
      key: {
        id: "key-2",
        name: "other-key",
        referenceId: "user-1",
        permissions: { mcp: ["request"] },
      },
    };
    const res = await call("request_title", {
      kind: "movie",
      tmdb_id: 1,
      title: "A",
      confirm_token: first.result.structuredContent.confirm_token,
    });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Start over");
    expect(dispatched).toHaveLength(0);
  });
});

describe("per-key rate limits", () => {
  it("refuses a read tool over 60/minute and says when to retry", async () => {
    counters.set("mcp:rl:key-1:read", 60);
    respond = async () => Response.json({ items: [] });

    const res = await call("downloads", {});
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("60 read tools per minute");
    expect(body.result.content[0].text).toContain("42 seconds");
    expect(dispatched).toHaveLength(0);
  });

  it("refuses an over-budget action without burning its confirm token", async () => {
    const first = (await (
      await call("request_title", {
        kind: "movie",
        tmdb_id: 1,
        title: "A",
      })
    ).json()) as {
      result: { structuredContent: { confirm_token: string } };
    };
    const token = first.result.structuredContent.confirm_token;

    counters.set("mcp:rl:key-1:action", 10);
    const refused = await call("request_title", {
      kind: "movie",
      tmdb_id: 1,
      title: "A",
      confirm_token: token,
    });
    const refusedBody = (await refused.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(refusedBody.result.isError).toBe(true);
    expect(refusedBody.result.content[0].text).toContain("10 actions per hour");
    expect(dispatched).toHaveLength(0);

    // The token was not consumed (GETDEL comes after the budget check), so
    // once the window resets the same confirmation still performs.
    counters.set("mcp:rl:key-1:action", 0);
    const performed = await call("request_title", {
      kind: "movie",
      tmdb_id: 1,
      title: "A",
      confirm_token: token,
    });
    const performedBody = (await performed.json()) as {
      result: { isError: boolean };
    };
    expect(performedBody.result.isError).toBe(false);
    expect(dispatched).toHaveLength(1);
  });

  it("counts the action budget once per performed confirm", async () => {
    const first = (await (
      await call("request_title", {
        kind: "movie",
        tmdb_id: 1,
        title: "A",
      })
    ).json()) as {
      result: { structuredContent: { confirm_token: string } };
    };
    await call("request_title", {
      kind: "movie",
      tmdb_id: 1,
      title: "A",
      confirm_token: first.result.structuredContent.confirm_token,
    });
    expect(counters.get("mcp:rl:key-1:action")).toBe(1);
  });

  it("fails closed when the confirmation cannot be stored", async () => {
    storeConfirmFails = true;
    const res = await call("request_title", {
      kind: "movie",
      tmdb_id: 1,
      title: "A",
    });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Could not store");
    expect(store.size).toBe(0);
    expect(dispatched).toHaveLength(0);
  });

  it("does not spend the action budget on the unconfirmed summary call", async () => {
    await call("request_title", {
      kind: "movie",
      tmdb_id: 1,
      title: "A",
    });
    expect(counters.has("mcp:rl:key-1:action")).toBe(false);
    expect(counters.get("mcp:rl:key-1:read")).toBeUndefined();
  });
});
