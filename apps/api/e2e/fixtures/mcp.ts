import type { FixtureRegistry } from "./types";

export const mcpFixtures: FixtureRegistry = {
  // The transport is JSON-RPC over POST guarded by an API key (x-api-key or
  // Authorization: Bearer); the e2e harness exercises cookie auth and cannot
  // attach custom headers. Protocol, auth and tools are covered by the
  // colocated unit suite (src/routes/mcp/index.test.ts).
  "POST /api/mcp": {
    phase: "read",
    skipReason:
      "Route is guarded by an MCP API key in the x-api-key/Authorization header; the e2e harness cannot attach custom headers.",
  },

  // No SSE stream on GET: the transport is POST-only.
  "GET /api/mcp": {
    phase: "read",
    expectedStatus: 405,
    public: true,
    negativeBody: null,
  },
};
