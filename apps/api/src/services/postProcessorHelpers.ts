import { copyFile, link, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";

export function qualityStringsFromParsed(
  qualityParsed: unknown,
  releaseTitle: string,
): { resolution: string | null; source: string | null; codec: string | null } {
  if (qualityParsed && typeof qualityParsed === "object") {
    const q = qualityParsed as Record<string, unknown>;
    const res = q.resolution;
    const resolution =
      typeof res === "number"
        ? `${res}p`
        : typeof res === "string"
          ? res
          : null;
    const source = typeof q.source === "string" ? q.source : null;
    const codec = typeof q.codec === "string" ? q.codec : null;
    if (resolution || source || codec) return { resolution, source, codec };
  }
  const p = parseReleaseTitle(releaseTitle);
  return {
    resolution: p.resolution ? `${p.resolution}p` : null,
    source: p.source,
    codec: p.codec,
  };
}

export function resolveTorrentContentPath(
  contentPath: string | null | undefined,
  savePath: string | null | undefined,
  torrentName: string,
): string | null {
  const cp = contentPath?.trim();
  if (cp) {
    if (isAbsolute(cp)) return cp;
    const sp = savePath?.replace(/\/+$/, "") ?? "";
    if (sp) return join(sp, cp);
    return cp;
  }
  const sp = savePath?.replace(/\/+$/, "");
  if (sp && torrentName) return join(sp, torrentName);
  return null;
}

async function ensureDestinationDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function asInodeParts(st: import("node:fs").Stats): {
  dev: number;
  ino: number;
} {
  const devUnknown = st.dev as unknown;
  const inoUnknown = st.ino as unknown;
  return {
    dev:
      typeof devUnknown === "bigint"
        ? Number(devUnknown)
        : Number(devUnknown as number),
    ino:
      typeof inoUnknown === "bigint"
        ? Number(inoUnknown)
        : Number(inoUnknown as number),
  };
}

function inodeMatch(
  a: { dev: number; ino: number },
  b: { dev: number; ino: number },
): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

export async function placeFile(
  src: string,
  dst: string,
  operation: "hardlink" | "move",
): Promise<void> {
  try {
    const dstStat = await stat(dst);
    const srcStat = await stat(src);
    const dstIno = asInodeParts(dstStat);
    const srcIno = asInodeParts(srcStat);
    if (inodeMatch(dstIno, srcIno)) {
      console.warn(
        `[postProcess] Destination already exists and is the same file, skipping: ${dst}`,
      );
      return;
    }
    throw new Error(
      `Destination file already exists and is different from source: ${dst}`,
    );
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("Destination file already exists")
    ) {
      throw e;
    }
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[postProcess] stat destination failed (${dst}):`, e);
    }
    // absent — proceed
  }

  await ensureDestinationDir(dst);

  if (operation === "move") {
    try {
      await rename(src, dst);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        await copyFile(src, dst);
        await unlink(src);
      } else {
        throw e;
      }
    }
    return;
  }

  try {
    await link(src, dst);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      await copyFile(src, dst);
    } else {
      throw e;
    }
  }
}

export async function markItemDownloaded(dh: {
  media: { id: number; type: string; tmdbStatus: string | null };
  episode: { id: number } | null;
}): Promise<void> {
  if (dh.episode) {
    await prisma.libraryEpisode.update({
      where: { id: dh.episode.id },
      data: { status: "downloaded", downloadedAt: new Date() },
    });
  } else {
    await prisma.libraryMedia.update({
      where: { id: dh.media.id },
      data: {
        status: resolveDownloadedStatus(dh.media.type, dh.media.tmdbStatus),
      },
    });
  }
}

/** Parse season and episode numbers from a video filename. */
export function parseSeasonEpisode(
  filename: string,
): { season: number; episode: number } | null {
  const m = filename.match(/S(\d{1,2})E(\d{1,3})/i);
  if (!m) return null;
  return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
}
