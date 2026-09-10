import { rateLimit } from "elysia-rate-limit";
import {
  clientIp,
  GLOBAL_RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_MESSAGE,
  globalRateLimitSkip,
  RATE_LIMIT_WINDOW_MS,
  STRICT_AUTH_RATE_LIMIT_MAX,
  STRICT_AUTH_RATE_LIMIT_MESSAGE,
  strictAuthRateLimitSkip,
} from "@rawkoon/api/middleware/rateLimitCore";

/**
 * Global rate limiting configuration
 * Default: 1000 unauthenticated requests per hour.
 * Authenticated users bypass the limiter entirely.
 * Policy lives in rateLimitCore (shared with the Hono limiter).
 */
export const globalRateLimit = rateLimit({
  duration: RATE_LIMIT_WINDOW_MS,
  max: GLOBAL_RATE_LIMIT_MAX,
  skip: (req) => globalRateLimitSkip(req),
  generator: (req, server) =>
    `ip:${clientIp(req, server?.requestIP(req)?.address)}`,
  errorResponse: GLOBAL_RATE_LIMIT_MESSAGE,
});

/**
 * Strict rate limiting configuration for auth routes (sign-in, sign-up,
 * invitation). Default: 30 requests per hour per IP.
 */
export const strictAuthRateLimit = rateLimit({
  duration: RATE_LIMIT_WINDOW_MS,
  max: STRICT_AUTH_RATE_LIMIT_MAX,
  skip: (req) => strictAuthRateLimitSkip(req),
  generator: (req, server) =>
    `ip_auth:${clientIp(req, server?.requestIP(req)?.address)}`,
  errorResponse: STRICT_AUTH_RATE_LIMIT_MESSAGE,
});
