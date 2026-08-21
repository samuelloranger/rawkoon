import { describe, it, expect, vi, beforeEach } from "vitest";

// An app update clears caches so the new build takes effect — but downloaded
// books are the user's, and clearing them was the same mistake the activation
// handler had.

vi.mock("./sw", () => ({
  sw: {
    clients: { matchAll: async () => [] },
    location: { origin: "https://x" },
  },
}));
vi.mock("./constants", () => ({ CACHE_VERSION: "rawkoon-1.9.0" }));

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

  it("keeps downloaded books while clearing the rest", async () => {
    await handleAppUpdate();

    expect(deleted).toContain("rawkoon-1.8.0");
    expect(deleted).toContain("rawkoon-1.9.0");
    expect(deleted).not.toContain("rawkoon-books");
  });
});
