/**
 * The manifest is what lets the client treat a multi-file audiobook as one
 * timeline, so the offsets and the chapter fallback are what these tests pin.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";

type FileRow = {
  id: number;
  fileName: string;
  format: string;
  sizeBytes: bigint;
  durationSecs: number | null;
  chapters: Array<{
    index: number;
    title: string | null;
    startSecs: number;
    endSecs: number;
  }>;
};

let edition: {
  id: number;
  kind: string;
  narrators: string[];
  book: {
    id: number;
    title: string;
    authors: string[];
    coverUrl: string | null;
  };
  files: FileRow[];
} | null = null;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookEdition: { findUnique: async () => edition },
    bookProgress: { findUnique: async () => null },
  },
}));

const { buildManifest, naturalCompare } = await import(
  "@rawkoon/api/services/books/bookManifest"
);

const file = (over: Partial<FileRow> & { id: number }): FileRow => ({
  fileName: `file-${over.id}.mp3`,
  format: "mp3",
  sizeBytes: 1000n,
  durationSecs: 600,
  chapters: [],
  ...over,
});

const audiobook = (files: FileRow[]) => ({
  id: 42,
  kind: "audiobook",
  narrators: ["Juliette Baril"],
  book: {
    id: 9,
    title: "A Quiet Harbour",
    authors: ["Camille Rousseau"],
    coverUrl: null,
  },
  files,
});

describe("naturalCompare", () => {
  it("sorts part 2 before part 10", () => {
    const names = ["Part 10.mp3", "Part 2.mp3", "Part 1.mp3"];
    expect(names.sort(naturalCompare)).toEqual([
      "Part 1.mp3",
      "Part 2.mp3",
      "Part 10.mp3",
    ]);
  });
});

describe("buildManifest", () => {
  beforeEach(() => {
    edition = null;
  });

  it("returns null for an unknown edition", async () => {
    expect(await buildManifest(1, "u1")).toBeNull();
  });

  it("accumulates offsets across files in natural order", async () => {
    edition = audiobook([
      file({ id: 3, fileName: "Part 10.mp3", durationSecs: 300 }),
      file({ id: 1, fileName: "Part 1.mp3", durationSecs: 600 }),
      file({ id: 2, fileName: "Part 2.mp3", durationSecs: 900 }),
    ]);

    const manifest = (await buildManifest(42, "u1"))!;

    expect(manifest.files.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(manifest.files.map((f) => f.offset_secs)).toEqual([0, 600, 1500]);
    expect(manifest.total_duration_secs).toBe(1800);
  });

  it("gives a chapterless audiobook file one synthetic chapter", async () => {
    edition = audiobook([file({ id: 1, durationSecs: 600 })]);

    const manifest = (await buildManifest(42, "u1"))!;

    expect(manifest.files[0].chapters).toEqual([
      { index: 0, title: "file-1.mp3", start_secs: 0, end_secs: 600 },
    ]);
  });

  it("keeps real chapter marks when the file has them", async () => {
    edition = audiobook([
      file({
        id: 1,
        fileName: "book.m4b",
        format: "m4b",
        durationSecs: 1200,
        chapters: [
          { index: 0, title: "One", startSecs: 0, endSecs: 400 },
          { index: 1, title: "Two", startSecs: 400, endSecs: 1200 },
        ],
      }),
    ]);

    const manifest = (await buildManifest(42, "u1"))!;

    expect(manifest.files[0].chapters).toHaveLength(2);
    expect(manifest.files[0].chapters[1].title).toBe("Two");
    expect(manifest.primary_file_id).toBeNull();
  });

  it("reports no duration for an ebook edition", async () => {
    edition = {
      ...audiobook([
        file({
          id: 1,
          fileName: "book.epub",
          format: "epub",
          durationSecs: null,
        }),
      ]),
      kind: "ebook",
    };

    const manifest = (await buildManifest(42, "u1"))!;

    expect(manifest.total_duration_secs).toBeNull();
    expect(manifest.files[0].chapters).toEqual([]);
  });

  it("opens the epub when an ebook edition also holds a pdf", async () => {
    edition = {
      ...audiobook([
        file({
          id: 5,
          fileName: "book.pdf",
          format: "pdf",
          durationSecs: null,
        }),
        file({
          id: 6,
          fileName: "book.epub",
          format: "epub",
          durationSecs: null,
        }),
      ]),
      kind: "ebook",
    };

    const manifest = (await buildManifest(42, "u1"))!;

    expect(manifest.primary_file_id).toBe(6);
  });

  it("marks mobi and azw3 unreadable but still serves a content url", async () => {
    edition = {
      ...audiobook([
        file({
          id: 7,
          fileName: "book.azw3",
          format: "azw3",
          durationSecs: null,
        }),
      ]),
      kind: "ebook",
    };

    const manifest = (await buildManifest(42, "u1"))!;

    expect(manifest.files[0].readable).toBe(false);
    expect(manifest.primary_file_id).toBeNull();
    expect(manifest.files[0].content_url).toBe("/api/books/files/7/content");
  });
});
