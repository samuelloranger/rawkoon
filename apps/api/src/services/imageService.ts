/**
 * Image service for handling image uploads and thumbnail generation.
 * Backed by the local filesystem via storageService.
 */

import sharp from "sharp";
import {
  saveToStorage,
  deleteFromStorage,
  readFromStorage,
} from "./storageService";
import { getBaseUrl } from "@rawkoon/api/config";

// Allowed image extensions
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

// Thumbnail size
const THUMBNAIL_SIZE = 48;

/**
 * Check if file extension is allowed
 */
export function isAllowedFile(filename: string): boolean {
  if (!filename.includes(".")) return false;
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? ALLOWED_EXTENSIONS.has(ext) : false;
}

/**
 * Get content type from filename
 */
export function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

/**
 * Save uploaded image and create thumbnail on local disk
 */
export async function saveImageAndCreateThumbnail(file: File): Promise<string> {
  if (!file || !isAllowedFile(file.name)) {
    throw new Error("Invalid file type. Only images are allowed.");
  }

  const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const uniqueFilename = `${crypto.randomUUID().replace(/-/g, "")}.${fileExt}`;

  let savedOriginal = false;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Validate with sharp metadata first
    try {
      await sharp(imageBuffer).metadata();
    } catch (e) {
      throw new Error("Invalid image format or corrupted file", { cause: e });
    }

    const uploadSuccess = await saveToStorage(imageBuffer, uniqueFilename);
    if (!uploadSuccess) {
      throw new Error("Failed to save image");
    }
    savedOriginal = true;

    // Sharp automatically handles EXIF orientation
    const thumbnailBuffer = await sharp(imageBuffer)
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: "cover",
        position: "center",
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 85 })
      .toBuffer();

    const thumbnailSuccess = await saveToStorage(
      thumbnailBuffer,
      `thumbnail-${uniqueFilename}`,
    );

    if (!thumbnailSuccess) {
      await deleteFromStorage(uniqueFilename);
      throw new Error("Failed to save thumbnail");
    }

    console.log(`Saved image and thumbnail: ${uniqueFilename}`);
    return uniqueFilename;
  } catch (error) {
    if (savedOriginal) {
      try {
        await deleteFromStorage(uniqueFilename);
      } catch (delErr) {
        console.error(
          `Failed to clean up orphaned image ${uniqueFilename}:`,
          delErr,
        );
      }
    }
    console.error("Error saving image:", error);
    throw new Error(`Error saving image: ${error}`, { cause: error });
  }
}

/**
 * Delete image and thumbnail files from disk
 */
export async function deleteImageFiles(imageName: string): Promise<void> {
  if (!imageName) return;

  await deleteFromStorage(imageName);
  await deleteFromStorage(`thumbnail-${imageName}`);
}

/**
 * Get image from disk
 */
export async function getImage(filename: string): Promise<Buffer | null> {
  return readFromStorage(filename);
}

/**
 * Get thumbnail from disk
 */
export async function getThumbnail(filename: string): Promise<Buffer | null> {
  return readFromStorage(`thumbnail-${filename}`);
}

/**
 * Get the full URL for an avatar image (served through API)
 */
export function getAvatarUrl(filename: string): string {
  const baseUrl = getBaseUrl();
  return `${baseUrl}/api/users/avatar/${filename}`;
}
