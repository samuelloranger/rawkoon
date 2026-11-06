import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@rawkoon/api/db";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";

/** Include configured host-path aliases when checking who still owns a disk file. */
function pathAliases(stored: string, disk: string): string[] {
  const aliases = new Set([stored, disk]);
  const mappings = [
    [Bun.env.MEDIA_PATH_FROM, Bun.env.MEDIA_PATH_TO],
    ...(Bun.env.MEDIA_PATH_REMAP ?? "")
      .split(",")
      .map((pair) => pair.split(":")),
  ];
  for (const [from, to] of mappings) {
    if (!from || !to || !disk.startsWith(to)) continue;
    const candidate = from + disk.slice(to.length);
    if (resolve(remapPath(candidate)) === disk) aliases.add(candidate);
  }
  return [...aliases];
}

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
  const destination = resolve(remapPath(opts.destinationPath));
  for (const old of oldFiles) {
    const diskPath = resolve(remapPath(old.filePath));
    const owners = await prisma.mediaFile.findMany({
      where: { filePath: { in: pathAliases(old.filePath, diskPath) } },
      select: { mediaId: true, episodeId: true },
    });
    const shared = owners.some(
      (owner) =>
        owner.mediaId !== opts.mediaId || owner.episodeId !== opts.episodeId,
    );
    if (!shared && diskPath !== destination) {
      try {
        await unlink(diskPath);
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
