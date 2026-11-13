import sharp from "sharp";
import { getContentType } from "@rawkoon/api/services/imageService";
import {
  deleteFromStorage,
  readFromStorage,
  saveToStorage,
} from "@rawkoon/api/services/storageService";

/** A shelf cover is a hero image: 5 MB is plenty and keeps a bad upload from filling the disk. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Exactly the names `saveShelfCover` generates, so the public route can refuse anything else. */
const COVER_NAME = /^shelf-cover-[0-9a-f]{32}\.(png|jpg|gif|webp)$/;

/** The extension for each image format a cover may be, taken from the bytes and not the file name. */
const EXTENSIONS: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
};

export type SaveCoverResult =
  | { ok: true; file: string }
  | {
      ok: false;
      reason: "invalid_type" | "too_large" | "not_an_image" | "save_failed";
    };

/**
 * Stores an uploaded shelf cover under the instance's image storage. The file
 * is validated as an image with sharp before it is kept, so a renamed archive
 * never becomes a broken cover.
 */
export async function saveShelfCover(file: File): Promise<SaveCoverResult> {
  if (file.size > MAX_BYTES) return { ok: false, reason: "too_large" };
  const buffer = Buffer.from(await file.arrayBuffer());
  let format: string | undefined;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    return { ok: false, reason: "not_an_image" };
  }
  const extension = format ? EXTENSIONS[format] : undefined;
  if (!extension) return { ok: false, reason: "invalid_type" };
  const name = `shelf-cover-${crypto.randomUUID().replace(/-/g, "")}.${extension}`;
  const saved = await saveToStorage(buffer, name);
  return saved
    ? { ok: true, file: name }
    : { ok: false, reason: "save_failed" };
}

/** An uploaded cover's bytes and content type, or null when the name isn't one of ours. */
export async function readShelfCover(
  filename: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!COVER_NAME.test(filename)) return null;
  const body = await readFromStorage(filename);
  return body ? { body, contentType: getContentType(filename) } : null;
}

/** Removes a stored cover file; a name that isn't one of ours is left alone. */
export async function deleteShelfCover(filename: string | null): Promise<void> {
  if (filename && COVER_NAME.test(filename)) await deleteFromStorage(filename);
}
