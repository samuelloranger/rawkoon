import type {
  ClipFailedItem,
  ClipKind,
  ClipProgress,
  ClipSettings,
  ClipSummary,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { assertClipsRootSafe } from "@rawkoon/api/services/clips/clipGuard";
import {
  clampStart,
  sourceKeyFor,
} from "@rawkoon/api/services/clips/clipPipeline";
import {
  deleteAllClipFiles,
  ClipStoreError,
  deleteClip,
  sweepOrphans,
  sweepStaleTemps,
} from "@rawkoon/api/services/clips/clipStore";

// Lazy: queueService opens Valkey connections, and importing it at load would drag them into every route test.
const queue = async () =>
  (await import("@rawkoon/api/services/queueService")).clipsQueue;

const STALE_RUNNING_MS = 30 * 60_000;
const STALE_TEMP_MS = 60 * 60_000;

export async function loadClipSettings(): Promise<ClipSettings> {
  const s = await prisma.clipSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  return { enabled: s.enabled, paused: s.paused };
}

/** Pausing the queue stops dequeuing; a running encode finishes. */
export async function syncQueuePause(): Promise<void> {
  const { paused } = await loadClipSettings();
  const q = await queue();
  if (paused) await q.pause();
  else await q.resume();
}

/**
 * At boot no encode can be running yet (the worker lives in this process), so a row still marked
 * running was cut short by a restart: it goes back in line now instead of after the stale timeout.
 */
export async function requeueInterruptedClips(): Promise<number> {
  const { count } = await prisma.previewClip.updateMany({
    where: { status: "running" },
    data: { status: "queued" },
  });
  if (count > 0 && (await loadClipSettings()).enabled) await enqueueQueued();
  return count;
}

/** Throws ClipSafetyError (nothing is changed) when enabling with an unsafe clips folder. */
export async function updateClipSettings(patch: {
  enabled?: boolean;
  paused?: boolean;
}): Promise<ClipSettings> {
  const before = await loadClipSettings();
  if (patch.enabled && !before.enabled) await assertClipsRootSafe();
  const s = await prisma.clipSettings.update({ where: { id: 1 }, data: patch });
  await syncQueuePause();
  if (s.enabled && !before.enabled) await reconcileClips();
  return { enabled: s.enabled, paused: s.paused };
}

export async function enqueueClip(clipId: number): Promise<void> {
  await (await queue()).add("cut", { clipId }, { jobId: `clip-${clipId}` });
}

async function enqueueQueued(): Promise<void> {
  const rows = await prisma.previewClip.findMany({
    where: { status: "queued" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const r of rows) await enqueueClip(r.id);
}

type Wanted = {
  kind: ClipKind;
  mediaId: number;
  seasonNumber: number;
  sourceMediaFileId: number;
  sourceKey: string;
};

async function wantedClips(): Promise<Wanted[]> {
  const out: Wanted[] = [];
  const movieFiles = await prisma.mediaFile.findMany({
    where: { episodeId: null, media: { type: "movie" } },
    select: { id: true, mediaId: true, filePath: true },
    orderBy: { id: "asc" },
  });
  const seenMovies = new Set<number>();
  for (const f of movieFiles) {
    if (f.mediaId === null || seenMovies.has(f.mediaId)) continue;
    seenMovies.add(f.mediaId);
    out.push({
      kind: "movie",
      mediaId: f.mediaId,
      seasonNumber: 0,
      sourceMediaFileId: f.id,
      sourceKey: sourceKeyFor(f.filePath),
    });
  }
  const seasonFiles = await prisma.mediaFile.findMany({
    where: { episode: { season: { gte: 1 } } },
    select: {
      id: true,
      filePath: true,
      episode: { select: { mediaId: true, season: true, episode: true } },
    },
    orderBy: [{ episode: { episode: "asc" } }, { id: "asc" }],
  });
  const seen = new Set<string>();
  for (const f of seasonFiles) {
    if (!f.episode) continue;
    const k = `${f.episode.mediaId}:${f.episode.season}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      kind: "season",
      mediaId: f.episode.mediaId,
      seasonNumber: f.episode.season,
      sourceMediaFileId: f.id,
      sourceKey: sourceKeyFor(f.filePath),
    });
  }
  return out;
}

/**
 * Brings clips in line with the library: queues new movies and seasons, requeues
 * clips whose source file was replaced, deletes clips of departed titles, then
 * sweeps orphan and stale temp files. No-op while disabled.
 */
export async function reconcileClips(): Promise<void> {
  const settings = await loadClipSettings();
  if (!settings.enabled) return;
  await assertClipsRootSafe();

  const wanted = await wantedClips();
  const existing = await prisma.previewClip.findMany();
  const have = new Map(
    existing.map((c) => [`${c.mediaId}:${c.seasonNumber}`, c]),
  );

  const fresh = wanted.filter(
    (w) => !have.has(`${w.mediaId}:${w.seasonNumber}`),
  );
  if (fresh.length > 0) {
    await prisma.previewClip.createMany({
      data: fresh.map((w) => ({
        kind: w.kind,
        mediaId: w.mediaId,
        seasonNumber: w.seasonNumber,
        sourceMediaFileId: w.sourceMediaFileId,
        sourceKey: w.sourceKey,
      })),
      skipDuplicates: true,
    });
  }

  const wantedByKey = new Map(
    wanted.map((w) => [`${w.mediaId}:${w.seasonNumber}`, w]),
  );
  // A title that is only between files keeps its clip. Movie clips go with their LibraryMedia row (FK cascade, orphan sweep);
  // a season clip goes once the season has no episodes left in the library.
  const seasonsLeft = new Set(
    (
      await prisma.libraryEpisode.findMany({
        where: { season: { gte: 1 } },
        distinct: ["mediaId", "season"],
        select: { mediaId: true, season: true },
      })
    ).map((e) => `${e.mediaId}:${e.season}`),
  );
  for (const c of existing) {
    if (
      c.kind === "season" &&
      // A clip being cut is left for the next pass, so its publish never lands on a deleted row.
      c.status !== "running" &&
      !seasonsLeft.has(`${c.mediaId}:${c.seasonNumber}`)
    ) {
      // The row goes after the file, so a failed delete is retried next sweep.
      try {
        await deleteClip(c.id);
      } catch (e) {
        // A non-plain file is never forced; drop the row and let it sit.
        if (!(e instanceof ClipStoreError)) throw e;
        console.warn(
          `[clips] left a non-plain file for clip ${c.id}: ${e.message}`,
        );
      }
      await prisma.previewClip.deleteMany({ where: { id: c.id } });
    }
  }

  // Upgrade rule: re-cut at the stored start only when the source row is gone or its path changed.
  const sources = await prisma.mediaFile.findMany({
    where: {
      id: {
        in: existing.flatMap((c) =>
          c.sourceMediaFileId ? [c.sourceMediaFileId] : [],
        ),
      },
    },
    select: { id: true, filePath: true },
  });
  const sourceById = new Map(sources.map((s) => [s.id, s.filePath]));
  for (const c of existing) {
    if (
      c.status !== "done" ||
      !wantedByKey.has(`${c.mediaId}:${c.seasonNumber}`)
    )
      continue;
    const path =
      c.sourceMediaFileId === null
        ? undefined
        : sourceById.get(c.sourceMediaFileId);
    if (path === undefined || sourceKeyFor(path) !== c.sourceKey) {
      await prisma.previewClip.update({
        where: { id: c.id },
        data: { status: "queued" },
      });
    }
  }

  await prisma.previewClip.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) },
    },
    data: { status: "queued" },
  });

  await sweepOrphans(
    async () =>
      new Set(
        (await prisma.previewClip.findMany({ select: { id: true } })).map(
          (r) => r.id,
        ),
      ),
  );
  await sweepStaleTemps(STALE_TEMP_MS);
  await enqueueQueued();
}

export async function retryFailed(): Promise<number> {
  const { count } = await prisma.previewClip.updateMany({
    where: { status: "failed" },
    data: { status: "queued", error: null },
  });
  if ((await loadClipSettings()).enabled) await enqueueQueued();
  return count;
}

/** Only while disabled, so no encode can be writing into the folder being emptied. */
export async function deleteAllClips(): Promise<
  | { ok: true; files: number; bytes: number }
  | { ok: false; reason: "enabled" | "running" }
> {
  if ((await loadClipSettings()).enabled)
    return { ok: false, reason: "enabled" };
  // A job started before disabling may still be encoding into the folder.
  if ((await prisma.previewClip.count({ where: { status: "running" } })) > 0) {
    return { ok: false, reason: "running" };
  }
  await assertClipsRootSafe();
  const removed = await deleteAllClipFiles();
  await prisma.previewClip.deleteMany();
  return { ok: true, files: removed.files, bytes: removed.bytes };
}

export async function recutClip(
  id: number,
  startSec: number,
): Promise<"ok" | "not_found" | "running" | "disabled"> {
  if (!(await loadClipSettings()).enabled) return "disabled";
  const clip = await prisma.previewClip.findUnique({ where: { id } });
  if (!clip) return "not_found";
  if (clip.status === "running") return "running";
  const source = clip.sourceMediaFileId
    ? await prisma.mediaFile.findUnique({
        where: { id: clip.sourceMediaFileId },
        select: { durationSecs: true },
      })
    : null;
  await prisma.previewClip.update({
    where: { id },
    data: {
      status: "queued",
      error: null,
      manualStart: true,
      startSec: source?.durationSecs
        ? clampStart(startSec, source.durationSecs)
        : startSec,
    },
  });
  await enqueueClip(id);
  return "ok";
}

const toSummary = (c: {
  id: number;
  kind: string;
  mediaId: number;
  seasonNumber: number;
  status: string;
  startSec: number | null;
  manualStart: boolean;
  bytes: number | null;
  error: string | null;
  updatedAt: Date;
}): ClipSummary => ({
  id: c.id,
  kind: c.kind as ClipSummary["kind"],
  media_id: c.mediaId,
  season_number: c.seasonNumber,
  status: c.status as ClipSummary["status"],
  start_sec: c.startSec,
  manual_start: c.manualStart,
  bytes: c.bytes,
  error: c.error,
  updated_at: c.updatedAt.toISOString(),
});

export async function clipsForMedia(mediaId: number): Promise<ClipSummary[]> {
  const rows = await prisma.previewClip.findMany({
    where: { mediaId },
    orderBy: { seasonNumber: "asc" },
  });
  return rows.map(toSummary);
}

/** The clip a TV card maps to; a show without a season gets season 1. */
export async function findClipByTmdb(
  tmdbId: number,
  type: "movie" | "show",
  season: number | undefined,
) {
  return prisma.previewClip.findFirst({
    where: {
      kind: type === "movie" ? "movie" : "season",
      seasonNumber: type === "movie" ? 0 : (season ?? 1),
      bytes: { not: null },
      media: { tmdbId, type },
    },
    select: { id: true },
  });
}

export async function getClipProgress(): Promise<ClipProgress> {
  const [settings, groups, sum, running, failed, recent] = await Promise.all([
    loadClipSettings(),
    prisma.previewClip.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.previewClip.aggregate({ _sum: { bytes: true } }),
    prisma.previewClip.findFirst({
      where: { status: "running" },
      include: { media: { select: { title: true } } },
    }),
    prisma.previewClip.findMany({
      where: { status: "failed" },
      include: { media: { select: { title: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.previewClip.findMany({
      where: {
        status: "done",
        startedAt: { not: null },
        finishedAt: { not: null },
      },
      select: { startedAt: true, finishedAt: true },
      orderBy: { finishedAt: "desc" },
      take: 20,
    }),
  ]);
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const left = n("queued") + n("running");
  const durations = recent.map(
    (r) => (r.finishedAt!.getTime() - r.startedAt!.getTime()) / 1000,
  );
  const avg = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;
  const item = (c: NonNullable<typeof running>) => ({
    clip_id: c.id,
    kind: c.kind as ClipKind,
    title: c.media.title,
    season_number: c.kind === "season" ? c.seasonNumber : null,
  });
  return {
    settings,
    done: n("done"),
    left,
    failed: n("failed"),
    total_bytes: sum._sum.bytes ?? 0,
    running: running ? item(running) : null,
    eta_seconds: avg === null || left === 0 ? null : Math.round(avg * left),
    failed_items: failed.map(
      (c): ClipFailedItem => ({ ...item(c), error: c.error }),
    ),
  };
}
