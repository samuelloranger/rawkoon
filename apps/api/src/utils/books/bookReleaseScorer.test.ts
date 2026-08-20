import { describe, expect, test } from "bun:test";
import {
  meetsBookCutoff,
  pickBestBookRelease,
  releaseMatchesAuthor,
  releaseMatchesBookTitle,
  scoreBookRelease,
  type BookScoreProfile,
} from "@rawkoon/api/utils/books/bookReleaseScorer";

/**
 * Synthetic fixtures with an invented title and author, shaped like the results
 * a live Jackett aggregate returns for book categories. The sizes are realistic
 * because the scorer uses them to tell an ebook from an audiobook.
 *
 * The set deliberately includes a decoy: a different translation of the same
 * work, whose title shares a prefix with the wanted one. It is what proves
 * title matching compares whole tokens rather than substrings.
 */
const RELEASE_FIXTURES = [
  {
    title: "La Serre - Camille Rousseau - 2025 [MP3 à 64 kb/s]",
    sizeBytes: 262 * 1_048_576,
    seeders: 5,
    indexer: "tracker-a",
  },
  {
    title: "La.Serre.Camille.Rousseau.2025.FR.[EPUB]-NOTAG",
    sizeBytes: 1 * 1_048_576,
    seeders: 12,
    indexer: "tracker-a",
  },
  {
    title: "La Serre - Camille Rousseau - 2025 Fr [Epub]",
    sizeBytes: 1 * 1_048_576,
    seeders: 8,
    indexer: "tracker-b",
  },
  {
    title: "La serre - Camille Rousseau  [ePub] Fr",
    sizeBytes: 5 * 1_048_576,
    seeders: 3,
    indexer: "tracker-b",
  },
  {
    title: "Camille Rousseau – Le serrurier (The Greenhouse) - ePUB Fr",
    sizeBytes: 1 * 1_048_576,
    seeders: 1,
    indexer: "tracker-c",
  },
  {
    title: "La.Serre.Camille.Rousseau.2025.FR.[MP3.192kbps]-NOTAG",
    sizeBytes: 810 * 1_048_576,
    seeders: 6,
    indexer: "tracker-a",
  },
];

const EBOOK_PROFILE: BookScoreProfile = {
  allowedFormats: ["epub", "azw3", "mobi", "pdf"],
  cutoffFormat: "epub",
  preferRetail: true,
  maxSizeMb: null,
  minSeeders: 1,
  minAudioBitrate: null,
  preferredLanguages: ["fr"],
  prioritizedTrackers: [],
  preferTrackerOverQuality: false,
};

const AUDIO_PROFILE: BookScoreProfile = {
  allowedFormats: ["m4b", "mp3", "flac", "ogg"],
  cutoffFormat: "m4b",
  preferRetail: true,
  maxSizeMb: null,
  minSeeders: 1,
  minAudioBitrate: 96,
  preferredLanguages: ["fr"],
  prioritizedTrackers: [],
  preferTrackerOverQuality: false,
};

const FR_BOOK = { bookTitle: "La serre", authors: ["Camille Rousseau"] };

describe("title matching separates two competing translations", () => {
  test("the correct French title matches", () => {
    expect(
      releaseMatchesBookTitle(
        "La.Serre.Camille.Rousseau.2025.FR.[EPUB]-NOTAG",
        "La serre",
      ),
    ).toBe(true);
  });

  test("a different translation of the same work does NOT match", () => {
    // The decoy title shares a prefix with the wanted one, so a substring
    // comparison would wrongly accept it. Token equality rejects it.
    expect(
      releaseMatchesBookTitle(
        "Camille Rousseau – Le serrurier (The Greenhouse) - ePUB Fr",
        "La serre",
      ),
    ).toBe(false);
  });

  test("accents and case are ignored", () => {
    expect(releaseMatchesBookTitle("LA SERRE [epub]", "La Sèrre")).toBe(true);
  });

  test("an unrelated book is rejected", () => {
    expect(
      releaseMatchesBookTitle("Le jardin clos - Rousseau [epub]", "La serre"),
    ).toBe(false);
  });
});

describe("author matching", () => {
  test("surname is enough", () => {
    expect(
      releaseMatchesAuthor("La.Serre.Rousseau.EPUB", ["Camille Rousseau"]),
    ).toBe(true);
  });

  test("a different author is rejected", () => {
    expect(
      releaseMatchesAuthor("La.Serre.Delacroix.EPUB", ["Camille Rousseau"]),
    ).toBe(false);
  });

  test("no known authors means no author check", () => {
    expect(releaseMatchesAuthor("Anything At All", [])).toBe(true);
  });
});

