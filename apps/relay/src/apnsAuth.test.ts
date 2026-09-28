import { describe, expect, test } from "bun:test";
import { ApnsTokenCache, importApnsKey, signApnsJwt } from "./apnsAuth";
import { generateP8 } from "./testing";

function decodePart(part: string): Record<string, unknown> {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
}

function b64urlToBytes(part: string): Uint8Array {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

describe("signApnsJwt", () => {
  test("produces an ES256 JWT Apple can verify", async () => {
    const { pem, publicKey } = await generateP8();
    const key = await importApnsKey(pem);
    const jwt = await signApnsJwt(
      key,
      { keyId: "KEYID12345", teamId: "TEAMID1234" },
      1_700_000_000,
    );
    const [header, claims, signature] = jwt.split(".");
    expect(decodePart(header ?? "")).toEqual({
      alg: "ES256",
      kid: "KEYID12345",
      typ: "JWT",
    });
    expect(decodePart(claims ?? "")).toEqual({
      iss: "TEAMID1234",
      iat: 1_700_000_000,
    });
    const sig = b64urlToBytes(signature ?? "");
    // Raw r||s, not DER: JWS requires exactly 64 bytes for P-256.
    expect(sig.length).toBe(64);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sig,
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  test("rejects a key that is not a PKCS#8 EC key", async () => {
    await expect(importApnsKey("not a key")).rejects.toThrow();
  });
});

describe("ApnsTokenCache", () => {
  test("reuses the token within 50 minutes and re-signs after", async () => {
    const { pem } = await generateP8();
    let now = 1_700_000_000;
    const cache = new ApnsTokenCache(
      { keyId: "K", teamId: "T", privateKeyPem: pem },
      () => now,
    );
    const first = await cache.get();
    now += 49 * 60;
    expect(await cache.get()).toBe(first);
    now += 2 * 60;
    const second = await cache.get();
    expect(second).not.toBe(first);
    expect(decodePart(second.split(".")[1] ?? "").iat).toBe(now);
  });
});
