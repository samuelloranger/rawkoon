import { describe, expect, test } from "bun:test";
import { parseByteRange } from "@rawkoon/shared/utils";

import { clampClientTimestamp, sliceForRange } from "./bookPlaybackRoutes";

describe("clampClientTimestamp", () => {
  test("a future client clock is clamped to server time", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(clampClientTimestamp("2099-01-01T00:00:00Z", now)).toEqual(now);
  });

  test("a past client clock is kept, because offline edits are legitimate", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const past = "2026-08-20T09:30:00Z";
    expect(clampClientTimestamp(past, now)).toEqual(new Date(past));
  });

  test("an unparseable timestamp falls back to server time", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(clampClientTimestamp("banana", now)).toEqual(now);
  });
});

describe("sliceForRange", () => {
  test("converts an inclusive range to an exclusive slice", () => {
    const range = parseByteRange("bytes=0-99", 1000);
    expect(range).toEqual({ start: 0, end: 99 });
    expect(sliceForRange(range as { start: number; end: number })).toEqual({
      start: 0,
      endExclusive: 100,
    });
  });

  test("a single byte is a slice of length one", () => {
    expect(sliceForRange({ start: 5, end: 5 })).toEqual({
      start: 5,
      endExclusive: 6,
    });
  });

  test("an open-ended range runs to the last byte inclusive", () => {
    const range = parseByteRange("bytes=900-", 1000);
    expect(range).toEqual({ start: 900, end: 999 });
    expect(sliceForRange(range as { start: number; end: number })).toEqual({
      start: 900,
      endExclusive: 1000,
    });
  });
});
