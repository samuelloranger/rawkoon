import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";
import type { RunFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import {
  checkSsim,
  checkStructure,
  measureSsim,
  parseSsimAll,
  parseSsimAllValues,
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
  w?: number;
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
        width: o.w ?? 1920,
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
      w: 3840,
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
  it("fits a wide source inside the 1080p box and checks width too", () => {
    const scope = mk({
      size: "1000",
      codec: "h264",
      w: 3840,
      h: 1600,
      audio: ["fre", "eng"],
      subs: ["fre"],
    });
    const fit = mk({ w: 1920, h: 800, audio: ["fre", "eng"], subs: ["fre"] });
    const heightOnly = mk({
      w: 2592,
      h: 1080,
      audio: ["fre", "eng"],
      subs: ["fre"],
    });
    expect(checkStructure(scope, fit, { ...s, resolution: 1080 })).toBeNull();
    expect(
      checkStructure(scope, heightOnly, { ...s, resolution: 1080 }),
    ).toContain("2592x1080");
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

describe("parseSsimAllValues", () => {
  it("reads every SSIM result when several ssim filters ran", () => {
    expect(
      parseSsimAllValues(
        "[Parsed_ssim_9 @ 0x1] SSIM Y:0.9 All:0.936633 (12.0)\n" +
          "[Parsed_ssim_10 @ 0x2] SSIM Y:0.9 All:0.955711 (13.5)\n" +
          "[Parsed_ssim_11 @ 0x3] SSIM Y:0.9 All:0.922931 (11.1)\n",
      ),
    ).toEqual([0.936633, 0.955711, 0.922931]);
    expect(parseSsimAllValues("nothing")).toEqual([]);
  });
});

describe("measureSsim", () => {
  const probe = (w: number, h: number, fps: number | null) =>
    parseProbe({
      format: { duration: "3600", size: "1000" },
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "hevc",
          width: w,
          height: h,
          avg_frame_rate: fps ? `${fps}/1` : "0/0",
        },
      ],
    });

  function fakeRun(stderr: string) {
    const calls: string[][] = [];
    const run: RunFfmpeg = async (args) => {
      calls.push(args);
      return { code: 0, signal: null, stderr, aborted: false };
    };
    return { run, calls };
  }

  const graphOf = (args: string[]) => args[args.indexOf("-lavfi") + 1];

  const stderr =
    "[Parsed_ssim_9 @ 0x1] SSIM All:0.936633 (12.0)\n" +
    "[Parsed_ssim_10 @ 0x2] SSIM All:0.985251 (18.3)\n" +
    "[Parsed_ssim_11 @ 0x3] SSIM All:0.922931 (11.1)\n";

  const measure = (
    run: RunFfmpeg,
    srcFps: number | null = 24,
    outFps: number | null = 24,
  ) =>
    measureSsim({
      source: "src.mkv",
      output: "out.mkv",
      sourceProbe: probe(3840, 1600, srcFps),
      outputProbe: probe(1920, 800, outFps),
      run,
    });

  it("keeps the best of the frame offsets for each clip", async () => {
    const { run, calls } = fakeRun(stderr);
    const scores = await measure(run);
    expect(calls).toHaveLength(6);
    expect(scores).toEqual(Array(6).fill(0.985251));
  });

  it("pairs frames by index, not by timestamp", async () => {
    // The two files' timestamps can differ by a rounding millisecond, and the
    // ssim filter pairs by timestamp, so it can compare neighbouring frames.
    const { run, calls } = fakeRun(stderr);
    await measure(run);
    const graph = graphOf(calls[0]);
    expect(graph).not.toContain("PTS-STARTPTS");
    expect(graph.match(/setpts=N\/24\/TB/g)?.length).toBe(4);
    // 10 s at 24 fps = 240 frames: output 1..240 against source 0..239, 1..240, 2..241.
    expect(graph).toContain("trim=start_frame=1:end_frame=241");
    expect(graph).toContain("trim=start_frame=0:end_frame=240");
    expect(graph).toContain("trim=start_frame=2:end_frame=242");
    expect(graph.match(/\]ssim/g)?.length).toBe(3);
  });

  it("scales the reference with the same filter as the encode", async () => {
    const { run, calls } = fakeRun(stderr);
    await measure(run);
    expect(graphOf(calls[0])).toContain("scale=1920:800:flags=lanczos");
  });

  it("falls back to the output frame rate, then 24 fps", async () => {
    const a = fakeRun(stderr);
    await measure(a.run, null, 25);
    expect(graphOf(a.calls[0])).toContain("setpts=N/25/TB");
    const b = fakeRun(stderr);
    await measure(b.run, null, null);
    expect(graphOf(b.calls[0])).toContain("setpts=N/24/TB");
  });

  it("skips a clip whose run failed", async () => {
    const run: RunFfmpeg = async () => ({
      code: 1,
      signal: null,
      stderr: "boom",
      aborted: false,
    });
    expect(await measure(run)).toEqual([]);
  });
});
