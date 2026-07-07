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

export function decrypt(text: string): string {
  try {
    const raw = text.startsWith(ENC_PREFIX)
      ? text.slice(ENC_PREFIX.length)
      : text;
    const parts = raw.split(":");
    if (parts.length !== 3) return text;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH)
      return text;

    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    console.error("Decryption failed:", error);
    return text;
  }
}
