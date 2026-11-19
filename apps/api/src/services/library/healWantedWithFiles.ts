import { prisma } from "@rawkoon/api/db";
import { targetHasFileOnDisk } from "@rawkoon/api/services/library/targetHasFileOnDisk";

const BATCH = 200;

/** Movies and episodes left "wanted" while a library file is actually on disk go back to downloaded. */
export async function healWantedWithFiles(): Promise<number> {
  const where = { status: "wanted", files: { some: {} } };
  const [movies, episodes] = await Promise.all([
    prisma.libraryMedia.findMany({
      where: { ...where, type: "movie" },
      select: { id: true },
      take: BATCH,
    }),
    prisma.libraryEpisode.findMany({
      where,
      select: { id: true, mediaId: true },
      take: BATCH,
    }),
  ]);
  // A stale row for a deleted file must not flip the item back and stop searches.
  const onDisk = async <T>(
    rows: T[],
    target: (row: T) => { mediaId: number; episodeId: number | null },
  ) => {
    const flags = await Promise.all(
      rows.map((row) => targetHasFileOnDisk(target(row))),
    );
    return rows.filter((_, i) => flags[i]);
  };
  const [movieHits, episodeHits] = await Promise.all([
    onDisk(movies, (m) => ({ mediaId: m.id, episodeId: null })),
    onDisk(episodes, (e) => ({ mediaId: e.mediaId, episodeId: e.id })),
  ]);
  const data = { status: "downloaded" };
  const [m, e] = await Promise.all([
    prisma.libraryMedia.updateMany({
      where: { id: { in: movieHits.map((r) => r.id) }, status: "wanted" },
      data,
    }),
    prisma.libraryEpisode.updateMany({
      where: { id: { in: episodeHits.map((r) => r.id) }, status: "wanted" },
      data,
    }),
  ]);
  return m.count + e.count;
}
