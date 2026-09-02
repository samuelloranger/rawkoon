import { describe, it, expect } from "vitest";
import { continueItems } from "./continueItems";
import type {
  BookListeningProgress,
  BookReadingProgress,
} from "@rawkoon/shared/types";

const audio = (
  over: Partial<BookListeningProgress> = {},
): BookListeningProgress => ({
  edition_id: 1,
  book_id: 10,
  title: "Audio",
  authors: ["A"],
  cover_url: null,
  position_secs: 100,
  total_duration_secs: 1000,
  finished: false,
  updated_at: "2026-09-02T12:00:00.000Z",
  ...over,
});

const ebook = (
  over: Partial<BookReadingProgress> = {},
): BookReadingProgress => ({
  edition_id: 2,
  book_id: 11,
  title: "Ebook",
  authors: ["B"],
  cover_url: null,
  file_id: 64,
  spine_index: 1,
  spine_path: "b.xhtml",
  spine_count: 10,
  scroll_fraction: 0.2,
  locator: null,
  finished: false,
  updated_at: "2026-09-02T11:00:00.000Z",
  ...over,
});

describe("continueItems", () => {
  it("drops unfinished ticks and finished books", () => {
    const items = continueItems(
      [
        audio({ position_secs: 0.5 }),
        audio({ finished: true, edition_id: 9 }),
        audio(),
      ],
      [ebook({ spine_index: 0, scroll_fraction: 0 }), ebook()],
    );
    expect(items.map((i) => i.editionId)).toEqual([1, 2]);
  });

  it("sorts newest first and caps", () => {
    const items = continueItems(
      [audio({ edition_id: 1, updated_at: "2026-01-01T00:00:00.000Z" })],
      [ebook({ edition_id: 2, updated_at: "2026-06-01T00:00:00.000Z" })],
      1,
    );
    expect(items).toHaveLength(1);
    expect(items[0].editionId).toBe(2);
  });
});
