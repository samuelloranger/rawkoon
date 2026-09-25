import type {
  TranscodeJobSettings,
  TranscodePreset,
  TranscodeSpeed,
} from "@rawkoon/shared/types";
import type {
  ProbeStream,
  SourceProbe,
} from "@rawkoon/api/services/transcode/probe";

const QUALITY: Record<string, Record<TranscodePreset, number>> = {
  "software:hevc": { high: 20, balanced: 23, small: 26 },
  "software:av1": { high: 26, balanced: 30, small: 35 },
  "vaapi:hevc": { high: 20, balanced: 24, small: 28 },
  // av1_vaapi QP spans 0-255.
  "vaapi:av1": { high: 80, balanced: 110, small: 140 },
};

const SPEED: Record<string, Record<TranscodeSpeed, string>> = {
  "software:hevc": { slower: "slow", default: "medium", faster: "fast" },
  "software:av1": { slower: "4", default: "6", faster: "8" },
};

/** Rough 1080p24 video bitrate in kbps per quality preset; scaled by pixels^0.75 and fps. */
export const ROUGH_KBPS_1080: Record<
  string,
  Record<TranscodePreset, number>
> = {
  "software:hevc": { high: 5000, balanced: 3200, small: 2000 },
  "software:av1": { high: 3800, balanced: 2400, small: 1500 },
  "vaapi:hevc": { high: 6000, balanced: 4000, small: 2600 },
  "vaapi:av1": { high: 4800, balanced: 3000, small: 1900 },
};

/** Rough 1080p encode fps; scaled by 1080p pixel count / source pixel count. */
export const ROUGH_FPS_1080: Record<string, Record<TranscodeSpeed, number>> = {
  "software:hevc": { slower: 8, default: 18, faster: 35 },
  "software:av1": { slower: 6, default: 20, faster: 45 },
  "vaapi:hevc": { slower: 180, default: 220, faster: 260 },
  "vaapi:av1": { slower: 160, default: 200, faster: 240 },
};

export function comboKey(s: TranscodeJobSettings): string {
  return `${s.encoder}:${s.codec}`;
}

export function qualityValue(s: TranscodeJobSettings): number {
  return s.quality ?? QUALITY[comboKey(s)][s.preset];
}

export function speedValue(s: TranscodeJobSettings): string {
  return SPEED[comboKey(s)]?.[s.speed] ?? "";
}

export function targetHeight(
  s: TranscodeJobSettings,
  source: SourceProbe,
): number | null {
  if (s.resolution === "keep") return null;
  const h = source.video?.height ?? 0;
  return s.resolution < h ? s.resolution : null;
}

const LOSSLESS = new Set(["truehd", "flac", "mlp", "alac"]);

export function isLosslessAudio(st: ProbeStream): boolean {
  if (st.type !== "audio") return false;
  if (LOSSLESS.has(st.codec) || st.codec.startsWith("pcm_")) return true;
  return st.codec === "dts" && /MA|HD MA/i.test(st.profile ?? "");
}

export function eac3BitrateFor(channels: number | null): {
  kbps: number;
  channels: number;
} {
  const ch = channels ?? 2;
  // ffmpeg's eac3 encoder tops out at 5.1.
  if (ch > 6) return { kbps: 768, channels: 6 };
  if (ch > 2) return { kbps: 640, channels: ch };
  return { kbps: 224, channels: ch };
}
