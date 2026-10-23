import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { rateLimiter } from "hono-rate-limiter";
import {
  clientIp,
  GLOBAL_RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_MESSAGE,
  globalRateLimitSkip,
  JELLYFIN_USERNAME_RATE_LIMIT_MAX,
  JELLYFIN_USERNAME_RATE_LIMIT_MESSAGE,
  JELLYFIN_USERNAME_RATE_LIMIT_WINDOW_MS,
  jellyfinUsernameRateLimitKey,
  jellyfinUsernameRateLimitSkip,
  RATE_LIMIT_WINDOW_MS,
  STRICT_AUTH_RATE_LIMIT_MAX,
  STRICT_AUTH_RATE_LIMIT_MESSAGE,
  strictAuthRateLimitBucket,
  strictAuthRateLimitSkip,
} from "@rawkoon/api/middleware/rateLimitCore";

/**
 * The two rate limiters, enforced from the shared rateLimitCore policy, with the
 * connecting IP pulled via Hono's Bun adapter (getConnInfo). A string `message`
 * makes hono-rate-limiter answer 429 as text/plain.
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
  standardHeaders: true,
});

export const strictAuthRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: STRICT_AUTH_RATE_LIMIT_MAX,
  skip: (c) => strictAuthRateLimitSkip(c.req.raw),
  keyGenerator: (c) =>
    `${strictAuthRateLimitBucket(c.req.raw)}:${clientIp(c.req.raw, connAddr(c))}`,
  message: STRICT_AUTH_RATE_LIMIT_MESSAGE,
  standardHeaders: true,
});

export const jellyfinUsernameRateLimit = rateLimiter({
  windowMs: JELLYFIN_USERNAME_RATE_LIMIT_WINDOW_MS,
  limit: JELLYFIN_USERNAME_RATE_LIMIT_MAX,
  skip: (c) => jellyfinUsernameRateLimitSkip(c.req.raw),
  keyGenerator: (c) =>
    jellyfinUsernameRateLimitKey(c.req.raw, clientIp(c.req.raw, connAddr(c))),
  message: JELLYFIN_USERNAME_RATE_LIMIT_MESSAGE,
  standardHeaders: true,
});
