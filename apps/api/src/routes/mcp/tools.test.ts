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

const { MCP_TOOLS, callTool, toolByName } = await import("./tools");
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

describe("the tool registry", () => {
  it("has the eleven task-shaped tools with the expected scopes", () => {
    expect(
      MCP_TOOLS.map((t) => `${t.name}:${t.scope}${t.action ? ":action" : ""}`),
    ).toEqual([
      "search:read",
      "library_lookup:read",
      "downloads:read",
      "quality_profiles:read",
      "calendar:read",
      "my_requests:read",
      "listening_progress:read",
      "request_title:request:action",
      "pending_requests:approve",
      "decide_request:approve:action",
      "health:admin",
    ]);
  });

  it("gives every tool an LLM-ready description and JSON Schema", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe("object");
    }
    const properties = (tool: string) =>
      toolByName(tool)!.inputSchema.properties as Record<string, unknown>;
    expect(properties("request_title").confirm_token).toBeTruthy();
    expect(properties("decide_request").confirm_token).toBeTruthy();
  });
});

describe("search shaping", () => {
  it("maps TMDB tv to show, keeps library status, and searches books when enabled", async () => {
    let hits = 0;
    respond = async (req) => {
      hits++;
      const url = new URL(req.url);
      if (url.pathname === "/api/medias/tmdb-search") {
        return Response.json({
          enabled: true,
          items: [
            {
              tmdb_id: 438631,
              media_type: "tv",
              title: "Dune: Prophecy",
              release_year: 2024,
              overview: "x".repeat(400),
              already_exists: true,
              library_id: 9,
              library_status: "monitored",
            },
            {
              tmdb_id: 101,
              media_type: "movie",
              title: "Dune",
              release_year: 2021,
              overview: null,
              already_exists: false,
              library_id: null,
              library_status: null,
            },
          ],
        });
      }
      if (url.pathname === "/api/system/features") {
        return Response.json({ books_enabled: true });
      }
      return Response.json({
        results: [
          {
            google_volume_id: "vol-1",
            title: "Dune",
            authors: ["Frank Herbert"],
            published_year: 1965,
            language: "en",
            in_library: false,
          },
        ],
      });
    };

    const result = await callTool(
      toolByName("search")!,
      { query: "dune" },
      adminCaller,
    );
    expect(result.isError).toBe(false);
    const shaped = result.structuredContent as {
      movies_and_shows: { items: { kind: string; overview: string }[] };
      books: { items: { google_volume_id: string }[] };
    };
    expect(shaped.movies_and_shows.items[0].kind).toBe("show");
    expect(
      shaped.movies_and_shows.items[0].overview.length,
    ).toBeLessThanOrEqual(300);
    expect(shaped.books.items[0].google_volume_id).toBe("vol-1");
    expect(hits).toBe(3);
  });

  it("skips the book search when books are disabled", async () => {
    respond = async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/system/features") {
        return Response.json({ books_enabled: false });
      }
      return Response.json({ enabled: true, items: [] });
    };
    const result = await callTool(
      toolByName("search")!,
      { query: "dune", kind: "all" },
      adminCaller,
    );
    const shaped = result.structuredContent as { books?: unknown };
    expect(shaped.books).toBeUndefined();
    expect(dispatched.map((d) => new URL(d.url).pathname)).toEqual([
      "/api/medias/tmdb-search",
      "/api/system/features",
    ]);
  });

  it("surfaces a TMDB misconfiguration as a tool failure", async () => {
    respond = async () =>
      Response.json({ error: "TMDB is not configured" }, { status: 400 });
    const result = await callTool(
      toolByName("search")!,
      { query: "dune", kind: "movie" },
      adminCaller,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("TMDB is not configured");
  });
});

describe("health shaping", () => {
  it("passes the doctor report through with capped strings", async () => {
    respond = async () =>
      Response.json({
        status: "warn",
        version: "1.2.3",
        checked_at: "2026-11-18T00:00:00.000Z",
        checks: [
          {
            id: "paths",
            title: "Library paths",
            status: "warn",
            summary: "y".repeat(400),
            fix: "Check the mount.",
            duration_ms: 3,
          },
        ],
      });
    const result = await callTool(toolByName("health")!, {}, adminCaller);
    expect(result.isError).toBe(false);
    const report = result.structuredContent as {
      status: string;
      checks: { summary: string }[];
    };
    expect(report.status).toBe("warn");
    expect(report.checks[0].summary.length).toBeLessThanOrEqual(300);
  });
});

