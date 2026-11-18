import { access, constants, stat, statfs } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";
import { describeError } from "./describeError";
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
