import { describe, expect, it, mock } from "bun:test";
import {
  loadIndexerPrivacy,
  type PrivacyDeps,
} from "@rawkoon/api/services/seeding/indexerPrivacy";

function deps(o: Partial<PrivacyDeps> = {}): PrivacyDeps {
  return {
    getCache: async () => null,
    setCache: mock(async () => {}),
    listIndexers: async () => [
      { name: "Nimbus", privacy: "private" },
      { name: "Harbor", privacy: "public" },
      { name: "Semi", privacy: "semiPrivate" },
    ],
    ...o,
  };
}

describe("loadIndexerPrivacy", () => {
  it("maps names case-insensitively and treats anything not public as private", async () => {
    const d = deps();
    const map = await loadIndexerPrivacy(d);
    expect(map.get("nimbus")).toBe(true);
    expect(map.get("harbor")).toBe(false);
    expect(map.get("semi")).toBe(true);
    expect(d.setCache).toHaveBeenCalledTimes(1);
  });
  it("serves the cache without listing indexers", async () => {
    const listIndexers = mock(async () => []);
    const map = await loadIndexerPrivacy(
      deps({ getCache: async () => [["x", false]], listIndexers }),
    );
    expect(map.get("x")).toBe(false);
    expect(listIndexers).not.toHaveBeenCalled();
  });
  it("returns an empty map when the indexer manager is unreachable", async () => {
    const map = await loadIndexerPrivacy(
      deps({
        listIndexers: async () => {
          throw new Error("down");
        },
      }),
    );
    expect(map.size).toBe(0);
  });
});
