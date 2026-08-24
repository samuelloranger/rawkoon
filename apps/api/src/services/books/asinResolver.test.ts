import { describe, expect, test } from "bun:test";
import {
  ASIN_MIN_SCORE,
  extractVolumeNumber,
  pickBestAsin,
  scoreAsinCandidate,
} from "@rawkoon/api/services/books/asinResolver";
import type {
  AsinCandidate,
  AsinWant,
} from "@rawkoon/api/services/books/types";

/**
 * Scrubbed fixtures: invented titles and authors, real observed shapes. Each
 * case below pins a hazard measured against a live provider on 2026-08-24.
 */
const candidate = (over: Partial<AsinCandidate>): AsinCandidate => ({
  asin: "B000000001",
  title: "Le Jardin de Verre",
  subtitle: null,
  authors: ["Camille Rousseau"],
  narrators: [],
  seriesName: null,
  seriesPosition: null,
  language: "french",
  runtimeMin: null,
  publisher: null,
  releaseDate: null,
  coverUrl: null,
  genres: [],
  ...over,
});

describe("extractVolumeNumber", () => {
  test("reads the volume markers providers actually use", () => {
    expect(extractVolumeNumber("Les Jeux - tome 2 L'embrasement")).toBe(2);
    expect(extractVolumeNumber("Le Jardin de Verre Tome 1")).toBe(1);
    expect(extractVolumeNumber("The Glasshouse, Book 3")).toBe(3);
    expect(extractVolumeNumber("Chroniques vol. 4")).toBe(4);
    expect(extractVolumeNumber("Chroniques, Volume 12")).toBe(12);
  });

  test("returns null when there is no volume marker", () => {
    expect(extractVolumeNumber("Le Jardin de Verre")).toBeNull();
    // A bare year must not be read as a volume number.
    expect(extractVolumeNumber("Chroniques 1998")).toBeNull();
  });
});

describe("scoreAsinCandidate", () => {
  const want: AsinWant = {
    title: "Le Jardin de Verre",
    authors: ["Camille Rousseau"],
    language: "fr",
  };

  test("scores an exact normalized title with matching author above the floor", () => {
    expect(scoreAsinCandidate(want, candidate({}))).toBeGreaterThanOrEqual(
      ASIN_MIN_SCORE,
    );
  });

  test("ignores diacritics and punctuation when comparing titles", () => {
    expect(
      scoreAsinCandidate(want, candidate({ title: "LE JARDIN DE VERRE!" })),
    ).toBeGreaterThanOrEqual(ASIN_MIN_SCORE);
  });

  /**
   * The hazard this module exists for. Observed live: naive substring matching
   * mapped a "tome 2" library title onto the tome-1 product, because the
   * tome-1 title is a strict prefix of the tome-2 title. The tome-1 product's
   * own title carries no number — only its seriesPosition does — so the
   * candidate's volume must fall back to seriesPosition or the collision
   * survives.
   */
  test("disqualifies a candidate whose volume number disagrees", () => {
    const wantVol2: AsinWant = {
      title: "Les Jeux - tome 2 L'embrasement",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const vol1 = candidate({
      title: "Les Jeux",
      seriesName: "Les Jeux",
      seriesPosition: 1,
    });
    expect(scoreAsinCandidate(wantVol2, vol1)).toBe(-1);
    expect(pickBestAsin(wantVol2, [vol1])).toBeNull();
  });

  test("reads the candidate volume from its subtitle when the title lacks one", () => {
    const wantVol3: AsinWant = {
      title: "Le Jardin de Verre Tome 3",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const vol1 = candidate({
      title: "Le Jardin de Verre",
      subtitle: "Le Jardin de Verre - Tome 1",
    });
    expect(scoreAsinCandidate(wantVol3, vol1)).toBe(-1);
  });

  /**
   * Observed live: a French edition came back from the catalog with
   * language "english". Language may score, but must never gate — gating on it
   * loses a correct match outright.
   *
   * The real shape matters here and an earlier version of this test missed the
   * bug by giving the candidate an identical title. In the field the library
   * title carries an edition suffix the catalog title lacks, so the pair only
   * reaches containment scoring, and with the language signal also lost the
   * total fell BELOW the floor — the correct match was silently dropped. Hence
   * the edition-noise strip.
   */
  test("an edition suffix plus a mislabelled language still clears the floor", () => {
    const score = scoreAsinCandidate(
      {
        title: "Le Jardin de Verre - Version française",
        authors: ["Camille Rousseau"],
        language: "fr",
      },
      candidate({ title: "Le Jardin de Verre", language: "english" }),
    );
    expect(score).toBeGreaterThanOrEqual(ASIN_MIN_SCORE);
  });

  /**
   * The volume collision in its nastier form: a later volume whose title
   * CONTAINS the earlier volume's title, where NEITHER title carries a volume
   * marker, so the volume check cannot save it. Observed live across three
   * volumes of one series.
   *
   * Containment alone must therefore never clear the floor. Only corroboration
   * — an exact title or a confirmed volume match — should.
   */
  test("rejects a sibling volume that merely contains the candidate title", () => {
    const sequel: AsinWant = {
      title: "Les Secrets du Jardin de Verre",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const volume1 = candidate({
      title: "Le Jardin de Verre",
      seriesName: "Le Jardin de Verre",
      seriesPosition: 1,
    });
    expect(scoreAsinCandidate(sequel, volume1)).toBeLessThan(ASIN_MIN_SCORE);
    expect(pickBestAsin(sequel, [volume1])).toBeNull();
  });

  test("a confirmed volume match lets a containment hit clear the floor", () => {
    const wantVol1: AsinWant = {
      title: "Le Jardin de Verre Tome 1",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const vol1 = candidate({
      title: "Le Jardin de Verre",
      seriesName: "Le Jardin de Verre",
      seriesPosition: 1,
    });
    expect(scoreAsinCandidate(wantVol1, vol1)).toBeGreaterThanOrEqual(
      ASIN_MIN_SCORE,
    );
  });

  test("a wholly different author disqualifies", () => {
    expect(
      scoreAsinCandidate(want, candidate({ authors: ["Nenad Savic"] })),
    ).toBe(-1);
  });
});

describe("pickBestAsin", () => {
  test("returns nothing rather than a weak guess", () => {
    const want: AsinWant = {
      title: "Mises en Abyme",
      authors: ["Guillaume Tremblay"],
      language: "fr",
    };
    // Stands in for the observed live case of a title with no Audible edition:
    // the catalog returned unrelated products.
    expect(pickBestAsin(want, [candidate({})])).toBeNull();
  });

  test("picks the highest scorer among plausible candidates", () => {
    const want: AsinWant = {
      title: "Le Jardin de Verre",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const best = pickBestAsin(want, [
      candidate({ asin: "B000000002", title: "Le Jardin de Verre - extrait" }),
      candidate({ asin: "B000000003" }),
    ]);
    expect(best?.candidate.asin).toBe("B000000003");
  });

  test("returns nothing for an empty candidate list", () => {
    expect(
      pickBestAsin(
        {
          title: "Le Jardin de Verre",
          authors: ["Camille Rousseau"],
          language: "fr",
        },
        [],
      ),
    ).toBeNull();
  });
});
