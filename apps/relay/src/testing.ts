// Test helpers: a throwaway APNs-shaped key and a fake Worker env.
import type { Env, RateLimit } from "./index";

export async function generateP8(): Promise<{
  pem: string;
  publicKey: CryptoKey;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/(.{64})/g, "$1\n");
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  };
}

export function limiter(allow = true): RateLimit & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key);
      return { success: allow };
    },
  };
}

export function fakeEnv(pem: string, overrides: Partial<Env> = {}): Env {
  return {
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
    APNS_BUNDLE_ID: "com.example.app",
    APNS_PRIVATE_KEY: pem,
    PER_IP: limiter(),
    PER_TOKEN: limiter(),
    ...overrides,
  };
}
