import { describe, expect, it } from "bun:test";
import { assertE2eDatabase } from "./boot";

describe("assertE2eDatabase", () => {
  it("accepts a *_e2e database", () => {
    expect(() =>
      assertE2eDatabase("postgresql://u:p@localhost:5433/rawkoon_e2e"),
    ).not.toThrow();
  });
  it("accepts a *_test database", () => {
    expect(() =>
      assertE2eDatabase("postgresql://u:p@localhost:5433/foo_test"),
    ).not.toThrow();
  });
  it("rejects the dev database", () => {
    expect(() =>
      assertE2eDatabase("postgresql://u:p@localhost:5433/rawkoon"),
    ).toThrow(/refuses/i);
  });
  it("rejects when DATABASE_URL is empty", () => {
    expect(() => assertE2eDatabase("")).toThrow(/DATABASE_URL/);
  });
  it("rejects a url with query params but prod-like name", () => {
    expect(() =>
      assertE2eDatabase("postgresql://u:p@h/rawkoon?sslmode=require"),
    ).toThrow(/refuses/i);
  });
  it("accepts a *_e2e database with query params", () => {
    expect(() =>
      assertE2eDatabase("postgresql://u:p@h/rawkoon_e2e?sslmode=require"),
    ).not.toThrow();
  });
});
