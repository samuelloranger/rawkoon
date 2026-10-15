import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safeRedirect";

describe("safeRedirect", () => {
  it("keeps an in-app path with its query", () => {
    expect(safeRedirect("/device?user_code=ABCD1234")).toBe(
      "/device?user_code=ABCD1234",
    );
  });

  it.each([
    undefined,
    "",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "device",
  ])("falls back to / for %p", (target) => {
    expect(safeRedirect(target)).toBe("/");
  });
});
