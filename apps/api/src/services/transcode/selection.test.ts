import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";
import { exclusionReason } from "@rawkoon/api/services/transcode/selection";

const settings: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};
const caps = {
  combos: [{ codec: "hevc" as const, encoder: "software" as const }],
  vaapiDevice: null,
  deviceLabel: null,
  vaapiUnavailableReason: "none",
};
const p1080 = parseProbe({
  format: { duration: "10", size: "10" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
    },
  ],
});

describe("exclusionReason", () => {
  it("accepts a normal file", () => {
    expect(
      exclusionReason({
        path: "/a.mkv",
        probe: p1080,
        settings,
        active: false,
        caps,
      }),
    ).toBeNull();
  });
  it("rejects non-video extensions", () => {
    expect(
      exclusionReason({
        path: "/a.srt",
        probe: null,
        settings,
        active: false,
        caps,
      }),
    ).toBe("Not a video file");
  });
  it("rejects files already queued", () => {
    expect(
      exclusionReason({
        path: "/a.mkv",
        probe: p1080,
        settings,
        active: true,
        caps,
      }),
    ).toBe("Already queued");
  });
  it("rejects unreadable files", () => {
    expect(
      exclusionReason({
        path: "/a.mkv",
        probe: null,
        settings,
        active: false,
        caps,
      }),
    ).toBe("Could not read the file");
  });
  it("rejects Dolby Vision profile 5", () => {
    expect(
      exclusionReason({
        path: "/a.mkv",
        probe: { ...p1080, dvProfile: 5 },
        settings,
        active: false,
        caps,
      }),
    ).toContain("Dolby Vision profile 5");
  });
  it("rejects a downscale that is not lower than the source", () => {
    expect(
      exclusionReason({
        path: "/a.mkv",
        probe: p1080,
        settings: { ...settings, resolution: 1080 },
        active: false,
        caps,
      }),
    ).toBe("Already 1080p or lower");
  });
  it("rejects an unavailable encoder combo", () => {
    expect(
      exclusionReason({
        path: "/a.mkv",
        probe: p1080,
        settings: { ...settings, codec: "av1" },
        active: false,
        caps,
      }),
    ).toBe("Encoder not available");
  });
});
