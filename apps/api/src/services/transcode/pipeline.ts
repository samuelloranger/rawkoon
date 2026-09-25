import { dirname } from "node:path";
import type {
  TranscodeJobSettings,
  TranscodeLiveProgress,
  TranscodeStep,
} from "@rawkoon/shared/types";
import type { FileFingerprint } from "@rawkoon/api/utils/medias/fileFingerprint";
import { buildEncodeArgs } from "@rawkoon/api/services/transcode/buildArgs";
import type { Capabilities } from "@rawkoon/api/services/transcode/capabilities";
import {
  describeFailure,
  type RunFfmpeg,
} from "@rawkoon/api/services/transcode/ffmpegRunner";
import {
  finalPathFor,
  tmpPathFor,
} from "@rawkoon/api/services/transcode/outputPath";
import { targetHeight } from "@rawkoon/api/services/transcode/presets";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";
import { type SwapFs, swapInPlace } from "@rawkoon/api/services/transcode/swap";
import {
  checkSsim,
  checkStructure,
  measureSsim,
} from "@rawkoon/api/services/transcode/validate";

export interface PipelineSource {
  dbPath: string;
  sizeBytes: bigint;
  fileMtimeMs: bigint | null;
  fileDev: string | null;
  fileIno: string | null;
}

export interface PipelineJob {
  id: number;
  settings: TranscodeJobSettings;
  estimatedBytes: bigint | null;
  source: PipelineSource;
}

export interface PipelineDeps {
  mapPath(p: string): string;
  probe(path: string): Promise<SourceProbe>;
  run: RunFfmpeg;
  fingerprint(path: string): Promise<FileFingerprint | null>;
  nlink(path: string): Promise<number>;
  freeBytes(dir: string): Promise<bigint>;
  fs: SwapFs;
  capabilities(): Promise<Capabilities>;
  rescan(finalDbPath: string): Promise<void>;
}

export interface PipelineHooks {
  onStep(step: TranscodeStep): void;
  onProgress(p: TranscodeLiveProgress): void;
}

export type PipelineResult =
  | {
      ok: true;
      outputBytes: bigint;
      ssimAvg: number;
      ssimMin: number;
      nlink: number;
      finalDbPath: string;
    }
  | {
      ok: false;
      error: string;
      cancelled: boolean;
      ssimAvg?: number;
      ssimMin?: number;
      nlink?: number;
    };

class StepError extends Error {}

function sameFile(src: PipelineSource, live: FileFingerprint | null): boolean {
  if (!live) return false;
  if (live.sizeBytes !== src.sizeBytes) return false;
  if (src.fileMtimeMs != null && live.mtimeMs !== src.fileMtimeMs) return false;
  if (src.fileIno && live.ino && src.fileIno !== live.ino) return false;
  return true;
}

export async function runPipeline(
  job: PipelineJob,
  deps: PipelineDeps,
  hooks: PipelineHooks,
  opts: {
    signal: AbortSignal;
    threads: number;
    thresholds: { avg: number; min: number };
  },
): Promise<PipelineResult> {
  const src = deps.mapPath(job.source.dbPath);
  const tmp = tmpPathFor(src);
  let nlink: number | undefined;
  let scores: number[] = [];
  const ssim = () =>
    scores.length
      ? {
          ssimAvg: scores.reduce((a, b) => a + b, 0) / scores.length,
          ssimMin: Math.min(...scores),
        }
      : {};
  try {
    hooks.onStep("preflight");
    if (!sameFile(job.source, await deps.fingerprint(src)))
      throw new StepError("Source changed since queued");
    const probe = await deps.probe(src);
    if (!probe.video) throw new StepError("Source has no video stream");
    if (probe.dvProfile === 5)
      throw new StepError("Dolby Vision profile 5 cannot be re-encoded");
    const caps = await deps.capabilities();
    if (job.settings.encoder === "vaapi" && !caps.vaapiDevice)
      throw new StepError("VAAPI device not available");
    const need = ((job.estimatedBytes ?? job.source.sizeBytes) * 12n) / 10n;
    if ((await deps.freeBytes(dirname(src))) < need)
      throw new StepError("Not enough free space for the output");
    nlink = await deps.nlink(src);

    hooks.onStep("encode");
    const started = Date.now();
    const r = await deps.run(
      buildEncodeArgs({
        input: src,
        output: tmp,
        probe,
        settings: job.settings,
        threads: opts.threads,
        vaapiDevice: caps.vaapiDevice,
      }),
      {
        signal: opts.signal,
        nice: job.settings.encoder === "software",
        onProgress: (p) => {
          const progress =
            p.outTimeSecs != null
              ? Math.min(1, p.outTimeSecs / probe.durationSecs)
              : 0;
          const elapsed = (Date.now() - started) / 1000;
          hooks.onProgress({
            progress,
            fps: p.fps,
            speed: p.speed,
            eta_secs:
              progress > 0.01
                ? Math.round((elapsed / progress) * (1 - progress))
                : null,
            current_bytes: p.totalSize != null ? String(p.totalSize) : null,
          });
        },
      },
    );
    if (r.aborted)
      return await cleanup({ ok: false, error: "Cancelled", cancelled: true });
    if (r.code !== 0) throw new StepError(describeFailure(r));

    hooks.onStep("validate");
    const out = await deps.probe(tmp);
    const structural = checkStructure(probe, out, job.settings);
    if (structural) throw new StepError(structural);
    scores = await measureSsim({
      source: src,
      output: tmp,
      sourceProbe: probe,
      outputProbe: out,
      run: deps.run,
    });
    const quality = checkSsim(scores, opts.thresholds);
    if (quality) throw new StepError(quality);

    hooks.onStep("replace");
    if (!sameFile(job.source, await deps.fingerprint(src)))
      throw new StepError("Source changed during encode");
    const h = targetHeight(job.settings, probe);
    const final = finalPathFor(src, h);
    const finalDbPath = finalPathFor(job.source.dbPath, h);
    await swapInPlace({
      tmp,
      source: src,
      final,
      fs: deps.fs,
      verify: async (p) => {
        try {
          const v = await deps.probe(p);
          return v.sizeBytes === out.sizeBytes;
        } catch {
          return false;
        }
      },
    });

    hooks.onStep("rescan");
    try {
      await deps.rescan(finalDbPath);
    } catch (e) {
      return {
        ok: false,
        cancelled: false,
        nlink,
        ...ssim(),
        error: `Replaced on disk but the library update failed (${(e as Error).message}); run Rescan files`,
      };
    }
    const s = ssim() as { ssimAvg: number; ssimMin: number };
    return {
      ok: true,
      outputBytes: out.sizeBytes,
      nlink: nlink ?? 1,
      finalDbPath,
      ...s,
    };
  } catch (e) {
    const msg =
      e instanceof StepError
        ? e.message
        : `Unexpected error: ${(e as Error).message}`;
    return await cleanup({
      ok: false,
      error: msg,
      cancelled: false,
      nlink,
      ...ssim(),
    });
  }

  async function cleanup(res: PipelineResult): Promise<PipelineResult> {
    try {
      await deps.fs.unlink(tmp);
    } catch {
      /* nothing written */
    }
    return res;
  }
}
