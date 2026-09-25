import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  TranscodeExcludedFile,
  TranscodeJob,
  TranscodeJobSettings,
  TranscodeJobStatus,
  TranscodeQueueSettings,
  TranscodeSelection,
  TranscodeSummary,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { roughEstimate } from "@rawkoon/api/services/transcode/estimate";
import { transcodeDispatcher } from "@rawkoon/api/services/transcode/index";
import {
  blockToTop,
  isInsideWindow,
  positionBetween,
} from "@rawkoon/api/services/transcode/queueMath";
import { loadQueueSettings } from "@rawkoon/api/services/transcode/repo";
import { resolveEligible } from "@rawkoon/api/services/transcode/estimateService";

type Row = Prisma.TranscodeJobGetPayload<{ include: typeof withPoster }>;

function toJob(r: Row): TranscodeJob {
  return {
    id: r.id,
    media_file_id: r.mediaFileId,
    media_id: r.mediaId,
    batch_id: r.batchId,
    title: r.title,
    position: r.position,
    status: r.status as TranscodeJobStatus,
    step: (r.step as TranscodeJob["step"]) ?? null,
    settings: r.settings as unknown as TranscodeJobSettings,
    source_bytes: String(r.sourceBytes),
    estimated_bytes: r.estimatedBytes != null ? String(r.estimatedBytes) : null,
    output_bytes: r.outputBytes != null ? String(r.outputBytes) : null,
    source_nlink: r.sourceNlink,
    progress: r.progress,
    ssim_avg: r.ssimAvg,
    ssim_min: r.ssimMin,
    error: r.error,
    created_at: r.createdAt.toISOString(),
    started_at: r.startedAt?.toISOString() ?? null,
    finished_at: r.finishedAt?.toISOString() ?? null,
    poster_url: r.media?.posterUrl ?? null,
    live: transcodeDispatcher.live(r.id),
  };
}

const withPoster = { media: { select: { posterUrl: true } } } as const;

export async function enqueueSelection(
  sel: TranscodeSelection,
  settings: TranscodeJobSettings,
) {
  const { eligible, excluded } = await resolveEligible(sel, settings);
  const batchId = randomUUID();
  const tail = await prisma.transcodeJob.aggregate({
    where: { status: "queued" },
    _max: { position: true },
  });
  let pos = tail._max.position ?? 0;
  const created: number[] = [];
  const skipped: TranscodeExcludedFile[] = [...excluded];
  for (const { file, probe } of eligible) {
    pos += 1;
    try {
      const row = await prisma.transcodeJob.create({
        data: {
          mediaFileId: file.id,
          mediaId: file.mediaId,
          batchId,
          title: file.title,
          position: pos,
          settings: settings as object,
          sourceBytes: file.sizeBytes,
          estimatedBytes: roughEstimate(probe, settings).totalBytes,
        },
      });
      created.push(row.id);
    } catch {
      // Partial unique index: another request queued this file first.
      skipped.push({
        file_id: file.id,
        title: file.title,
        reason: "Already queued",
      });
    }
  }
  return { batch_id: batchId, count: created.length, excluded: skipped };
}

export async function listJobs(
  statuses: TranscodeJobStatus[],
  since?: Date,
): Promise<TranscodeJob[]> {
  const rows = await prisma.transcodeJob.findMany({
    where: {
      status: { in: statuses },
      ...(since
        ? { OR: [{ finishedAt: null }, { finishedAt: { gte: since } }] }
        : {}),
    },
    include: withPoster,
    orderBy: statuses.every((s) => s === "queued" || s === "running")
      ? { position: "asc" }
      : { finishedAt: "desc" },
    take: 1000,
  });
  return rows.map(toJob);
}

