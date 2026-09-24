import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const findUnique = mock(
  async (_args: unknown): Promise<unknown> => ({
    moviesLibraryPath: null,
    showsLibraryPath: null,
  }),
);

mock.module("@rawkoon/api/db", () => ({
  prisma: { mediaSettings: { findUnique } },
}));

const { pruneLibraryDirsAfterDelete } = await import(
  "@rawkoon/api/services/library/pruneLibraryDirs"
);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("pruneLibraryDirsAfterDelete", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "rawkoon-prune-lib-"));
    findUnique.mockClear();
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("prunes under both the movies and shows roots", async () => {
    const movies = join(base, "Movies");
    const shows = join(base, "TV_Shows");
    await mkdir(join(movies, "Movie (2020)"), { recursive: true });
    await mkdir(join(shows, "Show", "Season 1"), { recursive: true });
    findUnique.mockImplementationOnce(async () => ({
      moviesLibraryPath: movies,
      showsLibraryPath: shows,
    }));

    await pruneLibraryDirsAfterDelete([
      join(movies, "Movie (2020)", "Movie (2020).mkv"),
      join(shows, "Show", "Season 1", "Show - S01E01.mkv"),
    ]);

    expect(await exists(join(movies, "Movie (2020)"))).toBe(false);
    expect(await exists(join(shows, "Show"))).toBe(false);
    expect(await exists(movies)).toBe(true);
    expect(await exists(shows)).toBe(true);
  });

  it("does nothing when no library path is configured", async () => {
    const folder = join(base, "Movies", "Movie (2020)");
    await mkdir(folder, { recursive: true });

    await pruneLibraryDirsAfterDelete([join(folder, "Movie (2020).mkv")]);

    expect(await exists(folder)).toBe(true);
  });

  it("skips the settings lookup when there is nothing to prune", async () => {
    await pruneLibraryDirsAfterDelete([]);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it("swallows a settings lookup failure", async () => {
    findUnique.mockImplementationOnce(async () => {
      throw new Error("db down");
    });

    await expect(
      pruneLibraryDirsAfterDelete([join(base, "Movies", "a.mkv")]),
    ).resolves.toBeUndefined();
  });
});
