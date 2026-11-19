import { describe, expect, it } from "bun:test";
import {
  evaluateOrphans,
  ORPHAN_MIN_AGE_MS,
  selectOrphans,
  type DownloadEntry,
} from "./orphanedDownloads";

const NOW = 10 * ORPHAN_MIN_AGE_MS;
const entry = (over: Partial<DownloadEntry> = {}): DownloadEntry => ({
  name: "Some.Movie.2020",
  sizeBytes: 1024 ** 3,
  newestMtimeMs: 0,
  linkedToLibrary: false,
  ...over,
});
const torrent = (over: Record<string, string | null> = {}) => ({
  name: "Other",
  contentPath: "/data/downloads/Other",
  savePath: "/data/downloads",
  ...over,
});

describe("selectOrphans", () => {
  it("flags an old unlinked entry no torrent owns", () => {
    expect(selectOrphans([entry()], [torrent()], NOW)).toHaveLength(1);
  });

  it("skips entries a torrent owns by name or content path segment", () => {
    expect(
      selectOrphans([entry()], [torrent({ name: "Some.Movie.2020" })], NOW),
    ).toHaveLength(0);
    expect(
      selectOrphans(
        [entry()],
        [torrent({ contentPath: "/mnt/dl/Some.Movie.2020/file.mkv" })],
        NOW,
      ),
    ).toHaveLength(0);
    expect(
      selectOrphans(
        [entry({ name: "movies" })],
        [torrent({ contentPath: "/mnt/dl/movies/Foo" })],
        NOW,
      ),
    ).toHaveLength(0);
  });

  it("skips entries hardlinked into the library", () => {
    expect(
      selectOrphans([entry({ linkedToLibrary: true })], [], NOW),
    ).toHaveLength(0);
  });

  it("skips entries younger than the grace period", () => {
    const fresh = entry({ newestMtimeMs: NOW - ORPHAN_MIN_AGE_MS + 1 });
    expect(selectOrphans([fresh], [], NOW)).toHaveLength(0);
  });
});

describe("evaluateOrphans", () => {
  it("is ok with none", () => {
    expect(evaluateOrphans([]).status).toBe("ok");
  });

  it("warns with count, size and at most 10 names", () => {
    const many = Array.from({ length: 12 }, (_, i) => entry({ name: `n${i}` }));
    const outcome = evaluateOrphans(many);
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("12 items (12.0 GB)");
    expect(outcome.summary).toContain("n9");
    expect(outcome.summary).not.toContain("n10");
    expect(outcome.summary).toContain("and 2 more");
    expect(outcome.fix).toContain("delete");
  });
});
