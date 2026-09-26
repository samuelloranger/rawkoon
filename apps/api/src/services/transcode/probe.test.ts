import { describe, expect, it } from "bun:test";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";

const fixture = {
  format: { duration: "5400.5", size: "4000000000", bit_rate: "5925000" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "mjpeg",
      disposition: { attached_pic: 1 },
      tags: {},
    },
    {
      index: 1,
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main 10",
      width: 3840,
      height: 2160,
      r_frame_rate: "24000/1001",
      pix_fmt: "yuv420p10le",
      color_primaries: "bt2020",
      color_transfer: "smpte2084",
      color_space: "bt2020nc",
      disposition: { attached_pic: 0 },
      side_data_list: [
        { side_data_type: "DOVI configuration record", dv_profile: 8 },
      ],
    },
    {
      index: 2,
      codec_type: "audio",
      codec_name: "truehd",
      channels: 8,
      tags: { language: "eng", title: "Main" },
      disposition: {},
    },
    {
      index: 3,
      codec_type: "audio",
      codec_name: "ac3",
      channels: 6,
      bit_rate: "640000",
      tags: { language: "fre" },
      disposition: {},
    },
    {
      index: 4,
      codec_type: "subtitle",
      codec_name: "subrip",
      tags: { language: "fre" },
      disposition: {},
    },
  ],
};

describe("parseProbe", () => {
  it("reads format fields", () => {
    const p = parseProbe(fixture);
    expect(p.durationSecs).toBeCloseTo(5400.5);
    expect(p.sizeBytes).toBe(4_000_000_000n);
    expect(p.bitRate).toBe(5_925_000);
  });

  it("mainVideo skips attached_pic", () => {
    const p = parseProbe(fixture);
    expect(p.video?.index).toBe(1);
    expect(p.video?.ordinal).toBe(1);
    expect(p.video?.fps).toBeCloseTo(23.976, 2);
  });

  it("detects HDR and Dolby Vision profile", () => {
    const p = parseProbe(fixture);
    expect(p.isHdr).toBe(true);
    expect(p.dvProfile).toBe(8);
  });

  it("assigns per-type ordinals and languages", () => {
    const p = parseProbe(fixture);
    const audio = p.streams.filter((s) => s.type === "audio");
    expect(audio.map((a) => a.ordinal)).toEqual([0, 1]);
    expect(audio.map((a) => a.language)).toEqual(["eng", "fre"]);
    expect(audio[1].bitRate).toBe(640_000);
    expect(audio[0].bitRate).toBeNull();
  });

  it("treats a file without video as video=null", () => {
    const p = parseProbe({
      format: { duration: "10", size: "10" },
      streams: [],
    });
    expect(p.video).toBeNull();
    expect(p.isHdr).toBe(false);
  });
});

describe("parseProbe audio bitrate", () => {
  it("falls back to the Matroska BPS statistics tag when bit_rate is missing", () => {
    const p = parseProbe({
      format: { duration: "100", size: "1000" },
      streams: [
        {
          index: 0,
          codec_type: "audio",
          codec_name: "dts",
          profile: "DTS-HD MA",
          channels: 6,
          tags: { language: "eng", BPS: "3972854" },
        },
        {
          index: 1,
          codec_type: "audio",
          codec_name: "truehd",
          channels: 8,
          tags: { "BPS-eng": "4100000" },
        },
      ],
    });
    expect(p.streams.map((s) => s.bitRate)).toEqual([3972854, 4100000]);
  });
});
