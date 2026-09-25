import { cpus } from "node:os";
import type { TranscodeLiveProgress } from "@rawkoon/shared/types";
import {
  finalPathFor,
  tmpPathFor,
} from "@rawkoon/api/services/transcode/outputPath";
import {
  type PipelineDeps,
  runPipeline,
} from "@rawkoon/api/services/transcode/pipeline";
import { isInsideWindow } from "@rawkoon/api/services/transcode/queueMath";
import type {
  ClaimedJob,
  TranscodeRepo,
} from "@rawkoon/api/services/transcode/repo";
import { recoverSwap } from "@rawkoon/api/services/transcode/swap";

export interface TranscodeNotifier {
  jobFailed(job: ClaimedJob, error: string): Promise<void>;
  batchFinished(
    job: ClaimedJob,
    s: {
      done: number;
      failed: number;
      savedBytes: bigint;
      pendingSeedBytes: bigint;
    },
  ): Promise<void>;
}

const TICK_MS = 10_000;
const PERSIST_MS = 15_000;

export class TranscodeDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: {
    id: number;
    abort: AbortController;
    live: TranscodeLiveProgress | null;
  } | null = null;
  private busy: Promise<void> | null = null;

  constructor(
    private repo: TranscodeRepo,
    private deps: PipelineDeps,
    private notifier: TranscodeNotifier,
    private now: () => Date = () => new Date(),
    private defaultThreads: () => number = () => Math.max(1, cpus().length - 2),
  ) {}

  start(): void {
    if (this.timer) return;
    void this.recover()
      .catch((e) => console.error("[transcode] boot recovery failed:", e))
      .finally(() => {
        this.timer = setInterval(() => void this.tick(), TICK_MS);
      });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running?.abort.abort();
    await this.busy;
  }

  runningJobId(): number | null {
    return this.running?.id ?? null;
  }

  live(jobId: number): TranscodeLiveProgress | null {
    return this.running?.id === jobId ? this.running.live : null;
  }

  cancel(jobId: number): boolean {
    if (this.running?.id !== jobId) return false;
    this.running.abort.abort();
    return true;
  }

  async recover(): Promise<void> {
    for (const job of await this.repo.runningJobs()) {
      if (job.source) {
        const src = this.deps.mapPath(job.source.dbPath);
        const verify = async (p: string) => {
          try {
            await this.deps.probe(p);
            return true;
          } catch {
            return false;
          }
        };
        const h =
          job.settings.resolution === "keep" ? null : job.settings.resolution;
        await recoverSwap({
          source: src,
          final: finalPathFor(src, h),
          fs: this.deps.fs,
          verify,
        }).catch((e) =>
          console.error(`[transcode] recoverSwap failed for job ${job.id}:`, e),
        );
        await this.deps.fs.unlink(tmpPathFor(src)).catch(() => {});
      }
      await this.repo.requeue(job.id);
    }
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    const settings = await this.repo.getSettings();
    if (settings.paused) return;
    if (
      settings.window_enabled &&
      !isInsideWindow(this.now(), settings.window_start, settings.window_end)
    )
      return;
    const job = await this.repo.claimNext();
    if (!job) return;
    this.busy = this.execute(
      job,
      settings.cpu_threads ?? this.defaultThreads(),
      {
        avg: settings.ssim_threshold,
        min: settings.ssim_clip_min,
      },
    ).finally(() => {
      this.busy = null;
      this.running = null;
    });
    await this.busy;
  }

  private async execute(
    job: ClaimedJob,
    threads: number,
    thresholds: { avg: number; min: number },
  ): Promise<void> {
    const abort = new AbortController();
    this.running = { id: job.id, abort, live: null };
    let lastPersist = 0;
    // PipelineDeps.rescan takes one argument; the file id travels in the token (split in index.ts).
    const deps: PipelineDeps = {
      ...this.deps,
      rescan: (finalDbPath) =>
        this.deps.rescan(`${job.mediaFileId}|${finalDbPath}`),
    };
    const result = job.source
      ? await runPipeline(
          {
            id: job.id,
            settings: job.settings,
            estimatedBytes: job.estimatedBytes,
            source: job.source,
          },
          deps,
          {
            onStep: (step) =>
              void this.repo.markStep(job.id, step).catch(() => {}),
            onProgress: (p) => {
              if (this.running) this.running.live = p;
              if (Date.now() - lastPersist > PERSIST_MS) {
                lastPersist = Date.now();
                void this.repo.saveProgress(job.id, p.progress).catch(() => {});
              }
            },
          },
          { signal: abort.signal, threads, thresholds },
        )
      : ({
          ok: false,
          cancelled: false,
          error: "File no longer in library",
        } as const);

    await this.repo.finish(job.id, result);
    if (!result.ok && !result.cancelled)
      await this.notifier.jobFailed(job, result.error).catch(() => {});
    if ((await this.repo.batchRemaining(job.batchId)) === 0) {
      await this.notifier
        .batchFinished(job, await this.repo.batchSummary(job.batchId))
        .catch(() => {});
    }
  }
}
