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

/**
 * A wrong-language product is the failure this scorer exists to prevent, and
 * for a long while it could not: an exact title plus a full author match scores
 * 80 on its own, so the 10-point language signal could never change a verdict.
 *
 * Measured live 2026-08-25 on `api.audible.fr` for "Vengeful Schwab": the only
 * non-German hit is the English Macmillan Audio product. There is no French
 * audiobook, so the correct answer is no ASIN — instead the English record was
 * attached and its blurb, cover, narrator and publisher displaced the French
 * ones from Google Books.
 */
describe("scoreAsinCandidate language mismatch", () => {
  const want: AsinWant = {
    title: "Le Jardin de Verre",
    authors: ["Camille Rousseau"],
    language: "fr",
  };

  test("rejects an exact title and author in the wrong language", () => {
    const score = scoreAsinCandidate(
      want,
      candidate({ title: "Le Jardin de Verre", language: "english" }),
    );
    expect(score).toBeLessThan(ASIN_MIN_SCORE);
  });

  test("still prefers the same-language product over the floor", () => {
    const score = scoreAsinCandidate(
      want,
      candidate({ title: "Le Jardin de Verre", language: "french" }),
    );
    expect(score).toBeGreaterThanOrEqual(ASIN_MIN_SCORE);
  });

  /**
   * The penalty must not sink the mislabelled-edition case above: the library
   * title announcing its own translated edition is evidence that the retailer's
   * language tag for that product cannot be trusted.
   */
  test("does not penalise when the library title announces the edition", () => {
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

  /** An edition marker on the candidate outranks its own reported language. */
  test("reads the candidate's edition marker over its reported language", () => {
    const score = scoreAsinCandidate(
      want,
      candidate({
        title: "Le Jardin de Verre - Version française",
        language: "english",
      }),
    );
    expect(score).toBeGreaterThanOrEqual(ASIN_MIN_SCORE);
  });

  test("keeps rejecting a wrong-language sibling volume", () => {
    const score = scoreAsinCandidate(
      want,
      candidate({
        title: "Le Jardin de Verre - Die Rache",
        language: "german",
      }),
    );
    expect(score).toBeLessThan(ASIN_MIN_SCORE);
  });

  test("no ASIN is picked when every candidate is the wrong language", () => {
    expect(
      pickBestAsin(want, [
        candidate({ title: "Le Jardin de Verre", language: "english" }),
        candidate({
          asin: "B000000002",
          title: "Le Jardin de Verre - Die Rache",
          language: "german",
        }),
      ]),
    ).toBeNull();
  });
});

/**
 * The retailer spells the edition suffix in both orders. Measured live
 * 2026-08-25: the genuine French audiobook of a French library title is
 * "<name> (French Edition)", by the same author, reported `french` — and it
 * scored 55 against a floor of 60, because only the "Édition française" order
 * was stripped before comparison. The exact title never matched, so the correct
 * product lost to the English one it was meant to displace.
 */
describe("scoreAsinCandidate edition suffix ordering", () => {
  const want: AsinWant = {
    title: "Le Jardin de Verre",
    authors: ["Camille Rousseau"],
    language: "fr",
  };

  test("strips a trailing '(French Edition)' before comparing", () => {
    const score = scoreAsinCandidate(
      want,
      candidate({
        title: "Le Jardin de Verre (French Edition)",
        language: "french",
      }),
    );
    expect(score).toBeGreaterThanOrEqual(ASIN_MIN_SCORE);
  });

  test("prefers the French edition over the English product", () => {
    const best = pickBestAsin(want, [
      candidate({
        asin: "B0ENGLISH",
        title: "Le Jardin de Verre",
        language: "english",
      }),
      candidate({
        asin: "B0FRENCH",
        title: "Le Jardin de Verre (French Edition)",
        language: "french",
      }),
    ]);
    expect(best?.candidate.asin).toBe("B0FRENCH");
  });

  test("still disqualifies a same-title book by another author", () => {
    // Observed live: the French "Vicious" in the catalogue is L.J. Shen's
    // romance, not V. E. Schwab's novel. No ASIN is the right answer.
    expect(
      pickBestAsin(want, [
        candidate({
          asin: "B0OTHER",
          title: "Le Jardin de Verre",
          language: "french",
          authors: ["Sonia Eska"],
        }),
      ]),
    ).toBeNull();
  });
});
