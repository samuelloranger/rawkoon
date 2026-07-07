import { describe, it, expect } from "bun:test";
import { validateEmail, validatePassword } from "../validation";

describe("validateEmail", () => {
  it("accepts valid emails", () => {
    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("user.name@domain.co")).toBe(true);
    expect(validateEmail("user+tag@domain.org")).toBe(true);
    expect(validateEmail("user123@sub.domain.com")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(validateEmail("")).toBe(false);
    expect(validateEmail("user")).toBe(false);
    expect(validateEmail("user@")).toBe(false);
    expect(validateEmail("@domain.com")).toBe(false);
    expect(validateEmail("user@domain")).toBe(false);
    expect(validateEmail("user @domain.com")).toBe(false);
  });
});

describe("validatePassword", () => {
  it("accepts a valid password", () => {
    const [valid, error] = validatePassword("Test123!abc");
    expect(valid).toBe(true);
    expect(error).toBeNull();
  });

  it("rejects empty password", () => {
    const [valid, error] = validatePassword("");
    expect(valid).toBe(false);
    expect(error).toBe("Password is required");
  });

  it("rejects too short password", () => {
    const [valid, error] = validatePassword("Ab1!xyz");
    expect(valid).toBe(false);
    expect(error).toContain("8 characters");
  });

  it("rejects password without uppercase", () => {
    const [valid, error] = validatePassword("test1234!");
    expect(valid).toBe(false);
    expect(error).toContain("uppercase");
  });

  it("rejects password without lowercase", () => {
    const [valid, error] = validatePassword("TEST1234!");
    expect(valid).toBe(false);
    expect(error).toContain("lowercase");
  });

  it("rejects password without number", () => {
    const [valid, error] = validatePassword("TestTest!");
    expect(valid).toBe(false);
    expect(error).toContain("number");
  });

  it("rejects password without special character", () => {
    const [valid, error] = validatePassword("TestTest1");
    expect(valid).toBe(false);
    expect(error).toContain("special character");
  });
});
