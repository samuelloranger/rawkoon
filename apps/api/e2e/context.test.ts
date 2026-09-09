import { describe, expect, it } from "bun:test";
import { createContext } from "./context";

describe("Context", () => {
  it("stores and retrieves ids", () => {
    const ctx = createContext();
    ctx.set("libraryMediaId", "42");
    expect(ctx.get("libraryMediaId")).toBe("42");
  });
  it("throws on a missing id rather than returning undefined", () => {
    const ctx = createContext();
    expect(() => ctx.get("nope")).toThrow(/nope/);
  });
  it("starts with empty cookies", () => {
    const ctx = createContext();
    expect(ctx.cookies.admin).toBe("");
    expect(ctx.cookies.user).toBe("");
  });
});
