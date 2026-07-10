import { describe, expect, it } from "bun:test";
import { resolveFirstSignup } from "../src/lib/firstSignup";

describe("resolveFirstSignup", () => {
  const user = { email: "first@example.com", name: "First" };

  it("promotes the first account (zero existing users) to admin", () => {
    const result = resolveFirstSignup(user, 0);
    expect(result).toEqual({
      data: { email: "first@example.com", name: "First", isAdmin: true },
    });
  });

  it("preserves the incoming user fields on the first account", () => {
    const result = resolveFirstSignup({ email: "a@b.co", locale: "fr" }, 0);
    expect(result.data.email).toBe("a@b.co");
    expect(result.data.locale).toBe("fr");
    expect(result.data.isAdmin).toBe(true);
  });

  it("rejects sign-up once any user already exists", () => {
    expect(() => resolveFirstSignup(user, 1)).toThrow();
  });

  it("rejects sign-up regardless of how many users exist", () => {
    expect(() => resolveFirstSignup(user, 42)).toThrow();
  });
});
