import { parseReleaseStructure } from "@rawkoon/shared/utils/releaseStructure";
import {
  copyFile,
  link,
  mkdir,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";
import {
  removeStalePartials,
  withPartial,
} from "@rawkoon/api/utils/medias/partialFile";

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

/**
 * Inode identity as exact decimal strings. Coercing a mergerfs inode to Number
 * rounds it, so two distinct files could compare equal and a placement would
 * be silently skipped as "already the same file".
 */
function asInodeParts(st: import("node:fs").BigIntStats): {
  dev: string;
  ino: string;
} {
  return { dev: st.dev.toString(), ino: st.ino.toString() };
}

function inodeMatch(
  a: { dev: string; ino: string },
  b: { dev: string; ino: string },
): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Copy into a hidden file beside `dst`, then rename it into place, so a copy
 * cut short (the process killed mid-way) never leaves a partial file at a
 * path that a retry would take for a finished import.
 */
export async function copyFileAtomic(src: string, dst: string): Promise<void> {
  await removeStalePartials(dst);
  // Unique per attempt, so a failed attempt never removes another's copy.
  await withPartial(dst, async (partial) => {
    try {
      await copyFile(src, partial);
      await rename(partial, dst);
    } catch (e) {
      await unlink(partial).catch(() => {});
      throw e;
    }
  });
}

export async function placeFile(
  src: string,
  dst: string,
  operation: "hardlink" | "move",
): Promise<void> {
  try {
    const dstStat = await stat(dst, { bigint: true });
    const srcStat = await stat(src, { bigint: true });
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
        await copyFileAtomic(src, dst);
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
      await copyFileAtomic(src, dst);
    } else {
      throw e;
    }
  }
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Rename, falling back to copy and delete across devices. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await copyFileAtomic(from, to);
    await unlink(from);
  }
}

/** Whether two paths are the same file on disk; a hardlink counts. */
export async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([
      stat(a, { bigint: true }),
      stat(b, { bigint: true }),
    ]);
    return inodeMatch(asInodeParts(sa), asInodeParts(sb));
  } catch {
    return false;
  }
}

/**
 * Place `src` at `dst` over an existing file. The new file lands beside the
 * old one first and is then renamed over it, so the library is never left
 * without a copy.
 */
export async function replaceFile(
  src: string,
  dst: string,
  operation: "hardlink" | "move",
): Promise<void> {
  if (await isSameFile(src, dst)) return;
  let tmp = join(dirname(dst), `.${basename(dst)}.rawkoon-upgrade`);
  if (await exists(tmp)) {
    // A leftover from an interrupted replace may be the only copy of a release:
    // drop it only when it is just another link to this source.
    if (await isSameFile(tmp, src)) await unlink(tmp);
    else tmp = `${tmp}-${Date.now()}`;
  }
  await placeFile(src, tmp, operation);
  try {
    await rename(tmp, dst);
  } catch (e) {
    // A moved source is only at tmp now: put it back rather than delete it.
    await (operation === "move" ? moveFile(tmp, src) : unlink(tmp)).catch(
      (cleanupError) =>
        console.warn(`[postProcess] Could not clean up ${tmp}:`, cleanupError),
    );
    throw e;
  }
}

export async function markItemDownloaded(dh: {
  media: { id: number };
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
      data: { status: "downloaded" },
    });
  }
}

const NOT_AN_EPISODE = /\b(?:sample|trailer)\b/i;
// Only checked for season-less names: "Extras" is also a real show title.
const BONUS_CONTENT =
  /\b(?:extras?|featurettes?|bonus|nc(?:op|ed)|creditless)\b/i;

/** `season` is null when the file only carries an episode (absolute numbering, typical of anime). */
export function parseSeasonEpisode(
  filename: string,
): { season: number | null; episode: number } | null {
  if (NOT_AN_EPISODE.test(filename)) return null;
  const { season, episodes } = parseReleaseStructure(filename);
  if (season !== null && episodes.length > 0) {
    return { season, episode: episodes[0] };
  }
  if (BONUS_CONTENT.test(filename)) return null;
  if (episodes.length > 0) return { season: null, episode: episodes[0] };
  const abs =
    filename.match(/\b(?:E|Ep|Episode)[\s._-]?(\d{1,4})\b/i) ??
    filename.match(/\s-\s(\d{1,4})(?:v\d)?(?=[\s.[(]|$)/);
  if (!abs) return null;
  const episode = parseInt(abs[1], 10);
  // A bare 4-digit number in that spot is far more often a year than an episode.
  if (episode >= 1900 && episode <= 2099) return null;
  return { season: null, episode };
}

/**
 * Whether a content tree could be read end to end. An empty import is only the
 * release's fault when this holds — a missing mount or a permission error is not.
 */
export async function isFullyReadable(
  root: string,
  maxEntries = 20_000,
): Promise<boolean> {
  const queue = [root];
  let seen = 0;
  while (queue.length > 0 && seen < maxEntries) {
    const current = queue.shift() as string;
    seen += 1;
    try {
      const st = await stat(current);
      if (!st.isDirectory()) continue;
      for (const entry of await readdir(current))
        queue.push(join(current, entry));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Put a release's file at its library path. A different file already there is
 * only replaced by an upgrade. Returns whether the release's file is now at
 * `dst` as a copy separate from the download.
 */
export async function placeImportFile(
  src: string,
  dst: string,
  operation: "hardlink" | "move",
  isUpgrade: boolean,
): Promise<boolean> {
  if (!(await exists(dst))) {
    await placeFile(src, dst, operation);
    return true;
  }
  if (await isSameFile(src, dst)) {
    // A download that already sits at its library path is not a separate copy.
    return (await realpath(src)) !== (await realpath(dst));
  }
  if (!isUpgrade) return false;
  await replaceFile(src, dst, operation);
  return true;
}
