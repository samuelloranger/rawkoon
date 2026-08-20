import { describe, expect, it } from "bun:test";
import { languageFromIsbn13, reconcileBookLanguage } from "../isbnLanguage";

/**
 * Synthetic ISBNs: only the registration group matters here, and real ISBNs
 * identify real published works. The group prefixes are the standard ones.
 */
describe("languageFromIsbn13", () => {
  it.each([
    ["9782000000001", "fr"],
    ["9780000000002", "en"],
    ["9781000000009", "en"],
    ["9783000000000", "de"],
    ["9784000000007", "ja"],
    ["9788400000004", "es"],
    ["9788800000001", "it"],
    ["9789700000008", "es"],
    ["9791000000004", "fr"],
    ["9798000000009", "en"],
  ])("%s → %s", (isbn, expected) => {
    expect(languageFromIsbn13(isbn)).toBe(expected);
  });

  it("matches the longest group, so a two-digit group beats a one-digit one", () => {
    // 9788... could look like group "8" but 84 is Spain and 88 is Italy.
    expect(languageFromIsbn13("9788400000004")).toBe("es");
    expect(languageFromIsbn13("9788800000001")).toBe("it");
  });

  it("tolerates hyphens and spaces", () => {
    expect(languageFromIsbn13("978-2-0000-0000-1")).toBe("fr");
    expect(languageFromIsbn13("978 2 0000 0000 1")).toBe("fr");
  });

  it.each([
    ["", "empty"],
    ["123", "too short"],
    ["2000000001", "ISBN-10, no registration prefix"],
    ["9776000000000", "not a 978/979 prefix"],
    ["9789690000006", "a real group this map does not cover"],
  ])("returns null for %s (%s)", (isbn) => {
    expect(languageFromIsbn13(isbn)).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(languageFromIsbn13(null)).toBeNull();
    expect(languageFromIsbn13(undefined)).toBeNull();
  });
});

describe("reconcileBookLanguage", () => {
  it("corrects a provider language the ISBN contradicts", () => {
    // The case that prompted this: a French ISBN reported as Arabic.
    const r = reconcileBookLanguage("ar", "9782000000001");
    expect(r.language).toBe("fr");
    expect(r.correctedFrom).toBe("ar");
  });

  it("leaves an agreeing pair alone", () => {
    const r = reconcileBookLanguage("fr", "9782000000001");
    expect(r.language).toBe("fr");
    expect(r.correctedFrom).toBeNull();
  });

  it("keeps the provider value when the ISBN group is not in the map", () => {
    const r = reconcileBookLanguage("ar", "9789690000006");
    expect(r.language).toBe("ar");
    expect(r.correctedFrom).toBeNull();
  });

  it("keeps the provider value when there is no ISBN at all", () => {
    const r = reconcileBookLanguage("ja", null);
    expect(r.language).toBe("ja");
    expect(r.correctedFrom).toBeNull();
  });

  it("falls back to the ISBN when the provider says nothing", () => {
    const r = reconcileBookLanguage(null, "9783000000000");
    expect(r.language).toBe("de");
    expect(r.correctedFrom).toBeNull();
  });

  it("normalizes a regional tag down to its base language", () => {
    expect(reconcileBookLanguage("fr-CA", "9782000000001").language).toBe("fr");
  });

  it("defaults to en when it has nothing to go on", () => {
    expect(reconcileBookLanguage(null, null).language).toBe("en");
  });
});
