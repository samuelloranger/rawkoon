import { basename, dirname, resolve } from "node:path";
import { clipsRoot } from "@rawkoon/api/services/clips/clipStore";

export const CLIP_SECONDS = 12;
export const CLIP_WIDTH = 960;

// Same tone-map chain the CPU path of a re-encode would use; HDR10 and HLG both land in BT.709.
const TONEMAP =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

export interface ClipArgsInput {
  source: string;
  startSec: number;
  /** `W:H:X:Y` from cropdetect, or null. */
  crop: string | null;
  hdr: boolean;
  /** VA-API render node, or null for libx264. */
  vaapiDevice: string | null;
  /** clipStore temp path. */
  output: string;
}

/** The output must be a clipStore temp file in the clips root, never the input or anything near it. */
function assertSafeOutput(output: string, source: string): void {
  const out = resolve(output);
  if (
    resolve(dirname(out)) !== resolve(clipsRoot()) ||
    !/^clip-\d+\.tmp-\d+\.mp4$/.test(basename(out)) ||
    out === resolve(source)
  ) {
    throw new Error("Unsafe clip output path");
  }
}

export function buildClipArgs(i: ClipArgsInput): string[] {
  assertSafeOutput(i.output, i.source);
  const filters = [
    i.crop ? `crop=${i.crop}` : null,
    i.hdr ? TONEMAP : null,
    `scale=${CLIP_WIDTH}:-2`,
    i.vaapiDevice ? "format=nv12,hwupload" : "format=yuv420p",
  ].filter((f): f is string => f !== null);
  return [
    "ffmpeg",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    // Never overwrite: a clash fails instead of clobbering a file.
    "-n",
    ...(i.vaapiDevice
      ? [
          "-init_hw_device",
          `vaapi=va:${i.vaapiDevice}`,
          "-filter_hw_device",
          "va",
        ]
      : []),
    "-ss",
    String(i.startSec),
    "-t",
    String(CLIP_SECONDS),
    "-i",
    i.source,
    "-map",
    "0:v:0",
    "-vf",
    filters.join(","),
    ...(i.vaapiDevice
      ? ["-c:v", "h264_vaapi", "-qp", "26"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26"]),
    "-an",
    "-sn",
    "-dn",
    "-g",
    "48",
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-f",
    "mp4",
    i.output,
  ];
}

/** Probe pass: decodes the clip window to the null muxer, so nothing is written. */
export function buildCropDetectArgs(
  source: string,
  startSec: number,
): string[] {
  return [
    "ffmpeg",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "info",
    "-ss",
    String(startSec),
    "-t",
    String(CLIP_SECONDS),
    "-i",
    source,
    "-map",
    "0:v:0",
    "-vf",
    // A fraction scales with bit depth; a whole number is absolute, and 24 is brighter than 10-bit black.
    "cropdetect=limit=0.094:round=2:reset=0",
    "-an",
    "-sn",
    "-dn",
    "-f",
    "null",
    "-",
  ];
}

/** Last `crop=` suggestion, or null when there is none or it is implausibly small. */
export function parseCrop(stderr: string): string | null {
  const all = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const m = all.at(-1);
  if (!m) return null;
  const [, w, h, x, y] = m;
  return Number(w) < 16 || Number(h) < 16 ? null : `${w}:${h}:${x}:${y}`;
}

/**
 * Keeps a suggested crop only when it looks like real bars: on one axis, centred, leaving a film-like
 * shape. A dark scene makes cropdetect cut into the picture; then the full frame is kept instead.
 */
export function plausibleCrop(
  crop: string | null,
  frameW: number | null | undefined,
  frameH: number | null | undefined,
): string | null {
  if (!crop || !frameW || !frameH) return null;
  const [w, h, x, y] = crop.split(":").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const tolW = Math.max(8, Math.round(frameW * 0.01));
  const tolH = Math.max(8, Math.round(frameH * 0.01));
  const fullWidth = Math.abs(w - frameW) <= tolW;
  const fullHeight = Math.abs(h - frameH) <= tolH;
  if (fullWidth === fullHeight) return null;
  const centred = fullWidth
    ? Math.abs(2 * y + h - frameH) <= 2 * tolH
    : Math.abs(2 * x + w - frameW) <= 2 * tolW;
  const aspect = w / h;
  return centred && aspect >= 1.2 && aspect <= 2.8 ? crop : null;
}
