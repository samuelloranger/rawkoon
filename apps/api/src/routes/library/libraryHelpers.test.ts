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
  tmdbStatus: null,
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

const withTitles = {
  ...base,
  titles: [
    { language: "en", title: "The Godfather" },
    { language: "fr", title: "Le Parrain" },
  ],
};

describe("mapLibraryMedia last search", () => {
  const searched = {
    ...base,
    lastSearchAt: new Date("2026-01-02T00:00:00Z"),
    lastSearchOutcome: "error",
    lastSearchReason: "The search failed",
  };

  it("hides the reason from non-admins but keeps the outcome", () => {
    const out = mapLibraryMedia(searched, undefined, { isAdmin: false });
    expect(out.last_search_reason).toBeNull();
    expect(out.last_search_outcome).toBe("error");
    expect(mapLibraryMedia(searched).last_search_reason).toBeNull();
  });

  it("shows the reason to admins", () => {
    expect(
      mapLibraryMedia(searched, undefined, { isAdmin: true })
        .last_search_reason,
    ).toBe("The search failed");
  });
});

describe("mapLibraryMedia title language", () => {
  it("defaults to the English title", () => {
    expect(mapLibraryMedia(withTitles).title).toBe("The Godfather");
  });

  it("uses the localized title when asked", () => {
    expect(mapLibraryMedia(withTitles, "fr").title).toBe("Le Parrain");
  });

  it("falls back to the English title when the row is missing", () => {
    const noFr = {
      ...base,
      titles: [{ language: "en", title: "The Godfather" }],
    };
    expect(mapLibraryMedia(noFr, "fr").title).toBe("The Godfather");
  });

  it("falls back to the English title when titles were not included", () => {
    expect(mapLibraryMedia(base, "fr").title).toBe("The Godfather");
  });

  it("keeps the manual override above the localized title", () => {
    const overridden = {
      ...withTitles,
      overrides: { title: "Godfather, The" },
    };
    expect(mapLibraryMedia(overridden, "fr").title).toBe("Godfather, The");
  });
});

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

describe("mapLibraryMedia status", () => {
  it("keeps the stored acquisition status and adds the airing state", () => {
    const airing = {
      ...base,
      type: "show",
      status: "downloaded",
      tmdbStatus: "Returning Series",
    };
    const out = mapLibraryMedia(airing);
    expect(out.status).toBe("downloaded");
    expect(out.airing_state).toBe("returning");
  });

  it("reports a finished show as ended", () => {
    const ended = { ...base, type: "show", tmdbStatus: "Canceled" };
    expect(mapLibraryMedia(ended).airing_state).toBe("ended");
  });

  it("has no airing state for a movie or an unknown TMDB status", () => {
    expect(mapLibraryMedia(base).airing_state).toBeNull();
    expect(
      mapLibraryMedia({ ...base, type: "show", tmdbStatus: "Pilot" })
        .airing_state,
    ).toBeNull();
  });
});
