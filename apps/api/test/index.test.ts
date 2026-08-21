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

  /**
   * An unmatched /api path must never fall through to the SPA shell. It did,
   * with a 200 and a body of HTML, which is how a reader bug stayed invisible:
   * epub.js probed `/api/books/files/1/META-INF/container.xml`, got index.html
   * with a success status, and failed to parse it instead of reporting an error.
   */
  it("answers an unknown /api path with a 404, not the SPA shell", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/books/files/1/META-INF/container.xml"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toContain("text/html");
  });
});
