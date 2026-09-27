import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { ok, unauthorized } from "@rawkoon/api/errors";
import {
  COMPRESS_THRESHOLD_BYTES,
  compressJson,
  selectEncoding,
} from "@rawkoon/api/middleware/hono/compressJson";
import { conditionalGet } from "@rawkoon/api/middleware/hono/conditionalGet";

const big = {
  items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `t${i}` })),
};

function buildApp() {
  const app = new Hono();
  // Same order as src/index.ts: compression wraps the ETag layer.
  app.use("/api/*", compressJson);
  app.use("/api/*", conditionalGet);
  app.get("/api/big", () => ok(big));
  app.get("/api/small", () => ok({ a: 1 }));
  app.get("/api/big-401", () => unauthorized("x".repeat(2000)));
  app.get("/api/big-text", (c) => c.text("x".repeat(5000)));
  app.get("/api/sse", () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
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

const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe("compressJson", () => {
  it("gzips a JSON body above the threshold when gzip is accepted", async () => {
    expect(JSON.stringify(big).length).toBeGreaterThan(
      COMPRESS_THRESHOLD_BYTES,
    );
    const res = await buildApp().request("/api/big", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(res.headers.get("Vary")).toBe("Authorization, Accept-Encoding");
    const decoded = gunzipSync(await bytes(res)).toString();
    expect(JSON.parse(decoded)).toEqual(big);
  });

  it("prefers brotli when offered", async () => {
    const res = await buildApp().request("/api/big", {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });
    expect(res.headers.get("Content-Encoding")).toBe("br");
    const decoded = brotliDecompressSync(await bytes(res)).toString();
    expect(JSON.parse(decoded)).toEqual(big);
  });

  it("keeps the ETag identical across encodings", async () => {
    const app = buildApp();
    const plain = await app.request("/api/big");
    const gz = await app.request("/api/big", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(plain.headers.get("Content-Encoding")).toBeNull();
    expect(gz.headers.get("ETag")).toBe(plain.headers.get("ETag"));
  });

  it("sends a 304 uncompressed and empty", async () => {
    const app = buildApp();
    const etag = (await app.request("/api/big")).headers.get("ETag") ?? "";
    const res = await app.request("/api/big", {
      headers: { "Accept-Encoding": "gzip", "If-None-Match": etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Authorization, Accept-Encoding");
    expect(await res.text()).toBe("");
  });

  it("skips bodies at or below the threshold", async () => {
    const res = await buildApp().request("/api/small", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("skips when the client sends no Accept-Encoding", async () => {
    const res = await buildApp().request("/api/big");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(await res.json()).toEqual(big);
  });

  it("leaves non-200 and non-JSON responses alone", async () => {
    const app = buildApp();
    const denied = await app.request("/api/big-401", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Content-Encoding")).toBeNull();

    const text = await app.request("/api/big-text", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(text.headers.get("Content-Encoding")).toBeNull();
  });

  it("streams SSE through without buffering or encoding it", async () => {
    const res = await withTimeout(
      Promise.resolve(
        buildApp().request("/api/sse", {
          headers: { "Accept-Encoding": "gzip, br" },
        }),
      ),
    );
    expect(res.headers.get("Content-Encoding")).toBeNull();
    const reader = res.body?.getReader();
    const first = await withTimeout(reader?.read() ?? Promise.reject());
    expect(new TextDecoder().decode(first.value)).toBe("data: hi\n\n");
    await reader?.cancel();
  });
});

describe("selectEncoding", () => {
  it.each([
    [undefined, null],
    ["gzip", "gzip"],
    ["gzip, br", "br"],
    ["br;q=0, gzip", "gzip"],
    ["gzip;q=0", null],
    ["*", "br"],
    ["identity", null],
    ["deflate", null],
  ] as const)("%p -> %p", (header, expected) => {
    expect(selectEncoding(header)).toBe(expected);
  });
});
