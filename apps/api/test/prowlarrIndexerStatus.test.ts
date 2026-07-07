import { describe, expect, it, afterEach, mock } from "bun:test";
import { ProwlarrAdapter } from "../src/services/indexerManager/prowlarrAdapter";

const FAKE_CONFIG = {
  website_url: "http://prowlarr.local",
  api_key: "test-key",
};

// Delay the search response slightly so the status/indexer calls (which resolve
// synchronously in tests) finish before the search, matching real-world timing
// where searches take seconds and status checks take milliseconds.
async function delayedResponse(body: unknown): Promise<Response> {
  await new Promise<void>((r) => setTimeout(r, 10));
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(handlers: Record<string, unknown>) {
  return mock(async (input: RequestInfo | URL) => {
    const url = input.toString();
    // Search responses are delayed to let status/indexer calls resolve first.
    if (url.includes("/api/v1/search")) {
      return delayedResponse(handlers["/api/v1/search"] ?? []);
    }
    for (const [key, body] of Object.entries(handlers)) {
      if (url.includes(key)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("[]", { status: 200 });
  }) as unknown as typeof global.fetch;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("ProwlarrAdapter.search — indexer warnings", () => {
  it("returns empty indexerWarnings when no indexers are blocked", async () => {
    global.fetch = makeFetch({
      indexerstatus: [],
      "/api/v1/search": [],
    });

    const adapter = new ProwlarrAdapter(FAKE_CONFIG as never);
    const result = await adapter.search({ query: "test", type: "search" });

    expect(result.indexerWarnings).toEqual([]);
  });

  it("returns empty indexerWarnings when indexerstatus endpoint fails", async () => {
    global.fetch = mock(async (input: RequestInfo | URL) => {
      if (input.toString().includes("indexerstatus")) {
        return new Response("", { status: 503 });
      }
      return new Response("[]", { status: 200 });
    }) as unknown as typeof global.fetch;

    const adapter = new ProwlarrAdapter(FAKE_CONFIG as never);
    const result = await adapter.search({ query: "test", type: "search" });

    expect(result.indexerWarnings).toEqual([]);
  });

  it("populates indexerWarnings for blocked indexers with names from indexer list", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();

    global.fetch = makeFetch({
      indexerstatus: [
        { indexerId: 3, disabledTill: future, escalationLevel: 2 },
      ],
      "/api/v1/indexer": [{ id: 3, name: "NZBgeek" }],
      "/api/v1/search": [],
    });

    const adapter = new ProwlarrAdapter(FAKE_CONFIG as never);
    const result = await adapter.search({ query: "test", type: "search" });

    expect(result.indexerWarnings).toEqual([
      { id: "3", name: "NZBgeek", error: "temporarily blocked by Prowlarr" },
    ]);
  });

  it("falls back to indexer ID as name when indexer list fetch fails", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();

    global.fetch = mock(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("indexerstatus")) {
        return new Response(
          JSON.stringify([
            { indexerId: 7, disabledTill: future, escalationLevel: 1 },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/indexer") && !url.includes("indexerstatus")) {
        return new Response("", { status: 503 });
      }
      // Delay search so status resolves first
      return delayedResponse([]);
    }) as unknown as typeof global.fetch;

    const adapter = new ProwlarrAdapter(FAKE_CONFIG as never);
    const result = await adapter.search({ query: "test", type: "search" });

    expect(result.indexerWarnings).toEqual([
      { id: "7", name: "7", error: "temporarily blocked by Prowlarr" },
    ]);
  });

  it("ignores indexers whose disabledTill is in the past", async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();

    global.fetch = makeFetch({
      indexerstatus: [{ indexerId: 2, disabledTill: past, escalationLevel: 1 }],
      "/api/v1/indexer": [{ id: 2, name: "OldIndexer" }],
      "/api/v1/search": [],
    });

    const adapter = new ProwlarrAdapter(FAKE_CONFIG as never);
    const result = await adapter.search({ query: "test", type: "search" });

    expect(result.indexerWarnings).toEqual([]);
  });

  it("ignores indexers with null disabledTill", async () => {
    global.fetch = makeFetch({
      indexerstatus: [{ indexerId: 5, disabledTill: null, escalationLevel: 0 }],
      "/api/v1/indexer": [{ id: 5, name: "SomeIndexer" }],
      "/api/v1/search": [],
    });

    const adapter = new ProwlarrAdapter(FAKE_CONFIG as never);
    const result = await adapter.search({ query: "test", type: "search" });

    expect(result.indexerWarnings).toEqual([]);
  });
});
