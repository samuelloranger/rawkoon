import { describe, expect, it } from "bun:test";
import { loadManifest } from "./loadManifest";

describe("loadManifest", () => {
  const routes = loadManifest();

  it("loads >200 routes from the committed manifest", () => {
    expect(routes.length).toBeGreaterThan(200);
  });
  it("includes a known library GET", () => {
    expect(
      routes.some(
        (r) => r.path.startsWith("/api/library") && r.method === "GET",
      ),
    ).toBe(true);
  });
  it("appends better-auth sign-in", () => {
    expect(routes.some((r) => r.path === "/api/auth/sign-in/email")).toBe(true);
  });
  it("never contains the SPA catch-all", () => {
    expect(routes.some((r) => r.path === "/*")).toBe(false);
  });
  it("has no duplicate method+path pairs", () => {
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
