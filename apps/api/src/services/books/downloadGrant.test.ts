import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  signGrant,
  verifyGrant,
} from "@rawkoon/api/services/books/downloadGrant";

const SECRET = "x".repeat(32);
const BASE = {
  fileId: 42,
  variant: "original" as const,
  grantId: "g-abc",
  expiresAt: 2_000_000_000_000,
};

const signPayloadForTest = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

describe("download grants", () => {
  test("a freshly signed grant verifies and round-trips its fields", () => {
    const token = signGrant(BASE, SECRET);
    expect(verifyGrant(token, SECRET, 1_000_000_000_000)).toEqual(BASE);
  });

  test("an expired grant does not verify", () => {
    const token = signGrant(BASE, SECRET);
    expect(verifyGrant(token, SECRET, 2_000_000_000_001)).toBeNull();
  });

  test("a grant expiring exactly at now is treated as expired", () => {
    const token = signGrant(BASE, SECRET);
    expect(verifyGrant(token, SECRET, BASE.expiresAt)).toBeNull();
  });

  test("a grant signed with another secret does not verify", () => {
    const token = signGrant(BASE, "y".repeat(32));
    expect(verifyGrant(token, SECRET, 1_000_000_000_000)).toBeNull();
  });

  /**
   * The whole reason the payload is signed rather than merely opaque: a client
   * that edits the fileId must not be able to read another book's bytes.
   */
  test("a tampered fileId does not verify", () => {
    const token = signGrant(BASE, SECRET);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...BASE, fileId: 43 }),
    ).toString("base64url");
    expect(payload).not.toBe(forged);
    expect(
      verifyGrant(`${forged}.${sig}`, SECRET, 1_000_000_000_000),
    ).toBeNull();
  });

  test("a token with no separator returns null", () => {
    expect(verifyGrant("noperiodtoken", SECRET)).toBeNull();
  });

  test("a token with base64url payload that is not JSON returns null", () => {
    const payload = Buffer.from("this-is-not-json", "utf8").toString(
      "base64url",
    );
    const signature = signPayloadForTest(payload, SECRET);
    expect(verifyGrant(`${payload}.${signature}`, SECRET)).toBeNull();
  });

  test("a token with JSON payload that is not an object returns null", () => {
    const payload = Buffer.from("4", "utf8").toString("base64url");
    const signature = signPayloadForTest(payload, SECRET);
    expect(verifyGrant(`${payload}.${signature}`, SECRET)).toBeNull();
  });

  test("a token with mismatched signature length returns null", () => {
    const token = signGrant(BASE, SECRET);
    const [payload] = token.split(".");
    expect(() => verifyGrant(`${payload}.x`, SECRET)).not.toThrow();
    expect(verifyGrant(`${payload}.x`, SECRET)).toBeNull();
  });

  test("garbage is rejected rather than throwing", () => {
    expect(verifyGrant("not-a-token", SECRET)).toBeNull();
    expect(verifyGrant("", SECRET)).toBeNull();
  });
});
