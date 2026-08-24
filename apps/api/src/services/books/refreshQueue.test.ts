import { afterEach, describe, expect, test } from "bun:test";
import { serializePerBook } from "@rawkoon/api/services/books/refreshQueue";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("serializePerBook", () => {
  test("runs work for the same book one at a time, in order", async () => {
    const events: string[] = [];
    const job = (name: string, ms: number) => async () => {
      events.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      events.push(`${name}:end`);
      return name;
    };

    // The slow one is queued first; without serialization B would start
    // immediately and finish before A.
    const a = serializePerBook(1, job("A", 30));
    const b = serializePerBook(1, job("B", 1));
    expect(await Promise.all([a, b])).toEqual(["A", "B"]);
    expect(events).toEqual(["A:start", "A:end", "B:start", "B:end"]);
  });

  test("does not serialize across different books", async () => {
    const running: string[] = [];
    const job = (name: string) => async () => {
      running.push(name);
      await new Promise((r) => setTimeout(r, 20));
      return running.length;
    };
    await Promise.all([
      serializePerBook(1, job("one")),
      serializePerBook(2, job("two")),
    ]);
    // Both had started before either finished.
    expect(running).toEqual(["one", "two"]);
  });

  /**
   * The queued chain must absorb rejections.
   *
   * Deriving cleanup from the work promise creates a second promise that
   * rejects whenever the work does, with nothing to catch it — an unhandled
   * rejection, which Bun can turn into a dead process rather than the 500 the
   * caller intended.
   */
  test("a rejection reaches the caller without becoming unhandled", async () => {
    const unhandled: unknown[] = [];
    // Typed structurally: PromiseRejectionEvent is not in this package's lib.
    const onUnhandled = (e: Event & { reason?: unknown }) => {
      unhandled.push(e.reason);
      e.preventDefault();
    };
    globalThis.addEventListener?.(
      "unhandledrejection",
      onUnhandled as EventListener,
    );

    const failing = serializePerBook(3, async () => {
      throw new Error("boom");
    });
    expect(failing).rejects.toThrow("boom");
    await failing.catch(() => undefined);
    // Give the microtask queue a chance to surface an unhandled rejection.
    await tick();
    await tick();

    globalThis.removeEventListener?.(
      "unhandledrejection",
      onUnhandled as EventListener,
    );
    expect(unhandled).toEqual([]);
  });

  test("a failed job does not block the next one for that book", async () => {
    const failed = serializePerBook(4, async () => {
      throw new Error("first fails");
    });
    await failed.catch(() => undefined);
    expect(await serializePerBook(4, async () => "second runs")).toBe(
      "second runs",
    );
  });
});

afterEach(async () => {
  // Let queued cleanup settle so one test cannot leak state into the next.
  await tick();
});