describe("ebook edition against the fixture set", () => {
  const scored = RELEASE_FIXTURES.map((r) => ({
    release: r,
    result: scoreBookRelease(r, {
      ...FR_BOOK,
      kind: "ebook",
      profile: EBOOK_PROFILE,
    }),
  }));

  test("accepts exactly the three matching ebooks", () => {
    const accepted = scored
      .filter((s) => !s.result.rejected)
      .map((s) => s.release.title);
    expect(accepted).toEqual([
      "La.Serre.Camille.Rousseau.2025.FR.[EPUB]-NOTAG",
      "La Serre - Camille Rousseau - 2025 Fr [Epub]",
      "La serre - Camille Rousseau  [ePub] Fr",
    ]);
  });

  test("rejects the other translation on title, not on format", () => {
    const other = scored.find((s) => s.release.title.includes("Le serrurier"))!;
    expect(other.result.rejected).toBe(true);
    expect(other.result.rejections).toContain("Title does not match");
  });

  test("rejects both audiobooks when the ebook edition is wanted", () => {
    const audio = scored.filter((s) => s.release.title.includes("MP3"));
    expect(audio).toHaveLength(2);
    for (const a of audio) {
      expect(a.result.rejected).toBe(true);
      expect(a.result.rejections).toContain(
        "Release is a audiobook, wanted ebook",
      );
    }
  });

  test("picks an epub", () => {
    const best = pickBestBookRelease(scored);
    expect(best?.result.parsed.format).toBe("epub");
  });
});

describe("audiobook edition against the fixture set", () => {
  const scored = RELEASE_FIXTURES.map((r) => ({
    release: r,
    result: scoreBookRelease(r, {
      ...FR_BOOK,
      kind: "audiobook",
      profile: AUDIO_PROFILE,
    }),
  }));

  test("the 64 kb/s release is rejected by minAudioBitrate", () => {
    const low = scored.find((s) => s.release.title.includes("64 kb/s"))!;
    expect(low.result.rejected).toBe(true);
    expect(low.result.rejections).toContain("Bitrate 64 kbps below 96");
  });

  test("the higher-bitrate release wins regardless of indexer category", () => {
    // Trackers file audiobooks under the Books category too, so kind is
    // derived from the parsed format and never from the category.
    const best = pickBestBookRelease(scored);
    expect(best?.release.title).toBe(
      "La.Serre.Camille.Rousseau.2025.FR.[MP3.192kbps]-NOTAG",
    );
    expect(best?.result.kind).toBe("audiobook");
  });
});

describe("scoring order", () => {
  test("format preference outranks seeders", () => {
    const profile = { ...EBOOK_PROFILE, minSeeders: 0 };
    const epubFewSeeds = scoreBookRelease(
      {
        title: "La Serre Rousseau [EPUB]",
        sizeBytes: 1_048_576,
        seeders: 1,
        indexer: null,
      },
      { ...FR_BOOK, kind: "ebook", profile },
    );
    const pdfManySeeds = scoreBookRelease(
      {
        title: "La Serre Rousseau [PDF]",
        sizeBytes: 1_048_576,
        seeders: 999,
        indexer: null,
      },
      { ...FR_BOOK, kind: "ebook", profile },
    );
    expect(epubFewSeeds.score).toBeGreaterThan(pdfManySeeds.score);
  });

  test("a retail marker is a bonus, never a requirement", () => {
    const profile = { ...EBOOK_PROFILE, minSeeders: 0 };
    const plain = scoreBookRelease(
      {
        title: "La Serre Rousseau [EPUB]",
        sizeBytes: 1_048_576,
        seeders: 5,
        indexer: null,
      },
      { ...FR_BOOK, kind: "ebook", profile },
    );
    const retail = scoreBookRelease(
      {
        title: "La Serre Rousseau RETAIL [EPUB]",
        sizeBytes: 1_048_576,
        seeders: 5,
        indexer: null,
      },
      { ...FR_BOOK, kind: "ebook", profile },
    );
    // Untagged releases must stay viable: most carry no retail marker at all.
    expect(plain.rejected).toBe(false);
    expect(retail.score).toBeGreaterThan(plain.score);
  });

  test("multi-book packs are rejected", () => {
    const r = scoreBookRelease(
      {
        title: "Camille Rousseau - La Serre - Intégrale [EPUB]",
        sizeBytes: 20 * 1_048_576,
        seeders: 50,
        indexer: null,
      },
      { ...FR_BOOK, kind: "ebook", profile: EBOOK_PROFILE },
    );
    expect(r.rejections).toContain("Multi-book pack");
  });
});

describe("meetsBookCutoff", () => {
  test("epub meets an epub cutoff", () => {
    expect(meetsBookCutoff("epub", EBOOK_PROFILE)).toBe(true);
  });
  test("pdf does not meet an epub cutoff", () => {
    expect(meetsBookCutoff("pdf", EBOOK_PROFILE)).toBe(false);
  });
  test("no file means the cutoff is not met", () => {
    expect(meetsBookCutoff(null, EBOOK_PROFILE)).toBe(false);
  });
});
