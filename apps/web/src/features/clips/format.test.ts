import { describe, expect, it } from "vitest";
import { formatMmSs, parseMmSs } from "./format";

describe("parseMmSs", () => {
  it("parses minutes and seconds", () => {
    expect(parseMmSs("0:05")).toBe(5);
    expect(parseMmSs(" 12:30 ")).toBe(750);
    expect(parseMmSs("125:00")).toBe(7500);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "90", "1:60", "1:5", "-1:00", "a:bc", "1:00:00"])
      expect(parseMmSs(bad)).toBeNull();
  });
  it("round-trips through formatMmSs", () => {
    expect(formatMmSs(750)).toBe("12:30");
    expect(parseMmSs(formatMmSs(65))).toBe(65);
  });
});
