import { describe, expect, it } from "bun:test";
import {
  releaseMatchesExpectedTitles,
  resolvePreferredSearchTitle,
  resolveSearchTitles,
} from "./resolveSearchTitles";

describe("resolveSearchTitles", () => {
  it("legacy nulls → english title only", () => {
    expect(
      resolveSearchTitles({
        title: "Belflower",
        searchTitle: null,
        originalTitle: null,
      }),
    ).toEqual({ queries: ["Belflower"], matchTitles: ["Belflower"] });
  });

  it("preferred then distinct original", () => {
    expect(
      resolveSearchTitles({
        title: "Belflower",
        searchTitle: "Bellefleur",
        originalTitle: "Bellefleur",
      }),
    ).toEqual({
      queries: ["Bellefleur"],
      matchTitles: ["Bellefleur"],
    });
  });

  it("preferred then different original", () => {
    expect(
      resolveSearchTitles({
        title: "English",
        searchTitle: "Français",
        originalTitle: "Original",
      }),
    ).toEqual({
      queries: ["Français", "Original"],
      matchTitles: ["Français", "Original"],
    });
  });

  it("dedupes case-insensitively but keeps first casing", () => {
    expect(
      resolveSearchTitles({
        title: "Foo",
        searchTitle: "Bar",
        originalTitle: "bar",
      }).queries,
    ).toEqual(["Bar"]);
  });
});

describe("resolvePreferredSearchTitle", () => {
  const translations = [
    { language_code: "fr", title: "Bellefleur" },
    { language_code: "de", title: "Belflower DE" },
  ];

  it("uses translation for preferred language", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "fr",
        originalTitle: "Bellefleur",
        originalLanguage: "fr",
        translations,
      }),
    ).toEqual({ title: "Bellefleur", language: "fr" });
  });

  it("falls back to original when language matches and no translation", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "fr",
        originalTitle: "Bellefleur",
        originalLanguage: "fr",
        translations: [],
      }),
    ).toEqual({ title: "Bellefleur", language: "fr" });
  });

  it("falls back to english when preferred title missing", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "ja",
        originalTitle: "Bellefleur",
        originalLanguage: "fr",
        translations,
      }),
    ).toEqual({ title: "Belflower", language: "en" });
  });

  it("null/blank preferred language → en", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "",
        originalTitle: null,
        originalLanguage: null,
        translations: [],
      }),
    ).toEqual({ title: "Belflower", language: "en" });
  });
});

describe("releaseMatchesExpectedTitles", () => {
  it("matches preferred foreign title", () => {
    expect(
      releaseMatchesExpectedTitles(
        "Bellefleur.S03E10.FRENCH.1080p.WEB.AC3.5.1.H264-MTLQC",
        ["Bellefleur"],
      ),
    ).toBe(true);
  });

  it("rejects english-only expectation for french release", () => {
    expect(
      releaseMatchesExpectedTitles(
        "Bellefleur.S03E10.FRENCH.1080p.WEB.AC3.5.1.H264-MTLQC",
        ["Belflower"],
      ),
    ).toBe(false);
  });

  it("accepts when either title in the set matches", () => {
    expect(
      releaseMatchesExpectedTitles(
        "Bellefleur.S03E10.FRENCH.1080p.WEB.AC3.5.1.H264-MTLQC",
        ["Belflower", "Bellefleur"],
      ),
    ).toBe(true);
  });

  it("allows exact title equality without trailing tokens", () => {
    expect(releaseMatchesExpectedTitles("Bellefleur", ["Bellefleur"])).toBe(
      true,
    );
  });
});
