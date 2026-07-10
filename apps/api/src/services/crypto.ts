import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENC_PREFIX = "enc:";

/**
 * Thrown when an `enc:`-prefixed value cannot be decrypted — almost always
 * because SECRET_KEY changed since the value was encrypted. Callers must
 * surface this (fail closed) rather than fall back to the ciphertext.
 */
export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptError";
  }
}

function getKey(): Buffer {
  const secret = Bun.env.SECRET_KEY;
  if (!secret) {
    throw new Error("SECRET_KEY environment variable is missing or empty.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value produced by {@link encrypt}.
 *
 * - Values WITHOUT the `enc:` prefix are treated as legacy plaintext and
 *   returned unchanged (pre-encryption values keep working until re-saved).
 * - Values WITH the `enc:` prefix MUST decrypt. Any failure throws
 *   {@link DecryptError} instead of silently returning the ciphertext — a
 *   silent fallback is what turned a SECRET_KEY change into an invisible
 *   outage (garbage API keys used as if valid).
 */
export function decrypt(text: string): string {
  if (!text.startsWith(ENC_PREFIX)) return text;

  const raw = text.slice(ENC_PREFIX.length);
  const parts = raw.split(":");
  if (parts.length !== 3) {
    throw new DecryptError(
      "malformed ciphertext: expected 'enc:iv:authTag:data'",
    );
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new DecryptError("malformed ciphertext: bad iv/authTag length");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new DecryptError(
      `decrypt failed — SECRET_KEY may have changed since this value was encrypted: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
