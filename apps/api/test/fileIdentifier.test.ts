import { describe, it, expect, afterEach } from "bun:test";
import { mkdir, writeFile, chmod, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listVideoFilesUnder } from "../src/utils/medias/fileIdentifier";

describe("listVideoFilesUnder", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) {
      await chmod(join(dir, "locked"), 0o700).catch(() => {});
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("skips an unreadable subdirectory instead of aborting the whole walk", async () => {
    dir = await mkdtemp(join(tmpdir(), "rawkoon-scan-"));
    await writeFile(join(dir, "Visible.Movie.2020.mkv"), "x");

    const locked = join(dir, "locked");
    await mkdir(locked);
    await writeFile(join(locked, "Hidden.Movie.2021.mkv"), "x");
    await chmod(locked, 0o000);

    const found = await listVideoFilesUnder(dir);
    expect(found).toEqual([join(dir, "Visible.Movie.2020.mkv")]);
  });
});
