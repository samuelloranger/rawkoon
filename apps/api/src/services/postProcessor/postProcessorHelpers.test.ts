import { describe, expect, it } from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyFileAtomic,
  parseSeasonEpisode,
  replaceFile,
} from "./postProcessorHelpers";

describe("parseSeasonEpisode", () => {
  it.each([
    ["Show.S02E05.1080p.mkv", { season: 2, episode: 5 }],
    ["Show.1x05.720p.mkv", { season: 1, episode: 5 }],
    [
      "[SubsPlease] Show - 05 (1080p) [ABCD1234].mkv",
      { season: null, episode: 5 },
    ],
    ["[Grp] Show - 13v2 [1080p].mkv", { season: null, episode: 13 }],
    ["Show - 1001.mkv", { season: null, episode: 1001 }],
    ["Show E05.mkv", { season: null, episode: 5 }],
    ["Show.Ep.12.mkv", { season: null, episode: 12 }],
    ["Extras.S01E02.720p.mkv", { season: 1, episode: 2 }],
  ])("%s", (name, expected) => {
    expect(parseSeasonEpisode(name)).toEqual(expected);
  });

  it.each([
    "Show 2019 1080p.mkv",
    "Show - 2019 [1080p].mkv",
    "Show 1920x1080 x265.mkv",
    "Show.DDP5.1.E-AC3.mkv",
    "Show.S01E01.sample.mkv",
    "Show - 01 sample.mkv",
    "Extras - 01.mkv",
    "[Grp] Show - NCOP 01 [1080p].mkv",
  ])("rejects %s", (name) => {
    expect(parseSeasonEpisode(name)).toBeNull();
  });
});

describe("replaceFile", () => {
  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "rawkoon-replace-"));
    const src = join(dir, "new.mkv");
    const dst = join(dir, "lib", "Movie (2020).mkv");
    await writeFile(src, "new release");
    await Bun.write(dst, "old release");
    return { dir, src, dst };
  }

  it("hardlinks the new file over the old one", async () => {
    const { dir, src, dst } = await setup();
    try {
      await replaceFile(src, dst, "hardlink");
      expect(await readFile(dst, "utf8")).toBe("new release");
      expect((await stat(dst)).ino).toBe((await stat(src)).ino);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("moves the new file over the old one", async () => {
    const { dir, src, dst } = await setup();
    try {
      await replaceFile(src, dst, "move");
      expect(await readFile(dst, "utf8")).toBe("new release");
      expect(await Bun.file(src).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves a file that is already the source alone", async () => {
    const { dir, src, dst } = await setup();
    try {
      await replaceFile(src, dst, "hardlink");
      await replaceFile(src, dst, "hardlink");
      expect(await readFile(dst, "utf8")).toBe("new release");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a leftover temp file that holds a different release", async () => {
    const { dir, src, dst } = await setup();
    try {
      const stale = join(dir, "lib", ".Movie (2020).mkv.rawkoon-upgrade");
      await writeFile(stale, "interrupted release");
      await replaceFile(src, dst, "hardlink");
      expect(await readFile(dst, "utf8")).toBe("new release");
      expect(await readFile(stale, "utf8")).toBe("interrupted release");
      expect(await readdir(join(dir, "lib"))).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when the source already is the destination", async () => {
    const { dir, dst } = await setup();
    try {
      await replaceFile(dst, dst, "move");
      expect(await readFile(dst, "utf8")).toBe("old release");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("copyFileAtomic", () => {
  it("copies into place without leaving a temp file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rawkoon-copy-"));
    try {
      const src = join(dir, "src.mkv");
      const dst = join(dir, "dst.mkv");
      await writeFile(src, "release");
      await copyFileAtomic(src, dst);
      expect(await readFile(dst, "utf8")).toBe("release");
      expect((await readdir(dir)).sort()).toEqual(["dst.mkv", "src.mkv"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves neither a partial nor a final file when the copy fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rawkoon-copy-"));
    try {
      await expect(
        copyFileAtomic(join(dir, "missing.mkv"), join(dir, "dst.mkv")),
      ).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
