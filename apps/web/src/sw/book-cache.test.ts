import { describe, it, expect, vi } from "vitest";

// The matchers decide what the service worker takes responsibility for, and the
// offline story broke last time precisely because the metadata requests were
// not among them.

vi.mock("./sw", () => ({
  sw: { location: { origin: "https://rawkoon.test" } },
}));

const {
  isBookContentRequest,
  isBookMetaRequest,
  isBuildAsset,
  BOOK_CACHE,
  handleBookFetch,
} = await import("./book-cache");

describe("isBookContentRequest", () => {
  it("matches a book file's content url", () => {
    expect(isBookContentRequest("/api/books/files/12/content")).toBe(true);
    expect(
      isBookContentRequest("https://rawkoon.test/api/books/files/12/content"),
    ).toBe(true);
  });

  it("ignores everything else under /api/books", () => {
    expect(isBookContentRequest("/api/books/12")).toBe(false);
    expect(isBookContentRequest("/api/books/files/12")).toBe(false);
    expect(isBookContentRequest("/api/books/editions/3/manifest")).toBe(false);
  });
});

describe("isBookMetaRequest", () => {
  it("matches the two requests needed to reopen a stored book", () => {
    expect(isBookMetaRequest("/api/books/12")).toBe(true);
    expect(isBookMetaRequest("/api/books/editions/3/manifest")).toBe(true);
  });

  it("does not claim the content route or unrelated book routes", () => {
    expect(isBookMetaRequest("/api/books/files/12/content")).toBe(false);
    expect(isBookMetaRequest("/api/books/search")).toBe(false);
    expect(isBookMetaRequest("/api/books/progress?editionIds=1")).toBe(false);
    expect(isBookMetaRequest("/api/books/12/editions/ebook/files")).toBe(false);
  });
});

describe("isBuildAsset", () => {
  it("matches same-origin hashed assets only", () => {
    expect(isBuildAsset("/assets/index-abc123.js")).toBe(true);
    expect(isBuildAsset("https://rawkoon.test/assets/app-1.css")).toBe(true);
    expect(isBuildAsset("https://cdn.example.com/assets/app-1.css")).toBe(
      false,
    );
    expect(isBuildAsset("/api/books/12")).toBe(false);
  });
});

describe("BOOK_CACHE", () => {
  it("is exported so activation can keep it", () => {
    // Regression guard: the activation handler deletes every cache whose name
    // is not recognised, which silently wiped explicitly downloaded books.
    expect(BOOK_CACHE).toBe("rawkoon-books");
  });
});

/**
 * Range handling for cached audio.
 *
 * WebKit will not play media that a service worker answers with a whole 200:
 * it probes with `Range: bytes=0-1` and seeks by range, and a downloaded
 * audiobook that gets a 200 back simply refuses to start.
 */
describe("handleBookFetch range handling", () => {
  const BYTES = new Uint8Array(1000).map((_, i) => i % 256);

  /** Serves one cached entry, and records what the worker responded with. */
  const serve = async (
    rangeHeader: string | null,
  ): Promise<{ response: Response; fetched: boolean }> => {
    let fetched = false;
    const cached = new Response(BYTES, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(BYTES.byteLength),
      },
    });

    vi.stubGlobal("caches", {
      open: async () => ({ match: async () => cached }),
    });
    vi.stubGlobal("fetch", async () => {
      fetched = true;
      return new Response(null, { status: 504 });
    });

    const request = new Request(
      "https://rawkoon.test/api/books/files/7/content",
      { headers: rangeHeader ? { Range: rangeHeader } : {} },
    );

    let responded: Promise<Response> | null = null;
    handleBookFetch({
      request,
      respondWith: (value: Promise<Response>) => {
        responded = value;
      },
    } as unknown as FetchEvent);

    if (!responded) throw new Error("handler did not respond");
    const response = await responded;
    vi.unstubAllGlobals();
    return { response, fetched };
  };

  it("answers a probe range with a 206 and a Content-Range", async () => {
    const { response } = await serve("bytes=0-1");

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-1/1000");
    expect(response.headers.get("Content-Length")).toBe("2");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      BYTES.slice(0, 2),
    );
  });

  it("serves a mid-file seek range", async () => {
    const { response } = await serve("bytes=500-599");

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 500-599/1000");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      BYTES.slice(500, 600),
    );
  });

  it("runs an open-ended range to the last byte", async () => {
    const { response } = await serve("bytes=900-");

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 900-999/1000");
  });

  it("advertises range support on a plain request", async () => {
    const { response } = await serve(null);

    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("reports an unsatisfiable range as 416 with the real size", async () => {
    const { response } = await serve("bytes=5000-6000");

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */1000");
  });

  it("falls through to the network when nothing is cached", async () => {
    let fetched = false;
    vi.stubGlobal("caches", {
      open: async () => ({ match: async () => undefined }),
    });
    vi.stubGlobal("fetch", async () => {
      fetched = true;
      return new Response("from network", { status: 200 });
    });

    let responded: Promise<Response> | null = null;
    handleBookFetch({
      request: new Request("https://rawkoon.test/api/books/files/7/content"),
      respondWith: (value: Promise<Response>) => {
        responded = value;
      },
    } as unknown as FetchEvent);

    if (!responded) throw new Error("handler did not respond");
    await responded;
    expect(fetched).toBe(true);
    vi.unstubAllGlobals();
  });
});
