import { join } from "node:path";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import {
  buildClipCutArgs,
  buildEncodeArgs,
} from "@rawkoon/api/services/transcode/buildArgs";
import type { RunFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import {
  comboKey,
  eac3BitrateFor,
  isLosslessAudio,
  ROUGH_FPS_1080,
  ROUGH_KBPS_1080,
  targetHeight,
} from "@rawkoon/api/services/transcode/presets";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";

export const SAMPLE_CLIPS = 6;
export const SAMPLE_SECS = 10;
const PX_1080 = 1920 * 1080;
const FALLBACK_AUDIO_BPS = 640_000;

export interface FileEstimate {
  videoBytes: bigint;
  audioBytes: bigint;
  totalBytes: bigint;
  etaSecs: number;
}

function outputPixels(probe: SourceProbe, s: TranscodeJobSettings): number {
  const v = probe.video;
  const w = v?.width ?? 1920;
  const h = v?.height ?? 1080;
  const th = targetHeight(s, probe);
  return th ? Math.round((w * th) / h) * th : w * h;
}

function audioBps(probe: SourceProbe, s: TranscodeJobSettings): number {
  let total = 0;
  for (const a of probe.streams.filter((x) => x.type === "audio")) {
    if (s.convertLosslessAudio && isLosslessAudio(a))
      total += eac3BitrateFor(a.channels).kbps * 1000;
    else total += a.bitRate ?? FALLBACK_AUDIO_BPS;
  }
  return total;
}

function sourceAudioBps(probe: SourceProbe): number {
  return probe.streams
    .filter((x) => x.type === "audio")
    .reduce((t, a) => t + (a.bitRate ?? FALLBACK_AUDIO_BPS), 0);
}

function etaSecs(
  probe: SourceProbe,
  s: TranscodeJobSettings,
  measuredFps?: number | null,
): number {
  const v = probe.video;
  const frames = probe.durationSecs * (v?.fps ?? 24);
  const px = (v?.width ?? 1920) * (v?.height ?? 1080);
  const fps =
    measuredFps ?? (ROUGH_FPS_1080[comboKey(s)][s.speed] * PX_1080) / px;
  return Math.round(frames / fps);
}

function sourceVideoBytes(probe: SourceProbe): number {
  const audio = (sourceAudioBps(probe) * probe.durationSecs) / 8;
  return Math.max(0, Number(probe.sizeBytes) - audio);
}

function finish(
  videoBytes: number,
  probe: SourceProbe,
  s: TranscodeJobSettings,
  eta: number,
): FileEstimate {
  const audioBytes = Math.round((audioBps(probe, s) * probe.durationSecs) / 8);
  const v = Math.round(videoBytes);
  return {
    videoBytes: BigInt(v),
    audioBytes: BigInt(audioBytes),
    totalBytes: BigInt(Math.round((v + audioBytes) * 1.01)),
    etaSecs: eta,
  };
}

export function roughEstimate(
  probe: SourceProbe,
  s: TranscodeJobSettings,
): FileEstimate {
  const eta = etaSecs(probe, s);
  if (s.mode === "target") {
    return finish(
      (s.targetVideoKbps! * 1000 * probe.durationSecs) / 8,
      probe,
      s,
      eta,
    );
  }
  const fps = probe.video?.fps ?? 24;
  const kbps =
    ROUGH_KBPS_1080[comboKey(s)][s.preset] *
    (outputPixels(probe, s) / PX_1080) ** 0.75 *
    (fps / 24);
  const predicted = (kbps * 1000 * probe.durationSecs) / 8;
  // A re-encode never lands above ~90% of what the source video already spends.
  return finish(
    Math.min(predicted, sourceVideoBytes(probe) * 0.9),
    probe,
    s,
    eta,
  );
}

export function clipStarts(
  durationSecs: number,
  count: number,
  clipSecs: number,
): number[] {
  if (durationSecs < clipSecs * 3) return [0];
  const step = durationSecs / count;
  return Array.from({ length: count }, (_, i) =>
    Math.min(
      Math.round(step * (i + 0.5) - clipSecs / 2),
      Math.floor(durationSecs - clipSecs),
    ),
  );
}

export function applyRatio(
  probe: SourceProbe,
  s: TranscodeJobSettings,
  ratios: number[],
  measuredFps?: number | null,
): { est: FileEstimate; rangePct: number } {
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const spread = Math.max(...ratios) - Math.min(...ratios);
  const rangePct = Math.max(5, Math.round((spread / mean) * 50));
  return {
    est: finish(
      sourceVideoBytes(probe) * mean,
      probe,
      s,
      etaSecs(probe, s, measuredFps),
    ),
    rangePct,
  };
}

export async function sampleRatios(o: {
  input: string;
  probe: SourceProbe;
  settings: TranscodeJobSettings;
  workDir: string;
  run: RunFfmpeg;
  threads: number;
  vaapiDevice: string | null;
  statSize: (p: string) => Promise<number>;
}): Promise<{ ratios: number[]; fps: number | null }> {
  const ratios: number[] = [];
  const fpsSamples: number[] = [];
  const starts = clipStarts(o.probe.durationSecs, SAMPLE_CLIPS, SAMPLE_SECS);
  for (const [i, start] of starts.entries()) {
    const cut = join(o.workDir, `src-${i}.mkv`);
    const enc = join(o.workDir, `enc-${i}-${comboKey(o.settings)}.mkv`);
    const c = await o.run(
      buildClipCutArgs(o.input, cut, o.probe, start, SAMPLE_SECS),
      {},
    );
    if (c.code !== 0) continue;
    let lastFps: number | null = null;
    const e = await o.run(
      buildEncodeArgs({
        input: cut,
        output: enc,
        probe: o.probe,
        settings: o.settings,
        threads: o.threads,
        vaapiDevice: o.vaapiDevice,
        clip: { start: 0, duration: SAMPLE_SECS },
      }),
      {
        nice: true,
        onProgress: (p) => {
          if (p.fps) lastFps = p.fps;
        },
      },
    );
    if (e.code !== 0) continue;
    const [a, b] = await Promise.all([o.statSize(cut), o.statSize(enc)]);
    if (a > 0) ratios.push(b / a);
    if (lastFps) fpsSamples.push(lastFps);
  }
  if (!ratios.length) throw new Error("Sample encode failed");
  const fps = fpsSamples.length
    ? fpsSamples.reduce((x, y) => x + y, 0) / fpsSamples.length
    : null;
  return { ratios, fps };
}
