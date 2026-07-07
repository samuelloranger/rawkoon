import { describe, expect, it } from "bun:test";
import { app } from "../src/index";

describe("Elysia Server", () => {
  it("returns ok on /health", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    const json = await response.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("returns ok on /api/health", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/health"),
    );
    const json = await response.json();
    expect(json).toEqual({ status: "ok" });
  });
});
