import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import {
  applyRatio,
  clipStarts,
  roughEstimate,
} from "@rawkoon/api/services/transcode/estimate";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";

const s: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

// 1 h, 1080p24, 20 Mb/s video + one 640 kb/s AC3 track.
const probe = parseProbe({
  format: {
    duration: "3600",
    size: String(((20_000_000 + 640_000) * 3600) / 8),
    bit_rate: "20640000",
  },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      r_frame_rate: "24/1",
      pix_fmt: "yuv420p",
    },
    {
      index: 1,
      codec_type: "audio",
      codec_name: "ac3",
      channels: 6,
      bit_rate: "640000",
    },
  ],
});

describe("roughEstimate", () => {
  it("uses the preset bitrate plus copied audio and 1% overhead", () => {
    const e = roughEstimate(probe, s);
    expect(Number(e.videoBytes)).toBe((3200 * 1000 * 3600) / 8);
    expect(Number(e.audioBytes)).toBe((640_000 * 3600) / 8);
    expect(Number(e.totalBytes)).toBe(
      Math.round((Number(e.videoBytes) + Number(e.audioBytes)) * 1.01),
    );
    expect(e.etaSecs).toBe(Math.round((3600 * 24) / 18));
  });

  it("never predicts more video than the source has", () => {
    const tiny = {
      ...probe,
      bitRate: 1_000_000,
      sizeBytes: BigInt((1_000_000 * 3600) / 8),
    };
    const e = roughEstimate(tiny, s);
    expect(Number(e.videoBytes)).toBeLessThan(Number(tiny.sizeBytes));
  });

  it("target mode is bitrate × duration", () => {
    const e = roughEstimate(probe, {
      ...s,
      mode: "target",
      targetVideoKbps: 4000,
    });
    expect(Number(e.videoBytes)).toBe((4000 * 1000 * 3600) / 8);
  });

  it("converted lossless audio uses the eac3 bitrate", () => {
    const lossless = parseProbe({
      format: { duration: "100", size: "100000000" },
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "24/1",
        },
        { index: 1, codec_type: "audio", codec_name: "truehd", channels: 8 },
      ],
    });
    const e = roughEstimate(lossless, { ...s, convertLosslessAudio: true });
    expect(Number(e.audioBytes)).toBe((768_000 * 100) / 8);
  });
});

describe("clipStarts", () => {
  it("spreads clips evenly and stays inside the file", () => {
    expect(clipStarts(600, 6, 10)).toEqual([45, 145, 245, 345, 445, 545]);
    expect(clipStarts(20, 6, 10)).toEqual([0]);
  });
});

describe("applyRatio", () => {
  it("scales source video bytes by the mean ratio with a 5% floor", () => {
    const { est, rangePct } = applyRatio(probe, s, [0.2, 0.2, 0.2]);
    const srcVideo = Number(probe.sizeBytes) - (640_000 * 3600) / 8;
    expect(Number(est.videoBytes)).toBe(Math.round(srcVideo * 0.2));
    expect(rangePct).toBe(5);
  });

  it("widens the range with spread", () => {
    expect(applyRatio(probe, s, [0.1, 0.3]).rangePct).toBe(50);
  });
});
