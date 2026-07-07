import { describe, expect, it } from "bun:test";
import { mapTrackerUrlToTag } from "@rawkoon/api/services/webhookEnrichment";

describe("mapTrackerUrlToTag", () => {
  it("derives the tag from the registrable domain label", () => {
    const match = mapTrackerUrlToTag("https://example.org/announce/abcdef");
    expect(match?.tag).toBe("example");
    expect(match?.label).toBe("Example");
  });

  it("ignores subdomains when deriving the tag", () => {
    expect(
      mapTrackerUrlToTag("https://api.mytracker.xyz/announce/abcdef")?.tag,
    ).toBe("mytracker");
  });

  it("title-cases hyphenated names for the label", () => {
    const match = mapTrackerUrlToTag(
      "https://tracker.my-indexer.example/announce/abcdef",
    );
    expect(match?.tag).toBe("my-indexer");
    expect(match?.label).toBe("My Indexer");
  });

  it("ignores qBittorrent pseudo-trackers like DHT", () => {
    expect(mapTrackerUrlToTag("** [DHT] **")).toBeNull();
  });

  it("returns null for non-URL input", () => {
    expect(mapTrackerUrlToTag("not a url")).toBeNull();
  });
});
