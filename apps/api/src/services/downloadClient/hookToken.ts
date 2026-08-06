import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@rawkoon/api/db";
import { decrypt, encrypt } from "@rawkoon/api/services/crypto";

/** 32 random bytes, base64url — safe to paste into a shell command unquoted. */
export function generateHookToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time token comparison.
 *
 * The length check is deliberately not constant-time: `timingSafeEqual` throws
 * on mismatched buffer lengths, and a token's length is not a secret.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const readStoredToken = async (): Promise<string | null> => {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { downloadHookToken: true },
  });
  const stored = settings?.downloadHookToken;
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch (error) {
    // Same posture as downloadClient/config.ts: an undecryptable secret means
    // "unconfigured", not "crash". A rotation re-establishes it.
    console.error(
      `[download-hook] failed to decrypt hook token — treating as unconfigured until rotated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
};

const persistToken = async (plaintext: string): Promise<void> => {
  // upsert, not update: nothing seeds media_settings row 1 — no migration
  // inserts it — so on a fresh install an `update` throws P2025 before the user
  // has ever saved settings. Matches indexerManager/factory.ts:18.
  const downloadHookToken = encrypt(plaintext);
  await prisma.mediaSettings.upsert({
    where: { id: 1 },
    update: { downloadHookToken },
    create: { id: 1, downloadHookToken },
  });
};

/** The current token, creating and persisting one on first use. */
export async function getOrCreateHookToken(): Promise<string> {
  const existing = await readStoredToken();
  if (existing) return existing;
  const token = generateHookToken();
  await persistToken(token);
  return token;
}

/** Replace the token. Callers must re-run client auto-configuration after this. */
export async function rotateHookToken(): Promise<string> {
  const token = generateHookToken();
  await persistToken(token);
  return token;
}

/** False when no token is configured or none was provided. */
export async function verifyHookToken(
  provided: string | null,
): Promise<boolean> {
  if (!provided) return false;
  const expected = await readStoredToken();
  if (!expected) return false;
  return tokensMatch(provided, expected);
}
