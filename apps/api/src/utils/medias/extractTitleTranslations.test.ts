import { describe, expect, it } from "bun:test";
import {
  extractTitleTranslations,
  parseMediaDetails,
} from "./tmdbFetcherDetails";

describe("extractTitleTranslations", () => {
  it("returns one title per language for movies (data.title)", () => {
    const translations = {
      translations: [
        { iso_639_1: "en", iso_3166_1: "US", data: { title: "The Movie" } },
        { iso_639_1: "fr", iso_3166_1: "FR", data: { title: "Le Film" } },
        { iso_639_1: "de", iso_3166_1: "DE", data: { title: "Der Film" } },
      ],
    };
    expect(extractTitleTranslations(translations, "movie")).toEqual([
      { language_code: "en", title: "The Movie" },
      { language_code: "fr", title: "Le Film" },
      { language_code: "de", title: "Der Film" },
    ]);
  });

  it("uses data.name for TV shows", () => {
    const translations = {
      translations: [
        { iso_639_1: "fr", iso_3166_1: "FR", data: { name: "La Série" } },
      ],
    };
    expect(extractTitleTranslations(translations, "tv")).toEqual([
      { language_code: "fr", title: "La Série" },
    ]);
  });

  it("collapses regional variants to one title, preferring the primary region", () => {
    const translations = {
      translations: [
        { iso_639_1: "fr", iso_3166_1: "BE", data: { title: "BE title" } },
        { iso_639_1: "fr", iso_3166_1: "CA", data: { title: "CA title" } },
        { iso_639_1: "fr", iso_3166_1: "FR", data: { title: "FR title" } },
      ],
    };
    expect(extractTitleTranslations(translations, "movie")).toEqual([
      { language_code: "fr", title: "FR title" },
    ]);
  });

  it("falls back to fr-CA when no fr-FR exists", () => {
    const translations = {
      translations: [
        { iso_639_1: "fr", iso_3166_1: "BE", data: { title: "BE title" } },
        { iso_639_1: "fr", iso_3166_1: "CA", data: { title: "CA title" } },
      ],
    };
    expect(extractTitleTranslations(translations, "movie")).toEqual([
      { language_code: "fr", title: "CA title" },
    ]);
  });

  it("falls back to the first region for languages without a primary mapping", () => {
    const translations = {
      translations: [
        { iso_639_1: "ja", iso_3166_1: "JP", data: { title: "日本語" } },
      ],
    };
    expect(extractTitleTranslations(translations, "movie")).toEqual([
      { language_code: "ja", title: "日本語" },
    ]);
  });

  it("ignores blank titles and entries without a language code", () => {
    const translations = {
      translations: [
        { iso_639_1: "fr", iso_3166_1: "FR", data: { title: "   " } },
        { iso_3166_1: "US", data: { title: "No language" } },
        { iso_639_1: "es", iso_3166_1: "ES", data: { title: "La Película" } },
      ],
    };
    expect(extractTitleTranslations(translations, "movie")).toEqual([
      { language_code: "es", title: "La Película" },
    ]);
  });

  it("returns an empty array for malformed / missing payloads", () => {
    expect(extractTitleTranslations(null, "movie")).toEqual([]);
    expect(extractTitleTranslations(undefined, "movie")).toEqual([]);
    expect(extractTitleTranslations({}, "movie")).toEqual([]);
    expect(extractTitleTranslations({ translations: "nope" }, "movie")).toEqual(
      [],
    );
  });
});

describe("parseMediaDetails TV runtime", () => {
  const runtimeOf = (data: Record<string, unknown>) =>
    parseMediaDetails(data, "tv").runtime;

  it("uses episode_run_time when TMDB provides it", () => {
    expect(
      runtimeOf({
        episode_run_time: [45, 50],
        last_episode_to_air: { runtime: 60 },
      }),
    ).toBe(45);
  });

  it("falls back to the last aired episode when the array is empty", () => {
    expect(
      runtimeOf({
        episode_run_time: [],
        last_episode_to_air: { runtime: 52 },
        next_episode_to_air: { runtime: 40 },
      }),
    ).toBe(52);
  });

  it("falls back to the next episode when there is no usable last one", () => {
    expect(
      runtimeOf({
        episode_run_time: [],
        last_episode_to_air: { runtime: null },
        next_episode_to_air: { runtime: 40 },
      }),
    ).toBe(40);
  });

  it("stays null when no source has a runtime", () => {
    expect(runtimeOf({ episode_run_time: [] })).toBeNull();
  });
});
