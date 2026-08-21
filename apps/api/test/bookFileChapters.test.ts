/**
 * MediaInfo reports m4b chapter marks as a Menu track keyed by timecode. The
 * parser is pure so this needs no binary.
 */
import { describe, it, expect } from "bun:test";

const { parseMenuChapters, parseMenuTimecode } = await import(
  "@rawkoon/api/services/books/bookFileChapters"
);

const menu = (extra: Record<string, string>) =>
  JSON.stringify({
    media: {
      track: [
        { "@type": "General", Duration: "3600" },
        { "@type": "Audio", Format: "AAC" },
        { "@type": "Menu", extra },
      ],
    },
  });

describe("parseMenuTimecode", () => {
  it("reads hours, minutes, seconds and milliseconds", () => {
    expect(parseMenuTimecode("_01_02_03_500")).toBe(3723.5);
  });

  it("rejects anything that is not a timecode key", () => {
    expect(parseMenuTimecode("Duration")).toBeNull();
  });
});

describe("parseMenuChapters", () => {
  it("returns nothing for unparseable output", () => {
    expect(parseMenuChapters("not json", 100)).toEqual([]);
  });

  it("returns nothing when the file has no Menu track", () => {
    const raw = JSON.stringify({ media: { track: [{ "@type": "Audio" }] } });
    expect(parseMenuChapters(raw, 100)).toEqual([]);
  });

  it("ends each chapter where the next begins", () => {
    const chapters = parseMenuChapters(
      menu({
        _00_00_00_000: "en:Chapter One",
        _00_10_00_000: "en:Chapter Two",
        _00_25_30_000: "en:Chapter Three",
      }),
      3600,
    );

    expect(chapters).toEqual([
      { index: 0, title: "Chapter One", startSecs: 0, endSecs: 600 },
      { index: 1, title: "Chapter Two", startSecs: 600, endSecs: 1530 },
      { index: 2, title: "Chapter Three", startSecs: 1530, endSecs: 3600 },
    ]);
  });

  it("sorts marks that arrive out of order", () => {
    const chapters = parseMenuChapters(
      menu({ _00_10_00_000: "Two", _00_00_00_000: "One" }),
      1200,
    );
    expect(chapters.map((c) => c.title)).toEqual(["One", "Two"]);
  });

  it("keeps a title that carries no language prefix", () => {
    const chapters = parseMenuChapters(menu({ _00_00_00_000: "Prologue" }), 60);
    expect(chapters[0].title).toBe("Prologue");
  });

  it("stores no title for an empty label", () => {
    const chapters = parseMenuChapters(menu({ _00_00_00_000: "en:" }), 60);
    expect(chapters[0].title).toBeNull();
  });

  it("gives the last chapter a zero-length tail when the duration is unknown", () => {
    const chapters = parseMenuChapters(menu({ _00_05_00_000: "Only" }), null);
    expect(chapters[0]).toEqual({
      index: 0,
      title: "Only",
      startSecs: 300,
      endSecs: 300,
    });
  });
});
