import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";
import {
  checkSsim,
  checkStructure,
  parseSsimAll,
} from "@rawkoon/api/services/transcode/validate";

const s: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

const mk = (o: {
  dur?: string;
  size?: string;
  codec?: string;
  h?: number;
  audio?: string[];
  subs?: string[];
}) =>
  parseProbe({
    format: { duration: o.dur ?? "100", size: o.size ?? "500" },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: o.codec ?? "hevc",
        width: 1920,
        height: o.h ?? 1080,
      },
      ...(o.audio ?? ["eng"]).map((l, i) => ({
        index: 1 + i,
        codec_type: "audio",
        codec_name: "ac3",
        tags: { language: l },
      })),
      ...(o.subs ?? []).map((l, i) => ({
        index: 10 + i,
        codec_type: "subtitle",
        codec_name: "subrip",
        tags: { language: l },
      })),
    ],
  });

const source = mk({
  size: "1000",
  codec: "h264",
  audio: ["fre", "eng"],
  subs: ["fre"],
});

describe("checkStructure", () => {
  it("passes a matching output", () => {
    expect(
      checkStructure(source, mk({ audio: ["fre", "eng"], subs: ["fre"] }), s),
    ).toBeNull();
  });
  it("fails on duration drift", () => {
    expect(
      checkStructure(
        source,
        mk({ dur: "98.5", audio: ["fre", "eng"], subs: ["fre"] }),
        s,
      ),
    ).toContain("Duration");
  });
  it("fails on wrong codec", () => {
    expect(
      checkStructure(
        source,
        mk({ codec: "h264", audio: ["fre", "eng"], subs: ["fre"] }),
        s,
      ),
    ).toContain("codec");
  });
  it("fails on wrong height", () => {
    expect(
      checkStructure(
        source,
        mk({ h: 720, audio: ["fre", "eng"], subs: ["fre"] }),
        s,
      ),
    ).toContain("height");
  });
  it("fails when audio languages differ", () => {
    expect(
      checkStructure(source, mk({ audio: ["fre"], subs: ["fre"] }), s),
    ).toContain("Audio");
  });
  it("fails when subtitles are missing", () => {
    expect(checkStructure(source, mk({ audio: ["fre", "eng"] }), s)).toContain(
      "Subtitle",
    );
  });
  it("fails with no size gain", () => {
    expect(
      checkStructure(
        source,
        mk({ size: "1000", audio: ["fre", "eng"], subs: ["fre"] }),
        s,
      ),
    ).toBe("No size gain");
  });
  it("expects the target height when downscaling", () => {
    const uhd = mk({
      size: "1000",
      codec: "h264",
      h: 2160,
      audio: ["fre", "eng"],
      subs: ["fre"],
    });
    expect(
      checkStructure(
        uhd,
        mk({ h: 1080, audio: ["fre", "eng"], subs: ["fre"] }),
        { ...s, resolution: 1080 },
      ),
    ).toBeNull();
  });
});

describe("checkSsim", () => {
  it("passes above both thresholds", () => {
    expect(checkSsim([0.98, 0.975], { avg: 0.97, min: 0.95 })).toBeNull();
  });
  it("fails on a low mean", () => {
    expect(checkSsim([0.96, 0.964], { avg: 0.97, min: 0.95 })).toContain(
      "0.962",
    );
  });
  it("fails on one bad clip", () => {
    expect(checkSsim([0.99, 0.99, 0.94], { avg: 0.97, min: 0.95 })).toContain(
      "clip",
    );
  });
  it("fails with no scores", () => {
    expect(checkSsim([], { avg: 0.97, min: 0.95 })).toContain("no");
  });
});

describe("parseSsimAll", () => {
  it("reads the All value from ffmpeg stderr", () => {
    expect(
      parseSsimAll(
        "[Parsed_ssim_4 @ 0x1] SSIM Y:0.990 (20.0) U:0.99 V:0.99 All:0.987654 (19.1)\n",
      ),
    ).toBeCloseTo(0.987654);
    expect(parseSsimAll("nothing")).toBeNull();
  });
});
