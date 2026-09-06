import { describe, expect, it } from "bun:test";
import { fetchWithTimeout } from "@rawkoon/api/utils/fetchWithTimeout";

describe("fetchWithTimeout", () => {
  it("aborts when the server is slower than the deadline", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(200);
        return new Response("late");
      },
    });
    try {
      await expect(
        fetchWithTimeout(server.url, undefined, 20),
      ).rejects.toThrow();
    } finally {
      server.stop(true);
    }
  });
});
