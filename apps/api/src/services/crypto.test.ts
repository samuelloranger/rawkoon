import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { encrypt, decrypt, DecryptError } from "./crypto";

const OLD_KEY = Bun.env.SECRET_KEY;

function setKey(value: string) {
  Bun.env.SECRET_KEY = value;
}

beforeEach(() => setKey("test-secret-key-one"));
afterEach(() => {
  if (OLD_KEY === undefined) delete Bun.env.SECRET_KEY;
  else Bun.env.SECRET_KEY = OLD_KEY;
});

describe("crypto", () => {
  it("round-trips an encrypted value", () => {
    const secret = "s3cr3t-api-key";
    const enc = encrypt(secret);
    expect(enc.startsWith("enc:")).toBe(true);
    expect(decrypt(enc)).toBe(secret);
  });

  it("passes through legacy plaintext (no enc: prefix) untouched", () => {
    // Values stored before encryption existed must keep working.
    expect(decrypt("plain-legacy-value")).toBe("plain-legacy-value");
    expect(decrypt("has:colons:but:no:prefix")).toBe(
      "has:colons:but:no:prefix",
    );
  });

  it("throws DecryptError when the SECRET_KEY changed since encryption", () => {
    const enc = encrypt("value-under-old-key");
    setKey("a-completely-different-key");
    expect(() => decrypt(enc)).toThrow(DecryptError);
  });

  it("throws DecryptError on a malformed enc: payload", () => {
    expect(() => decrypt("enc:not-three-parts")).toThrow(DecryptError);
    expect(() => decrypt("enc:aa:bb:cc")).toThrow(DecryptError);
  });
});
