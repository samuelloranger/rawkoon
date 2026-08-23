import type { AudiobookFormat, BookFormat, EbookFormat } from "../types/books";

/**
 * Book formats, best first. The order is the default preference order a quality
 * profile starts from, which is why these are ordered lists rather than sets.
 */
export const EBOOK_FORMATS: EbookFormat[] = [
  "epub",
  "azw3",
  "mobi",
  "pdf",
  "cbz",
];
export const AUDIOBOOK_FORMATS: AudiobookFormat[] = [
  "m4b",
  "mp3",
  "flac",
  "ogg",
];

export type BookProfileKind = "ebook" | "audiobook" | "both";

export function bookFormatsForKind(kind: BookProfileKind): BookFormat[] {
  if (kind === "ebook") return [...EBOOK_FORMATS];
  if (kind === "audiobook") return [...AUDIOBOOK_FORMATS];
  return [...EBOOK_FORMATS, ...AUDIOBOOK_FORMATS];
}

/**
 * Validate that the formats listed match the profile's kind. Mixing an epub
 * into an audiobook profile would make the reject filter behave incoherently,
 * so it is refused rather than silently ignored.
 *
 * Returns the error message, or null when the combination is valid. Shared so
 * the settings form can refuse a bad combination before the API has to.
 */
export function validateBookProfileFormats(
  kind: string,
  formats: string[],
  cutoff: string | null,
): string | null {
  const valid: string[] = bookFormatsForKind(kind as BookProfileKind);

  const bad = formats.filter((f) => !valid.includes(f));
  if (bad.length > 0) {
    return `Formats not valid for a ${kind} profile: ${bad.join(", ")}`;
  }
  if (cutoff && !formats.includes(cutoff)) {
    return "cutoff_format must be one of allowed_formats";
  }
  return null;
}
