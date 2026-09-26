import { describe, expect, it } from "bun:test";
import {
  finalPathFor,
  origPathFor,
  tmpPathFor,
} from "@rawkoon/api/services/transcode/outputPath";

describe("outputPath", () => {
  it("tmp and orig are hidden siblings", () => {
    expect(tmpPathFor("/lib/Movie (2010)/Movie (2010).mkv")).toBe(
      "/lib/Movie (2010)/.Movie (2010).rawkoon-tmp.mkv",
    );
    expect(origPathFor("/lib/Movie (2010)/Movie (2010).mkv")).toBe(
      "/lib/Movie (2010)/.Movie (2010).mkv.rawkoon-orig",
    );
  });

  it("finalPathFor keeps an mkv path when resolution is kept", () => {
    expect(finalPathFor("/lib/a/Show - S01E01 [1080p WEB].mkv", null)).toBe(
      "/lib/a/Show - S01E01 [1080p WEB].mkv",
    );
  });

  it("finalPathFor swaps extension", () => {
    expect(finalPathFor("/lib/a/Clip.mp4", null)).toBe("/lib/a/Clip.mkv");
    expect(finalPathFor("/lib/a/Clip.M4V", null)).toBe("/lib/a/Clip.mkv");
  });

  it("finalPathFor rewrites the resolution token when downscaling", () => {
    expect(finalPathFor("/lib/a/Movie [2160p BluRay].mkv", 1080)).toBe(
      "/lib/a/Movie [1080p BluRay].mkv",
    );
    expect(finalPathFor("/lib/a/Movie.4K.HDR.mkv", 1080)).toBe(
      "/lib/a/Movie.1080p.HDR.mkv",
    );
    expect(finalPathFor("/lib/a/Movie.mkv", 720)).toBe("/lib/a/Movie.mkv");
  });

  it("does not touch directory names", () => {
    expect(finalPathFor("/lib/2160p/Movie [2160p].mkv", 1080)).toBe(
      "/lib/2160p/Movie [1080p].mkv",
    );
  });
});
