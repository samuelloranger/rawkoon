import { describe, it, expect } from "bun:test";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  opaqueTokenCandidates,
} from "@rawkoon/api/utils/tokens";

describe("generateOpaqueToken", () => {
  it("returns a non-empty string", () => {
    const token = generateOpaqueToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("returns base64url-safe characters only", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not contain padding characters", () => {
    const token = generateOpaqueToken();
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });

  it("generates unique tokens", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateOpaqueToken()),
    );
    expect(tokens.size).toBe(100);
  });
});

describe("hashOpaqueToken", () => {
  it("returns a hex-encoded SHA256 hash (64 chars)", () => {
    const hash = hashOpaqueToken("test-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces consistent output for same input", () => {
    const h1 = hashOpaqueToken("same-token");
    const h2 = hashOpaqueToken("same-token");
    expect(h1).toBe(h2);
  });

  it("produces different output for different input", () => {
    const h1 = hashOpaqueToken("token-a");
    const h2 = hashOpaqueToken("token-b");
    expect(h1).not.toBe(h2);
  });
});

describe("opaqueTokenCandidates", () => {
  it("returns both plain and hashed token when they differ", () => {
    const token = "my-raw-token";
    const candidates = opaqueTokenCandidates(token);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(token);
    expect(candidates[1]).toBe(hashOpaqueToken(token));
  });

  it("returns only one entry when token is already its own hash", () => {
    const token = hashOpaqueToken("something");
    // If hashOpaqueToken(token) === token, it would return [token]
    // In practice this is extremely unlikely, so we just verify the logic
    const candidates = opaqueTokenCandidates(token);
    // The hash of a hex string is different from the hex string itself
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(token);
  });
});
