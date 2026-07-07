import { describe, expect, it } from "bun:test";
import { withKeyedLock } from "./keyedLock";

describe("withKeyedLock", () => {
  it("serializes calls sharing a key (no interleaving)", async () => {
    const events: string[] = [];
    const task = (id: string) =>
      withKeyedLock("k", async () => {
        events.push(`start:${id}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`end:${id}`);
      });

    await Promise.all([task("a"), task("b")]);

    // Serialized => each start is immediately followed by its own end.
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("runs different keys concurrently", async () => {
    const events: string[] = [];
    const task = (key: string, id: string) =>
      withKeyedLock(key, async () => {
        events.push(`start:${id}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`end:${id}`);
      });

    await Promise.all([task("x", "a"), task("y", "b")]);

    // Both start before either ends.
    expect(events.slice(0, 2).sort()).toEqual(["start:a", "start:b"]);
  });

  it("releases the lock even if the task throws", async () => {
    await expect(
      withKeyedLock("boom", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    // A later call on the same key still runs.
    const ok = await withKeyedLock("boom", async () => "ok");
    expect(ok).toBe("ok");
  });
});
