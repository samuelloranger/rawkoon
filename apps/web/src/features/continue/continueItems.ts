import type {
  BookListeningProgress,
  BookReadingProgress,
} from "@rawkoon/shared/types";

export type ContinueKind = "audiobook" | "ebook";

export interface ContinueItem {
  kind: ContinueKind;
  editionId: number;
  bookId: number;
  title: string;
  authors: string[];
  coverUrl: string | null;
  updatedAt: string;
  progressFraction: number;
}

const audioInProgress = (row: BookListeningProgress) =>
  !row.finished && row.position_secs > 1 && row.total_duration_secs > 1;

const ebookInProgress = (row: BookReadingProgress) =>
  !row.finished && (row.spine_index > 0 || row.scroll_fraction > 0.01);

export function continueItems(
  listening: BookListeningProgress[],
  reading: BookReadingProgress[],
  cap = 6,
): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const row of listening) {
    if (!audioInProgress(row)) continue;
    items.push({
      kind: "audiobook",
      editionId: row.edition_id,
      bookId: row.book_id,
      title: row.title,
      authors: row.authors,
      coverUrl: row.cover_url,
      updatedAt: row.updated_at,
      progressFraction: Math.min(
        Math.max(row.position_secs / row.total_duration_secs, 0),
        1,
      ),
    });
  }
  for (const row of reading) {
    if (!ebookInProgress(row)) continue;
    const denom = Math.max(row.spine_count, 1);
    items.push({
      kind: "ebook",
      editionId: row.edition_id,
      bookId: row.book_id,
      title: row.title,
      authors: row.authors,
      coverUrl: row.cover_url,
      updatedAt: row.updated_at,
      progressFraction: Math.min(
        Math.max((row.spine_index + row.scroll_fraction) / denom, 0),
        1,
      ),
    });
  }
  items.sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
  return items.slice(0, cap);
}
