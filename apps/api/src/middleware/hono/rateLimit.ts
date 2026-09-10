import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { rateLimiter } from "hono-rate-limiter";
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
 * Hono port of the two rate limiters. Same policy as the Elysia limiters —
 * enforced from the shared rateLimitCore — with the connecting IP pulled via
 * Hono's Bun adapter instead of Elysia's `server.requestIP`. A string `message`
 * makes hono-rate-limiter answer 429 text/plain, matching the Elysia behavior.
 */

function connAddr(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export const globalRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: GLOBAL_RATE_LIMIT_MAX,
  skip: (c) => globalRateLimitSkip(c.req.raw),
  keyGenerator: (c) => `ip:${clientIp(c.req.raw, connAddr(c))}`,
  message: GLOBAL_RATE_LIMIT_MESSAGE,
  standardHeaders: false,
});

export const strictAuthRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: STRICT_AUTH_RATE_LIMIT_MAX,
  skip: (c) => strictAuthRateLimitSkip(c.req.raw),
  keyGenerator: (c) => `ip_auth:${clientIp(c.req.raw, connAddr(c))}`,
  message: STRICT_AUTH_RATE_LIMIT_MESSAGE,
  standardHeaders: false,
});
