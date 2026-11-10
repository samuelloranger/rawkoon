import { beforeAll, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";

Bun.env.IMAGE_STORAGE_DIR = "/tmp/clip-args-test/data/images";
const root = "/tmp/clip-args-test/data/clips";

const { buildClipArgs, buildCropDetectArgs, parseCrop, plausibleCrop } =
  await import("@rawkoon/api/services/clips/clipArgs");

const base = {
  source: "/lib/Movie (2020)/movie.mkv",
  startSec: 90.5,
  crop: null as string | null,
  hdr: false,
  vaapiDevice: null as string | null,
  output: join(root, "clip-4.tmp-123.mp4"),
};

describe("buildClipArgs", () => {
  let args: string[];
  beforeAll(() => {
    args = buildClipArgs(base);
  });

  it("writes only to the clips root under a temp name, with -n and never -y", () => {
    expect(args.at(-1)).toBe(base.output);
    expect(dirname(args.at(-1) as string)).toBe(root);
    expect(args).toContain("-n");
    expect(args).not.toContain("-y");
    expect(args.at(-1)).not.toBe(base.source);
    expect(args.filter((a) => a === base.output)).toHaveLength(1);
  });

  it("reads the source only through -i, seeking before it", () => {
    const i = args.indexOf("-i");
    expect(args[i + 1]).toBe(base.source);
    expect(args.indexOf("-ss")).toBeLessThan(i);
    expect(args[args.indexOf("-ss") + 1]).toBe("90.5");
    expect(args[args.indexOf("-t") + 1]).toBe("12");
  });

  it("drops audio, subtitles, data and metadata and keeps seekable output", () => {
    for (const f of ["-an", "-sn", "-dn"]) expect(args).toContain(f);
    expect(args[args.indexOf("-g") + 1]).toBe("48");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args[args.indexOf("-map_metadata") + 1]).toBe("-1");
  });

  it("uses libx264 on CPU and h264_vaapi with a device when given one", () => {
    expect(args).toContain("libx264");
    const gpu = buildClipArgs({ ...base, vaapiDevice: "/dev/dri/renderD128" });
    expect(gpu).toContain("h264_vaapi");
    expect(gpu.join(" ")).toContain("vaapi=va:/dev/dri/renderD128");
    expect(gpu[gpu.indexOf("-vf") + 1]).toEndWith("hwupload");
  });

  it("crops before tone mapping and scaling", () => {
    const full = buildClipArgs({ ...base, crop: "1920:800:0:140", hdr: true });
    const vf = full[full.indexOf("-vf") + 1];
    expect(vf?.indexOf("crop=1920:800:0:140")).toBe(0);
    expect(vf?.indexOf("tonemap")).toBeGreaterThan(0);
    expect(vf?.indexOf("scale=960:-2")).toBeGreaterThan(
      vf?.indexOf("tonemap") ?? 0,
    );
  });

  it("refuses any output that is not a temp file in the clips root", () => {
    for (const output of [
      base.source,
      "/lib/Movie (2020)/clip-4.tmp-1.mp4",
      join(root, "clip-4.mp4"),
      join(root, "nested", "clip-4.tmp-1.mp4"),
      join(root, "movie.mkv"),
      join(root, "..", "clip-4.tmp-1.mp4"),
    ]) {
      expect(() => buildClipArgs({ ...base, output })).toThrow();
    }
  });
});

describe("crop detection", () => {
  it("decodes to the null muxer, so no file is written", () => {
    const args = buildCropDetectArgs(base.source, 10);
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
    expect(args).not.toContain("-y");
  });

  it("takes the last crop suggestion and ignores absurd ones", () => {
    expect(parseCrop("x crop=1920:800:0:140\ny crop=1920:816:0:132")).toBe(
      "1920:816:0:132",
    );
    expect(parseCrop("crop=8:8:0:0")).toBeNull();
    expect(parseCrop("nothing")).toBeNull();
  });
});

describe("plausibleCrop", () => {
  it("keeps centred letterbox and pillarbox bars", () => {
    expect(plausibleCrop("1920:800:0:140", 1920, 1080)).toBe("1920:800:0:140");
    expect(plausibleCrop("3840:1600:0:280", 3840, 2160)).toBe(
      "3840:1600:0:280",
    );
    expect(plausibleCrop("1440:1080:240:0", 1920, 1080)).toBe(
      "1440:1080:240:0",
    );
    // 2.76:1, a frame a few lines short of 2160, and anamorphic SD (storage pixels)
    expect(plausibleCrop("1920:696:0:192", 1920, 1080)).toBe("1920:696:0:192");
    expect(plausibleCrop("3840:1600:0:278", 3840, 2156)).toBe(
      "3840:1600:0:278",
    );
    expect(plausibleCrop("720:352:0:64", 720, 480)).toBe("720:352:0:64");
  });

  it("drops what a dark scene suggests: off-centre, near-square or a thin strip", () => {
    expect(plausibleCrop("1110:1080:494:0", 1920, 1080)).toBeNull();
    expect(plausibleCrop("670:114:680:384", 1920, 1080)).toBeNull();
    expect(plausibleCrop("1920:40:0:520", 1920, 1080)).toBeNull();
  });

  it("drops a crop on both axes, no crop at all, or one it can't judge", () => {
    expect(plausibleCrop("1700:900:110:90", 1920, 1080)).toBeNull();
    expect(plausibleCrop("1920:1080:0:0", 1920, 1080)).toBeNull();
    expect(plausibleCrop(null, 1920, 1080)).toBeNull();
    expect(plausibleCrop("1920:800:0:140", null, 1080)).toBeNull();
  });
});