export async function cancelOrRemove(
  id: number,
): Promise<"cancelled" | "removed" | "not_found" | "finished"> {
  const row = await prisma.transcodeJob.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) return "not_found";
  if (row.status === "running")
    return transcodeDispatcher.cancel(id) ? "cancelled" : "not_found";
  if (row.status !== "queued") return "finished";
  // Conditional so a claim that lands between the read and this write is not overwritten.
  const r = await prisma.transcodeJob.updateMany({
    where: { id, status: "queued" },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  if (r.count === 1) return "removed";
  return transcodeDispatcher.cancel(id) ? "cancelled" : "finished";
}

export async function removeBatch(batchId: string): Promise<number> {
  const r = await prisma.transcodeJob.updateMany({
    where: { batchId, status: "queued" },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  return r.count;
}

export async function moveJob(
  id: number,
  body: { top?: true; before_id?: number; after_id?: number },
): Promise<boolean> {
  const row = await prisma.transcodeJob.findUnique({
    where: { id },
    select: { status: true },
  });
  if (row?.status !== "queued") return false;
  let pos: number;
  if (body.top) {
    const min = await prisma.transcodeJob.aggregate({
      where: { status: "queued" },
      _min: { position: true },
    });
    pos = positionBetween(null, min._min.position ?? 1);
  } else {
    const anchorId = (body.before_id ?? body.after_id)!;
    const anchor = await prisma.transcodeJob.findUnique({
      where: { id: anchorId },
      select: { position: true, status: true },
    });
    if (anchor?.status !== "queued") return false;
    const neighbour = await prisma.transcodeJob.findFirst({
      where: {
        status: "queued",
        id: { not: id },
        position: body.before_id
          ? { lt: anchor.position }
          : { gt: anchor.position },
      },
      orderBy: { position: body.before_id ? "desc" : "asc" },
      select: { position: true },
    });
    pos = body.before_id
      ? positionBetween(neighbour?.position ?? null, anchor.position)
      : positionBetween(anchor.position, neighbour?.position ?? null);
  }
  await prisma.transcodeJob.update({ where: { id }, data: { position: pos } });
  return true;
}

export async function moveBatchTop(batchId: string): Promise<number> {
  const rows = await prisma.transcodeJob.findMany({
    where: { batchId, status: "queued" },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const min = await prisma.transcodeJob.aggregate({
    where: { status: "queued" },
    _min: { position: true },
  });
  const positions = blockToTop(min._min.position ?? null, rows.length);
  await prisma.$transaction(
    rows.map((r, i) =>
      prisma.transcodeJob.update({
        where: { id: r.id },
        data: { position: positions[i] },
      }),
    ),
  );
  return rows.length;
}

export async function retryJob(id: number): Promise<boolean> {
  const row = await prisma.transcodeJob.findUnique({
    where: { id },
    select: { status: true },
  });
  if (row?.status !== "failed" && row?.status !== "cancelled") return false;
  const tail = await prisma.transcodeJob.aggregate({
    where: { status: "queued" },
    _max: { position: true },
  });
  try {
    await prisma.transcodeJob.update({
      where: { id },
      data: {
        status: "queued",
        position: (tail._max.position ?? 0) + 1,
        error: null,
        step: null,
        progress: null,
        startedAt: null,
        finishedAt: null,
        outputBytes: null,
        ssimAvg: null,
        ssimMin: null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearHistory(): Promise<number> {
  const r = await prisma.transcodeJob.deleteMany({
    where: { status: { in: ["done", "failed", "cancelled"] } },
  });
  return r.count;
}

export async function purgeOldHistory(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  await prisma.transcodeJob.deleteMany({
    where: {
      status: { in: ["done", "failed", "cancelled"] },
      finishedAt: { lt: cutoff },
    },
  });
}

export async function updateQueueSettings(
  p: Partial<TranscodeQueueSettings>,
): Promise<TranscodeQueueSettings> {
  await loadQueueSettings();
  await prisma.transcodeSettings.update({
    where: { id: 1 },
    data: {
      paused: p.paused,
      windowEnabled: p.window_enabled,
      windowStart: p.window_start,
      windowEnd: p.window_end,
      ssimThreshold: p.ssim_threshold,
      ssimClipMin: p.ssim_clip_min,
      cpuThreads: p.cpu_threads,
    },
  });
  return loadQueueSettings();
}

export async function buildSummary(): Promise<TranscodeSummary> {
  await purgeOldHistory();
  const settings = await loadQueueSettings();
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since24 = new Date(Date.now() - 86_400_000);
  const [active, done, failedCount, recent] = await Promise.all([
    prisma.transcodeJob.findMany({
      where: { status: { in: ["running", "queued"] } },
      include: withPoster,
      orderBy: { position: "asc" },
    }),
    prisma.transcodeJob.findMany({
      where: { status: "done", finishedAt: { gte: since30 } },
      select: { sourceBytes: true, outputBytes: true, sourceNlink: true },
    }),
    prisma.transcodeJob.count({
      where: { status: "failed", finishedAt: { gte: since30 } },
    }),
    prisma.transcodeJob.count({ where: { finishedAt: { gte: since24 } } }),
  ]);
  const running = active.find((j) => j.status === "running") ?? null;
  const queued = active.filter((j) => j.status === "queued");
  let saved = 0n,
    pending = 0n;
  for (const d of done) {
    if (d.outputBytes == null) continue;
    const diff = d.sourceBytes - d.outputBytes;
    if ((d.sourceNlink ?? 1) > 1) pending += diff;
    else saved += diff;
  }
  const inWindow =
    !settings.window_enabled ||
    isInsideWindow(new Date(), settings.window_start, settings.window_end);
  const state = running
    ? "running"
    : settings.paused
      ? "paused"
      : queued.length && !inWindow
        ? "waiting_window"
        : queued.length
          ? "running"
          : "idle";
  const eta = queued.reduce(
    (t, j) => t + Math.round(Number(j.sourceBytes) / 25_000_000),
    0,
  );
  return {
    show: active.length > 0 || recent > 0,
    state,
    window_start: settings.window_start,
    current: running ? toJob(running) : null,
    next: queued.slice(0, 2).map(toJob),
    queued_count: queued.length,
    queued_source_bytes: String(queued.reduce((t, j) => t + j.sourceBytes, 0n)),
    queued_eta_secs: eta,
    saved_bytes_30d: String(saved),
    done_count_30d: done.length,
    frees_after_seeding_bytes: String(pending),
    failed_count: failedCount,
  };
}
