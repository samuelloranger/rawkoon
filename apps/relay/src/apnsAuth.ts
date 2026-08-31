import { createSign } from "node:crypto";

// APNs provider tokens (JWT, ES256). Apple rejects tokens older than 1h and
// throttles clients that mint a fresh one per push, so the signature is cached
// and reused for 50 minutes (margin for clock skew against Apple's edge).
export interface ApnsKey {
  keyId: string;
  teamId: string;
  privateKeyPem: string;
}

const TOKEN_TTL_SECONDS = 50 * 60;
const b64url = (input: Buffer | string): string =>
  (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");

export function signApnsJwt(key: ApnsKey, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: key.keyId, typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: key.teamId, iat: nowSeconds }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign({ key: key.privateKeyPem, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(signature)}`;
}

export class ApnsTokenCache {
  private token: string | null = null;
  private issuedAt = 0;
  constructor(
    private readonly key: ApnsKey,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}
  get(): string {
    const now = this.now();
    if (this.token === null || now - this.issuedAt >= TOKEN_TTL_SECONDS) {
      this.token = signApnsJwt(this.key, now);
      this.issuedAt = now;
    }
    return this.token;
  }
}
