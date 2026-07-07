import { scryptSync, timingSafeEqual, pbkdf2Sync } from "node:crypto";

/**
 * Hash a password using Argon2id (Bun default)
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

/**
 * Verify a password against a hash.
 * Supports:
 * - Argon2/Bcrypt (via Bun.password)
 * - pbkdf2:sha256 (Werkzeug legacy)
 * - scrypt (Werkzeug legacy)
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  try {
    // 1. Try Bun native (Argon2 / Bcrypt)
    // specific check to avoid overhead if it's obviously not argon/bcrypt not needed,
    // but verify handles standard formats checking.
    // If it's a werkzeug hash it might throw or return false.
    const isBunSupported =
      hash.startsWith("$argon2") ||
      hash.startsWith("$2b$") ||
      hash.startsWith("$2a$");
    if (isBunSupported) {
      return await Bun.password.verify(password, hash);
    }
  } catch {
    // ignore and fall through to legacy
  }

  // 2. Handle Werkzeug formats
  // Format: method$salt$hash or method:iterations$salt$hash

  if (hash.startsWith("pbkdf2:sha256")) {
    return verifyPbkdf2(password, hash);
  }

  if (hash.startsWith("scrypt")) {
    return verifyScrypt(password, hash);
  }

  return false;
}

function verifyPbkdf2(password: string, hashStr: string): boolean {
  // Format: pbkdf2:sha256:iterations$salt$hash
  const parts = hashStr.split("$");
  if (parts.length !== 3) return false;

  const [methodPart, salt, originalHash] = parts;
  const [, , iterStr] = methodPart.split(":");
  const iterations = parseInt(iterStr || "260000", 10); // default if missing, though typically present

  const derivedKey = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const derivedHash = derivedKey.toString("hex");

  return timingSafeEqual(Buffer.from(derivedHash), Buffer.from(originalHash));
}

function verifyScrypt(password: string, hashStr: string): boolean {
  // Format: scrypt:32768:8:1$salt$hash
  // Werkzeug scrypt format: scrypt:n:r:p$salt$hash
  const parts = hashStr.split("$");
  if (parts.length !== 3) return false;

  const [methodPart, salt, originalHash] = parts;
  const params = methodPart.split(":");
  // scrypt:n:r:p
  if (params.length !== 4) return false;

  const n = parseInt(params[1], 10);
  const r = parseInt(params[2], 10);
  const p = parseInt(params[3], 10);

  // Memory requirement: 128 * N * r * p bytes
  // Set maxmem to 128MB to handle legacy Werkzeug hashes safely
  const derivedKey = scryptSync(password, salt, 64, {
    N: n,
    r: r,
    p: p,
    maxmem: 128 * 1024 * 1024, // 128MB
  });
  const derivedHash = derivedKey.toString("hex");

  return timingSafeEqual(Buffer.from(derivedHash), Buffer.from(originalHash));
}
