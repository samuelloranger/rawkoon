import { describe, expect, it } from "bun:test";
import { rssMovieReleaseAllowed } from "@rawkoon/api/workers/rssReleaseMatching";

const today = new Date("2026-11-07T00:00:00.000Z");
const due = new Date("2026-11-17T00:00:00.000Z");
const out = new Date("2026-11-01T00:00:00.000Z");

describe("rssMovieReleaseAllowed", () => {
  it("takes any release once the movie is out", () => {
    expect(
      rssMovieReleaseAllowed("Title.2026.1080p.TELESYNC.x264", out, today),
    ).toBe(true);
  });

  it("takes a disc or web release before the home-release date", () => {
    for (const title of [
      "Title.2026.MULTI.1080p.BluRay.x264-GRP",
      "Title.2026.1080p.Blu-ray.Remux.AVC.DTS-HD.MA.5.1-GRP",
      "Title.2026.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP",
      "Title.2026.1080p.WEBRip.x265-GRP",
    ]) {
      expect(rssMovieReleaseAllowed(title, due, today)).toBe(true);
    }
  });

  it("refuses cams, telesyncs and unlabelled releases before the home-release date", () => {
    for (const title of [
      "Title.2026.1080p.TELESYNC.HEVC-GRP",
      "Title.2026.1080p.HDTS.x265-GRP",
      "Title.2026.HDCAM.x264-GRP",
      "Title.2026.1080p.x264-GRP",
    ]) {
      expect(rssMovieReleaseAllowed(title, due, today)).toBe(false);
    }
  });
});
