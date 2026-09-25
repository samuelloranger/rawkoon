import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";
import {
  eac3BitrateFor,
  isLosslessAudio,
  qualityValue,
  speedValue,
  targetDims,
} from "@rawkoon/api/services/transcode/presets";

export interface EncodeArgsInput {
  input: string;
  output: string;
  probe: SourceProbe;
  settings: TranscodeJobSettings;
  threads: number;
  vaapiDevice: string | null;
  clip?: { start: number; duration: number };
}

const HEAD = ["ffmpeg", "-nostdin", "-hide_banner", "-y"];

function encoderName(s: TranscodeJobSettings): string {
  if (s.encoder === "vaapi")
    return s.codec === "hevc" ? "hevc_vaapi" : "av1_vaapi";
  return s.codec === "hevc" ? "libx265" : "libsvtav1";
}

function videoArgs(i: EncodeArgsInput, n: number): string[] {
  const { settings: s, probe } = i;
  const v = probe.video!;
  const tenBit =
    s.codec === "av1" || probe.isHdr || (v.pixFmt ?? "").includes("10");
  const dims = targetDims(s, probe);
  const scale = dims
    ? `scale=${dims.width}:${dims.height}:flags=lanczos`
    : null;
  const out: string[] = [];

  if (s.encoder === "vaapi") {
    const chain = [scale, `format=${tenBit ? "p010" : "nv12"}`, "hwupload"]
      .filter(Boolean)
      .join(",");
    out.push(`-filter:v:${n}`, chain);
  } else if (scale) {
    out.push(`-filter:v:${n}`, scale);
  }

  out.push(`-c:v:${n}`, encoderName(s));

  if (s.mode === "target") {
    const kbps = s.targetVideoKbps!;
    if (s.encoder === "vaapi") out.push("-rc_mode", "VBR");
    out.push(
      `-b:v:${n}`,
      `${kbps}k`,
      `-maxrate:v:${n}`,
      `${Math.round(kbps * 1.5)}k`,
      `-bufsize:v:${n}`,
      `${kbps * 3}k`,
    );
  } else if (s.encoder === "vaapi") {
    out.push("-rc_mode", "CQP", "-global_quality", String(qualityValue(s)));
  } else {
    out.push("-crf", String(qualityValue(s)));
  }

  if (s.encoder === "software") {
    out.push("-preset", speedValue(s));
    out.push(`-pix_fmt:v:${n}`, tenBit ? "yuv420p10le" : "yuv420p");
    if (s.codec === "hevc") {
      out.push("-x265-params", `log-level=error:pools=${i.threads}`);
    }
  }

  if (probe.isHdr) {
    if (v.colorPrimaries) out.push(`-color_primaries:v:${n}`, v.colorPrimaries);
    if (v.colorTransfer) out.push(`-color_trc:v:${n}`, v.colorTransfer);
    if (v.colorSpace) out.push(`-colorspace:v:${n}`, v.colorSpace);
  }
  return out;
}

export function buildEncodeArgs(i: EncodeArgsInput): string[] {
  const { probe, settings } = i;
  const v = probe.video;
  if (!v) throw new Error("Source has no video stream");
  const args = [...HEAD, "-loglevel", "error"];
  if (settings.encoder === "vaapi") {
    if (!i.vaapiDevice) throw new Error("VAAPI device not available");
    args.push(
      "-init_hw_device",
      `vaapi=va:${i.vaapiDevice}`,
      "-filter_hw_device",
      "va",
    );
  }
  if (i.clip)
    args.push("-ss", String(i.clip.start), "-t", String(i.clip.duration));
  args.push("-i", i.input);
  if (settings.encoder === "software") args.push("-threads", String(i.threads));

  if (i.clip) {
    // Clip input is the stream-copied cut, whose only stream is the main video.
    args.push("-map", "0:v:0", "-an", "-sn", "-dn");
    args.push(...videoArgs(i, 0));
  } else {
    args.push("-map", "0", "-map", "-0:d", "-c", "copy");
    args.push(...videoArgs(i, v.ordinal));
    if (settings.convertLosslessAudio) {
      for (const a of probe.streams.filter(isLosslessAudio)) {
        const { kbps, channels } = eac3BitrateFor(a.channels);
        args.push(`-c:a:${a.ordinal}`, "eac3", `-b:a:${a.ordinal}`, `${kbps}k`);
        if (channels !== a.channels)
          args.push(`-ac:a:${a.ordinal}`, String(channels));
      }
    }
    for (const s of probe.streams) {
      if (s.type === "subtitle" && s.codec === "mov_text")
        args.push(`-c:s:${s.ordinal}`, "srt");
    }
    args.push("-max_muxing_queue_size", "4096");
  }
  args.push("-progress", "pipe:1", "-nostats", "-f", "matroska", i.output);
  return args;
}

export function buildClipCutArgs(
  input: string,
  output: string,
  probe: SourceProbe,
  start: number,
  duration: number,
): string[] {
  if (!probe.video) throw new Error("Source has no video stream");
  return [
    ...HEAD,
    "-loglevel",
    "error",
    "-ss",
    String(start),
    "-t",
    String(duration),
    "-i",
    input,
    "-map",
    `0:${probe.video.index}`,
    "-c",
    "copy",
    "-an",
    "-sn",
    "-dn",
    "-f",
    "matroska",
    output,
  ];
}
