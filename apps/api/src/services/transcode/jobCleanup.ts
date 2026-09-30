import { prisma } from "@rawkoon/api/db";
import type { ManualReleaseResult } from "@rawkoon/api/services/seeding/seedSweep";
import { releaseTorrentNow } from "@rawkoon/api/services/seeding/seedSweep";
import { transcodeDispatcher } from "@rawkoon/api/services/transcode/index";
import { tmpPathFor } from "@rawkoon/api/services/transcode/outputPath";
import { nodeSwapFs, type SwapFs } from "@rawkoon/api/services/transcode/swap";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";

export type FreeSourceResult =
  | { status: "ok"; torrents: number; freedBytes: number; skipped: number }
  | { status: "not_found" | "not_done" };

export interface FreeSourceDeps {
  loadJob(id: number): Promise<{
    status: string;
    mediaId: number | null;
    episodeId: number | null;
  } | null>;
  heldHashes(mediaId: number, episodeId: number | null): Promise<string[]>;
  release(hash: string): Promise<ManualReleaseResult>;
}

const defaultFreeDeps: FreeSourceDeps = {
  loadJob: async (id) => {
    const row = await prisma.transcodeJob.findUnique({
      where: { id },
      select: {
        status: true,
        mediaId: true,
        mediaFile: { select: { episodeId: true } },
      },
    });
    return row
      ? {
          status: row.status,
          mediaId: row.mediaId,
          episodeId: row.mediaFile?.episodeId ?? null,
        }
      : null;
  },
  heldHashes: async (mediaId, episodeId) => {
    const rows = await prisma.downloadHistory.findMany({
      where: {
        mediaId,
        // A season pack row has no episode of its own; it still holds this file.
        ...(episodeId != null
          ? { OR: [{ episodeId }, { episodeId: null }] }
          : {}),
        completedAt: { not: null },
        failed: false,
        seedReleasedAt: null,
        torrentHash: { not: null },
      },
      select: { torrentHash: true },
    });
    return [
      ...new Set(
        rows.flatMap((r) =>
          r.torrentHash ? [r.torrentHash.trim().toLowerCase()] : [],
        ),
      ),
    ];
  },
  release: (hash) => releaseTorrentNow(hash),
};

/**
 * "Free space" on a finished re-encode: remove the torrents still holding the
 * old file from the download client, deleting their data unless another
 * torrent shares it. The library copy is a hardlink, so it stays. Torrents the
 * user added themselves are left alone (counted as skipped).
 */
export async function freeSeededSource(
  jobId: number,
  deps: FreeSourceDeps = defaultFreeDeps,
): Promise<FreeSourceResult> {
  const job = await deps.loadJob(jobId);
  if (!job) return { status: "not_found" };
  if (job.status !== "done" || job.mediaId == null)
    return { status: "not_done" };
  let torrents = 0;
  let freedBytes = 0;
  let skipped = 0;
  for (const hash of await deps.heldHashes(job.mediaId, job.episodeId)) {
    const r = await deps.release(hash);
    if (r.status === "released") {
      torrents++;
      freedBytes += r.freedBytes ?? 0;
    } else {
      skipped++;
    }
  }
  return { status: "ok", torrents, freedBytes, skipped };
}

export type DiscardResult =
  | { status: "ok"; freedBytes: number }
  | { status: "not_found" | "not_failed" | "busy" };

export interface DiscardDeps {
  loadJob(id: number): Promise<{
    status: string;
    mediaFileId: number | null;
    filePath: string | null;
  } | null>;
  encodingFileId(): number | null;
  fs: Pick<SwapFs, "size" | "unlink">;
  mapPath(path: string): string;
  deleteRow(id: number): Promise<void>;
}

const defaultDiscardDeps: DiscardDeps = {
  loadJob: async (id) => {
    const row = await prisma.transcodeJob.findUnique({
      where: { id },
      select: {
        status: true,
        mediaFileId: true,
        mediaFile: { select: { filePath: true } },
      },
    });
    return row
      ? {
          status: row.status,
          mediaFileId: row.mediaFileId,
          filePath: row.mediaFile?.filePath ?? null,
        }
      : null;
  },
  encodingFileId: () => transcodeDispatcher.encodingFileId(),
  fs: nodeSwapFs,
  mapPath: remapPath,
  deleteRow: async (id) => {
    await prisma.transcodeJob.delete({ where: { id } });
  },
};

/**
 * Deletes a failed or cancelled re-encode from the history along with the
 * partial output it left next to the source. Never touches the source or a
 * finished output.
 */
export async function discardFailedJob(
  jobId: number,
  deps: DiscardDeps = defaultDiscardDeps,
): Promise<DiscardResult> {
  const job = await deps.loadJob(jobId);
  if (!job) return { status: "not_found" };
  if (job.status !== "failed" && job.status !== "cancelled")
    return { status: "not_failed" };
  let freedBytes = 0;
  if (job.filePath) {
    // Another job encoding this file owns that temp file right now.
    if (job.mediaFileId != null && deps.encodingFileId() === job.mediaFileId)
      return { status: "busy" };
    const tmp = tmpPathFor(deps.mapPath(job.filePath));
    const size = await deps.fs.size(tmp);
    if (size != null) {
      await deps.fs.unlink(tmp);
      freedBytes = size;
    }
  }
  await deps.deleteRow(jobId);
  return { status: "ok", freedBytes };
}
