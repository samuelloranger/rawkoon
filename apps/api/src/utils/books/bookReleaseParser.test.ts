import { describe, expect, test } from "bun:test";
import {
  inferEditionKind,
  kindForFormat,
  parseBookReleaseTitle,
} from "@rawkoon/api/utils/books/bookReleaseParser";

/**
 * The first block is verbatim output from a live Jackett aggregate search for
 * "La Prof Freida McFadden" (categories 7000 and 3000) on 2026-08-20. These
 * are not invented fixtures — they are what the indexer actually returns, and
 * they are the reason several design decisions look the way they do.
 */
describe("parseBookReleaseTitle — real releases", () => {
  test("French audiobook with spaced French bitrate", () => {
    const r = parseBookReleaseTitle(
      "La Prof - Freida McFadden - 2025 [MP3 à 64 kb/s]",
    );
    expect(r.format).toBe("mp3");
    expect(r.kind).toBe("audiobook");
    expect(r.audioBitrate).toBe(64);
    expect(r.isPack).toBe(false);
    // No language tag at all: the only French signal is the unit notation
    // ("à … kb/s"), which is locale flavour, not a tag. This release is the
    // reason language must be a scoring PREFERENCE and never a hard filter —
    // filtering on language would drop a genuine French result.
    expect(r.language).toBeNull();
  });

  test("scene-style French ebook, NOTAG is not a group", () => {
    const r = parseBookReleaseTitle(
      "La.Prof.Freida.McFadden.2025.FR.[EPUB]-NOTAG",
    );
    expect(r.format).toBe("epub");
    expect(r.kind).toBe("ebook");
    expect(r.language).toBe("fr");
    expect(r.releaseGroup).toBeNull();
  });

  test("spaced ebook with trailing year, year is not a group", () => {
    const r = parseBookReleaseTitle(
      "La Prof - Freida McFadden - 2025 Fr [Epub]",
    );
    expect(r.format).toBe("epub");
    expect(r.language).toBe("fr");
    expect(r.releaseGroup).toBeNull();
  });

  test("double space and mixed-case ePub", () => {
    const r = parseBookReleaseTitle("La prof - Freida McFadden  [ePub] Fr");
    expect(r.format).toBe("epub");
    expect(r.kind).toBe("ebook");
    expect(r.language).toBe("fr");
  });

  test("en dash separator and parenthetical original title", () => {
    const r = parseBookReleaseTitle(
      "Freida McFadden – Le professeur (The Teacher) - ePUB Fr",
    );
    expect(r.format).toBe("epub");
    expect(r.language).toBe("fr");
  });

  test("dotted kbps form", () => {
    const r = parseBookReleaseTitle(
      "La.Prof.Freida.McFadden.2025.FR.[MP3.192kbps]-NOTAG",
    );
    expect(r.format).toBe("mp3");
    expect(r.kind).toBe("audiobook");
    expect(r.audioBitrate).toBe(192);
    expect(r.releaseGroup).toBeNull();
  });

  test("none of the real French releases claim retail", () => {
    const titles = [
      "La Prof - Freida McFadden - 2025 [MP3 à 64 kb/s]",
      "La.Prof.Freida.McFadden.2025.FR.[EPUB]-NOTAG",
      "La Prof - Freida McFadden - 2025 Fr [Epub]",
      "La prof - Freida McFadden  [ePub] Fr",
      "Freida McFadden – Le professeur (The Teacher) - ePUB Fr",
      "La.Prof.Freida.McFadden.2025.FR.[MP3.192kbps]-NOTAG",
    ];
    for (const t of titles) {
      expect(parseBookReleaseTitle(t).isRetail).toBe(false);
    }
  });
});

/**
 * Regressions against the video parser's failure modes. These are the specific
 * mistakes that made a separate parser necessary rather than an extension.
 */
describe("parseBookReleaseTitle — video-parser traps", () => {
  test("a four-digit year in the title is not a resolution", () => {
    const r = parseBookReleaseTitle("Title 1984 [epub] Fr");
    expect(r.format).toBe("epub");
    expect(r.audioBitrate).toBeNull();
  });

  test("M4B is not MP4", () => {
    const r = parseBookReleaseTitle("Some.Book.M4B");
    expect(r.format).toBe("m4b");
    expect(r.kind).toBe("audiobook");
  });

  test("azw3 wins over shorter format matches", () => {
    expect(parseBookReleaseTitle("Book Name [AZW3]").format).toBe("azw3");
  });
});

describe("parseBookReleaseTitle — groups, retail, packs", () => {
  test("a real group is kept", () => {
    expect(
      parseBookReleaseTitle("Book.Title.2024.EPUB-ABCTEAM").releaseGroup,
    ).toBe("ABCTEAM");
  });

  test("retail marker is detected", () => {
    expect(parseBookReleaseTitle("Book Title RETAIL EPUB").isRetail).toBe(true);
  });

  test("proper/repack is detected", () => {
    expect(parseBookReleaseTitle("Book Title REPACK EPUB").isProper).toBe(true);
  });

  test.each([
    "Freida McFadden - Intégrale [EPUB]",
    "Author Name - Complete Collection [epub]",
    "Series Name Tomes 1 - 5 [epub]",
  ])("pack is flagged: %s", (title) => {
    expect(parseBookReleaseTitle(title).isPack).toBe(true);
  });
});

describe("inferEditionKind", () => {
  test("format wins when present", () => {
    const parsed = parseBookReleaseTitle("Book [EPUB]");
    // Even at an audiobook-sized payload, an epub is an ebook.
    expect(inferEditionKind(parsed, 900 * 1_048_576)).toBe("ebook");
  });

  test("size separates the two when no format is parseable", () => {
    const parsed = parseBookReleaseTitle("Some Untagged Release Fr");
    expect(parsed.format).toBeNull();
    // Real measurements: ebooks 1-5 MB, audiobooks 262-810 MB.
    expect(inferEditionKind(parsed, 2 * 1_048_576)).toBe("ebook");
    expect(inferEditionKind(parsed, 810 * 1_048_576)).toBe("audiobook");
  });

  test("ambiguous mid-range and unknown size yield null rather than a guess", () => {
    const parsed = parseBookReleaseTitle("Some Untagged Release");
    expect(inferEditionKind(parsed, 75 * 1_048_576)).toBeNull();
    expect(inferEditionKind(parsed, null)).toBeNull();
  });
});

describe("kindForFormat", () => {
  test.each([
    ["epub", "ebook"],
    ["pdf", "ebook"],
    ["cbz", "ebook"],
    ["m4b", "audiobook"],
    ["mp3", "audiobook"],
    ["flac", "audiobook"],
  ] as const)("%s → %s", (format, kind) => {
    expect(kindForFormat(format)).toBe(kind);
  });
});
