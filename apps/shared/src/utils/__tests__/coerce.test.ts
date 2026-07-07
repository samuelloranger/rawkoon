import { describe, it, expect } from "bun:test";
import {
  toRecord,
  toStringOrNull,
  toYearOrNull,
  toStringArray,
  toNumberOrNull,
  toPositiveInt,
} from "../coerce";

describe("toRecord", () => {
  it("returns the object for plain objects", () => {
    const obj = { a: 1 };
    expect(toRecord(obj)).toBe(obj);
  });

  it("returns null for arrays", () => {
    expect(toRecord([1, 2])).toBeNull();
  });

  it("returns null for primitives", () => {
    expect(toRecord("string")).toBeNull();
    expect(toRecord(42)).toBeNull();
    expect(toRecord(null)).toBeNull();
    expect(toRecord(undefined)).toBeNull();
  });
});

describe("toStringOrNull", () => {
  it("returns trimmed string", () => {
    expect(toStringOrNull("  hello  ")).toBe("hello");
  });

  it("returns null for empty/whitespace string", () => {
    expect(toStringOrNull("")).toBeNull();
    expect(toStringOrNull("   ")).toBeNull();
  });

  it("converts numbers to strings", () => {
    expect(toStringOrNull(42)).toBe("42");
  });

  it("returns null for non-finite numbers", () => {
    expect(toStringOrNull(Infinity)).toBeNull();
    expect(toStringOrNull(NaN)).toBeNull();
  });

  it("returns null for other types", () => {
    expect(toStringOrNull(null)).toBeNull();
    expect(toStringOrNull(undefined)).toBeNull();
    expect(toStringOrNull(true)).toBeNull();
  });
});

describe("toYearOrNull", () => {
  it("returns truncated number for numeric input", () => {
    expect(toYearOrNull(2024)).toBe(2024);
    expect(toYearOrNull(2024.9)).toBe(2024);
  });

  it("parses year from string", () => {
    expect(toYearOrNull("2024")).toBe(2024);
  });

  it("returns null for invalid input", () => {
    expect(toYearOrNull("abc")).toBeNull();
    expect(toYearOrNull(null)).toBeNull();
    expect(toYearOrNull(Infinity)).toBeNull();
  });
});

describe("toStringArray", () => {
  it("converts array elements to strings", () => {
    expect(toStringArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("filters out null/empty values", () => {
    expect(toStringArray(["a", "", null, "b"])).toEqual(["a", "b"]);
  });

  it("returns empty array for non-arrays", () => {
    expect(toStringArray("not-array")).toEqual([]);
    expect(toStringArray(null)).toEqual([]);
    expect(toStringArray(42)).toEqual([]);
  });
});

describe("toNumberOrNull", () => {
  it("returns numbers directly", () => {
    expect(toNumberOrNull(42)).toBe(42);
    expect(toNumberOrNull(3.14)).toBe(3.14);
  });

  it("parses numeric strings", () => {
    expect(toNumberOrNull("42")).toBe(42);
    expect(toNumberOrNull("3.14")).toBe(3.14);
  });

  it("returns null for non-numeric values", () => {
    expect(toNumberOrNull("abc")).toBeNull();
    expect(toNumberOrNull(Infinity)).toBeNull();
    expect(toNumberOrNull(NaN)).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
  });
});

describe("toPositiveInt", () => {
  it("parses positive integers", () => {
    expect(toPositiveInt("10", 1)).toBe(10);
  });

  it("returns fallback for zero or negative", () => {
    expect(toPositiveInt("0", 5)).toBe(5);
    expect(toPositiveInt("-1", 5)).toBe(5);
  });

  it("returns fallback for undefined/empty", () => {
    expect(toPositiveInt(undefined, 5)).toBe(5);
    expect(toPositiveInt("", 5)).toBe(5);
  });

  it("returns fallback for non-numeric strings", () => {
    expect(toPositiveInt("abc", 5)).toBe(5);
  });
});
