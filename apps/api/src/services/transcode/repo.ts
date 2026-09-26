import type {
  TranscodeJobSettings,
  TranscodeQueueSettings,
  TranscodeStep,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import type {
  PipelineResult,
  PipelineSource,
} from "@rawkoon/api/services/transcode/pipeline";

export interface ClaimedJob {
  id: number;
  batchId: string;
  title: string;
  mediaId: number | null;
  mediaFileId: number | null;
  settings: TranscodeJobSettings;
  estimatedBytes: bigint | null;
  step: string | null;
  source: PipelineSource | null;
}

export interface TranscodeRepo {
  getSettings(): Promise<TranscodeQueueSettings>;
  claimNext(): Promise<ClaimedJob | null>;
  runningJobs(): Promise<ClaimedJob[]>;
  requeue(id: number): Promise<void>;
  markStep(id: number, step: TranscodeStep): Promise<void>;
  saveProgress(id: number, progress: number): Promise<void>;
  finish(id: number, r: PipelineResult): Promise<void>;
  batchRemaining(batchId: string): Promise<number>;
  batchSummary(batchId: string): Promise<{
    done: number;
    failed: number;
    savedBytes: bigint;
    pendingSeedBytes: bigint;
  }>;
}

export async function loadQueueSettings(): Promise<TranscodeQueueSettings> {
  const s = await prisma.transcodeSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  return {
    paused: s.paused,
    window_enabled: s.windowEnabled,
    window_start: s.windowStart,
    window_end: s.windowEnd,
    ssim_threshold: s.ssimThreshold,
    ssim_clip_min: s.ssimClipMin,
    cpu_threads: s.cpuThreads,
  };
}

const jobInclude = {
  mediaFile: {
    select: {
      filePath: true,
      sizeBytes: true,
      fileMtimeMs: true,
      fileDev: true,
      fileIno: true,
    },
  },
} as const;

type JobRow = Awaited<ReturnType<typeof loadJob>>;

function loadJob(id: number) {
  return prisma.transcodeJob.findUnique({ where: { id }, include: jobInclude });
}

function toClaimed(row: NonNullable<JobRow>): ClaimedJob {
  const f = row.mediaFile;
  return {
    id: row.id,
    batchId: row.batchId,
    title: row.title,
    mediaId: row.mediaId,
    mediaFileId: row.mediaFileId,
    settings: row.settings as unknown as TranscodeJobSettings,
    estimatedBytes: row.estimatedBytes,
    step: row.step,
    source: f
      ? {
          dbPath: f.filePath,
          sizeBytes: f.sizeBytes,
          fileMtimeMs: f.fileMtimeMs,
          fileDev: f.fileDev,
          fileIno: f.fileIno,
        }
      : null,
  };
}

export const prismaTranscodeRepo: TranscodeRepo = {
  getSettings: loadQueueSettings,

  async claimNext() {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      UPDATE transcode_jobs SET status = 'running', step = 'preflight', started_at = now(), progress = 0, error = NULL
      WHERE id = (
        SELECT id FROM transcode_jobs WHERE status = 'queued'
        ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (!rows[0]) return null;
    const row = await loadJob(rows[0].id);
    return row ? toClaimed(row) : null;
  },

  async runningJobs() {
    const rows = await prisma.transcodeJob.findMany({
      where: { status: "running" },
      include: jobInclude,
    });
    return rows.map(toClaimed);
  },

  async requeue(id) {
    await prisma.transcodeJob.update({
      where: { id },
      data: { status: "queued", step: null, progress: null, startedAt: null },
    });
  },

  async markStep(id, step) {
    await prisma.transcodeJob.update({ where: { id }, data: { step } });
  },

  async saveProgress(id, progress) {
    await prisma.transcodeJob.update({ where: { id }, data: { progress } });
  },

  async finish(id, r) {
    const base = {
      finishedAt: new Date(),
      step: null,
      sourceNlink: r.nlink ?? null,
      ssimAvg: r.ssimAvg ?? null,
      ssimMin: r.ssimMin ?? null,
    };
    if (r.ok) {
      await prisma.transcodeJob.update({
        where: { id },
        data: {
          ...base,
          status: "done",
          progress: 1,
          outputBytes: r.outputBytes,
          error: null,
        },
      });
    } else {
      await prisma.transcodeJob.update({
        where: { id },
        data: {
          ...base,
          status: r.cancelled ? "cancelled" : "failed",
          error: r.error,
        },
      });
    }
  },

  async batchRemaining(batchId) {
    return prisma.transcodeJob.count({
      where: { batchId, status: { in: ["queued", "running"] } },
    });
  },

  async batchSummary(batchId) {
    const rows = await prisma.transcodeJob.findMany({
      where: { batchId, status: { in: ["done", "failed"] } },
      select: {
        status: true,
        sourceBytes: true,
        outputBytes: true,
        sourceNlink: true,
      },
    });
    let savedBytes = 0n;
    let pendingSeedBytes = 0n;
    for (const r of rows) {
      if (r.status !== "done" || r.outputBytes == null) continue;
      const diff = r.sourceBytes - r.outputBytes;
      if ((r.sourceNlink ?? 1) > 1) pendingSeedBytes += diff;
      else savedBytes += diff;
    }
    return {
      done: rows.filter((r) => r.status === "done").length,
      failed: rows.filter((r) => r.status === "failed").length,
      savedBytes,
      pendingSeedBytes,
    };
  },
};
