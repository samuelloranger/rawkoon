import { describe, expect, it } from "vitest";
import {
  filterAndSortReleases,
  normalizeFilterKey,
} from "./interactive-search";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";

function makeRelease(title: string): InteractiveReleaseItem {
  return {
    guid: title,
    title,
    indexer: "test",
    indexer_id: null,
    languages: [],
    protocol: "torrent",
    size_bytes: 1_000_000_000,
    age: 1,
    seeders: 10,
    leechers: 2,
    rejected: false,
    rejection_reason: null,
    info_url: null,
    source: "jackett",
    download_token: null,
    download_url: null,
    quality_score: null,
    parsed_quality: null,
    is_season_pack: false,
    is_complete_series: false,
    freeleech: false,
  };
}

const BASE_FILTER = {
  filterQuery: "",
  hideRejected: true,
  includedTrackers: [],
  excludedTrackers: [],
  includedLanguages: [],
  sortBy: "seeders" as const,
  sortDir: "desc" as const,
  isSearchMode: true,
  mediaTitle: "Jérémie: rendez-vous à la plage",
  mediaYear: 2024,
};

// ---------------------------------------------------------------------------
// normalizeFilterKey
// ---------------------------------------------------------------------------

describe("normalizeFilterKey", () => {
  it("strips diacritics so accented and unaccented text compare equal", () => {
    expect(normalizeFilterKey("Jérémie")).toBe("jeremie");
    expect(normalizeFilterKey("rendez-vous à la plage")).toBe(
      "rendez-vous a la plage",
    );
    expect(normalizeFilterKey("CAFÉ")).toBe("cafe");
  });
});

// ---------------------------------------------------------------------------
// filterAndSortReleases — client-side rejection with French accented mediaTitle
// ---------------------------------------------------------------------------

describe("filterAndSortReleases — isClientRejected with accented French title", () => {
  it("passes an ASCII-normalised release that matches the French title", () => {
    // "Jérémie: rendez-vous à la plage" → titleWords ["jeremie","rendez","vous","plage"]
    // This release contains all 4 distinctive words → should NOT be rejected.
    const result = filterAndSortReleases(
      [makeRelease("Jeremie.Rendez.Vous.A.La.Plage.2024.FRENCH.1080p.BluRay")],
      BASE_FILTER,
    );
    expect(result).toHaveLength(1);
  });

  it("passes a release whose title still has accented characters", () => {
    // normalizedRelease strips diacritics: "jérémie.rendez-vous.à.la.plage" →
    // "jeremie rendez vous a la plage" — all 4 words present.
    const result = filterAndSortReleases(
      [makeRelease("Jérémie.Rendez-vous.à.la.plage.2024.FRENCH.HDRip")],
      BASE_FILTER,
    );
    expect(result).toHaveLength(1);
  });

  it("rejects a release whose year does not match", () => {
    const result = filterAndSortReleases(
      [makeRelease("Jeremie.Rendez.Vous.A.La.Plage.2019.FRENCH.1080p")],
      BASE_FILTER,
    );
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Regression: before the NFD fix, titleWords for "Jérémie: rendez-vous à
  // la plage" were ["mie","rendez","vous","plage"] instead of the correct
  // ["jeremie","rendez","vous","plage"]. The fragment "mie" can appear as a
  // substring of unrelated words (e.g. "premier" = p-r-e-m-i-e-r) causing
  // unrelated releases to incorrectly pass the 70 % threshold.
  // -------------------------------------------------------------------------
  it("rejects a release from a different movie that contains 'premier' (has 'mie' as substring) and 'rendezvous'", () => {
    // Before fix: titleWords = ["mie","rendez","vous","plage"]
    //   "mie" hits inside "premier", "rendez" hits inside "rendezvous",
    //   "vous" hits inside "rendezvous" → 3/4 = 75 % → NOT rejected (bug).
    // After fix:  titleWords = ["jeremie","rendez","vous","plage"]
    //   "jeremie" absent → 2/4 = 50 % → REJECTED (correct).
    const result = filterAndSortReleases(
      [makeRelease("Ratatouille.Premier.Rendezvous.2024.FRENCH.1080p.BluRay")],
      BASE_FILTER,
    );
    expect(result).toHaveLength(0);
  });

  it("rejects a completely unrelated release", () => {
    const result = filterAndSortReleases(
      [makeRelease("The.Dark.Knight.2008.1080p.BluRay.x264")],
      BASE_FILTER,
    );
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterAndSortReleases — accent-insensitive filterQuery (text box)
// ---------------------------------------------------------------------------

describe("filterAndSortReleases — filterQuery accent stripping", () => {
  it("unaccented filter query matches an accented release title", () => {
    const result = filterAndSortReleases(
      [makeRelease("Jérémie.Rendez-vous.à.la.plage.2024.FRENCH")],
      {
        ...BASE_FILTER,
        hideRejected: false,
        filterQuery: "jeremie",
      },
    );
    expect(result).toHaveLength(1);
  });

  it("accented filter query matches an ASCII release title", () => {
    const result = filterAndSortReleases(
      [makeRelease("Jeremie.Rendez.Vous.2024.FRENCH.1080p")],
      {
        ...BASE_FILTER,
        hideRejected: false,
        filterQuery: "Jérémie",
      },
    );
    expect(result).toHaveLength(1);
  });
});
