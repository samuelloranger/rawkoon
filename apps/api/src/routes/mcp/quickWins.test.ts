import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { McpScope } from "@rawkoon/shared/types";

// Tool shaping against canned inner-route responses; auth is bypassed by
// calling callTool directly with a fabricated caller.

// dispatcher → middleware/auth → lib/auth: stub the real better-auth instance
// (its top-level OIDC load) out of this suite.
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: { api: { getSession: async () => null } },
}));

const store = new Map<string, string>();
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async (k: string) => {
    const raw = store.get(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  },
  setJsonCache: async (k: string, v: unknown) => {
    store.set(k, JSON.stringify(v));
  },
  setJsonCacheChecked: async (k: string, v: unknown) => {
    store.set(k, JSON.stringify(v));
    return true;
  },
  deleteCache: async (k: string) => {
    store.delete(k);
  },
  takeJsonCache: async (k: string) => {
    const raw = store.get(k);
    if (!raw) return null;
    store.delete(k);
    return JSON.parse(raw) as unknown;
  },
  incrCache: async () => 1,
  ttlCache: async () => 42,
}));

const { callTool, toolByName } = await import("./tools");
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

const owner = {
  id: "user-1",
  email: "owner@example.test",
  first_name: "Ow",
  last_name: "Ner",
  is_admin: true,
  locale: "en",
  last_login: null,
  created_at: "2026-01-01T00:00:00.000Z",
  last_activity: null,
  avatar_url: null,
  nav_position: null,
  notification_preferences: null,
  has_passkey: false,
};

const adminCaller = {
  keyId: "key-1",
  keyName: "mcp-key",
  owner,
  scopes: ["read", "request", "approve", "admin"] as McpScope[],
};

const memberCaller = {
  ...adminCaller,
  owner: { ...owner, is_admin: false },
};

beforeEach(() => {
  store.clear();
  dispatched.length = 0;
  respond = async () => Response.json({});
});
const call = (name: string, args: unknown, caller = adminCaller) =>
  callTool(toolByName(name)!, args, caller);

describe("calendar", () => {
  it("keeps releases dated today and drops past and out-of-window days", async () => {
    const now = new Date();
    const day = (offset: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: process.env.TZ ?? "America/New_York",
      }).format(new Date(now.getTime() + offset * 86_400_000));
    respond = async () =>
      Response.json({
        enabled: true,
        items: [
          { title: "Later", media_type: "movie", release_date: day(3) },
          { title: "Today", media_type: "movie", release_date: day(0) },
          { title: "Yesterday", media_type: "movie", release_date: day(-1) },
          { title: "Far", media_type: "movie", release_date: day(20) },
        ],
      });
    const result = await call("calendar", { days: 7 });
    const shaped = result.structuredContent as {
      items: { title: string }[];
    };
    expect(shaped.items.map((i) => i.title)).toEqual(["Today", "Later"]);
  });
});

describe("search argument checks", () => {
  it("refuses a one-character query with a clear message", async () => {
    const result = await call("search", { query: "a" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("at least 2 characters");
    expect(dispatched).toHaveLength(0);
  });
});

describe("request_title argument checks", () => {
  it("names google_volume_id when a book lacks it", async () => {
    const result = await call("request_title", { kind: "book" });
    expect(result.content[0].text).toContain("google_volume_id is required");
  });

  it("rejects seasons on a book", async () => {
    const result = await call("request_title", {
      kind: "book",
      google_volume_id: "vol-1",
      seasons: [1],
    });
    expect(result.content[0].text).toContain(
      "seasons are only valid for shows",
    );
  });
});

describe("listening_progress", () => {
  it("rounds audiobook positions to whole seconds", async () => {
    respond = async (req) =>
      new URL(req.url).pathname === "/api/books/progress"
        ? Response.json({
            progress: [
              {
                book_id: 1,
                title: "A",
                position_secs: 11067.069983456999,
                total_duration_secs: 20000.4,
              },
            ],
          })
        : Response.json({ progress: [] });
    const result = await call("listening_progress", {});
    const shaped = result.structuredContent as {
      listening: {
        items: { position_secs: number; total_duration_secs: number }[];
      };
    };
    expect(shaped.listening.items[0].position_secs).toBe(11067);
    expect(shaped.listening.items[0].total_duration_secs).toBe(20000);
  });
});

describe("cancel_request", () => {
  const requestsList = {
    requests: [{ id: 7, title: 'Dune "Part Two"', status: "pending" }],
  };

  it("previews with the request title and does not delete", async () => {
    respond = async () => Response.json(requestsList);
    const result = await call(
      "cancel_request",
      { request_id: 7 },
      memberCaller,
    );
    const shaped = result.structuredContent as {
      confirmation_required: boolean;
      summary: string;
    };
    expect(shaped.confirmation_required).toBe(true);
    expect(shaped.summary).toContain("Dune Part Two");
    expect(dispatched.every((d) => d.method === "GET")).toBe(true);
  });

  it("deletes through the requests route on confirm", async () => {
    respond = async () => Response.json(requestsList);
    const preview = await call(
      "cancel_request",
      { request_id: 7 },
      memberCaller,
    );
    const token = (preview.structuredContent as { confirm_token: string })
      .confirm_token;
    dispatched.length = 0;
    respond = async () => Response.json({ ok: true });
    const done = await call(
      "cancel_request",
      { request_id: 7, confirm_token: token },
      memberCaller,
    );
    expect(done.structuredContent).toEqual({ cancelled: true, request_id: 7 });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].method).toBe("DELETE");
    expect(new URL(dispatched[0].url).pathname).toBe("/api/requests/7");
  });

  it("surfaces the route's error for someone else's request", async () => {
    respond = async () => Response.json(requestsList);
    const preview = await call(
      "cancel_request",
      { request_id: 7 },
      memberCaller,
    );
    const token = (preview.structuredContent as { confirm_token: string })
      .confirm_token;
    respond = async () =>
      Response.json({ error: "Request not found" }, { status: 404 });
    const done = await call(
      "cancel_request",
      { request_id: 7, confirm_token: token },
      memberCaller,
    );
    expect(done.isError).toBe(true);
    expect(done.content[0].text).toContain("not found");
  });
});
