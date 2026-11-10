import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "clipsroute-"));
Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
const root = join(base, "data", "clips");
await mkdir(root, { recursive: true });

let enabled = true;
let row: { id: number } | null = { id: 3 };
let lastWhere: Record<string, unknown> | null = null;
let running = 0;
let clip: { status: string } | null = { status: "done" };

mock.module("@rawkoon/api/services/queueService", () => ({
  clipsQueue: {
    add: async () => {},
    pause: async () => {},
    resume: async () => {},
  },
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    clipSettings: {
      upsert: async () => ({ enabled, paused: false }),
      findUnique: async () => ({ enabled, paused: false }),
    },
    previewClip: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        lastWhere = where;
        return row;
      },
      findUnique: async () => clip,
      count: async () => running,
      update: async () => clip,
    },
    mediaFile: { findUnique: async () => null },
  },
}));
// mock.module is process-wide, so keep every export the app imports.
mock.module("@rawkoon/api/middleware/hono/auth", () => {
  const pass = async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "u1" });
    await next();
  };
  return { requireUser: pass, requireAdmin: pass };
});

const { clipsRoutes, parseRange } = await import("./index");

afterAll(() => rm(base, { recursive: true, force: true }));
beforeEach(async () => {
  enabled = true;
  row = { id: 3 };
  clip = { status: "done" };
  running = 0;
  lastWhere = null;
  await writeFile(join(root, "clip-3.mp4"), "0123456789");
});

const get = (qs: string, headers: Record<string, string> = {}) =>
  clipsRoutes.request(`/file?${qs}`, { headers });
const Q = "tmdbId=603&type=movie";

describe("parseRange", () => {
  it("handles open, closed and suffix ranges and rejects bad ones", () => {
    expect(parseRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
    expect(parseRange("bytes=5-", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=2-99", 10)).toEqual({ start: 2, end: 9 });
    for (const bad of [
      "bytes=10-",
      "bytes=5-2",
      "bytes=-",
      "items=1-2",
      "bytes=a-b",
    ]) {
      expect(parseRange(bad, 10)).toBeNull();
    }
  });
});

describe("GET /status", () => {
  it("reports whether clips are enabled", async () => {
    expect(await (await clipsRoutes.request("/status")).json()).toEqual({
      enabled: true,
    });
    enabled = false;
    expect(await (await clipsRoutes.request("/status")).json()).toEqual({
      enabled: false,
    });
  });
});

describe("GET /file", () => {
  it("streams the whole clip with caching headers", async () => {
    const res = await get(Q);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(await res.text()).toBe("0123456789");
  });

  it("answers a range with 206 and the slice", async () => {
    const res = await get(Q, { Range: "bytes=2-4" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await res.text()).toBe("234");
  });

  it("answers an unsatisfiable range with 416", async () => {
    const res = await get(Q, { Range: "bytes=50-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("answers a matching ETag with 304", async () => {
    const etag = (await get(Q)).headers.get("etag") as string;
    expect((await get(Q, { "If-None-Match": etag })).status).toBe(304);
  });

  it("is 404 when disabled, when no row matches, and when the file is missing", async () => {
    enabled = false;
    expect((await get(Q)).status).toBe(404);
    enabled = true;
    row = null;
    expect((await get(Q)).status).toBe(404);
    row = { id: 4 };
    expect((await get(Q)).status).toBe(404);
  });

  it("is 404, not 400, for season 0", async () => {
    row = null;
    expect((await get("tmdbId=1399&type=show&season=0")).status).toBe(404);
  });

  it("looks a show up by season, defaulting to the first", async () => {
    await get("tmdbId=1399&type=show");
    expect(lastWhere).toMatchObject({
      kind: "season",
      seasonNumber: 1,
      media: { tmdbId: 1399, type: "show" },
    });
    await get("tmdbId=1399&type=show&season=3");
    expect(lastWhere).toMatchObject({ seasonNumber: 3 });
  });

  it("rejects bad input, and never takes a path from the client", async () => {
    expect((await get("tmdbId=abc&type=movie")).status).toBe(400);
    expect((await get("tmdbId=1&type=tv")).status).toBe(400);
    expect(
      (await get("tmdbId=1&type=movie&file=../../etc/passwd")).status,
    ).toBe(200);
  });
});

describe("admin routes", () => {
  it("refuses delete-all while enabled", async () => {
    const res = await clipsRoutes.request("/delete-all", { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("refuses delete-all with a distinct message while a clip is running", async () => {
    enabled = false;
    running = 1;
    const res = await clipsRoutes.request("/delete-all", { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain(
      "being cut",
    );
  });

  it("validates the re-cut start", async () => {
    const post = (body: unknown) =>
      clipsRoutes.request("/3/recut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post({ start_sec: -1 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ start_sec: 61.5 })).status).toBe(200);
    clip = { status: "running" };
    expect((await post({ start_sec: 5 })).status).toBe(409);
    clip = null;
    expect((await post({ start_sec: 5 })).status).toBe(404);
  });
});
