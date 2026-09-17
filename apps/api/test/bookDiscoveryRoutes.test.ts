import { describe, it, expect, mock } from "bun:test";
import { Hono } from "hono";
import type { Env } from "@rawkoon/api/honoEnv";

// requireUser is shared middleware tested elsewhere; here we exercise the
// handler logic (defaults, unknown-source rejection, 503 mapping), so stub the
// guard to a passthrough that injects a user.
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: (
    c: { set: (k: string, v: unknown) => void },
    next: () => unknown,
  ) => {
    c.set("user", { id: "u1" });
    return next();
  },
}));

const { BookProviderUnavailableError } = await import(
  "@rawkoon/api/services/books"
);

const state: { fail: boolean } = { fail: false };

mock.module("@rawkoon/api/services/books/bookDiscovery", () => ({
  getConfiguredSources: async () => ({
    sources: [
      {
        id: "leslibraires",
        label: "Palmarès Québec",
        lists: [{ id: "general", label: "Palmarès" }],
      },
    ],
  }),
  getDiscovery: async (source: string, list: string) => {
    if (state.fail) throw new BookProviderUnavailableError("down");
    return {
      source,
      list,
      items: [
        {
          rank: 1,
          title: "A",
          isbn13: "9780000000001",
          coverUrl: null,
          sourceUrl: null,
          author: null,
          overview: null,
          publishedYear: null,
          volumeId: null,
          alreadyInLibrary: false,
        },
      ],
    };
  },
}));

const { bookDiscoveryRoutes } = await import(
  "@rawkoon/api/routes/books/bookDiscoveryRoutes"
);

const app = new Hono<Env>().route("/", bookDiscoveryRoutes);

describe("book discovery routes", () => {
  it("GET /discovery/sources returns configured sources", async () => {
    const res = await app.request("/discovery/sources");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources[0].id).toBe("leslibraires");
  });

  it("GET /discovery defaults source + list", async () => {
    state.fail = false;
    const res = await app.request("/discovery");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("leslibraires");
    expect(body.list).toBe("general");
    expect(body.items).toHaveLength(1);
  });

  it("GET /discovery passes through source + list query", async () => {
    const res = await app.request(
      "/discovery?source=leslibraires&list=jeunesse",
    );
    const body = await res.json();
    expect(body.list).toBe("jeunesse");
  });

  it("rejects an unknown source with 400", async () => {
    const res = await app.request("/discovery?source=bogus");
    expect(res.status).toBe(400);
  });

  it("maps a source failure to 503", async () => {
    state.fail = true;
    const res = await app.request("/discovery");
    expect(res.status).toBe(503);
  });
});
