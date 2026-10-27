import { statfs } from "node:fs/promises";

import { prisma } from "@rawkoon/api/db";
import { buildLibraryStatsResponse } from "@rawkoon/api/routes/library/libraryStats";

/**
 * Capacity/free bytes of the volume holding the library, or nulls when no path
 * is configured or it can't be read. Movies and shows usually share one volume,
 * so the movies path (then shows) is enough for a headline figure.
 */
async function readDiskUsage(): Promise<{
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
}> {
  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  const path =
    settings?.moviesLibraryPath?.trim() || settings?.showsLibraryPath?.trim();
  if (!path) return { disk_total_bytes: null, disk_free_bytes: null };
  try {
    const fs = await statfs(path);
    return {
      disk_total_bytes: Number(fs.blocks * fs.bsize),
      disk_free_bytes: Number(fs.bavail * fs.bsize),
    };
  } catch {
    return { disk_total_bytes: null, disk_free_bytes: null };
  }
}

export async function getLibraryStatsWithDisk(): Promise<
  ReturnType<typeof buildLibraryStatsResponse> &
    Awaited<ReturnType<typeof readDiskUsage>>
> {
  const [typeStatusRows, tmdbStatusRows, files, disk] = await Promise.all([
    prisma.libraryMedia.groupBy({
      by: ["type", "status"],
      _count: true,
    }),
    prisma.libraryMedia.groupBy({
      by: ["tmdbStatus"],
      where: { type: "show" },
      _count: true,
    }),
    // ::bigint — SUM(bigint) yields NUMERIC, which Prisma maps to Decimal;
    // Decimal leaking into buildLibraryStatsResponse's bigint arithmetic
    // corrupts the storage total (digit concatenation, then the
    // MAX_SAFE_INTEGER clamp shows ~8192 TB).
    prisma.$queryRaw<{ resolution: number | null; size_bytes: bigint }[]>`
      SELECT resolution, SUM(size_bytes)::bigint AS size_bytes
      FROM media_files
      GROUP BY resolution
    `,
    readDiskUsage(),
  ]);

  const stats = buildLibraryStatsResponse({
    byTypeStatus: typeStatusRows.map((r) => ({
      type: r.type,
      status: r.status,
      count: r._count,
    })),
    byTmdbStatus: tmdbStatusRows.map((r) => ({
      tmdb_status: r.tmdbStatus,
      count: r._count,
    })),
    files: files.map((f) => ({
      resolution: f.resolution,
      size_bytes: f.size_bytes,
    })),
  });

  return { ...stats, ...disk };
}

export async function listLanguageTags(): Promise<string[]> {
  const rows = await prisma.$queryRaw<
    { tag: string }[]
  >`SELECT DISTINCT UNNEST(language_tags) AS tag FROM media_files`;
  const tags = rows.map((r) => r.tag).filter(Boolean);
  const order: Record<string, number> = {
    EN: 0,
    VFQ: 1,
    VFF: 2,
    VFI: 3,
    FR: 4,
  };
  tags.sort((a, b) => {
    const ai = order[a] ?? 100;
    const bi = order[b] ?? 100;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
  return tags;
}
