import { describe, expect, it } from "bun:test";
import { bucketResolution, buildLibraryStatsResponse } from "./libraryStats";

describe("bucketResolution", () => {
  it("maps null to unknown", () => {
    expect(bucketResolution(null)).toBe("unknown");
  });
  it("maps 0 to unknown", () => {
    expect(bucketResolution(0)).toBe("unknown");
  });
  it("maps 480 to 480p", () => {
    expect(bucketResolution(480)).toBe("480p");
  });
  it("maps 719 to 480p (below 720p boundary)", () => {
    expect(bucketResolution(719)).toBe("480p");
  });
  it("maps 720 to 720p (720p boundary)", () => {
    expect(bucketResolution(720)).toBe("720p");
  });
  it("maps 1080 to 1080p", () => {
    expect(bucketResolution(1080)).toBe("1080p");
  });
  it("maps 2160+ to 4k", () => {
    expect(bucketResolution(2160)).toBe("4k");
  });
});

describe("buildLibraryStatsResponse", () => {
  it("sets missing equal wanted", () => {
    const stats = buildLibraryStatsResponse({
      byTypeStatus: [{ type: "movie", status: "wanted", count: 3 }],
      byTmdbStatus: [{ tmdb_status: "Returning Series", count: 2 }],
      files: [{ resolution: 1080, size_bytes: 100n }],
    });
    expect(stats.wanted).toBe(3);
    expect(stats.returning_series).toBe(2);
  });
});
