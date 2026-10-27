import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { placeImportFile } from "@rawkoon/api/services/postProcessor/postProcessorHelpers";
import { packPathConflict } from "@rawkoon/api/services/postProcessor/postProcessorSeasonPack";

describe("placeImportFile", () => {
  let dir: string;
  let src: string;
  let dst: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "place-episode-"));
    src = join(dir, "new.mkv");
    dst = join(dir, "lib", "episode.mkv");
    await writeFile(src, "new");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("places the file when the destination is missing", async () => {
    expect(await placeImportFile(src, dst, "hardlink", false)).toBe(true);
    expect(await readFile(dst, "utf8")).toBe("new");
  });

  it("replaces a different file when the pack is an upgrade", async () => {
    await placeImportFile(src, dst, "hardlink", false);
    await rm(dst);
    await writeFile(dst, "old");
    expect(await placeImportFile(src, dst, "hardlink", true)).toBe(true);
    expect(await readFile(dst, "utf8")).toBe("new");
  });

  it("leaves an unrelated file alone when the pack is not an upgrade", async () => {
    await placeImportFile(src, dst, "hardlink", false);
    await rm(dst);
    await writeFile(dst, "old");
    expect(await placeImportFile(src, dst, "hardlink", false)).toBe(false);
    expect(await readFile(dst, "utf8")).toBe("old");
  });

  it("counts an existing hardlink of the source as placed", async () => {
    await placeImportFile(src, dst, "hardlink", false);
    expect(await placeImportFile(src, dst, "hardlink", false)).toBe(true);
  });

  it("does not count the source itself as a separate copy", async () => {
    expect(await placeImportFile(src, src, "hardlink", true)).toBe(false);
    expect((await stat(src)).size).toBe(3);
  });
});

describe("packPathConflict", () => {
  it("refuses an episode whose path another episode in the pack also renders to", () => {
    expect(
      packPathConflict({
        sharedInPack: true,
        ownerEpisodeId: null,
        episodeId: 2,
      }),
    ).toContain("same library path");
  });

  it("refuses a path the library records for another episode", () => {
    expect(
      packPathConflict({
        sharedInPack: false,
        ownerEpisodeId: 1,
        episodeId: 2,
      }),
    ).toContain("another episode's file");
  });

  it("allows a free path or one already recorded for this episode", () => {
    expect(
      packPathConflict({
        sharedInPack: false,
        ownerEpisodeId: null,
        episodeId: 2,
      }),
    ).toBeNull();
    expect(
      packPathConflict({
        sharedInPack: false,
        ownerEpisodeId: 2,
        episodeId: 2,
      }),
    ).toBeNull();
  });
});
