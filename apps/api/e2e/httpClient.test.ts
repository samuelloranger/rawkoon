import { describe, expect, it } from "bun:test";
import { request } from "./httpClient";
import { createContext } from "./context";
import { checkPositive } from "./assert";

// Requires a running e2e server; skipped when BASE_URL is unset.
describe.if(!!process.env.BASE_URL)("http sweep primitives", () => {
  it("GET /api/health returns 200 over HTTP", async () => {
    const res = await request("GET", "/api/health");
    expect(res.status).toBe(200);
  });
  it("checkPositive passes for GET /api/health", async () => {
    const ctx = createContext();
    const res = await checkPositive(
      { method: "GET", path: "/api/health" },
      {},
      ctx,
    );
    expect(res.ok).toBe(true);
  });
});
