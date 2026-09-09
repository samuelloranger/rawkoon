import { describe, expect, it } from "bun:test";
import { substitutePath } from "./assert";

describe("substitutePath", () => {
  it("substitutes a single param", () => {
    expect(substitutePath("/api/requests/:id", { id: "42" })).toBe(
      "/api/requests/42",
    );
  });
  it("substitutes multiple params", () => {
    expect(
      substitutePath("/api/library/:id/files/:fileId", {
        id: "7",
        fileId: "9",
      }),
    ).toBe("/api/library/7/files/9");
  });
  it("throws on a missing param", () => {
    expect(() => substitutePath("/api/requests/:id", {})).toThrow(/id/);
  });
  it("leaves param-free paths untouched", () => {
    expect(substitutePath("/api/system/version", {})).toBe(
      "/api/system/version",
    );
  });
});
