/**
 * The only module allowed to create, rename or delete clip files. Every path is
 * built here from a numeric id; nothing outside it passes a path to a mutator.
 * Never recursive, never derived from a media path (see the preview-clips design).
 */
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const CLIP_NAME = /^clip-(\d+)(\.tmp-\d+)?\.mp4$/;
const FINAL_NAME = /^clip-(\d+)\.mp4$/;

export class ClipStoreError extends Error {}
/** The clips folder or file does not exist: there is simply no clip. */
class ClipMissingError extends ClipStoreError {}

/** Sibling of the image store, so it sits on the app data volume and never on the media pool. */
export function clipsRoot(): string {
  return join(
    dirname(resolve(Bun.env.IMAGE_STORAGE_DIR || "./data/images")),
    "clips",
  );
}

export function assertClipId(id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new ClipStoreError("Invalid clip id");
  }
}

export function clipFileName(id: number): string {
  assertClipId(id);
  return `clip-${id}.mp4`;
}

export function tempFileName(id: number, nonce: number = Date.now()): string {
  assertClipId(id);
  if (!Number.isSafeInteger(nonce) || nonce < 0)
    throw new ClipStoreError("Invalid nonce");
  return `clip-${id}.tmp-${nonce}.mp4`;
}

// Per-clip lock: re-cut, delete and orphan cleanup never race on one id.
const locks = new Map<number, Promise<unknown>>();
export async function withClipLock<T>(
  id: number,
  fn: () => Promise<T>,
): Promise<T> {
  assertClipId(id);
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  try {
    return await run;
  } finally {
    if (locks.get(id) === tail) locks.delete(id);
  }
}

/** Resolves a clip basename to a path, re-checking containment against the real root on every call. */
async function contained(name: string): Promise<string> {
  if (basename(name) !== name || !CLIP_NAME.test(name)) {
    throw new ClipStoreError("Not a clip file name");
  }
  const lexicalRoot = clipsRoot();
  const path = join(lexicalRoot, name);
  let realRoot: string;
  let realParent: string;
  try {
    [realRoot, realParent] = await Promise.all([
      realpath(lexicalRoot),
      realpath(dirname(path)),
    ]);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new ClipMissingError("Clips folder does not exist");
    throw e;
  }
  if (realRoot !== realParent)
    throw new ClipStoreError("Clip path escapes the clips root");
  return path;
}

/** Output path ffmpeg may write: a fresh temp name inside the clips root. */
export async function reserveTempPath(
  id: number,
): Promise<{ name: string; path: string }> {
  await ensureRoot();
  const name = tempFileName(id);
  return { name, path: await contained(name) };
}

export async function ensureRoot(): Promise<void> {
  await mkdir(clipsRoot(), { recursive: true });
}

async function plainFileSize(path: string): Promise<number | null> {
  let st;
  try {
    st = await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) {
    throw new ClipStoreError("Refusing to touch a non-plain file");
  }
  return st.size;
}

async function removeNamed(name: string): Promise<number> {
  let path: string;
  try {
    path = await contained(name);
  } catch (e) {
    if (e instanceof ClipMissingError) return 0;
    throw e;
  }
  const size = await plainFileSize(path);
  if (size === null) return 0;
  await unlink(path);
  return size;
}

/** Deletes one clip's file; returns the bytes freed (0 when there was none). */
export function deleteClip(id: number): Promise<number> {
  return withClipLock(id, () => removeNamed(clipFileName(id)));
}

/** Atomically replaces `clip-<id>.mp4` with a finished temp file; returns its size. */
export function publish(id: number, tempName: string): Promise<number> {
  return withClipLock(id, async () => {
    const m = CLIP_NAME.exec(tempName);
    if (!m || !m[2] || Number(m[1]) !== id)
      throw new ClipStoreError("Not this clip's temp file");
    const from = await contained(tempName);
    const to = await contained(clipFileName(id));
    const size = await plainFileSize(from);
    if (size === null || size === 0)
      throw new ClipStoreError("Encoder produced no output");
    await rename(from, to);
    return size;
  });
}

export function discardTemp(id: number, tempName: string): Promise<number> {
  return withClipLock(id, async () => {
    const m = CLIP_NAME.exec(tempName);
    if (!m || !m[2] || Number(m[1]) !== id)
      throw new ClipStoreError("Not this clip's temp file");
    return removeNamed(tempName);
  });
}

/** For serving: a plain file's path and size, or null when the clip has no file. */
export async function statClip(
  id: number,
): Promise<{ path: string; size: number; mtimeMs: number } | null> {
  let path: string;
  try {
    path = await contained(clipFileName(id));
  } catch (e) {
    if (e instanceof ClipMissingError) return null;
    throw e;
  }
  const size = await plainFileSize(path);
  if (size === null) return null;
  return { path, size, mtimeMs: (await lstat(path)).mtimeMs };
}

async function listNames(): Promise<string[]> {
  try {
    return (await readdir(clipsRoot())).filter((n) => CLIP_NAME.test(n));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function removeAll(
  names: string[],
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const name of names) {
    const id = Number(CLIP_NAME.exec(name)?.[1]);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    try {
      const freed = await withClipLock(id, () => removeNamed(name));
      if (freed > 0) files++;
      bytes += freed;
    } catch (e) {
      // A foreign-looking entry (symlink, hardlinked file) is left alone, never forced.
      if (!(e instanceof ClipStoreError)) throw e;
    }
  }
  return { files, bytes };
}

/** "Delete all": pattern-matching files one by one, then the root only if it is already empty. */
export async function deleteAllClipFiles(): Promise<{
  files: number;
  bytes: number;
}> {
  const result = await removeAll(await listNames());
  try {
    await rmdir(clipsRoot());
  } catch {
    // Not empty (foreign content) or already gone: leave it.
  }
  return result;
}

/** Deletes clip files whose id has no row. Files are listed before ids are read, so a clip being created is never seen as an orphan. */
export async function sweepOrphans(
  knownIds: () => Promise<Set<number>>,
): Promise<{ files: number; bytes: number }> {
  const names = (await listNames()).filter((n) => FINAL_NAME.test(n));
  if (names.length === 0) return { files: 0, bytes: 0 };
  const known = await knownIds();
  return removeAll(
    names.filter((n) => !known.has(Number(FINAL_NAME.exec(n)?.[1]))),
  );
}

/** Deletes temp files older than maxAgeMs (an interrupted encode). */
export async function sweepStaleTemps(maxAgeMs: number): Promise<number> {
  const root = clipsRoot();
  const stale: string[] = [];
  for (const name of await listNames()) {
    if (FINAL_NAME.test(name)) continue;
    try {
      const st = await lstat(join(root, name));
      if (Date.now() - st.mtimeMs > maxAgeMs) stale.push(name);
    } catch {
      // Vanished between readdir and lstat.
    }
  }
  return (await removeAll(stale)).files;
}
