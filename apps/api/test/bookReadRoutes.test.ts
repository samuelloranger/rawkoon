/**
 * Byte delivery for the reader and player. Range handling is what a media
 * element depends on, and the 416 must name the real size or playback stalls
 * instead of recovering.
 *
 * There is no path-traversal case to test: the only client input is a file id,
 * and the path is read from the row.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "rawkoon-bookread-"));
const bookPath = join(root, "A Quiet Harbour.epub");
const BODY = "x".repeat(1000);
await writeFile(bookPath, BODY);
const { ino, mtimeMs } = await stat(bookPath);

let authenticated = true;
let fileRow: Record<string, unknown> | null = null;

const dbUser = {
  id: "u1",
  email: "reader@example.com",
  firstName: null,
  lastName: null,
  isAdmin: false,
  locale: null,
  lastLogin: null,
  createdAt: null,
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
  name: "Reader",
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: { findUnique: async () => dbUser },
    bookFile: { findUnique: async () => fileRow },
    bookEdition: { findUnique: async () => null },
    bookProgress: { findUnique: async () => null, findMany: async () => [] },
  },
}));

mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (authenticated ? { user: { id: "u1" } } : null),
    },
    handler: async () => new Response("", { status: 404 }),
  },
  refreshOidcProviders: () => {},
}));

const { Elysia } = await import("elysia");
const { bookReadRoutes, parseRange } = await import(
  "@rawkoon/api/routes/books/bookReadRoutes"
);

const app = new Elysia({ prefix: "/api/books" }).use(bookReadRoutes);

const get = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

const epubRow = () => ({
  filePath: bookPath,
  fileName: "A Quiet Harbour.epub",
  format: "epub",
  sizeBytes: BigInt(1000),
  fileIno: String(ino),
  fileMtimeMs: BigInt(Math.trunc(mtimeMs)),
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parseRange", () => {
  it("ignores a missing or unparseable header", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("pages=1-2", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
  });

  it("reads an open-ended range", () => {
    expect(parseRange("bytes=200-", 1000)).toEqual({ start: 200, end: 999 });
  });

  it("clamps an end past the file", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });

  it("reads a suffix range", () => {
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("calls a start past the end unsatisfiable", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=500-400", 1000)).toBe("unsatisfiable");
  });
});

describe("GET /api/books/files/:id/content", () => {
  beforeEach(() => {
    authenticated = true;
    fileRow = epubRow();
  });

  it("requires a session", async () => {
    authenticated = false;
    const res = await get("/api/books/files/1/content");
    expect(res.status).toBe(401);
  });

  it("404s an unknown file", async () => {
    fileRow = null;
    const res = await get("/api/books/files/1/content");
    expect(res.status).toBe(404);
  });

  it("404s a row whose file left the disk", async () => {
    fileRow = { ...epubRow(), filePath: join(root, "gone.epub") };
    const res = await get("/api/books/files/1/content");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "This file is missing from the library",
    });
  });

  it("serves the whole file with an accept-ranges header", async () => {
    const res = await get("/api/books/files/1/content");
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("content-length")).toBe("1000");
    expect((await res.text()).length).toBe(1000);
  });

  it("answers a range with 206 and a matching content-range", async () => {
    const res = await get("/api/books/files/1/content", {
      range: "bytes=100-199",
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect((await res.text()).length).toBe(100);
  });

  it("answers an unsatisfiable range with 416 naming the real size", async () => {
    const res = await get("/api/books/files/1/content", {
      range: "bytes=4000-5000",
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */1000");
  });

  it("304s a matching if-none-match", async () => {
    const first = await get("/api/books/files/1/content");
    const etag = first.headers.get("etag")!;
    expect(etag).toContain(String(ino));

    const res = await get("/api/books/files/1/content", {
      "if-none-match": etag,
    });
    expect(res.status).toBe(304);
  });

  it("serves audio with its own content type", async () => {
    fileRow = { ...epubRow(), format: "m4b", fileName: "book.m4b" };
    const res = await get("/api/books/files/1/content");
    expect(res.headers.get("content-type")).toBe("audio/mp4");
  });
});

describe("GET /api/books/progress", () => {
  beforeEach(() => {
    authenticated = true;
  });

  it("rejects a missing id list", async () => {
    const res = await get("/api/books/progress");
    expect(res.status).toBe(400);
  });

  it("returns an empty list for ids nobody has opened", async () => {
    const res = await get("/api/books/progress?editionIds=1,2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ progress: [] });
  });
});
