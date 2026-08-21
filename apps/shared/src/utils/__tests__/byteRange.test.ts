import { describe, it, expect } from "bun:test";
import { parseByteRange } from "../byteRange";

describe("parseByteRange", () => {
  it("returns null when there is no header to honour", () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
    // Multi-range is answered in full rather than partially.
    expect(parseByteRange("bytes=0-10,20-30", 1000)).toBeNull();
    expect(parseByteRange("items=0-10", 1000)).toBeNull();
  });

  it("parses an explicit range", () => {
    expect(parseByteRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
    expect(parseByteRange(" bytes=100-199 ", 1000)).toEqual({
      start: 100,
      end: 199,
    });
  });

  it("runs an open-ended range to the last byte", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it("clamps an end past the resource", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });

  it("reads the suffix form as the last N bytes", () => {
    expect(parseByteRange("bytes=-200", 1000)).toEqual({
      start: 800,
      end: 999,
    });
    // A suffix longer than the resource is the whole resource.
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it("rejects a range that cannot be served", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=500-499", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("treats every range over an empty resource as unsatisfiable", () => {
    // The suffix form used to compute {start: 0, end: -1} here, which is a
    // Content-Range naming a negative last byte.
    expect(parseByteRange("bytes=-1", 0)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-0", 0)).toBe("unsatisfiable");
  });
});
