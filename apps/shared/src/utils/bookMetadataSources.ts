import type { BookMetadataSource } from "../types/books";

export const DEFAULT_BOOK_METADATA_SOURCE_ORDER: BookMetadataSource[] = [
  "local",
  "audnexus",
  "googlebooks",
  "openlibrary",
];

const KNOWN = new Set<string>(DEFAULT_BOOK_METADATA_SOURCE_ORDER);

/**
 * The stored order doubles as the enable list: a source absent from the array
 * is disabled. An empty or unusable array therefore cannot be honoured as
 * "everything disabled" — that would silently stop all enrichment — so it
 * falls back to the default order.
 */
export function normalizeSourceOrder(input: unknown): BookMetadataSource[] {
  if (!Array.isArray(input)) return [...DEFAULT_BOOK_METADATA_SOURCE_ORDER];
  const seen = new Set<string>();
  const out: BookMetadataSource[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    if (!KNOWN.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw as BookMetadataSource);
  }
  return out.length > 0 ? out : [...DEFAULT_BOOK_METADATA_SOURCE_ORDER];
}
