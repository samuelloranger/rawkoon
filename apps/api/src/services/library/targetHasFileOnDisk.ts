import { stat } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";

/** True when a movie or single episode already has a library file on disk. */
export async function targetHasFileOnDisk(target: {
  mediaId: number | null;
  episodeId: number | null;
}): Promise<boolean> {
  const files = await prisma.mediaFile.findMany({
    where:
      target.episodeId != null
        ? { episodeId: target.episodeId }
        : { mediaId: target.mediaId, episodeId: null },
    select: { filePath: true },
  });
  for (const f of files) {
    try {
      await stat(f.filePath);
      return true;
    } catch {
      // Missing file: the import will treat this target as empty.
    }
  }
  return false;
}

/** The status a reopened movie or episode takes: a file on disk means it is still downloaded. */
export async function reopenedStatus(
  target: Parameters<typeof targetHasFileOnDisk>[0],
): Promise<"wanted" | "downloaded"> {
  return (await targetHasFileOnDisk(target)) ? "downloaded" : "wanted";
}
