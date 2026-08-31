import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { parseByteRange } from "@rawkoon/shared/utils";
import { loadConfig } from "@rawkoon/api/config";
import { signGrant } from "@rawkoon/api/services/books/downloadGrant";

const TEST_SECRET = loadConfig().SECRET_KEY;

let fixturePath = "";
let fixtureSize = 0;

const findUnique = mock(async (args: { where: { id: number } }) => {
  if (args.where.id !== 1) return null;
  return {
    filePath: fixturePath,
    sizeBytes: BigInt(fixtureSize),
  };
});

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    oidcProvider: {
      findMany: async () => [],
    },
    bookFile: {
      findUnique,
    },
  },
}));

const { bookContentRoutes, clampClientTimestamp, sliceForRange } = await import(
  "./bookPlaybackRoutes"
);

const tempDir = mkdtempSync(join(tmpdir(), "book-content-ranges-"));

const app = new Elysia()
  .use(
    cors({
      origin: Bun.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    }),
  )
  .use(bookContentRoutes);

const grantFor = (fileId: number) =>
  signGrant(
    {
      fileId,
      variant: "original",
      grantId: crypto.randomUUID(),
      expiresAt: Date.now() + 60_000,
    },
    TEST_SECRET,
  );

beforeEach(async () => {
  findUnique.mockClear();
  const bytes = new Uint8Array(4096);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = index % 251;
  }
  fixtureSize = bytes.byteLength;
  fixturePath = join(tempDir, `${crypto.randomUUID()}.mp3`);
  await Bun.write(fixturePath, bytes);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

describe("clampClientTimestamp", () => {
  test("a future client clock is clamped to server time", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(clampClientTimestamp("2099-01-01T00:00:00Z", now)).toEqual(now);
  });

  test("a past client clock is kept, because offline edits are legitimate", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const past = "2026-08-20T09:30:00Z";
    expect(clampClientTimestamp(past, now)).toEqual(new Date(past));
  });

  test("an unparseable timestamp falls back to server time", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(clampClientTimestamp("banana", now)).toEqual(now);
  });
});

describe("sliceForRange", () => {
  test("converts an inclusive range to an exclusive slice", () => {
    const range = parseByteRange("bytes=0-99", 1000);
    expect(range).toEqual({ start: 0, end: 99 });
    expect(sliceForRange(range as { start: number; end: number })).toEqual({
      start: 0,
      endExclusive: 100,
    });
  });

  test("a single byte is a slice of length one", () => {
    expect(sliceForRange({ start: 5, end: 5 })).toEqual({
      start: 5,
      endExclusive: 6,
    });
  });

  test("an open-ended range runs to the last byte inclusive", () => {
    const range = parseByteRange("bytes=900-", 1000);
    expect(range).toEqual({ start: 900, end: 999 });
    expect(sliceForRange(range as { start: number; end: number })).toEqual({
      start: 900,
      endExclusive: 1000,
    });
  });
});

describe("bookContentRoutes with global cors", () => {
  test("Range bytes=0-99 returns only 100 bytes end to end", async () => {
    const grant = grantFor(1);
    const response = await app.handle(
      new Request(`http://localhost/files/1/content?grant=${grant}`, {
        headers: { Range: "bytes=0-99" },
      }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Length")).toBe("100");
    expect(response.headers.get("Content-Range")).toBe(
      `bytes 0-99/${fixtureSize}`,
    );
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(100);
  });

  test("no Range returns full file bytes", async () => {
    const grant = grantFor(1);
    const response = await app.handle(
      new Request(`http://localhost/files/1/content?grant=${grant}`),
    );

    expect(response.status).toBe(200);
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(fixtureSize);
  });

  test("unsatisfiable range returns 416", async () => {
    const grant = grantFor(1);
    const response = await app.handle(
      new Request(`http://localhost/files/1/content?grant=${grant}`, {
        headers: { Range: `bytes=${fixtureSize}-` },
      }),
    );

    expect(response.status).toBe(416);
  });
});
