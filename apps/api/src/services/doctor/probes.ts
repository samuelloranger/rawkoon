import {
  access,
  constants,
  lstat,
  readdir,
  stat,
  statfs,
} from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@rawkoon/api/db";
import { describeError } from "@rawkoon/api/utils/describeError";
import { buildLibraryInodeKeySet } from "@rawkoon/api/services/downloads/downloadsScanner";
import { normalizeInode } from "@rawkoon/api/utils/medias/fileFingerprint";
import type { DownloadEntry } from "./orphanedDownloads";
import type { PathProbe } from "./paths";

/** The library-relevant slice of mediaSettings (row id = 1). */
export interface LibrarySettings {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
  booksLibraryPath: string | null;
  audiobooksLibraryPath: string | null;
  downloadsPath: string | null;
  fileOperation: string;
  minFreeSpaceGb: number;
}

export async function readLibrarySettings(): Promise<LibrarySettings> {
  const row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  return {
    moviesLibraryPath: row?.moviesLibraryPath ?? null,
    showsLibraryPath: row?.showsLibraryPath ?? null,
    booksLibraryPath: row?.booksLibraryPath ?? null,
    audiobooksLibraryPath: row?.audiobooksLibraryPath ?? null,
    downloadsPath: row?.downloadsPath ?? null,
    fileOperation: row?.fileOperation ?? "hardlink",
    // 0 (row absent) disables the free-space guard, like grabSpaceCheck.
    minFreeSpaceGb: row?.minFreeSpaceGb ?? 0,
  };
}

/** stat + fs.access facts for one path; absence is a finding, not an error. */
export async function probePath(path: string): Promise<PathProbe> {
  try {
    const info = await stat(path);
    let readableAndWritable = true;
    try {
      await access(path, constants.R_OK | constants.W_OK);
    } catch {
      readableAndWritable = false;
    }
    return {
      exists: true,
      isDirectory: info.isDirectory(),
      readableAndWritable,
      error: null,
    };
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return {
        exists: false,
        isDirectory: false,
        readableAndWritable: false,
        error: null,
      };
    }
    return {
      exists: false,
      isDirectory: false,
      readableAndWritable: false,
      error: describeError(error),
    };
  }
}

/** stat().dev for hardlink support, or null when the path can't be stat'ed. */
export async function statDevice(path: string): Promise<number | null> {
  try {
    return (await stat(path)).dev;
  } catch {
    return null;
  }
}

export interface FreeBytesProbe {
  freeBytes: number | null;
  error: string | null;
}

/** statfs free bytes; null + error text when the volume can't be measured. */
export async function statFreeBytes(path: string): Promise<FreeBytesProbe> {
  try {
    const info = await statfs(path);
    return {
      freeBytes: Number(info.bavail) * Number(info.bsize),
      error: null,
    };
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return { freeBytes: null, error: null };
    }
    return { freeBytes: null, error: describeError(error) };
  }
}

/**
 * Every inode the library knows, without the device: mergerfs and remounts change st_dev,
 * so a stored dev goes stale while the inode stays. A cross-filesystem inode clash can only hide an orphan.
 */
export async function readLibraryInodes(): Promise<Set<string>> {
  const keys = new Set(
    [...(await buildLibraryInodeKeySet())].map((k) =>
      k.slice(k.indexOf(":") + 1),
    ),
  );
  const books = await prisma.bookFile.findMany({
    where: { fileIno: { not: null } },
    select: { fileIno: true },
  });
  for (const row of books) {
    const ino = normalizeInode(BigInt(row.fileIno!));
    if (ino !== null) keys.add(ino);
  }
  return keys;
}

type Walked = Pick<
  DownloadEntry,
  "sizeBytes" | "newestMtimeMs" | "linkedToLibrary" | "unreadable"
>;

const code = (error: unknown) => (error as { code?: unknown }).code;

/** null: the path vanished mid-walk. Unreadable paths come back flagged, never as errors. */
async function walk(
  path: string,
  inodes: ReadonlySet<string>,
  deadlineMs: number,
): Promise<Walked | null> {
  if (Date.now() > deadlineMs) throw new Error("downloads scan timed out");
  const total: Walked = {
    sizeBytes: 0,
    newestMtimeMs: 0,
    linkedToLibrary: false,
    unreadable: false,
  };
  try {
    const info = await lstat(path, { bigint: true });
    total.newestMtimeMs = Number(info.mtimeMs);
    if (!info.isDirectory()) {
      total.sizeBytes = Number(info.size);
      total.linkedToLibrary =
        info.nlink > 1n && inodes.has(normalizeInode(info.ino) ?? "?");
      return total;
    }
    for (const child of await readdir(path)) {
      const sub = await walk(join(path, child), inodes, deadlineMs);
      if (!sub) continue;
      total.sizeBytes += sub.sizeBytes;
      total.newestMtimeMs = Math.max(total.newestMtimeMs, sub.newestMtimeMs);
      total.linkedToLibrary ||= sub.linkedToLibrary;
      total.unreadable ||= sub.unreadable;
    }
    return total;
  } catch (error) {
    if (code(error) === "ENOENT") return null;
    if (error instanceof Error && error.message.endsWith("timed out")) {
      throw error;
    }
    // EACCES, EPERM and anything else: unknown, so never reported as an orphan.
    return { ...total, unreadable: true };
  }
}

/** Top-level entries of the downloads folder with size, freshness and library-link facts. */
export async function scanDownloads(
  downloadsPath: string,
  inodes: ReadonlySet<string>,
  deadlineMs: number,
): Promise<DownloadEntry[]> {
  const names = (await readdir(downloadsPath)).filter(
    (name) => !name.startsWith(".") && name.toLowerCase() !== "incomplete",
  );
  const entries: DownloadEntry[] = [];
  for (const name of names) {
    const walked = await walk(join(downloadsPath, name), inodes, deadlineMs);
    if (walked) entries.push({ name, ...walked });
  }
  return entries;
}
