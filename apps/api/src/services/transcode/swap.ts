import { access, copyFile, open, rename, unlink } from "node:fs/promises";
import { origPathFor } from "@rawkoon/api/services/transcode/outputPath";

export interface SwapFs {
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  fsync(path: string): Promise<void>;
}

export const nodeSwapFs: SwapFs = {
  rename,
  copyFile,
  unlink,
  exists: async (p) => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
  fsync: async (p) => {
    const fh = await open(p, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  },
};

async function quietUnlink(fs: SwapFs, p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    /* already gone */
  }
}

export async function swapInPlace(o: {
  tmp: string;
  source: string;
  final: string;
  fs: SwapFs;
  verify: (p: string) => Promise<boolean>;
}): Promise<void> {
  const { tmp, source, final, fs } = o;
  try {
    await fs.rename(tmp, final);
    if (final !== source) await quietUnlink(fs, source);
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
  }
  // Union filesystems can place tmp on another branch; keep the original reachable until the copy is proven.
  const orig = origPathFor(source);
  await fs.rename(source, orig);
  try {
    await fs.copyFile(tmp, final);
    await fs.fsync(final);
    if (!(await o.verify(final)))
      throw new Error("Copied file failed verification");
  } catch (err) {
    if (final !== source || (await fs.exists(final)))
      await quietUnlink(fs, final);
    await fs.rename(orig, source);
    throw err;
  }
  await quietUnlink(fs, orig);
  await quietUnlink(fs, tmp);
}

export async function recoverSwap(o: {
  source: string;
  final: string;
  fs: SwapFs;
  verify: (p: string) => Promise<boolean>;
}): Promise<"none" | "kept-final" | "restored-orig"> {
  const { source, final, fs } = o;
  const orig = origPathFor(source);
  if (!(await fs.exists(orig))) return "none";
  if ((await fs.exists(final)) && (await o.verify(final))) {
    await quietUnlink(fs, orig);
    return "kept-final";
  }
  await quietUnlink(fs, final);
  await fs.rename(orig, source);
  return "restored-orig";
}
