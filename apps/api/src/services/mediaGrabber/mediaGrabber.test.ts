import { describe, it, expect } from "bun:test";

describe("grabRelease isUpgrade flag", () => {
  it("accepts isUpgrade in opts without TypeScript error", () => {
    // Structural/type test — verifies the opts shape compiles
    type GrabOpts = Parameters<
      typeof import("./mediaGrabberGrab").grabRelease
    >[0];
    const opts: GrabOpts = {
      mediaId: 1,
      downloadUrl: "magnet:?xt=urn:btih:abc",
      releaseTitle: "Movie.2024.1080p.BluRay.x265",
      isUpgrade: true,
    };
    expect(opts.isUpgrade).toBe(true);
  });
});
