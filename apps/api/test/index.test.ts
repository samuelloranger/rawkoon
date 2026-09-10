import { describe, expect, it } from "bun:test";
import { app } from "../src/index";

describe("API Server", () => {
  it("does not expose the constant /health path", async () => {
    const response = await app.fetch(new Request("http://localhost/health"));
    expect(response.status).toBe(404);
  });

  it("returns db and valkey status on /api/health", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/health"),
    );
    const json = (await response.json()) as {
      status: string;
      db: boolean;
      valkey: boolean;
    };
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("db");
    expect(json).toHaveProperty("valkey");
    expect(["ok", "degraded"]).toContain(json.status);
    if (json.status === "ok") expect(response.status).toBe(200);
    else expect(response.status).toBe(503);
  });

  /**
   * An unmatched /api path must never fall through to the SPA shell. It did,
   * with a 200 and a body of HTML, which is how a reader bug stayed invisible:
   * epub.js probed `/api/books/files/1/META-INF/container.xml`, got index.html
   * with a success status, and failed to parse it instead of reporting an error.
   */
  it("answers an unknown /api path with a 404, not the SPA shell", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/books/files/1/META-INF/container.xml"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toContain("text/html");
  });
});
