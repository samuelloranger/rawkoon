import { describe, expect, it } from "bun:test";
import {
  generateHookToken,
  tokensMatch,
} from "@rawkoon/api/services/downloadClient/hookToken";

describe("generateHookToken", () => {
  it("produces a url-safe token of stable length", () => {
    const token = generateHookToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("produces a different token each call", () => {
    expect(generateHookToken()).not.toBe(generateHookToken());
  });
});

describe("tokensMatch", () => {
  it("accepts an identical token", () => {
    const token = generateHookToken();
    expect(tokensMatch(token, token)).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    const a = generateHookToken();
    const b = generateHookToken();
    expect(tokensMatch(a, b)).toBe(false);
  });

  it("rejects a token of a different length without throwing", () => {
    const token = generateHookToken();
    expect(tokensMatch("short", token)).toBe(false);
  });

  it("rejects an empty provided token", () => {
    expect(tokensMatch("", generateHookToken())).toBe(false);
  });
});
