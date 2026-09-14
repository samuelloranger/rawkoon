import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// The global setup mock pins i18n.language to "en"; override it here to prove
// a regional tag narrows correctly.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "fr-CA", changeLanguage: () => Promise.resolve() },
  }),
}));

const { useTitleLanguage } = await import("./useTitleLanguage");

describe("useTitleLanguage", () => {
  it("narrows the i18n tag to a stored title language", () => {
    const { result } = renderHook(() => useTitleLanguage());
    expect(result.current).toBe("fr");
  });
});
