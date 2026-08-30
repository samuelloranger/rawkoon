import { createHmac, timingSafeEqual } from "node:crypto";

export interface GrantInput {
  fileId: number;
  variant: "original" | "datasaver";
  /** Opaque per-user id. Never the userId: these tokens end up in logs. */
  grantId: string;
  expiresAt: number;
}

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

const isGrantInput = (value: unknown): value is GrantInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fileId === "number" &&
    (candidate.variant === "original" || candidate.variant === "datasaver") &&
    typeof candidate.grantId === "string" &&
    typeof candidate.expiresAt === "number"
  );
};

/**
 * A signed download URL is what authenticates `content`.
 *
 * A background URLSession transfer carries no session cookie, so a route behind
 * requireUser would 401 every download. The signature travels in the URL
 * instead, and carries an opaque grant id rather than a user id so that a URL
 * captured in a proxy log or a crash report names nobody.
 */
export const signGrant = (
  input: GrantInput,
  secret: string,
  _now?: number,
): string => {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
};

export const verifyGrant = (
  token: string,
  secret: string,
  now: number = Date.now(),
): GrantInput | null => {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator >= token.length - 1) return null;
  if (token.indexOf(".", separator + 1) !== -1) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expectedSignature = sign(payload, secret);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    if (!isGrantInput(parsed)) return null;
    if (parsed.expiresAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
};
