import { cpus } from "node:os";
import type { TranscodeLiveProgress } from "@rawkoon/shared/types";
import {
  finalPathFor,
  tmpPathFor,
} from "@rawkoon/api/services/transcode/outputPath";
import {
  type PipelineDeps,
  type PipelineResult,
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
  private shuttingDown = false;

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
    // A restart re-queues the running job; the pipeline ignores the abort once replace has started.
    this.shuttingDown = true;
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
      try {
        if (job.source && (await this.recoverFiles(job))) continue;
        await this.repo.requeue(job.id);
      } catch (e) {
        console.error(`[transcode] recovery failed for job ${job.id}:`, e);
      }
    }
  }

  /** Returns true when the job's output was already in place and has been registered. */
  private async recoverFiles(job: ClaimedJob): Promise<boolean> {
    const source = job.source!;
    const { fs } = this.deps;
    const src = this.deps.mapPath(source.dbPath);
    const tmp = tmpPathFor(src);
    const h =
      job.settings.resolution === "keep" ? null : job.settings.resolution;
    const final = finalPathFor(src, h);
    const probeOk = async (path: string) => {
      try {
        return await this.deps.probe(path);
      } catch {
        return null;
      }
    };
    const swap = await recoverSwap({
      source: src,
      final,
      tmp,
      fs,
      verify: async (x) => (await probeOk(x)) != null,
    });

    let swapped = false;
    if (
      swap !== "restored-orig" &&
      (job.step === "replace" || job.step === "rescan") &&
      (await fs.exists(final))
    ) {
      const out = await probeOk(final);
      if (out?.video?.codec === job.settings.codec) {
        if (final === src) {
          const live = await this.deps.fingerprint(src);
          swapped =
            swap === "kept-final" ||
            !live ||
            live.sizeBytes !== source.sizeBytes;
        } else {
          const tmpSize = await fs.size(tmp);
          const ours =
            tmpSize != null
              ? (await fs.size(final)) === tmpSize
              : !(await fs.exists(src));
          if (ours) {
            await fs.unlink(src).catch(() => {});
            swapped = true;
          }
        }
        if (swapped) {
          await this.deps.rescan(
            `${job.mediaFileId}|${finalPathFor(source.dbPath, h)}`,
          );
          await this.repo.finish(job.id, {
            ok: true,
            outputBytes: out.sizeBytes,
            nlink: 1,
            finalDbPath: final,
          });
        }
      }
    }
    await fs.unlink(tmp).catch(() => {});
    return swapped;
  }

  async tick(): Promise<void> {
    try {
      await this.tickOnce();
    } catch (e) {
      console.error("[transcode] tick failed:", e);
    }
  }

  private async tickOnce(): Promise<void> {
    if (this.busy || this.shuttingDown) return;
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
            // Awaited so "replace" is durable before the swap; boot recovery keys off it.
            onStep: (step) => this.repo.markStep(job.id, step).catch(() => {}),
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

    try {
      if (!result.ok && result.cancelled && this.shuttingDown) {
        await this.repo.requeue(job.id);
        return;
      }
      await this.repo.finish(job.id, result);
    } catch (e) {
      console.error(
        `[transcode] could not record the result of job ${job.id}:`,
        e,
      );
      return;
    }
    // Notifications enqueue through Valkey, which can block while it is down; never hold the queue for them.
    void this.notify(job, result).catch((e) =>
      console.warn("[transcode] notification failed:", e),
    );
  }

  private async notify(job: ClaimedJob, result: PipelineResult): Promise<void> {
    if (!result.ok && !result.cancelled)
      await this.notifier.jobFailed(job, result.error);
    if ((await this.repo.batchRemaining(job.batchId)) === 0) {
      await this.notifier.batchFinished(
        job,
        await this.repo.batchSummary(job.batchId),
      );
    }
  }
}
