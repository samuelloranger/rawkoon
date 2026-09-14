import { describe, expect, it } from "bun:test";
import { parseTmdbImages } from "@rawkoon/api/services/images/tmdbImageProvider";

const raw = {
  posters: [
    {
      file_path: "/a.jpg",
      width: 2000,
      height: 3000,
      iso_639_1: "en",
      vote_average: 5.6,
    },
    {
      file_path: "/b.jpg",
      width: 1000,
      height: 1500,
      iso_639_1: null,
      vote_average: 8.1,
    },
    { file_path: null, width: 1, height: 1, iso_639_1: "fr", vote_average: 9 },
  ],
  backdrops: [
    {
      file_path: "/c.jpg",
      width: 3840,
      height: 2160,
      iso_639_1: "fr",
      vote_average: 3.2,
    },
  ],
};

describe("parseTmdbImages", () => {
  it("maps posters to candidates", () => {
    const out = parseTmdbImages(raw, "poster");
    expect(out).toHaveLength(2);
    const first = out[0];
    expect(first.source).toBe("tmdb");
    expect(first.url).toBe("https://image.tmdb.org/t/p/original/b.jpg");
    expect(first.thumb_url).toBe("https://image.tmdb.org/t/p/w342/b.jpg");
  });

  it("sorts by vote descending", () => {
    expect(parseTmdbImages(raw, "poster").map((c) => c.vote)).toEqual([
      8.1, 5.6,
    ]);
  });

  it("keeps the image language, null included", () => {
    const out = parseTmdbImages(raw, "poster");
    expect(out.map((c) => c.language)).toEqual([null, "en"]);
  });

  it("uses the backdrop thumbnail size for backdrops", () => {
    const out = parseTmdbImages(raw, "backdrop");
    expect(out[0].thumb_url).toBe("https://image.tmdb.org/t/p/w780/c.jpg");
    expect(out[0].url).toBe("https://image.tmdb.org/t/p/original/c.jpg");
  });

  it("skips entries with no file_path", () => {
    expect(parseTmdbImages(raw, "poster").every((c) => c.url.length > 0)).toBe(
      true,
    );
  });

  it("does not cap the list at 12", () => {
    const many = {
      posters: Array.from({ length: 30 }, (_, i) => ({
        file_path: `/p${i}.jpg`,
        width: 1,
        height: 1,
        iso_639_1: "en",
        vote_average: i,
      })),
    };
    expect(parseTmdbImages(many, "poster")).toHaveLength(30);
  });

  it("returns an empty list for a malformed payload", () => {
    expect(parseTmdbImages(null, "poster")).toEqual([]);
    expect(parseTmdbImages({ posters: "nope" }, "poster")).toEqual([]);
  });
});
