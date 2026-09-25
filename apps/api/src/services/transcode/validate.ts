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
    return `Video height/width is ${output.video.width}x${output.video.height}, expected ${want.width}x${want.height}`;
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
  const m = stderr.match(/All:([0-9.]+)/g);
  if (!m) return null;
  return Number.parseFloat(m.at(-1)!.slice(4));
}

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
  const scores: number[] = [];
  for (const start of clipStarts(
    o.sourceProbe.durationSecs,
    SAMPLE_CLIPS,
    SAMPLE_SECS,
  )) {
    const graph =
      `[0:${ov.index}]setpts=PTS-STARTPTS,format=yuv420p[a];` +
      `[1:${sv.index}]scale=${ov.width}:${ov.height}:flags=bicubic,setpts=PTS-STARTPTS,format=yuv420p[b];` +
      "[a][b]ssim";
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
        String(SAMPLE_SECS),
        "-i",
        o.output,
        "-ss",
        String(start),
        "-t",
        String(SAMPLE_SECS),
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
    const v = r.code === 0 ? parseSsimAll(r.stderr) : null;
    if (v != null) scores.push(v);
  }
  return scores;
}
