import { describe, it, expect, vi, beforeEach } from "vitest";

const claim = vi.fn();
vi.mock("./sw", () => ({
  sw: { clients: { claim: () => claim() }, location: { origin: "https://x" } },
}));

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

  it("deletes every leftover cache on activate", async () => {
    let waited: Promise<unknown> = Promise.resolve();
    handleActivate({
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    } as unknown as ExtendableEvent);
    await waited;

    expect(deleted).toEqual([
      "rawkoon-v3",
      "rawkoon-v4",
      "rawkoon-books",
      "some-other-cache",
    ]);
    expect(claim).toHaveBeenCalled();
  });
});
