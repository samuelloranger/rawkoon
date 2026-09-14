import { describe, expect, it } from "bun:test";
import { mapLibraryMedia } from "./libraryHelpers";

const base = {
  id: 1,
  tmdbId: 238,
  type: "movie",
  title: "The Godfather",
  sortTitle: "Godfather",
  year: 1972,
  status: "downloaded",
  monitored: true,
  posterUrl: null,
  overview: null,
  digitalReleaseDate: null,
  qualityProfileId: null,
  searchAttempts: 0,
  qualityProfile: null,
  addedAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("mapLibraryMedia backdrop override", () => {
  it("is null with no override", () => {
    expect(mapLibraryMedia(base).backdrop_url).toBeNull();
  });

  it("returns the override when set", () => {
    const item = { ...base, overrides: { backdrop_url: "https://x/b.jpg" } };
    expect(mapLibraryMedia(item).backdrop_url).toBe("https://x/b.jpg");
  });

  it("ignores a non-string override", () => {
    const item = { ...base, overrides: { backdrop_url: 42 } };
    expect(mapLibraryMedia(item).backdrop_url).toBeNull();
  });
});

describe("mapLibraryMedia poster override", () => {
  it("prefers the override over the stored poster", () => {
    const item = {
      ...base,
      posterUrl: "https://tmdb/p.jpg",
      overrides: { poster_url: "https://x/p.jpg" },
    };
    expect(mapLibraryMedia(item).poster_url).toBe("https://x/p.jpg");
  });

  it("falls back to the stored poster", () => {
    const item = { ...base, posterUrl: "https://tmdb/p.jpg" };
    expect(mapLibraryMedia(item).poster_url).toBe("https://tmdb/p.jpg");
  });
});
