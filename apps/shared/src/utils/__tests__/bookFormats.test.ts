import { describe, expect, it } from "bun:test";
import {
  AUDIOBOOK_FORMATS,
  EBOOK_FORMATS,
  bookFormatsForKind,
  validateBookProfileFormats,
} from "../bookFormats";

describe("bookFormatsForKind", () => {
  it("keeps the kinds disjoint and lets 'both' see everything", () => {
    expect(bookFormatsForKind("ebook")).toEqual(EBOOK_FORMATS);
    expect(bookFormatsForKind("audiobook")).toEqual(AUDIOBOOK_FORMATS);
    expect(bookFormatsForKind("both")).toEqual([
      ...EBOOK_FORMATS,
      ...AUDIOBOOK_FORMATS,
    ]);
  });
});

describe("validateBookProfileFormats", () => {
  it("accepts formats that match the kind", () => {
    expect(validateBookProfileFormats("ebook", ["epub", "azw3"], "epub")).toBe(
      null,
    );
    expect(validateBookProfileFormats("audiobook", ["m4b"], null)).toBe(null);
  });

  // Mixing an epub into an audiobook profile would make the reject filter
  // behave incoherently, so it is refused rather than silently ignored.
  it("rejects a format belonging to the other kind", () => {
    expect(validateBookProfileFormats("audiobook", ["m4b", "epub"], null)).toBe(
      "Formats not valid for a audiobook profile: epub",
    );
  });

  it("rejects a cutoff that is not among the allowed formats", () => {
    expect(validateBookProfileFormats("ebook", ["epub"], "pdf")).toBe(
      "cutoff_format must be one of allowed_formats",
    );
  });

  it("treats no cutoff as valid", () => {
    expect(validateBookProfileFormats("ebook", ["epub"], null)).toBe(null);
  });
});
