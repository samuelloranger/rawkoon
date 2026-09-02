import { describe, it, expect } from "vitest";
import { createTimeline } from "./timeline";
import type { BookManifestChapter } from "@rawkoon/shared/types";

const ch = (
  index: number,
  start: number,
  end: number,
): BookManifestChapter => ({
  index,
  title: `Ch ${index}`,
  start_secs: start,
  end_secs: end,
  file_id: index,
  size_bytes: 1,
  sha256: null,
  url: `/c/${index}`,
});

describe("createTimeline", () => {
  const t = createTimeline([ch(0, 0, 10), ch(1, 10, 25)]);

  it("maps a mid-chapter position", () => {
    expect(t.chapterAt(4)?.index).toBe(0);
    expect(t.offsetWithinChapter(4)).toEqual({ index: 0, offsetSecs: 4 });
    expect(t.chapterAt(10)?.index).toBe(1);
  });

  it("treats the last instant as outside chapterAt, but clamp keeps it", () => {
    expect(t.chapterAt(25)).toBeNull();
    expect(t.clamp(99)).toBe(25);
    expect(t.clamp(-1)).toBe(0);
  });

  it("finds chapter boundaries for next/prev", () => {
    expect(t.boundaryAfter(4)).toBe(10);
    expect(t.boundaryBefore(12)).toBe(10);
    expect(t.boundaryBefore(0)).toBeUndefined();
  });
});
