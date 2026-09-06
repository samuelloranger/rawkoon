import { describe, expect, it } from "vitest";
import { formatListeningHours } from "./formatListeningHours";

describe("formatListeningHours", () => {
  it("zero is 0h", () => {
    expect(formatListeningHours(0)).toBe("0h");
  });
  it("under an hour is minutes", () => {
    expect(formatListeningHours(20 * 60)).toBe("20m");
  });
  it("hours and unpadded minutes", () => {
    expect(formatListeningHours(3 * 3600 + 20 * 60)).toBe("3h 20m");
  });
});
