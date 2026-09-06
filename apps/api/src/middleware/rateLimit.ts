import { rateLimit } from "elysia-rate-limit";
import { auth } from "@rawkoon/api/lib/auth";

function clientIp(
  req: Request,
  server: {
    requestIP: (request: Request) => { address: string } | null;
  } | null,
): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    server?.requestIP(req)?.address ||
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
 * Global rate limiting configuration
 * Default: 1000 unauthenticated requests per hour.
 * Authenticated users bypass the limiter entirely.
 */
export const globalRateLimit = rateLimit({
  duration: 60 * 60 * 1000,
  max: 1000,
  // Skip authenticated requests: cookie session, Bearer, or x-api-key.
  skip: async (req) => {
    const path = new URL(req.url).pathname;
    // Chapter content uses an HMAC grant as auth, so it should not consume the
    // anonymous IP bucket that protects truly unauthenticated traffic.
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
  },
  generator: (req, server) => `ip:${clientIp(req, server)}`,
  errorResponse: "Too many requests. Please try again later.",
});

/**
 * Strict rate limiting configuration for auth routes (sign-in, sign-up,
 * invitation). Default: 30 requests per hour per IP.
 */
export const strictAuthRateLimit = rateLimit({
  duration: 60 * 60 * 1000,
  max: 30,
  skip: (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const isSignIn = path.startsWith("/api/auth/sign-in");
    const isSignUp = path.startsWith("/api/auth/sign-up");
    const isAcceptInvitation = path === "/api/auth/accept-invitation";
    return !(isSignIn || isSignUp || isAcceptInvitation);
  },
  generator: (req, server) => `ip_auth:${clientIp(req, server)}`,
  errorResponse: "Too many authentication attempts. Please try again later.",
});
