const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export type ImageValidationError = { error: string };

export function validateImageMimeAndSize(
  file: { type: string; size?: number },
  options: { maxSizeBytes?: number } = {},
): ImageValidationError | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { error: "Invalid file type. Allowed: JPEG, PNG, GIF, WebP" };
  }

  if (options.maxSizeBytes && file.size && file.size > options.maxSizeBytes) {
    const maxMB = Math.round(options.maxSizeBytes / (1024 * 1024));
    return { error: `File too large. Maximum size is ${maxMB}MB` };
  }

  return null;
}
