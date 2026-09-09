import { beforeAll, describe, expect, it } from "bun:test";
import { installExternalMocks, mockState } from "./externals";

describe("installExternalMocks", () => {
  beforeAll(() => installExternalMocks());

  it("intercepts external fetch with a canned body (no real network)", async () => {
    const res = await fetch("https://api.themoviedb.org/3/movie/27205");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("records intercepted calls", async () => {
    mockState.fetchCalls.length = 0;
    await fetch("https://api.audible.com/1.0/catalog/products");
    expect(mockState.fetchCalls.some((c) => c.url.includes("audible"))).toBe(
      true,
    );
  });

  it("lets fixtures override a host response", async () => {
    mockState.fetchResponses["example-indexer"] = {
      json: { indexers: [{ id: 1 }] },
    };
    const res = await fetch("http://example-indexer.local/api");
    const body = (await res.json()) as { indexers: unknown[] };
    expect(body.indexers).toHaveLength(1);
    delete mockState.fetchResponses["example-indexer"];
  });

  it("passes localhost through untouched (not recorded)", async () => {
    mockState.fetchCalls.length = 0;
    // no server here; just assert the shim does not record a localhost call
    await fetch("http://localhost:59999/nope").catch(() => {});
    expect(mockState.fetchCalls.some((c) => c.url.includes("localhost"))).toBe(
      false,
    );
  });
});
