import { describe, expect, it } from "bun:test";
import { tmdbNotConfigured } from "@rawkoon/api/errors";

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
