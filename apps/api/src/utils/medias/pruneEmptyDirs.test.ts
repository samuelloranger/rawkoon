import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneEmptyParentDirs } from "./pruneEmptyDirs";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("pruneEmptyParentDirs", () => {
  let base: string;
  let shows: string;
  let movies: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "rawkoon-prune-"));
    shows = join(base, "TV_Shows");
    movies = join(base, "Movies");
    await mkdir(shows);
    await mkdir(movies);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("removes the season and show folders once the last episode is gone", async () => {
    const season = join(shows, "Show", "Season 1");
    await mkdir(season, { recursive: true });

    await pruneEmptyParentDirs(join(season, "Show - S01E01.mkv"), [shows]);

    expect(await exists(join(shows, "Show"))).toBe(false);
    expect(await exists(shows)).toBe(true);
  });

  it("stops at the first folder that still holds something", async () => {
    const season1 = join(shows, "Show", "Season 1");
    const season2 = join(shows, "Show", "Season 2");
    await mkdir(season1, { recursive: true });
    await mkdir(season2, { recursive: true });
    await writeFile(join(season2, "Show - S02E01.mkv"), "x");

    await pruneEmptyParentDirs(join(season1, "Show - S01E01.mkv"), [shows]);

    expect(await exists(season1)).toBe(false);
    expect(await exists(join(season2, "Show - S02E01.mkv"))).toBe(true);
  });

  it("keeps a folder that still holds non-video files", async () => {
    const folder = join(movies, "Movie (2020)");
    await mkdir(folder);
    await writeFile(join(folder, "movie.nfo"), "x");

    await pruneEmptyParentDirs(join(folder, "Movie (2020).mkv"), [movies]);

    expect(await exists(join(folder, "movie.nfo"))).toBe(true);
  });

  it("never removes the library root, even when it is empty", async () => {
    await pruneEmptyParentDirs(join(movies, "Movie (2020).mkv"), [movies]);

    expect(await exists(movies)).toBe(true);
  });

  it("leaves folders outside every library root alone", async () => {
    const outside = join(base, "Downloads", "release");
    await mkdir(outside, { recursive: true });

    await pruneEmptyParentDirs(join(outside, "file.mkv"), [movies, shows]);

    expect(await exists(outside)).toBe(true);
  });

  it("does not treat a sibling with a shared prefix as inside the root", async () => {
    const lookalike = join(base, "Movies-old", "Movie (2020)");
    await mkdir(lookalike, { recursive: true });

    await pruneEmptyParentDirs(join(lookalike, "Movie (2020).mkv"), [movies]);

    expect(await exists(lookalike)).toBe(true);
  });

  it("keeps climbing when a parent was already removed", async () => {
    const season = join(shows, "Show", "Season 1");

    await mkdir(join(shows, "Show"));
    await pruneEmptyParentDirs(join(season, "Show - S01E01.mkv"), [shows]);

    expect(await exists(join(shows, "Show"))).toBe(false);
  });

  it("ignores blank and missing roots", async () => {
    const folder = join(movies, "Movie (2020)");
    await mkdir(folder);

    await pruneEmptyParentDirs(join(folder, "Movie (2020).mkv"), [
      "",
      null,
      undefined,
      movies,
    ]);

    expect(await exists(folder)).toBe(false);
  });
});
