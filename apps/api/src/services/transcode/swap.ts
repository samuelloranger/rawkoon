import {
  access,
  constants,
  copyFile,
  link,
  open,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { origPathFor } from "@rawkoon/api/services/transcode/outputPath";

export interface SwapFs {
  rename(from: string, to: string): Promise<void>;
  /** Fails with EEXIST when `to` exists; never overwrites. */
  link(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string, exclusive?: boolean): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number | null>;
  fsync(path: string): Promise<void>;
}

export const nodeSwapFs: SwapFs = {
  rename,
  link,
  copyFile: (from, to, exclusive) =>
    copyFile(from, to, exclusive ? constants.COPYFILE_EXCL : 0),
  unlink,
  exists: async (p) => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
  size: async (p) => {
    try {
      return (await stat(p)).size;
    } catch {
      return null;
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

export function partPathFor(finalPath: string): string {
  return join(dirname(finalPath), `.${basename(finalPath)}.rawkoon-part`);
}

async function quietUnlink(fs: SwapFs, p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    /* already gone */
  }
}

function code(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException).code;
}

const EXISTS = "Destination already exists";

/** Put `from` at `final` without ever replacing a file that is already there. */
async function placeNew(
  fs: SwapFs,
  from: string,
  final: string,
  verify: (p: string) => Promise<boolean>,
): Promise<void> {
  try {
    await fs.link(from, final);
    return;
  } catch (e) {
    if (code(e) === "EEXIST") throw new Error(EXISTS);
    if (code(e) !== "EXDEV") throw e;
  }
  if (await fs.exists(final)) throw new Error(EXISTS);
  // Copy under a name only this job uses, then link it into place (same branch, so no EXDEV).
  const part = partPathFor(final);
  await quietUnlink(fs, part);
  try {
    await fs.copyFile(from, part, true);
    await fs.fsync(part);
    if (!(await verify(part)))
      throw new Error("Copied file failed verification");
    await fs.link(part, final);
  } catch (e) {
    await quietUnlink(fs, part);
    if (code(e) === "EEXIST") throw new Error(EXISTS);
    throw e;
  }
  await quietUnlink(fs, part);
}

export async function swapInPlace(o: {
  tmp: string;
  source: string;
  final: string;
  fs: SwapFs;
  verify: (p: string) => Promise<boolean>;
}): Promise<void> {
  const { tmp, source, final, fs } = o;
  if (final !== source) {
    await placeNew(fs, tmp, final, o.verify);
    await quietUnlink(fs, tmp);
    await quietUnlink(fs, source);
    return;
  }
  try {
    await fs.rename(tmp, final);
    return;
  } catch (e) {
    if (code(e) !== "EXDEV") throw e;
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
  tmp: string;
  fs: SwapFs;
  verify: (p: string) => Promise<boolean>;
}): Promise<"none" | "kept-final" | "restored-orig"> {
  const { source, final, tmp, fs } = o;
  await quietUnlink(fs, partPathFor(final));
  const orig = origPathFor(source);
  if (!(await fs.exists(orig))) return "none";
  // orig outlives tmp in swapInPlace, so while tmp exists the copy is only trusted if it is byte-complete.
  const tmpSize = await fs.size(tmp);
  const finalSize = await fs.size(final);
  const complete = tmpSize == null ? finalSize != null : finalSize === tmpSize;
  if (complete && (await o.verify(final))) {
    await quietUnlink(fs, orig);
    return "kept-final";
  }
  await quietUnlink(fs, final);
  await fs.rename(orig, source);
  return "restored-orig";
}
