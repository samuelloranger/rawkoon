import sharp from "sharp";
import {
  isAllowedFile,
  getContentType,
} from "@rawkoon/api/services/imageService";
import {
  saveToStorage,
  readFromStorage,
} from "@rawkoon/api/services/storageService";

/** A shelf cover is a hero image: 5 MB is plenty and keeps a bad upload from filling the disk. */
const MAX_BYTES = 5 * 1024 * 1024;

/** The prefix every uploaded cover's file name carries, so the serving route can refuse anything else. */
const PREFIX = "shelf-cover-";

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
  if (!isAllowedFile(file.name)) return { ok: false, reason: "invalid_type" };
  if (file.size > MAX_BYTES) return { ok: false, reason: "too_large" };
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await sharp(buffer).metadata();
  } catch {
    return { ok: false, reason: "not_an_image" };
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const name = `${PREFIX}${crypto.randomUUID().replace(/-/g, "")}.${extension}`;
  const saved = await saveToStorage(buffer, name);
  return saved
    ? { ok: true, file: name }
    : { ok: false, reason: "save_failed" };
}

/** An uploaded cover's bytes and content type, or null when the name isn't one of ours. */
export async function readShelfCover(
  filename: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!filename.startsWith(PREFIX) || !isAllowedFile(filename)) return null;
  const body = await readFromStorage(filename);
  return body ? { body, contentType: getContentType(filename) } : null;
}
