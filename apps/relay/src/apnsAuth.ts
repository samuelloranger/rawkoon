// APNs provider tokens (JWT, ES256). Apple rejects tokens older than 1h and
// throttles clients that mint a fresh one per push, so the signature is cached
// and reused for 50 minutes (margin for clock skew against Apple's edge).
export interface ApnsKey {
  keyId: string;
  teamId: string;
  privateKeyPem: string;
}

const TOKEN_TTL_SECONDS = 50 * 60;

function b64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// The .p8 Apple issues is a PKCS#8 PEM; WebCrypto wants the DER bytes inside.
export function importApnsKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// WebCrypto's ECDSA output is already the raw r||s form JWS requires.
export async function signApnsJwt(
  key: CryptoKey,
  ids: { keyId: string; teamId: string },
  nowSeconds: number,
): Promise<string> {
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: ids.keyId, typ: "JWT" }),
  );
  const claims = b64url(JSON.stringify({ iss: ids.teamId, iat: nowSeconds }));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${b64url(signature)}`;
}

export class ApnsTokenCache {
  private token: string | null = null;
  private issuedAt = 0;
  private cryptoKey: Promise<CryptoKey> | null = null;

  constructor(
    private readonly key: ApnsKey,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async get(): Promise<string> {
    const now = this.now();
    if (this.token === null || now - this.issuedAt >= TOKEN_TTL_SECONDS) {
      this.cryptoKey ??= importApnsKey(this.key.privateKeyPem);
      this.token = await signApnsJwt(await this.cryptoKey, this.key, now);
      this.issuedAt = now;
    }
    return this.token;
  }
}
