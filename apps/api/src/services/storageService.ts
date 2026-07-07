/**
 * Local filesystem storage for images.
 * Replaces the prior S3/MinIO-backed implementation.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

function getStorageDir(): string {
  return Bun.env.IMAGE_STORAGE_DIR || "./data/images";
}

function safeJoin(filename: string): string {
  const root = resolve(getStorageDir());
  const full = resolve(root, filename);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`Invalid filename: ${filename}`);
  }
  return full;
}

async function ensureDir(): Promise<void> {
  await mkdir(resolve(getStorageDir()), { recursive: true });
}

export async function saveToStorage(
  content: Buffer | Uint8Array,
  filename: string,
): Promise<boolean> {
  const path = safeJoin(filename);
  try {
    await ensureDir();
    await writeFile(path, content);
    return true;
  } catch (error) {
    console.error(`Failed to write file ${filename}:`, error);
    return false;
  }
}

export async function readFromStorage(
  filename: string,
): Promise<Buffer | null> {
  const path = safeJoin(filename);
  try {
    return await readFile(path);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    console.error(`Failed to read file ${filename}:`, error);
    return null;
  }
}

export async function deleteFromStorage(filename: string): Promise<boolean> {
  const path = safeJoin(filename);
  try {
    await unlink(path);
    return true;
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return true;
    console.error(`Failed to delete file ${filename}:`, error);
    return false;
  }
}
