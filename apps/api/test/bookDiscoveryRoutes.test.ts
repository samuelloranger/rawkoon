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

const addCalls: { via: string; arg: unknown }[] = [];
mock.module("@rawkoon/api/services/books/bookLibrary", () => ({
  addBookFromVolume: async (opts: unknown) => {
    addCalls.push({ via: "volume", arg: opts });
    return { added: true, bookId: 1, created: true };
  },
  addBookFromMetadata: async (opts: unknown) => {
    addCalls.push({ via: "metadata", arg: opts });
    return { added: true, bookId: 2, created: true };
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

  it("adds via the Google volume when volume_id is present", async () => {
    addCalls.length = 0;
    const res = await app.request("/discovery/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        volume_id: "vol-1",
        isbn13: "9780000000001",
        title: "A",
      }),
    });
    expect(res.status).toBe(200);
    expect(addCalls[0]?.via).toBe("volume");
  });

  it("adds from metadata when there is no volume_id", async () => {
    addCalls.length = 0;
    const res = await app.request("/discovery/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        isbn13: "9780000000002",
        title: "B",
        author: "Auteur",
      }),
    });
    expect(res.status).toBe(200);
    expect(addCalls[0]?.via).toBe("metadata");
  });

  it("400s an add with neither volume_id nor isbn13", async () => {
    const res = await app.request("/discovery/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "C" }),
    });
    expect(res.status).toBe(400);
  });
});