describe("request_title shaping", () => {
  it("adds directly for an admin owner and reports the search queue", async () => {
    respond = async () =>
      Response.json(
        {
          item: { id: 9, title: "Dune", status: "monitored" },
          search_queued: true,
        },
        { status: 200 },
      );

    const first = await callTool(
      toolByName("request_title")!,
      { kind: "movie", tmdb_id: 438631, title: "Dune", quality_profile_id: 2 },
      adminCaller,
    );
    expect(dispatched).toHaveLength(0);
    const token = (first.structuredContent as { confirm_token: string })
      .confirm_token;

    const second = await callTool(
      toolByName("request_title")!,
      {
        kind: "movie",
        tmdb_id: 438631,
        title: "Dune",
        quality_profile_id: 2,
        confirm_token: token,
      },
      adminCaller,
    );
    expect(second.isError).toBe(false);
    expect(second.structuredContent).toMatchObject({
      added: true,
      library_id: 9,
      title: "Dune",
      search_queued: true,
    });
    expect(dispatched[0].body).toMatchObject({
      tmdb_id: 438631,
      type: "movie",
      quality_profile_id: 2,
      search_on_add: true,
    });
  });

  it("requests (not adds) for a non-admin owner, requiring the title", async () => {
    respond = async () => Response.json({ id: 12 });

    const missingTitle = await callTool(
      toolByName("request_title")!,
      { kind: "show", tmdb_id: 1399, seasons: [1, 2] },
      memberCaller,
    );
    expect(missingTitle.isError).toBe(true);
    expect(missingTitle.content[0].text).toContain("title");
    expect(dispatched).toHaveLength(0);

    const first = await callTool(
      toolByName("request_title")!,
      { kind: "show", tmdb_id: 1399, title: "The Sopranos", seasons: [1, 2] },
      memberCaller,
    );
    const token = (first.structuredContent as { confirm_token: string })
      .confirm_token;
    const second = await callTool(
      toolByName("request_title")!,
      {
        kind: "show",
        tmdb_id: 1399,
        title: "The Sopranos",
        seasons: [1, 2],
        confirm_token: token,
      },
      memberCaller,
    );
    expect(second.isError).toBe(false);
    expect(second.structuredContent).toMatchObject({
      requested: true,
      request_id: 12,
    });
    expect(dispatched[0].url).toContain("/api/requests");
    expect(dispatched[0].body).toMatchObject({
      type: "show",
      tmdb_id: 1399,
      seasons: [1, 2],
    });
  });

  it("maps an inner 409 into a plain-English tool failure", async () => {
    respond = async () =>
      Response.json({ error: "Already requested" }, { status: 409 });
    const first = await callTool(
      toolByName("request_title")!,
      { kind: "movie", tmdb_id: 1, title: "A" },
      memberCaller,
    );
    const token = (first.structuredContent as { confirm_token: string })
      .confirm_token;
    const second = await callTool(
      toolByName("request_title")!,
      { kind: "movie", tmdb_id: 1, title: "A", confirm_token: token },
      memberCaller,
    );
    expect(second.isError).toBe(true);
    expect(second.content[0].text).toContain("Already requested");
  });
});

