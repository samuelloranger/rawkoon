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

/** Every (dev:ino) the library knows, from the cached stat of each media and book file. */
export async function readLibraryInodes(): Promise<Set<string>> {
  const where = { fileDev: { not: null }, fileIno: { not: null } };
  const select = { fileDev: true, fileIno: true };
  const [media, books] = await Promise.all([
    prisma.mediaFile.findMany({ where, select }),
    prisma.bookFile.findMany({ where, select }),
  ]);
  return new Set(
    [...media, ...books].map((row) => `${row.fileDev}:${row.fileIno}`),
  );
}

async function walk(
  path: string,
  inodes: ReadonlySet<string>,
): Promise<
  Pick<DownloadEntry, "sizeBytes" | "newestMtimeMs" | "linkedToLibrary">
> {
  const info = await lstat(path, { bigint: true });
  let sizeBytes = 0;
  let newestMtimeMs = Number(info.mtimeMs);
  let linkedToLibrary = false;
  if (info.isDirectory()) {
    for (const child of await readdir(path)) {
      const sub = await walk(join(path, child), inodes);
      sizeBytes += sub.sizeBytes;
      newestMtimeMs = Math.max(newestMtimeMs, sub.newestMtimeMs);
      linkedToLibrary ||= sub.linkedToLibrary;
    }
  } else {
    sizeBytes = Number(info.size);
    linkedToLibrary = info.nlink > 1n && inodes.has(`${info.dev}:${info.ino}`);
  }
  return { sizeBytes, newestMtimeMs, linkedToLibrary };
}

/** Top-level entries of the downloads folder with size, freshness and library-link facts. */
export async function scanDownloads(
  downloadsPath: string,
  inodes: ReadonlySet<string>,
): Promise<DownloadEntry[]> {
  const names = (await readdir(downloadsPath)).filter(
    (name) => !name.startsWith(".") && name.toLowerCase() !== "incomplete",
  );
  return Promise.all(
    names.map(async (name) => ({
      name,
      ...(await walk(join(downloadsPath, name), inodes)),
    })),
  );
}
