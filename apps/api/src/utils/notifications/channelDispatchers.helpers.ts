import { beforeEach, mock } from "bun:test";
// Copy the real exports first: mock.module persists across files in this process.
const realSsrf = { ...(await import("../ssrf")) };
mock.module("../ssrf", () => ({
  ...realSsrf,
  validateSafeUrl: async (url: string) => url,
  // Passthrough so request-construction assertions still see the original URL
  // and headers; the real safeFetch's IP-pinning is covered by ssrf tests.
  safeFetch: (url: string, init?: RequestInit) =>
    fetch(url, init as RequestInit),
}));

export const payload = {
  title: "Test Title",
  body: "Test body",
  url: "https://example.com",
};

export const mockFetch = mock(() =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
);

// @ts-expect-error test assigns global fetch mock
global.fetch = mockFetch;

/** Registers the per-test fetch reset; call once at the top of each test file. */
export function useMockFetchReset() {
  beforeEach(() => mockFetch.mockClear());
}
