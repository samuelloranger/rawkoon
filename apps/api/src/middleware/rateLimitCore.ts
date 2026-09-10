import { auth } from "@rawkoon/api/lib/auth";

/**
 * Rate-limit policy (windows, maxes, messages, skip predicates, client IP)
 * shared by the limiters in middleware/hono/rateLimit.ts, so they enforce the
 * same rules from one source.
 *
 * The `skip` predicates are pure `Request → boolean`; only the key generator
 * needs the connecting IP.
 */

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const GLOBAL_RATE_LIMIT_MAX = 1000;
export const STRICT_AUTH_RATE_LIMIT_MAX = 30;

export const GLOBAL_RATE_LIMIT_MESSAGE =
  "Too many requests. Please try again later.";
export const STRICT_AUTH_RATE_LIMIT_MESSAGE =
  "Too many authentication attempts. Please try again later.";

export function clientIp(
  req: Request,
  fallbackAddr: string | undefined,
): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    fallbackAddr ||
    "unknown"
  );
}

function hasAuthCredential(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  if (cookie.includes("better-auth.session_token")) return true;
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return true;
  return Boolean(req.headers.get("x-api-key"));
}

/**
 * Global limiter skip: authenticated requests (cookie session, Bearer, or a
 * valid x-api-key) and HMAC-granted chapter content bypass the anonymous IP
 * bucket entirely.
 */
export async function globalRateLimitSkip(req: Request): Promise<boolean> {
  const path = new URL(req.url).pathname;
  if (/^\/api\/books\/files\/\d+\/content$/.test(path)) return true;

  if (!hasAuthCredential(req)) return false;
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session !== null) return true;
  } catch {
    // fall through to x-api-key verify for Labby-style keys
  }
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return false;
  try {
    const { apiKeyApi } = await import("@rawkoon/api/lib/apiKeyApi");
    const { valid } = await apiKeyApi.verifyApiKey({ body: { key: apiKey } });
    return valid;
  } catch {
    return false;
  }
}

/** Strict limiter applies only to sign-in / sign-up / accept-invitation. */
export function strictAuthRateLimitSkip(req: Request): boolean {
  const path = new URL(req.url).pathname;
  const isSignIn = path.startsWith("/api/auth/sign-in");
  const isSignUp = path.startsWith("/api/auth/sign-up");
  const isAcceptInvitation = path === "/api/auth/accept-invitation";
  return !(isSignIn || isSignUp || isAcceptInvitation);
}
