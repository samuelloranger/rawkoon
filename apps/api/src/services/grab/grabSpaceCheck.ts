import { statfs } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";
import { deriveDownloadsScanRoots } from "@rawkoon/api/services/downloads/downloadsScanner";

export const SPACE_REFUSAL_PREFIX = "Not enough free space";

// GiB, though the setting and UI call it GB.
const GB = 1024 ** 3;

/**
 * Refuse a grab that would leave less than the configured free space on the
 * volume the download lands on. Returns a reason when refused, null otherwise.
 * Monitoring failures (no path, statfs error) never block a grab.
 */
export async function checkFreeSpaceForGrab(opts: {
  mediaType: string;
  sizeBytes: number | null | undefined;
}): Promise<string | null> {
  const size = opts.sizeBytes;
  if (!size || !Number.isFinite(size) || size <= 0) return null;

  try {
    const settings = await prisma.mediaSettings.findUnique({
      where: { id: 1 },
    });
    const minFreeGb = settings?.minFreeSpaceGb ?? 0;
    if (!settings || minFreeGb <= 0) return null;

    // Same roots the downloads scanner uses: the configured downloads path, else
    // the parent of this media type's library path.
    const isMovie = opts.mediaType === "movie";
    const roots = deriveDownloadsScanRoots({
      downloadsPath: settings.downloadsPath,
      moviesLibraryPath: isMovie ? settings.moviesLibraryPath : null,
      showsLibraryPath: isMovie ? null : settings.showsLibraryPath,
    });
    const path = roots[0];
    if (!path) return null;

    const fs = await statfs(path);
    const freeBytes = Number(fs.bavail) * Number(fs.bsize);
    if (freeBytes - size >= minFreeGb * GB) return null;

    return `${SPACE_REFUSAL_PREFIX}: needs ${fmtGb(size)} GB, ${fmtGb(freeBytes)} GB free, keeping ${minFreeGb} GB`;
  } catch (e) {
    console.warn("[mediaGrabber] free-space check failed, allowing grab:", e);
    return null;
  }
}

function fmtGb(bytes: number): string {
  return (bytes / GB).toFixed(1);
}
