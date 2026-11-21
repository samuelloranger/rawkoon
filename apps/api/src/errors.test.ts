import { describe, expect, it } from "bun:test";
import { normalizeAuthRateLimit, tmdbNotConfigured } from "@rawkoon/api/errors";

describe("tmdbNotConfigured", () => {
  it("is a 400 carrying the stable code", async () => {
    const res = tmdbNotConfigured();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "TMDB is not configured",
      code: "tmdb_not_configured",
    });
  });
});

describe("normalizeAuthRateLimit", () => {
  it("gives better-auth's 429 the { error } shape and a standard Retry-After", async () => {
    const res = await normalizeAuthRateLimit(
      new Response(JSON.stringify({ message: "Too many requests." }), {
        status: 429,
        headers: { "X-Retry-After": "7" },
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(await res.json()).toEqual({
      error: "Too many requests.",
      message: "Too many requests.",
    });
  });

  it("passes other responses through untouched", async () => {
    const original = new Response("ok", { status: 200 });
    expect(await normalizeAuthRateLimit(original)).toBe(original);
  });
});
