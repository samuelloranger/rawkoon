import { describe, expect, it } from "vitest";
import { buildTitleOptions } from "./interactive-search";

const TRANSLATIONS = [
  { language_code: "en", title: "Spirited Away" },
  { language_code: "fr", title: "Le Voyage de Chihiro" },
  { language_code: "de", title: "Chihiros Reise" },
  { language_code: "ja", title: "千と千尋の神隠し" },
  { language_code: "nl", title: "De reis van Chihiro" }, // not in allowlist
];

describe("buildTitleOptions", () => {
  it("pins EN then FR, tags the original language, and includes allowlisted commons", () => {
    const options = buildTitleOptions({
      localized: "Spirited Away",
      localizedLanguage: "en",
      original: "千と千尋の神隠し",
      originalLanguage: "ja",
      translations: TRANSLATIONS,
    });
    // en (platform), fr, the original (ja), then commons present (de). nl excluded.
    expect(options.map((o) => o.languageCode)).toEqual([
      "en",
      "fr",
      "ja",
      "de",
    ]);
    expect(options.find((o) => o.languageCode === "ja")?.isOriginal).toBe(true);
    expect(options.find((o) => o.languageCode === "fr")?.query).toBe(
      "Le Voyage de Chihiro",
    );
  });

  it("puts the platform language first (French platform)", () => {
    const options = buildTitleOptions({
      localized: "Le Voyage de Chihiro",
      localizedLanguage: "fr",
      original: "千と千尋の神隠し",
      originalLanguage: "ja",
      translations: TRANSLATIONS,
    });
    expect(options[0]).toEqual({
      languageCode: "fr",
      query: "Le Voyage de Chihiro",
      isOriginal: false,
    });
    expect(options[1].languageCode).toBe("en");
  });

  it("appends the season/episode suffix to every option", () => {
    const options = buildTitleOptions({
      localized: "Show",
      localizedLanguage: "en",
      translations: [
        { language_code: "en", title: "Show" },
        { language_code: "fr", title: "Émission" },
      ],
      suffix: " S01E02",
    });
    expect(options.map((o) => o.query)).toEqual([
      "Show S01E02",
      "Émission S01E02",
    ]);
  });

  it("dedupes options that resolve to the same query", () => {
    const options = buildTitleOptions({
      localized: "The Movie",
      localizedLanguage: "en",
      original: "The Movie",
      originalLanguage: "en",
      translations: [
        { language_code: "en", title: "The Movie" },
        { language_code: "fr", title: "the movie " }, // same text, different case/space
      ],
    });
    expect(options).toHaveLength(1);
    expect(options[0].languageCode).toBe("en");
  });

  it("prefers the original_title value for the original-language entry", () => {
    const options = buildTitleOptions({
      localized: "Amelie",
      localizedLanguage: "en",
      original: "Le Fabuleux Destin d'Amélie Poulain",
      originalLanguage: "fr",
      translations: [
        { language_code: "en", title: "Amelie" },
        { language_code: "fr", title: "Amélie (translation)" },
      ],
    });
    const fr = options.find((o) => o.languageCode === "fr");
    expect(fr?.query).toBe("Le Fabuleux Destin d'Amélie Poulain");
    expect(fr?.isOriginal).toBe(true);
  });

  it("still offers the original title when it shares the platform language but differs from the localized title", () => {
    // English UI, English-original media, but the library/localized title
    // differs from TMDB's original_title — both must be reachable.
    const options = buildTitleOptions({
      localized: "The Office (US)",
      localizedLanguage: "en",
      original: "The Office",
      originalLanguage: "en",
      translations: [{ language_code: "en", title: "The Office" }],
    });
    const queries = options.map((o) => o.query);
    expect(queries).toContain("The Office (US)");
    expect(queries).toContain("The Office");
    // The localized title is not mislabeled as the original.
    expect(options.find((o) => o.query === "The Office (US)")?.isOriginal).toBe(
      false,
    );
    expect(options.find((o) => o.query === "The Office")?.isOriginal).toBe(
      true,
    );
  });

  it("falls back to the localized title alone when there are no translations", () => {
    const options = buildTitleOptions({
      localized: "Solo Title",
      localizedLanguage: "en",
    });
    expect(options).toEqual([
      { languageCode: "en", query: "Solo Title", isOriginal: false },
    ]);
  });

  it("ignores too-short secondary titles but always keeps the platform title", () => {
    const options = buildTitleOptions({
      localized: "X",
      localizedLanguage: "en",
      translations: [
        { language_code: "en", title: "X" },
        { language_code: "fr", title: "Y" }, // too short (<2)
      ],
    });
    expect(options).toEqual([
      { languageCode: "en", query: "X", isOriginal: false },
    ]);
  });
  // Regression: library titles are persisted in English, so an English-titled
  // item viewed in a French UI must still offer TMDB's French title. Real data
  // for "Knowing" (TMDB 13811), whose French title is "Prédictions".
  it("offers the French translation for an English-stored title", () => {
    const options = buildTitleOptions({
      localized: "Knowing",
      localizedLanguage: "en",
      original: "Knowing",
      originalLanguage: "en",
      translations: [
        { language_code: "fr", title: "Prédictions" },
        { language_code: "de", title: "Die Prophezeiung" },
      ],
    });
    expect(options).toEqual([
      { languageCode: "en", query: "Knowing", isOriginal: false },
      { languageCode: "fr", query: "Prédictions", isOriginal: false },
      { languageCode: "de", query: "Die Prophezeiung", isOriginal: false },
    ]);
  });
});
