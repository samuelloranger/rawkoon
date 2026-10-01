import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import {
  clipStarts,
  SAMPLE_CLIPS,
  SAMPLE_SECS,
} from "@rawkoon/api/services/transcode/estimate";
import type { RunFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import { targetDims } from "@rawkoon/api/services/transcode/presets";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";

function langs(p: SourceProbe, type: "audio" | "subtitle"): string {
  return p.streams
    .filter((s) => s.type === type)
    .map((s) => s.language ?? "und")
    .join(",");
}

export function checkStructure(
  source: SourceProbe,
  output: SourceProbe,
  s: TranscodeJobSettings,
): string | null {
  if (!output.video) return "Output has no video stream";
  if (Math.abs(output.durationSecs - source.durationSecs) > 1) {
    return `Duration differs (${source.durationSecs.toFixed(1)}s → ${output.durationSecs.toFixed(1)}s)`;
  }
  if (output.video.codec !== s.codec)
    return `Video codec is ${output.video.codec}, expected ${s.codec}`;
  const want = targetDims(s, source) ?? {
    width: source.video?.width ?? null,
    height: source.video?.height ?? null,
  };
  if (
    (want.height != null && output.video.height !== want.height) ||
    (want.width != null && output.video.width !== want.width)
  ) {
    return `Video size is ${output.video.width}x${output.video.height}, expected ${want.width}x${want.height}`;
  }
  if (langs(output, "audio") !== langs(source, "audio")) {
    return `Audio tracks differ (${langs(source, "audio")} → ${langs(output, "audio")})`;
  }
  if (langs(output, "subtitle") !== langs(source, "subtitle")) {
    return `Subtitle tracks differ (${langs(source, "subtitle")} → ${langs(output, "subtitle")})`;
  }
  if (output.sizeBytes >= source.sizeBytes) return "No size gain";
  return null;
}

export function checkSsim(
  scores: number[],
  t: { avg: number; min: number },
): string | null {
  if (!scores.length) return "Quality check produced no scores";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const low = scores.filter((x) => x < t.min).length;
  if (avg < t.avg)
    return `Quality check: SSIM ${avg.toFixed(3)} below ${t.avg.toFixed(3)}`;
  if (low)
    return `Quality check: ${low} of ${scores.length} clip(s) below ${t.min.toFixed(3)}`;
  return null;
}

export function parseSsimAll(stderr: string): number | null {
  return parseSsimAllValues(stderr).at(-1) ?? null;
}

/** Every "All:" score in ffmpeg stderr, one per ssim filter that ran. */
export function parseSsimAllValues(stderr: string): number[] {
  return [...stderr.matchAll(/All:([0-9.]+)/g)].map((m) =>
    Number.parseFloat(m[1]),
  );
}

/**
 * Source frame offsets tried against the output. Both inputs are seeked to the
 * same second, but the files' timestamps are rounded independently, so the first
 * frame each side delivers can differ by one. A one-frame shift wrecks SSIM on
 * motion while hiding nothing on a real quality loss, so the best offset wins.
 */
const FRAME_OFFSETS = [-1, 0, 1];

export async function measureSsim(o: {
  source: string;
  output: string;
  sourceProbe: SourceProbe;
  outputProbe: SourceProbe;
  run: RunFfmpeg;
  signal?: AbortSignal;
}): Promise<number[]> {
  const sv = o.sourceProbe.video!;
  const ov = o.outputProbe.video!;
  const fps = sv.fps ?? ov.fps ?? 24;
  const frames = Math.round(SAMPLE_SECS * fps);
  // Pair frames by index: the ssim filter pairs by timestamp, and a millisecond of
  // rounding between the two files is enough to compare neighbouring frames.
  const byIndex = `setpts=N/${fps}/TB`;
  const pad = 1 + Math.max(...FRAME_OFFSETS.map(Math.abs));
  const n = FRAME_OFFSETS.length;
  const graph =
    `[0:${ov.index}]format=yuv420p,trim=start_frame=${pad - 1}:end_frame=${frames + pad - 1},${byIndex},split=${n}` +
    FRAME_OFFSETS.map((_, i) => `[a${i}]`).join("") +
    ";" +
    // Same scaler as the encode, so the reference differs from the encoder input only by format.
    `[1:${sv.index}]scale=${ov.width}:${ov.height}:flags=lanczos,format=yuv420p,split=${n}` +
    FRAME_OFFSETS.map((_, i) => `[s${i}]`).join("") +
    ";" +
    FRAME_OFFSETS.map((d, i) => {
      const first = pad - 1 + d;
      return (
        `[s${i}]trim=start_frame=${first}:end_frame=${first + frames},${byIndex}[b${i}];` +
        `[a${i}][b${i}]ssim`
      );
    }).join(";");
  // Read a second past the clip so every offset has its full frame count.
  const readSecs = String(SAMPLE_SECS + 1);
  const scores: number[] = [];
  for (const start of clipStarts(
    o.sourceProbe.durationSecs,
    SAMPLE_CLIPS,
    SAMPLE_SECS,
  )) {
    const r = await o.run(
      [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "info",
        "-ss",
        String(start),
        "-t",
        readSecs,
        "-i",
        o.output,
        "-ss",
        String(start),
        "-t",
        readSecs,
        "-i",
        o.source,
        "-lavfi",
        graph,
        "-f",
        "null",
        "-",
      ],
      { nice: true, signal: o.signal },
    );
    const v = r.code === 0 ? parseSsimAllValues(r.stderr) : [];
    if (v.length) scores.push(Math.max(...v));
  }
  return scores;
}
