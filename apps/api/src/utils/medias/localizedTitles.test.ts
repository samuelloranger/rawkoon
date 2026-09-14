import { describe, expect, it } from "bun:test";
import { resolveLocalizedTitleRows } from "@rawkoon/api/utils/medias/localizedTitles";

describe("resolveLocalizedTitleRows", () => {
  it("returns one row per supported language", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [{ language_code: "fr", title: "Le Parrain" }],
    });
    expect(rows.map((r) => r.language).sort()).toEqual(["en", "fr"]);
  });

  it("prefers the translation for the language", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [{ language_code: "FR", title: "  Le Parrain  " }],
    });
    const fr = rows.find((r) => r.language === "fr");
    expect(fr?.title).toBe("Le Parrain");
    expect(fr?.sortTitle).toBe("Parrain");
  });

  it("falls back to the original title when it is in that language", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "Amelie",
      originalTitle: "Le Fabuleux Destin d'Amélie Poulain",
      originalLanguage: "fr",
      translations: [],
    });
    const fr = rows.find((r) => r.language === "fr");
    expect(fr?.title).toBe("Le Fabuleux Destin d'Amélie Poulain");
    expect(fr?.sortTitle).toBe("Fabuleux Destin d'Amélie Poulain");
  });

  it("falls back to the English title when nothing else matches", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "Oldboy",
      originalTitle: "올드보이",
      originalLanguage: "ko",
      translations: [],
    });
    const fr = rows.find((r) => r.language === "fr");
    expect(fr?.title).toBe("Oldboy");
    expect(fr?.sortTitle).toBe("Oldboy");
  });

  it("ignores blank translations", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "Heat",
      originalTitle: "Heat",
      originalLanguage: "en",
      translations: [{ language_code: "fr", title: "   " }],
    });
    expect(rows.find((r) => r.language === "fr")?.title).toBe("Heat");
  });

  it("sorts the English row with English article rules", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [],
    });
    expect(rows.find((r) => r.language === "en")?.sortTitle).toBe("Godfather");
  });
});
