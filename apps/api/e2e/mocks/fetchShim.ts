// Intercept global fetch so NO external network call escapes the harness — every
// one of the 14 external boundaries (TMDB, indexers, download clients, book
// providers, Jellyfin, local-ai, APNs relay) goes through global fetch. Requests
// to localhost/127.0.0.1 pass through untouched (the real e2e server).
//
// Canned responses are keyed by hostname substring; unknown external hosts get a
// benign empty 200 so a handler stays on its happy path. Fixtures can override a
// host's response through `mockState.fetchResponses`.

export interface CannedResponse {
  status?: number;
  json?: unknown;
  text?: string;
}

export const mockState: {
  fetchResponses: Record<string, CannedResponse>;
  fetchCalls: { url: string; method: string }[];
} = {
  fetchResponses: {},
  fetchCalls: [],
};

// Default canned bodies for hosts whose response shape a handler parses.
const DEFAULT_RESPONSES: Record<string, CannedResponse> = {
  "api.themoviedb.org": {
    json: { results: [], total_results: 0, total_pages: 0 },
  },
  "googleapis.com": { json: { items: [], totalItems: 0 } },
  "openlibrary.org": { json: { docs: [], numFound: 0 } },
  "api.audible": { json: { products: [], total_results: 0 } },
  "api.audnex.us": { json: {} },
  "api.github.com": { json: [] },
};

function bodyFor(urlStr: string): CannedResponse {
  let host = "";
  try {
    host = new URL(urlStr).hostname;
  } catch {
    host = urlStr;
  }
  for (const [needle, resp] of Object.entries(mockState.fetchResponses)) {
    if (host.includes(needle) || urlStr.includes(needle)) return resp;
  }
  for (const [needle, resp] of Object.entries(DEFAULT_RESPONSES)) {
    if (host.includes(needle)) return resp;
  }
  return { json: {} };
}

function isLocal(urlStr: string): boolean {
  try {
    const h = new URL(urlStr).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

export function installFetchShim(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (
      init?.method ??
      (input as Request)?.method ??
      "GET"
    ).toUpperCase();
    if (isLocal(url)) return realFetch(input as never, init);
    mockState.fetchCalls.push({ url, method });
    const canned = bodyFor(url);
    const status = canned.status ?? 200;
    const body =
      canned.text !== undefined
        ? canned.text
        : JSON.stringify(canned.json ?? {});
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}
