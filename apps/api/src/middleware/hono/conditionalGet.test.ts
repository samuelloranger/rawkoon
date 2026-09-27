import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { ok, unauthorized } from "@rawkoon/api/errors";
import {
  appendVary,
  conditionalGet,
  ifNoneMatchHits,
} from "@rawkoon/api/middleware/hono/conditionalGet";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", conditionalGet);
  app.get("/api/items", () => ok({ items: [1, 2, 3] }));
  app.get("/api/guarded", () => unauthorized());
  app.get("/api/text", (c) => c.text("hello"));
  app.get("/api/cached", () =>
    Response.json({ a: 1 }, { headers: { "Cache-Control": "max-age=60" } }),
  );
  app.get("/api/no-store", () =>
    Response.json({ a: 1 }, { headers: { "Cache-Control": "no-store" } }),
  );
  app.get("/api/cookie", () =>
    Response.json({ a: 1 }, { headers: { "Set-Cookie": "s=1; Path=/" } }),
  );
  app.get("/api/sse", () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
        // Never closes, like the real notification stream.
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  return app;
}

async function withTimeout<T>(p: Promise<T>, ms = 1000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), ms),
    ),
  ]);
}

describe("conditionalGet", () => {
  it("tags a 200 JSON response with a weak ETag and private no-cache", async () => {
    const res = await buildApp().request("/api/items");
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toMatch(/^W\/"[^"]+"$/);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("Vary")).toBe("Authorization");
    expect(await res.json()).toEqual({ items: [1, 2, 3] });
  });

  it("yields a stable ETag for the same body", async () => {
    const app = buildApp();
    const a = await app.request("/api/items");
    const b = await app.request("/api/items");
    expect(a.headers.get("ETag")).toBe(b.headers.get("ETag"));
  });

  it("answers a matching If-None-Match with an empty 304", async () => {
    const app = buildApp();
    const etag = (await app.request("/api/items")).headers.get("ETag") ?? "";
    const res = await app.request("/api/items", {
      headers: { "If-None-Match": `"other", ${etag}` },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("ETag")).toBe(etag);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("Vary")).toBe("Authorization");
    expect(res.headers.get("Content-Type")).toBeNull();
  });

  it("matches a strong If-None-Match against the weak tag", async () => {
    const app = buildApp();
    const etag = (await app.request("/api/items")).headers.get("ETag") ?? "";
    const res = await app.request("/api/items", {
      headers: { "If-None-Match": etag.slice(2) },
    });
    expect(res.status).toBe(304);
  });

  it("treats If-None-Match: * as a match", async () => {
    const res = await buildApp().request("/api/items", {
      headers: { "If-None-Match": "*" },
    });
    expect(res.status).toBe(304);
  });

  it("returns 200 with the body for a non-matching If-None-Match", async () => {
    const res = await buildApp().request("/api/items", {
      headers: { "If-None-Match": 'W/"stale"' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [1, 2, 3] });
  });

  it("handles HEAD like GET", async () => {
    const app = buildApp();
    const etag = (await app.request("/api/items")).headers.get("ETag") ?? "";
    const head = await app.request("/api/items", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("ETag")).toBe(etag);
    const hit = await app.request("/api/items", {
      method: "HEAD",
      headers: { "If-None-Match": etag },
    });
    expect(hit.status).toBe(304);
  });

  it("leaves a 401 JSON response alone even with If-None-Match: *", async () => {
    const res = await buildApp().request("/api/guarded", {
      headers: { "If-None-Match": "*" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("ETag")).toBeNull();
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("leaves non-JSON responses untouched", async () => {
    const res = await buildApp().request("/api/text", {
      headers: { "If-None-Match": "*" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(await res.text()).toBe("hello");
  });

  it("keeps an existing Cache-Control", async () => {
    const res = await buildApp().request("/api/cached");
    expect(res.headers.get("ETag")).not.toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("max-age=60");
  });

  it("skips no-store and Set-Cookie responses", async () => {
    const app = buildApp();
    for (const path of ["/api/no-store", "/api/cookie"]) {
      const res = await app.request(path, {
        headers: { "If-None-Match": "*" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("ETag")).toBeNull();
    }
  });

  it("ignores non-GET methods", async () => {
    const app = new Hono();
    app.use("/api/*", conditionalGet);
    app.post("/api/items", () => ok({ created: true }));
    const res = await app.request("/api/items", {
      method: "POST",
      headers: { "If-None-Match": "*" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBeNull();
  });

  it("returns an SSE response without awaiting its never-ending body", async () => {
    const res = await withTimeout(
      Promise.resolve(buildApp().request("/api/sse")),
    );
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("ETag")).toBeNull();
    const reader = res.body?.getReader();
    const first = await withTimeout(reader?.read() ?? Promise.reject());
    expect(new TextDecoder().decode(first.value)).toBe("data: hi\n\n");
    await reader?.cancel();
  });
});

describe("ifNoneMatchHits", () => {
  const etag = 'W/"abc"';
  it.each([
    [undefined, false],
    ['W/"abc"', true],
    ['"abc"', true],
    [' "x" , W/"abc" ', true],
    ['"x,y", "abc"', true],
    ['"abcd"', false],
    ["*", true],
  ] as const)("%p -> %p", (header, expected) => {
    expect(ifNoneMatchHits(header, etag)).toBe(expected);
  });
});

describe("appendVary", () => {
  it("merges case-insensitively and keeps *", () => {
    const h = new Headers({ Vary: "Origin, authorization" });
    appendVary(h, "Authorization", "Accept-Encoding");
    expect(h.get("Vary")).toBe("Origin, authorization, Accept-Encoding");
    const star = new Headers({ Vary: "*" });
    appendVary(star, "Authorization");
    expect(star.get("Vary")).toBe("*");
  });
});
