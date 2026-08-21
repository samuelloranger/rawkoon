import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  chapterIndexAt,
  locate,
} from "@/features/player/AudiobookEngine";
import { formatClock, formatRemaining } from "@/features/player/formatClock";
import type { BookManifestFile } from "@rawkoon/shared/types";

// The mapping from an absolute timeline to (file, offset) is the whole reason
// the engine exists as a plain class: it is testable without a DOM.

const file = (
  id: number,
  offset: number,
  duration: number,
  chapters: BookManifestFile["chapters"] = [],
): BookManifestFile => ({
  id,
  file_name: `Part ${id}.mp3`,
  format: "mp3",
  size_bytes: "1000",
  duration_secs: duration,
  offset_secs: offset,
  readable: true,
  chapters,
  content_url: `/api/books/files/${id}/content`,
});

// locate() works on the built timeline, not the manifest, so build it here the
// same way the engine does.
const { timeline: threeFiles } = buildTimeline([
  file(1, 0, 600),
  file(2, 600, 900),
  file(3, 1500, 300),
]);

describe("buildTimeline", () => {
  it("sums durations and shifts chapters onto the absolute timeline", () => {
    const { duration, chapters } = buildTimeline([
      file(1, 0, 600, [
        { index: 0, title: "One", start_secs: 0, end_secs: 600 },
      ]),
      file(2, 600, 900, [
        { index: 0, title: "Two", start_secs: 0, end_secs: 400 },
        { index: 1, title: "Three", start_secs: 400, end_secs: 900 },
      ]),
    ]);

    expect(duration).toBe(1500);
    expect(chapters.map((c) => [c.label, c.start, c.end])).toEqual([
      ["One", 0, 600],
      ["Two", 600, 1000],
      ["Three", 1000, 1500],
    ]);
  });
});

describe("locate", () => {
  it("returns nothing for an empty timeline", () => {
    expect(locate([], 10)).toBeNull();
  });

  it("maps the start of the book to the first file", () => {
    expect(locate(threeFiles, 0)).toEqual({ index: 0, offset: 0 });
  });

  it("maps a position inside the second file", () => {
    expect(locate(threeFiles, 900)).toEqual({ index: 1, offset: 300 });
  });

  it("puts an exact boundary at the start of the later file", () => {
    expect(locate(threeFiles, 600)).toEqual({ index: 1, offset: 0 });
    expect(locate(threeFiles, 1500)).toEqual({ index: 2, offset: 0 });
  });

  it("maps the final second of the book", () => {
    expect(locate(threeFiles, 1799)).toEqual({ index: 2, offset: 299 });
  });

  it("clamps a position past the end to the last file's end", () => {
    expect(locate(threeFiles, 99_999)).toEqual({ index: 2, offset: 300 });
  });

  it("clamps a negative position to the start", () => {
    expect(locate(threeFiles, -30)).toEqual({ index: 0, offset: 0 });
  });
});

describe("chapterIndexAt", () => {
  const chapters = [
    { index: 0, label: "One", start: 0, end: 600 },
    { index: 1, label: "Two", start: 600, end: 1000 },
    { index: 2, label: "Three", start: 1000, end: 1500 },
  ];

  it("finds the chapter holding a position", () => {
    expect(chapterIndexAt(chapters, 0)).toBe(0);
    expect(chapterIndexAt(chapters, 599)).toBe(0);
    expect(chapterIndexAt(chapters, 600)).toBe(1);
    expect(chapterIndexAt(chapters, 1400)).toBe(2);
  });

  it("falls back to the first chapter with none to match", () => {
    expect(chapterIndexAt([], 42)).toBe(0);
  });
});

describe("formatClock", () => {
  it("omits hours a book does not have", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(2400)).toBe("40:00");
  });

  it("shows hours once there are any", () => {
    expect(formatClock(3661)).toBe("1:01:01");
    expect(formatClock(15_128)).toBe("4:12:08");
  });

  it("refuses to render nonsense as a time", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("writes what is left as a countdown", () => {
    expect(formatRemaining(15_128, 25_179)).toBe("-2:47:31");
    expect(formatRemaining(500, 100)).toBe("-0:00");
  });
});
