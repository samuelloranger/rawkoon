import { describe, it, expect } from "vitest";
import { createFileIndex } from "./fileIndex";
import type { BookManifestFile } from "@rawkoon/shared/types";

const f = (id: number, start: number, duration: number): BookManifestFile => ({
  id,
  start_secs: start,
  duration_secs: duration,
  size_bytes: 1,
  sha256: null,
  url: `/f/${id}`,
});

describe("createFileIndex", () => {
  it("multi-file: file per position, boundary is next file start", () => {
    const idx = createFileIndex([f(1, 0, 10), f(2, 10, 15)]);
    expect(idx.fileAt(4)?.id).toBe(1);
    expect(idx.fileAt(10)?.id).toBe(2);
    expect(idx.fileAt(99)).toBeNull();
    expect(idx.boundaryAfterFile(4)).toBe(10);
    expect(idx.boundaryAfterFile(12)).toBeNull();
  });

  it("single-file: one file covers the whole book, no next boundary", () => {
    const idx = createFileIndex([f(1059, 0, 400)]);
    expect(idx.fileAt(0)?.id).toBe(1059);
    expect(idx.fileAt(399.9)?.id).toBe(1059);
    expect(idx.boundaryAfterFile(200)).toBeNull();
  });
});
