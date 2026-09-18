import { describe, expect, it } from "bun:test";
import {
  getDiscoverySource,
  listDiscoverySources,
} from "@rawkoon/api/services/books/discoverySources";

describe("discovery source registry", () => {
  it("registers leslibraires and nyt", () => {
    expect(
      listDiscoverySources()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["leslibraires", "nyt"]);
  });

  it("returns null for an unknown source", () => {
    expect(getDiscoverySource("bogus")).toBeNull();
  });

  it("leslibraires exposes general + jeunesse and is always configured", async () => {
    const src = getDiscoverySource("leslibraires");
    expect(src).not.toBeNull();
    expect(await src!.isConfigured()).toBe(true);
    expect((await src!.lists()).map((l) => l.id)).toEqual([
      "general",
      "jeunesse",
    ]);
  });
});
