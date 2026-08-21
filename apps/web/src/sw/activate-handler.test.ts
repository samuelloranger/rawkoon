import { describe, it, expect, vi, beforeEach } from "vitest";

// Downloaded books are the user's explicit choice, so an app release must not
// take them away. This is the regression guard for that.

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

  it("keeps the current version and the book cache, drops the rest", async () => {
    let waited: Promise<unknown> = Promise.resolve();
    handleActivate({
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    } as unknown as ExtendableEvent);
    await waited;

    expect(deleted).toContain("rawkoon-v3");
    expect(deleted).toContain("some-other-cache");
    expect(deleted).not.toContain("rawkoon-books");
    expect(deleted).not.toContain("rawkoon-v4");
  });
});
