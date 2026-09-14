import { describe, expect, it } from "bun:test";
import { mergeArtworkCandidates } from "@rawkoon/api/services/images/artworkService";
import type { ArtworkCandidate } from "@rawkoon/shared/types";

const c = (
  url: string,
  source: "tmdb" | "fanart",
  vote: number | null,
): ArtworkCandidate => ({
  url,
  thumb_url: url,
  width: null,
  height: null,
  language: null,
  vote,
  source,
});

describe("mergeArtworkCandidates", () => {
  it("puts TMDB candidates before fanart ones", () => {
    const out = mergeArtworkCandidates([
      [c("t1", "tmdb", 1)],
      [c("f1", "fanart", 999)],
    ]);
    expect(out.map((x) => x.url)).toEqual(["t1", "f1"]);
  });

  it("sorts by vote within each source", () => {
    const out = mergeArtworkCandidates([
      [c("t1", "tmdb", 1), c("t2", "tmdb", 8)],
      [c("f1", "fanart", 2), c("f2", "fanart", 40)],
    ]);
    expect(out.map((x) => x.url)).toEqual(["t2", "t1", "f2", "f1"]);
  });

  it("dedupes by url, first occurrence wins", () => {
    const out = mergeArtworkCandidates([
      [c("same", "tmdb", 5)],
      [c("same", "fanart", 99)],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("tmdb");
  });

  it("treats a null vote as lowest", () => {
    const out = mergeArtworkCandidates([
      [c("t1", "tmdb", null), c("t2", "tmdb", 1)],
    ]);
    expect(out.map((x) => x.url)).toEqual(["t2", "t1"]);
  });

  it("handles empty input", () => {
    expect(mergeArtworkCandidates([])).toEqual([]);
    expect(mergeArtworkCandidates([[], []])).toEqual([]);
  });
});
