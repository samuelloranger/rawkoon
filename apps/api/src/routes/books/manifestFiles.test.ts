import { describe, expect, test } from "bun:test";
import { buildManifestFiles } from "./bookPlaybackRoutes";

const ch = (
  startSecs: number,
  endSecs: number,
  fileId: number,
  size = 1000,
) => ({
  startSecs,
  endSecs,
  bookFile: { id: fileId, sizeBytes: BigInt(size), sha256: null },
});

describe("buildManifestFiles", () => {
  test("multi-file: one file per chapter, start_secs == chapter start", () => {
    const files = buildManifestFiles(
      [ch(0, 10, 100), ch(10, 25, 101)],
      (id) => `grant:${id}`,
    );
    expect(files).toEqual([
      {
        id: 100,
        start_secs: 0,
        duration_secs: 10,
        size_bytes: 1000,
        sha256: null,
        url: "grant:100",
      },
      {
        id: 101,
        start_secs: 10,
        duration_secs: 15,
        size_bytes: 1000,
        sha256: null,
        url: "grant:101",
      },
    ]);
  });

  test("single-file: many chapters collapse to one file spanning them", () => {
    const files = buildManifestFiles(
      [ch(0, 100, 1059, 500), ch(100, 250, 1059, 500), ch(250, 400, 1059, 500)],
      (id) => `grant:${id}`,
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      id: 1059,
      start_secs: 0,
      duration_secs: 400,
      size_bytes: 500,
      sha256: null,
      url: "grant:1059",
    });
  });

  test("grant is signed once per distinct file", () => {
    const seen: number[] = [];
    buildManifestFiles([ch(0, 100, 7), ch(100, 200, 7)], (id) => {
      seen.push(id);
      return `g:${id}`;
    });
    expect(seen).toEqual([7]);
  });
});
