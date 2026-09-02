import { describe, it, expect } from "bun:test";
import { mapBookEdition } from "@rawkoon/api/routes/books/bookHelpers";

const edition = (over: Record<string, unknown> = {}) =>
  ({
    id: 1,
    kind: "audiobook",
    status: "downloaded",
    monitored: true,
    bookQualityProfileId: null,
    bookQualityProfile: null,
    narrators: [],
    durationSecs: 100,
    searchAttempts: 0,
    lastGrabbedAt: null,
    totalSizeBytes: null,
    files: [{ id: 1, format: "mp3" }],
    offlineReady: true,
    ...over,
  }) as never;

describe("mapBookEdition", () => {
  it("exposes offline_ready from the Prisma column", () => {
    expect(mapBookEdition(edition()).offline_ready).toBe(true);
    expect(mapBookEdition(edition({ offlineReady: false })).offline_ready).toBe(
      false,
    );
  });
});
