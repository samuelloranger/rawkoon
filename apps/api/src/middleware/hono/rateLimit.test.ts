import { describe, expect, it, spyOn } from "bun:test";
import { Hono } from "hono";
import { jellyfinUsernameRateLimit } from "./rateLimit";

const app = new Hono()
  .use("*", jellyfinUsernameRateLimit)
  .all("*", (c) => c.text("reached"));

const post = (path: string, username: string, ip = "10.0.0.1") =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ username, password: "pw" }),
    }),
  );

describe("jellyfinUsernameRateLimit", () => {
  it("answers 429 after ten attempts for one username, across IPs and case", async () => {
    for (let i = 0; i < 10; i++) {
      expect(
        (await post("/api/auth/sign-in/jellyfin", " Alice ", `10.0.1.${i}`))
          .status,
      ).toBe(200);
    }
    expect(
      (await post("/api/profile/jellyfin", "alice", "10.0.2.1")).status,
    ).toBe(429);
    expect((await post("/api/auth/sign-in/jellyfin", "bob")).status).toBe(200);
  });

  it("does not run the handler, so Jellyfin is never contacted, once limited", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    for (let i = 0; i < 10; i++)
      await post("/api/auth/sign-in/jellyfin", "carol");
    const res = await post("/api/auth/sign-in/jellyfin", "carol");
    expect(res.status).toBe(429);
    expect(await res.text()).not.toBe("reached");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("ignores other paths and methods", async () => {
    for (let i = 0; i < 12; i++) {
      expect((await post("/api/other", "dave")).status).toBe(200);
    }
    const get = await app.fetch(
      new Request("http://localhost/api/profile/jellyfin"),
    );
    expect(get.status).toBe(200);
  });
});
