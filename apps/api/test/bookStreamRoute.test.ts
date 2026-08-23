import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The layout arithmetic is covered in bookStreamLayout.test.ts. This drives the
// route itself: the headers a media element depends on, and the actual bytes it
// receives. Synthetic files rather than a real library, so it runs anywhere —
// each one is an ID3v2 tag of a known size followed by a known payload, which
// is what makes a wrong offset show up as wrong content rather than a wrong
// length.

const PAYLOAD = 1000;

/** An ID3v2 header declaring `size` bytes of tag body. */
const id3 = (size: number): Uint8Array => {
  const tag = new Uint8Array(10 + size);
  tag[0] = 0x49;
  tag[1] = 0x44;
  tag[2] = 0x33;
  tag[3] = 3;
  tag[6] = (size >> 21) & 0x7f;
  tag[7] = (size >> 14) & 0x7f;
  tag[8] = (size >> 7) & 0x7f;
  tag[9] = size & 0x7f;
  // Fill the tag body with a byte that must never appear in the response.
  tag.fill(0xee, 10);
  return tag;
};

/** Payload for file n: every byte is n, so provenance is visible per byte. */
const payload = (n: number): Uint8Array => new Uint8Array(PAYLOAD).fill(n);

let dir = "";
const files: Array<{
  id: number;
  filePath: string;
  fileName: string;
  format: string;
  audioBitrate: number | null;
}> = [];

const state: { files: typeof files } = { files: [] };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    oidcProvider: { findMany: () => Promise.resolve([]) },
    bookFile: { findMany: () => Promise.resolve(state.files) },
  },
}));

// No Redis in a unit test, and caching a layout across cases would hide bugs.
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: () => Promise.resolve(null),
  setJsonCache: () => Promise.resolve(undefined),
}));

const { bookReadRoutes } = await import(
  "@rawkoon/api/routes/books/bookReadRoutes"
);

type Handler = (ctx: {
  params: { editionId: number };
  request: Request;
  set: { status?: number };
}) => Promise<Response | { error: string }>;

const streamHandler = (): Handler => {
  const routes = (
    bookReadRoutes as unknown as {
      routes: Array<{ method: string; path: string; handler: Handler }>;
    }
  ).routes;
  const route = routes.find(
    (r) => r.method === "GET" && r.path.endsWith("/stream"),
  );
  if (!route) throw new Error("GET .../stream not registered");
  return route.handler;
};

const get = (headers: Record<string, string> = {}) =>
  streamHandler()({
    params: { editionId: 11 },
    request: new Request("http://x/api/books/editions/11/stream", { headers }),
    set: {},
  });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rawkoon-stream-"));
  // Different tag sizes per file: a route that skipped a constant would pass
  // with uniform tags and fail here.
  const tagSizes = [299, 0, 40];
  for (let i = 0; i < 3; i++) {
    const name = `0${i + 1}-Chapitre ${i + 1}.mp3`;
    const path = join(dir, name);
    const tag = tagSizes[i] > 0 ? id3(tagSizes[i]) : new Uint8Array(0);
    const body = new Uint8Array(tag.length + PAYLOAD);
    body.set(tag, 0);
    body.set(payload(i + 1), tag.length);
    await writeFile(path, body);
    files.push({
      id: i + 1,
      filePath: path,
      fileName: name,
      format: "mp3",
      audioBitrate: 192000,
    });
  }
  state.files = files;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytesOf = async (res: Response): Promise<Uint8Array> =>
  new Uint8Array(await res.arrayBuffer());

describe("GET /api/books/editions/:id/stream", () => {
  it("advertises the concatenated length and range support", async () => {
    const res = (await get()) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    // Three payloads, no tag bytes.
    expect(res.headers.get("content-length")).toBe(String(3 * PAYLOAD));
  });

  it("serves the payloads back to back with no tag bytes between them", async () => {
    const body = await bytesOf((await get()) as Response);

    expect(body.length).toBe(3 * PAYLOAD);
    // A tag byte anywhere in the body means an offset is wrong.
    expect(body.includes(0xee)).toBe(false);
    expect(body[0]).toBe(1);
    expect(body[PAYLOAD - 1]).toBe(1);
    expect(body[PAYLOAD]).toBe(2);
    expect(body[2 * PAYLOAD]).toBe(3);
    expect(body[3 * PAYLOAD - 1]).toBe(3);
  });

  it("answers a range that straddles a join", async () => {
    const res = (await get({ Range: "bytes=990-1009" })) as Response;

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 990-1009/${3 * PAYLOAD}`,
    );
    expect(res.headers.get("content-length")).toBe("20");

    const body = await bytesOf(res);
    // Ten bytes of file one, then ten of file two — the join, byte-exact.
    expect([...body]).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    ]);
  });

  it("answers an open-ended range to the end of the resource", async () => {
    const res = (await get({ Range: "bytes=2990-" })) as Response;

    expect(res.status).toBe(206);
    const body = await bytesOf(res);
    expect(body.length).toBe(10);
    expect([...new Set(body)]).toEqual([3]);
  });

  it("refuses a range past the end rather than serving short", async () => {
    const res = (await get({ Range: "bytes=99999-" })) as Response;

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${3 * PAYLOAD}`);
  });

  it("answers 304 for a matching validator", async () => {
    const first = (await get()) as Response;
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const res = (await get({ "If-None-Match": etag as string })) as Response;
    expect(res.status).toBe(304);
  });

  // A resumed transfer against changed files would stitch new bytes onto the
  // client's old buffer, handing the decoder a corrupt stream.
  it("ignores a range whose If-Range no longer matches", async () => {
    const res = (await get({
      Range: "bytes=0-9",
      "If-Range": '"concat-stale"',
    })) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(3 * PAYLOAD));
  });

  it("declines an edition whose files cannot be concatenated", async () => {
    state.files = files.map((f) => ({ ...f, format: "m4b" }));
    try {
      const result = await get();
      expect((result as { error: string }).error).toContain("single stream");
    } finally {
      state.files = files;
    }
  });
});
