import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findVideoFile, listVideoFilesUnder } from "./fileIdentifier";

describe("fileIdentifier", () => {
  it("returns a single video file path when torrent path is a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawkoon-vid-"));
    const mp4 = join(dir, "movie.mp4");
    writeFileSync(mp4, "x");
    expect(await findVideoFile(mp4)).toBe(mp4);
  });

  it("returns null for non-video file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawkoon-vid-"));
    const txt = join(dir, "readme.txt");
    writeFileSync(txt, "x");
    expect(await findVideoFile(txt)).toBeNull();
  });

  it("picks largest video in directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawkoon-vid-"));
    const small = join(dir, "a.mkv");
    const big = join(dir, "b.mkv");
    writeFileSync(small, "x");
    writeFileSync(big, "xxxxx");
    expect(await findVideoFile(dir)).toBe(big);
  });

  it("ignores Sample subfolder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawkoon-vid-"));
    const sampleDir = join(dir, "Sample");
    mkdirSync(sampleDir);
    writeFileSync(join(sampleDir, "s.mkv"), "xxxx");
    const main = join(dir, "main.mkv");
    writeFileSync(main, "x");
    expect(await findVideoFile(dir)).toBe(main);
  });

  it("lists videos under root file or directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawkoon-vid-"));
    const mkv = join(dir, "x.mkv");
    writeFileSync(mkv, "x");
    expect(await listVideoFilesUnder(mkv)).toEqual([mkv]);
    expect(await listVideoFilesUnder(dir)).toEqual([mkv]);
  });
});
