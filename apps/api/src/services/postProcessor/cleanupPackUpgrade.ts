import { unlink } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";

/** Remove replaced episode files only after the upgraded file has been recorded. */
export async function cleanupPackUpgrade(opts: {
  mediaId: number;
  episodeId: number;
  destinationPath: string;
}): Promise<void> {
  const oldFiles = await prisma.mediaFile.findMany({
    where: {
      mediaId: opts.mediaId,
      episodeId: opts.episodeId,
      filePath: { not: opts.destinationPath },
    },
    select: { id: true, filePath: true },
  });
  const removed: number[] = [];
  for (const old of oldFiles) {
    const owners = await prisma.mediaFile.findMany({
      where: { filePath: old.filePath },
      select: { mediaId: true, episodeId: true },
    });
    const shared = owners.some(
      (owner) =>
        owner.mediaId !== opts.mediaId || owner.episodeId !== opts.episodeId,
    );
    if (!shared) {
      try {
        await unlink(old.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(
            `[postProcess/pack] Could not remove replaced file ${old.filePath}:`,
            error,
          );
          continue;
        }
      }
    }
    // A shared file stays on disk for its other owner; only this episode's row goes.
    removed.push(old.id);
  }
  if (removed.length) {
    await prisma.mediaFile.deleteMany({ where: { id: { in: removed } } });
  }
}
