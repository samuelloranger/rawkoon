import { rateLimit } from "elysia-rate-limit";
import { auth } from "@rawkoon/api/lib/auth";

/**
 * Global rate limiting configuration
 * Default: 1000 unauthenticated requests per hour.
 * Authenticated users bypass the limiter entirely.
 */
export const globalRateLimit = rateLimit({
  duration: 60 * 60 * 1000,
  max: 1000,
  // Skip authenticated requests by validating Better Auth's session cookie.
  skip: async (req) => {
    const cookie = req.headers.get("cookie") ?? "";
    if (!cookie.includes("better-auth.session_token")) {
      return false;
    }
    try {
      const session = await auth.api.getSession({ headers: req.headers });
      return session !== null;
    } catch {
      return false;
    }
  },
  generator: (req) =>
    `ip:${req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown"}`,
  errorResponse: "Too many requests. Please try again later.",
});

/**
 * Strict rate limiting configuration for auth routes (sign-in, invitation)
 * Default: 30 requests per hour per IP.
 */
export const strictAuthRateLimit = rateLimit({
  duration: 60 * 60 * 1000,
  max: 30,
  skip: (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const isSignIn = path.startsWith("/api/auth/sign-in");
    const isAcceptInvitation = path === "/api/auth/accept-invitation";
    return !(isSignIn || isAcceptInvitation);
  },
  generator: (req) =>
    `ip_auth:${req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown"}`,
  errorResponse: "Too many authentication attempts. Please try again later.",
});
