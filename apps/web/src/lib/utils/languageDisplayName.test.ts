import { describe, expect, it } from "vitest";
import { languageDisplayName } from "./languageDisplayName";

describe("languageDisplayName", () => {
  it("returns the English name of a language in an English locale", () => {
    expect(languageDisplayName("de", "en")).toBe("German");
    expect(languageDisplayName("ja", "en")).toBe("Japanese");
  });

  it("localizes the language name to the UI locale", () => {
    // French UI: German -> "allemand" (capitalized by the helper)
    expect(languageDisplayName("de", "fr")).toBe("Allemand");
  });

  it("falls back to the uppercased code for unknown codes", () => {
    expect(languageDisplayName("zz", "en")).toBe("ZZ");
  });
});
