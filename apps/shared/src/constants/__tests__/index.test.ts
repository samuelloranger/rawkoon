import { describe, expect, it } from "bun:test";
import {
  DEFAULT_TITLE_LANGUAGE,
  SUPPORTED_TITLE_LANGUAGES,
  normalizeTitleLanguage,
} from "../index";

describe("normalizeTitleLanguage", () => {
  it("passes through a supported language", () => {
    expect(normalizeTitleLanguage("fr")).toBe("fr");
    expect(normalizeTitleLanguage("en")).toBe("en");
  });

  it("strips a region suffix and lowercases", () => {
    expect(normalizeTitleLanguage("fr-CA")).toBe("fr");
    expect(normalizeTitleLanguage("FR")).toBe("fr");
    expect(normalizeTitleLanguage("en_US")).toBe("en");
  });

  it("falls back to the default for unsupported or missing values", () => {
    expect(normalizeTitleLanguage("de")).toBe(DEFAULT_TITLE_LANGUAGE);
    expect(normalizeTitleLanguage("")).toBe(DEFAULT_TITLE_LANGUAGE);
    expect(normalizeTitleLanguage(null)).toBe(DEFAULT_TITLE_LANGUAGE);
    expect(normalizeTitleLanguage(undefined)).toBe(DEFAULT_TITLE_LANGUAGE);
  });

  it("lists exactly the locales the web app ships", () => {
    expect([...SUPPORTED_TITLE_LANGUAGES]).toEqual(["en", "fr"]);
  });
});
