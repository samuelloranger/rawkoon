import { describe, expect, test } from "bun:test";
import {
  normalizeSeriesName,
  parseSeriesPosition,
} from "@rawkoon/api/utils/books/seriesName";

/**
 * Every input here is a scrubbed stand-in for a shape observed live against a
 * real provider on 2026-08-24. The strings are invented; the shapes are not.
 */

describe("normalizeSeriesName", () => {
  test("strips a leading colon and surrounding whitespace", () => {
    expect(normalizeSeriesName(": Le Jardin de Verre (LJDV)")).toBe(
      "Le Jardin de Verre",
    );
  });

  test("strips a bracketed edition marker", () => {
    expect(normalizeSeriesName("The Glasshouse Series [French Edition]")).toBe(
      "The Glasshouse Series",
    );
  });

  test("strips a trailing parenthesized acronym", () => {
    expect(normalizeSeriesName("Le Jardin de Verre (LJDV)")).toBe(
      "Le Jardin de Verre",
    );
  });

  // A parenthesized fragment that is not an edition/acronym marker is part of
  // the name. Stripping every parenthesis would corrupt legitimate titles.
  test("keeps a parenthesized fragment that is prose", () => {
    expect(normalizeSeriesName("Chroniques (les années perdues)")).toBe(
      "Chroniques (les années perdues)",
    );
  });

  test("returns null for empty or absent input", () => {
    expect(normalizeSeriesName(null)).toBeNull();
    expect(normalizeSeriesName(undefined)).toBeNull();
    expect(normalizeSeriesName("   ")).toBeNull();
    expect(normalizeSeriesName(":  ")).toBeNull();
  });
});

describe("parseSeriesPosition", () => {
  test("parses the string positions the provider returns", () => {
    expect(parseSeriesPosition("1")).toBe(1);
    expect(parseSeriesPosition("4.5")).toBe(4.5);
    expect(parseSeriesPosition(3)).toBe(3);
  });

  // Observed live: a novella in a series carried position "".
  test("returns null for an empty or non-numeric position", () => {
    expect(parseSeriesPosition("")).toBeNull();
    expect(parseSeriesPosition("Book One")).toBeNull();
    expect(parseSeriesPosition(null)).toBeNull();
    expect(parseSeriesPosition(Number.NaN)).toBeNull();
  });
});
