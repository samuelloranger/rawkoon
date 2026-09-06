import { describe, it, expect, vi, beforeEach } from "vitest";

// An app update clears caches so the new build takes effect. With the in-app
// player removed there is nothing left to spare — including the dead
// "rawkoon-books" store.

vi.mock("./sw", () => ({
  sw: {
    clients: { matchAll: async () => [] },
    location: { origin: "https://x" },
  },
}));

const { handleAppUpdate } = await import("./app-update");

describe("handleAppUpdate", () => {
  const deleted: string[] = [];

  beforeEach(() => {
    deleted.length = 0;
    vi.stubGlobal("caches", {
      keys: async () => ["rawkoon-1.8.0", "rawkoon-1.9.0", "rawkoon-books"],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
  });

  it("clears every cache, the dead book store included", async () => {
    await handleAppUpdate();

    expect(deleted).toContain("rawkoon-1.8.0");
    expect(deleted).toContain("rawkoon-1.9.0");
    expect(deleted).toContain("rawkoon-books");
  });
});
