import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import {
  buildClipCutArgs,
  buildEncodeArgs,
} from "@rawkoon/api/services/transcode/buildArgs";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";

const settings: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

const sdrMkv = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      pix_fmt: "yuv420p",
    },
    { index: 1, codec_type: "audio", codec_name: "truehd", channels: 8 },
    { index: 2, codec_type: "audio", codec_name: "ac3", channels: 6 },
    { index: 3, codec_type: "subtitle", codec_name: "subrip" },
  ],
});

const hdrWithCover = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "mjpeg",
      disposition: { attached_pic: 1 },
    },
    {
      index: 1,
      codec_type: "video",
      codec_name: "hevc",
      width: 3840,
      height: 2160,
      pix_fmt: "yuv420p10le",
      color_primaries: "bt2020",
      color_transfer: "smpte2084",
      color_space: "bt2020nc",
    },
    { index: 2, codec_type: "audio", codec_name: "eac3", channels: 6 },
  ],
});

const mp4 = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width: 1280,
      height: 720,
      pix_fmt: "yuv420p",
    },
    { index: 1, codec_type: "audio", codec_name: "aac", channels: 2 },
    { index: 2, codec_type: "subtitle", codec_name: "mov_text" },
    { index: 3, codec_type: "data", codec_name: "bin_data" },
  ],
});

const base = {
  input: "/in.mkv",
  output: "/out.mkv",
  threads: 4,
  vaapiDevice: null,
};
const expectAll = (a: string[], values: string[]) => {
  for (const v of values) expect(a).toContain(v);
};

describe("buildEncodeArgs", () => {
  it("software hevc quality: copies everything, encodes v:0 with libx265 crf", () => {
    const a = buildEncodeArgs({ ...base, probe: sdrMkv, settings });
    expect(a.slice(0, 3)).toEqual(["ffmpeg", "-nostdin", "-hide_banner"]);
    expectAll(a, [
      "-map",
      "0",
      "-c",
      "copy",
      "-c:v:0",
      "libx265",
      "-crf",
      "23",
      "-preset",
      "medium",
    ]);
    expect(a.join(" ")).toContain("-map -0:d");
    expect(a).toContain("-progress");
    expect(a.at(-1)).toBe("/out.mkv");
    expect(a.join(" ")).not.toContain("eac3");
  });

  it("encodes the ordinal of the main video, not attached pic", () => {
    const a = buildEncodeArgs({ ...base, probe: hdrWithCover, settings });
    expect(a).toContain("-c:v:1");
    expect(a).not.toContain("-c:v:0");
  });

  it("keeps HDR: 10-bit pix_fmt and colour tags", () => {
    const a = buildEncodeArgs({ ...base, probe: hdrWithCover, settings });
    expect(a.join(" ")).toContain("-pix_fmt:v:1 yuv420p10le");
    expect(a.join(" ")).toContain("-color_trc:v:1 smpte2084");
    expect(a.join(" ")).toContain("-color_primaries:v:1 bt2020");
  });

  it("downscales with a per-stream filter", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: hdrWithCover,
      settings: { ...settings, resolution: 1080 },
    });
    expect(a.join(" ")).toContain("-filter:v:1 scale=1920:1080:flags=lanczos");
  });

  it("fits a wide source inside the box instead of fixing the height", () => {
    const scope = parseProbe({
      format: { duration: "100", size: "1000" },
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "hevc",
          width: 3840,
          height: 1600,
          pix_fmt: "yuv420p",
        },
      ],
    });
    const a = buildEncodeArgs({
      ...base,
      probe: scope,
      settings: { ...settings, resolution: 1080 },
    });
    expect(a.join(" ")).toContain("-filter:v:0 scale=1920:800:flags=lanczos");
  });

  it("converts lossless audio to eac3, 7.1 down to 5.1", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: sdrMkv,
      settings: { ...settings, convertLosslessAudio: true },
    });
    const j = a.join(" ");
    expect(j).toContain("-c:a:0 eac3 -b:a:0 768k -ac:a:0 6");
    expect(j).not.toContain("-c:a:1 eac3");
  });

  it("mp4 source maps subs to srt and drops data", () => {
    const a = buildEncodeArgs({ ...base, probe: mp4, settings });
    const j = a.join(" ");
    expect(j).toContain("-c:s:0 srt");
    expect(j).toContain("-map -0:d");
  });

  it("svt-av1 uses preset number and 10-bit", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: sdrMkv,
      settings: { ...settings, codec: "av1" },
    });
    expectAll(a, ["libsvtav1", "-crf", "30", "-preset", "6"]);
    expect(a.join(" ")).toContain("-pix_fmt:v:0 yuv420p10le");
  });

  it("vaapi hevc uploads frames and uses CQP", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: sdrMkv,
      vaapiDevice: "/dev/dri/renderD128",
      settings: { ...settings, encoder: "vaapi" },
    });
    const j = a.join(" ");
    expect(j).toContain("-init_hw_device vaapi=va:/dev/dri/renderD128");
    expect(j).toContain("-filter_hw_device va");
    expect(j).toContain("-filter:v:0 format=nv12,hwupload");
    expect(j).toContain("-c:v:0 hevc_vaapi -rc_mode CQP -global_quality 24");
  });

  it("vaapi av1 sets quality through global_quality (av1_vaapi ignores -qp)", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: sdrMkv,
      vaapiDevice: "/dev/dri/renderD128",
      settings: { ...settings, codec: "av1", encoder: "vaapi" },
    });
    expect(a.join(" ")).toContain(
      "-c:v:0 av1_vaapi -rc_mode CQP -global_quality 70",
    );
    expect(a).not.toContain("-qp");
  });

  it("target mode sets bitrate with vbv", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: sdrMkv,
      settings: { ...settings, mode: "target", targetVideoKbps: 3000 },
    });
    const j = a.join(" ");
    expect(j).toContain("-b:v:0 3000k");
    expect(j).toContain("-maxrate:v:0 4500k");
    expect(j).not.toContain("-crf");
  });

  it("advanced quality overrides the preset", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: sdrMkv,
      settings: { ...settings, quality: 19 },
    });
    expectAll(a, ["-crf", "19"]);
  });

  it("clip mode seeks and maps only the main video", () => {
    const a = buildEncodeArgs({
      ...base,
      probe: hdrWithCover,
      settings,
      clip: { start: 50, duration: 10 },
    });
    const j = a.join(" ");
    expect(j).toContain("-ss 50 -t 10 -i /in.mkv");
    // The clip input is the stream-copied cut, whose only stream is the video.
    expect(j).toContain("-map 0:v:0 -an -sn -dn");
    expect(j).toContain("-c:v:0 libx265");
  });
});

describe("buildClipCutArgs", () => {
  it("stream-copies the main video only", () => {
    expect(
      buildClipCutArgs("/in.mkv", "/c.mkv", hdrWithCover, 12, 10).join(" "),
    ).toBe(
      "ffmpeg -nostdin -hide_banner -y -loglevel error -ss 12 -t 10 -i /in.mkv -map 0:1 -c copy -an -sn -dn -f matroska /c.mkv",
    );
  });
});
