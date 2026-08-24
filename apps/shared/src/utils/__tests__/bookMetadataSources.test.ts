import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BOOK_METADATA_SOURCE_ORDER,
  normalizeSourceOrder,
} from "../bookMetadataSources";

describe("normalizeSourceOrder", () => {
  test("falls back to the default order for junk input", () => {
    expect(normalizeSourceOrder(null)).toEqual(
      DEFAULT_BOOK_METADATA_SOURCE_ORDER,
    );
    expect(normalizeSourceOrder("audnexus")).toEqual(
      DEFAULT_BOOK_METADATA_SOURCE_ORDER,
    );
    expect(normalizeSourceOrder([])).toEqual(
      DEFAULT_BOOK_METADATA_SOURCE_ORDER,
    );
  });

  test("drops unknown sources and de-duplicates, preserving order", () => {
    expect(
      normalizeSourceOrder(["audnexus", "goodreads", "audnexus", "local", 42]),
    ).toEqual(["audnexus", "local"]);
  });

  // Absence from the array IS the disable switch — there is no parallel set of
  // booleans that could contradict the order.
  test("a source omitted from the order stays omitted", () => {
    expect(normalizeSourceOrder(["local", "googlebooks"])).toEqual([
      "local",
      "googlebooks",
    ]);
  });
});
