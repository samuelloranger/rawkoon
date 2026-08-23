import { describe, it, expect, vi, beforeEach } from "vitest";

// The in-app player is gone, so nothing is stored on the user's behalf any
// more. "rawkoon-books" is stale by definition and must be dropped like any
// other old cache — the inverse of the guard this file used to hold.

const claim = vi.fn();
vi.mock("./sw", () => ({
  sw: { clients: { claim: () => claim() }, location: { origin: "https://x" } },
}));
vi.mock("./constants", () => ({ CACHE_VERSION: "rawkoon-v4" }));

const { handleActivate } = await import("./activate-handler");

describe("handleActivate", () => {
  const deleted: string[] = [];

  beforeEach(() => {
    deleted.length = 0;
    vi.stubGlobal("caches", {
      keys: async () => [
        "rawkoon-v3",
        "rawkoon-v4",
        "rawkoon-books",
        "some-other-cache",
      ],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
  });

  it("keeps only the current version, dropping the stale book cache", async () => {
    let waited: Promise<unknown> = Promise.resolve();
    handleActivate({
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    } as unknown as ExtendableEvent);
    await waited;

    expect(deleted).toContain("rawkoon-v3");
    expect(deleted).toContain("some-other-cache");
    expect(deleted).toContain("rawkoon-books");
    expect(deleted).not.toContain("rawkoon-v4");
  });
});
