import { stat as statFile, rename as renameFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { prisma } from "@rawkoon/api/db";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";
import { renderMovieTemplate } from "@rawkoon/api/utils/medias/fileTemplate";

export type FreshFileMeta = {
  resolution: number | null;
  source: string | null;
  videoCodec: string | null;
};

type RenameFile = {
  id: number;
  fileName: string;
  filePath: string;
  resolution: number | null;
  source: string | null;
  videoCodec: string | null;
};

/** Rename movie files that don't match the configured template; returns how many. */
export async function renameFilesToTemplate({
  media,
  mediaSettings,
  mediaId,
  files,
  toDeleteIds,
  freshMeta,
}: {
  media: { type: string; title: string; year: number | null };
  mediaSettings: {
    fileOperation: string;
    movieTemplate: string;
  } | null;
  mediaId: number;
  files: RenameFile[];
  toDeleteIds: number[];
  freshMeta: Map<number, FreshFileMeta>;
}): Promise<number> {
  let renamed = 0;
  if (
    mediaSettings &&
    media.type === "movie" &&
    mediaSettings.fileOperation !== "none" &&
    media.title
  ) {
    const activeDownloads = await prisma.downloadHistory.count({
      where: { mediaId, completedAt: null, failed: false },
    });
    if (activeDownloads === 0) {
      const survivingFiles = files.filter((f) => !toDeleteIds.includes(f.id));
      // Track destination paths claimed within this loop so two files
      // resolving to the same template stem don't clobber each other.
      const claimedTargets = new Set<string>();
      for (const file of survivingFiles) {
        const ext = extname(file.fileName);
        // Prefer post-rescan MediaInfo over the pre-update row, which may
        // hold stale or null values for resolution/source/codec.
        const fresh = freshMeta.get(file.id);
        const resolution = fresh?.resolution ?? file.resolution;
        const source = fresh?.source ?? file.source;
        const codec = fresh?.videoCodec ?? file.videoCodec;
        const res = resolution != null ? `${resolution}p` : null;
        const expectedStem = renderMovieTemplate(mediaSettings.movieTemplate, {
          title: media.title,
          year: media.year ?? null,
          resolution: res,
          source: source ?? null,
          codec: codec ?? null,
          ext: ext.slice(1),
        });
        const currentStem = file.fileName.slice(0, -ext.length);
        if (expectedStem === currentStem) continue;

        const newFileName = expectedStem + ext;
        const diskFrom = remapPath(file.filePath);
        const diskTo = join(dirname(diskFrom), newFileName);

        // Skip if another file in this same rescan already claimed the
        // target, or if a different file already exists on disk at it —
        // fs.rename on POSIX silently overwrites and we'd lose data.
        if (claimedTargets.has(diskTo)) continue;
        try {
          await statFile(diskTo);
          // Target already exists on disk — refuse to overwrite.
          continue;
        } catch {
          // ENOENT — safe to proceed.
        }

        await renameFile(diskFrom, diskTo);
        claimedTargets.add(diskTo);
        await prisma.mediaFile.update({
          where: { id: file.id },
          data: {
            filePath: join(dirname(file.filePath), newFileName),
            fileName: newFileName,
          },
        });
        renamed++;
      }
    }
  }
  return renamed;
}
