/* eslint-disable @typescript-eslint/no-explicit-any */
import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(globalThis, "matchMedia", {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      if (options && typeof options === "object") {
        const parts = [key];
        for (const [k, v] of Object.entries(options)) {
          if (k !== "lng" && k !== "ns") {
            parts.push(`${k}:${v}`);
          }
        }
        return parts.join(" ");
      }
      return key;
    },
    i18n: {
      changeLanguage: () => Promise.resolve(),
      language: "en",
    },
  }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

// Export test utilities for convenience
export * from "@/test-utils/render";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
