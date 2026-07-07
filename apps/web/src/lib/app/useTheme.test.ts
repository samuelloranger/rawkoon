import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme (dark-only)", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("always reports dark", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(true);
  });

  it("applies the dark class to <html> on mount", () => {
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggleTheme is a no-op (stays dark)", () => {
    const { result } = renderHook(() => useTheme());
    result.current.toggleTheme();
    expect(result.current.isDark).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
