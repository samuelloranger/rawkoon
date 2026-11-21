import { describe, expect, it } from "bun:test";
import { strictInt } from "@rawkoon/api/utils/strictInt";

describe("strictInt", () => {
  it("accepts positive integers", () => {
    expect(strictInt("12")).toBe(12);
  });
  it("rejects trailing junk, decimals, empty and non-positive ids", () => {
    for (const raw of ["12abc", "1.5", "", " ", "0", "-3", "1e2x", undefined]) {
      expect(strictInt(raw)).toBeNaN();
    }
  });
  it("honours a lower bound of zero", () => {
    expect(strictInt("0", 0)).toBe(0);
    expect(strictInt("-1", 0)).toBeNaN();
  });
});