describe("decide_request shaping", () => {
  it("refuses an approval without a quality profile before anything runs", async () => {
    const result = await callTool(
      toolByName("decide_request")!,
      { request_id: 5, decision: "approve" },
      adminCaller,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("quality_profile_id");
    expect(dispatched).toHaveLength(0);
  });

  it("approves through the admin route with the chosen profile", async () => {
    respond = async () => Response.json({ ok: true, media_id: 3 });
    const first = await callTool(
      toolByName("decide_request")!,
      { request_id: 5, decision: "approve", quality_profile_id: 1 },
      adminCaller,
    );
    const token = (first.structuredContent as { confirm_token: string })
      .confirm_token;
    const second = await callTool(
      toolByName("decide_request")!,
      {
        request_id: 5,
        decision: "approve",
        quality_profile_id: 1,
        confirm_token: token,
      },
      adminCaller,
    );
    expect(second.isError).toBe(false);
    expect(second.structuredContent).toMatchObject({
      decided: "approved",
      request_id: 5,
    });
    expect(dispatched.at(-1)!.url).toContain("/api/requests/5/approve");
  });

  it("names the request and profile in the confirmation summary", async () => {
    respond = async (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/api/requests")
        return Response.json({ requests: [{ id: 5, title: "Dune" }] });
      return Response.json({ profiles: [{ id: 1, name: "HD" }] });
    };
    const first = await callTool(
      toolByName("decide_request")!,
      { request_id: 5, decision: "approve", quality_profile_id: 1 },
      adminCaller,
    );
    const summary = (first.structuredContent as { summary: string }).summary;
    expect(summary).toContain('"Dune"');
    expect(summary).toContain('"HD"');
    expect(dispatched.every((d) => d.method === "GET")).toBe(true);
  });

  it("refuses a non-admin owner before issuing a confirm token", async () => {
    const result = await callTool(
      toolByName("decide_request")!,
      { request_id: 5, decision: "deny" },
      memberCaller,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("admin owner");
    expect(dispatched).toHaveLength(0);
  });

  it("says the token is used up when the confirmed action fails", async () => {
    const args = { request_id: 5, decision: "deny" } as const;
    const first = await callTool(
      toolByName("decide_request")!,
      args,
      adminCaller,
    );
    const token = (first.structuredContent as { confirm_token: string })
      .confirm_token;
    respond = async () => Response.json({ error: "nope" }, { status: 404 });
    const second = await callTool(
      toolByName("decide_request")!,
      { ...args, confirm_token: token },
      adminCaller,
    );
    expect(second.isError).toBe(true);
    expect(second.content[0].text).toContain("now used up");
    expect(second.structuredContent).toBeUndefined();
  });

  it("ends the confirm hint with a single period", async () => {
    const first = await callTool(
      toolByName("decide_request")!,
      { request_id: 5, decision: "deny" },
      adminCaller,
    );
    const next = (first.structuredContent as { next: string }).next;
    expect(next.endsWith("..")).toBe(false);
  });
});

describe("read tool shaping", () => {
  it("keeps numeric resolution and tmdb_id in library_lookup", async () => {
    respond = async () =>
      Response.json({
        items: [{ id: 1, tmdb_id: 42, title: "X", resolution: 1080 }],
        has_more: false,
      });
    const result = await callTool(
      toolByName("library_lookup")!,
      { query: "x" },
      adminCaller,
    );
    const item = (
      result.structuredContent as {
        items: { resolution: number; tmdb_id: number }[];
      }
    ).items[0];
    expect(item.resolution).toBe(1080);
    expect(item.tmdb_id).toBe(42);
  });

  it("reports download progress as a percent and speed in bytes per second", async () => {
    respond = async () =>
      Response.json({
        enabled: true,
        connected: true,
        items: [{ progress: 0.456, download_speed: 2048 }],
      });
    const result = await callTool(toolByName("downloads")!, {}, adminCaller);
    const item = (
      result.structuredContent as {
        items: {
          progress_percent: number;
          download_speed_bytes_per_s: number;
        }[];
      }
    ).items[0];
    expect(item.progress_percent).toBe(46);
    expect(item.download_speed_bytes_per_s).toBe(2048);
  });

  it("lists quality profiles with their ids", async () => {
    respond = async () =>
      Response.json({
        profiles: [{ id: 3, name: "HD", min_resolution: 1080 }],
      });
    const result = await callTool(
      toolByName("quality_profiles")!,
      {},
      adminCaller,
    );
    expect(
      (result.structuredContent as { items: { id: number }[] }).items[0].id,
    ).toBe(3);
  });

  it("never sets structuredContent to a non-object", async () => {
    const denied = await callTool(
      toolByName("request_title")!,
      { kind: "movie", tmdb_id: 1 },
      { ...adminCaller, scopes: ["read"] as McpScope[] },
    );
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toBeUndefined();
  });
});
