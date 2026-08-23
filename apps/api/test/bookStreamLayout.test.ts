import { describe, it, expect } from "bun:test";

import {
  hasId3v1,
  id3v2Length,
  isConcatEligible,
  sliceLayout,
  type StreamLayout,
} from "@rawkoon/api/services/books/bookStreamLayout";

// The byte arithmetic is the whole feature. A boundary off by one is a click
// between chapters at best and a decode error at worst, and it is invisible in
// any test that only checks a whole-file read — so these drive the joins.

const id3Header = (size: number, flags = 0): Uint8Array => {
  const b = new Uint8Array(10);
  b[0] = 0x49; // I
  b[1] = 0x44; // D
  b[2] = 0x33; // 3
  b[5] = flags;
  // Synchsafe: seven bits per byte.
  b[6] = (size >> 21) & 0x7f;
  b[7] = (size >> 14) & 0x7f;
  b[8] = (size >> 7) & 0x7f;
  b[9] = size & 0x7f;
  return b;
};

describe("id3v2Length", () => {
  it("reads the synchsafe size and adds the header", () => {
    // The measured book: 299 declared + 10 of header.
    expect(id3v2Length(id3Header(299))).toBe(309);
  });

  // A plain big-endian read gets this wrong the moment any byte exceeds 0x7f,
  // which is what makes synchsafe worth a test.
  it("does not read the size as a plain integer", () => {
    // 0x0000_0180 synchsafe is 128 + 1<<7 = 256, not 384.
    const header = id3Header(0);
    header[8] = 0x02;
    header[9] = 0x00;
    expect(id3v2Length(header)).toBe(10 + (2 << 7));
  });

  it("counts the footer when the flag says there is one", () => {
    expect(id3v2Length(id3Header(100, 0x10))).toBe(10 + 100 + 10);
  });

  it("returns zero for a file that opens with audio", () => {
    expect(
      id3v2Length(new Uint8Array([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe(0);
    expect(id3v2Length(new Uint8Array(3))).toBe(0);
  });
});

describe("hasId3v1", () => {
  it("recognises the TAG trailer", () => {
    const tail = new Uint8Array(128);
    tail[0] = 0x54;
    tail[1] = 0x41;
    tail[2] = 0x47;
    expect(hasId3v1(tail)).toBe(true);
  });

  it("rejects anything else, including a short read", () => {
    expect(hasId3v1(new Uint8Array(128))).toBe(false);
    expect(hasId3v1(new Uint8Array(3))).toBe(false);
  });
});

// Three parts, each 100 audio bytes, each behind a different tag size — so a
// slice that ignores `skip` produces visibly wrong offsets.
const layout: StreamLayout = {
  parts: [
    { fileId: 1, path: "/a.mp3", skip: 309, length: 100, offset: 0 },
    { fileId: 2, path: "/b.mp3", skip: 10, length: 100, offset: 100 },
    { fileId: 3, path: "/c.mp3", skip: 0, length: 100, offset: 200 },
  ],
  totalBytes: 300,
  etag: '"concat-test"',
};

describe("sliceLayout", () => {
  it("maps a range inside one part past that part's tag", () => {
    expect(sliceLayout(layout, 10, 19)).toEqual([
      { path: "/a.mp3", start: 319, end: 329 },
    ]);
  });

  it("walks a range across a boundary", () => {
    // 90..109 is the last 10 bytes of part one and the first 10 of part two.
    expect(sliceLayout(layout, 90, 109)).toEqual([
      { path: "/a.mp3", start: 399, end: 409 },
      { path: "/b.mp3", start: 10, end: 20 },
    ]);
  });

  it("spans every part for a whole-resource request", () => {
    expect(sliceLayout(layout, 0, 299)).toEqual([
      { path: "/a.mp3", start: 309, end: 409 },
      { path: "/b.mp3", start: 10, end: 110 },
      { path: "/c.mp3", start: 0, end: 100 },
    ]);
  });

  // The exact byte a naive implementation gets wrong: the first byte of a part
  // and the last byte of the one before it.
  it("resolves the byte either side of a join", () => {
    expect(sliceLayout(layout, 99, 99)).toEqual([
      { path: "/a.mp3", start: 408, end: 409 },
    ]);
    expect(sliceLayout(layout, 100, 100)).toEqual([
      { path: "/b.mp3", start: 10, end: 11 },
    ]);
  });

  it("stops at the end of the resource rather than reading past it", () => {
    expect(sliceLayout(layout, 290, 299)).toEqual([
      { path: "/c.mp3", start: 90, end: 100 },
    ]);
  });

  it("returns nothing for an inverted range", () => {
    expect(sliceLayout(layout, 50, 40)).toEqual([]);
  });
});

describe("isConcatEligible", () => {
  const file = (
    over: Partial<{ format: string; audioBitrate: number | null }> = {},
  ) => ({
    format: "mp3",
    audioBitrate: 192000,
    ...over,
  });

  it("accepts uniform CBR mp3", () => {
    expect(isConcatEligible([file(), file(), file()])).toBe(true);
  });

  // A single file is already one seekable resource; concatenating is pointless.
  it("declines a single file", () => {
    expect(isConcatEligible([file()])).toBe(false);
  });

  // Byte-to-time is not linear across differing bitrates, so the browser would
  // seek to the wrong place — silently.
  it("declines a mixed bitrate", () => {
    expect(isConcatEligible([file(), file({ audioBitrate: 128000 })])).toBe(
      false,
    );
  });

  it("declines when a bitrate is unknown, which is how VBR arrives", () => {
    expect(isConcatEligible([file(), file({ audioBitrate: null })])).toBe(
      false,
    );
  });

  it("declines formats whose concatenation is not a valid stream", () => {
    expect(
      isConcatEligible([file({ format: "m4b" }), file({ format: "m4b" })]),
    ).toBe(false);
  });
});
