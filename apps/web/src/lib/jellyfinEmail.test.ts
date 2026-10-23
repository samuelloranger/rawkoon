import { describe, expect, it } from "vitest";
import { displayEmail, isJellyfinPlaceholderEmail } from "./jellyfinEmail";

describe("jellyfin placeholder email", () => {
  it("recognises the placeholder domain, case-insensitively", () => {
    expect(isJellyfinPlaceholderEmail("abc123@jellyfin.invalid")).toBe(true);
    expect(isJellyfinPlaceholderEmail("ABC@Jellyfin.Invalid")).toBe(true);
  });
  it("leaves real addresses alone", () => {
    expect(isJellyfinPlaceholderEmail("a@example.com")).toBe(false);
    expect(isJellyfinPlaceholderEmail("a@jellyfin.invalid.example.com")).toBe(
      false,
    );
  });
  it("shows a dash for placeholders only", () => {
    expect(displayEmail("abc@jellyfin.invalid")).toBe("—");
    expect(displayEmail("a@example.com")).toBe("a@example.com");
  });
});
