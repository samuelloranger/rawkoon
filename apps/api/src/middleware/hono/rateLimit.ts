import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { rateLimiter } from "hono-rate-limiter";
import { tooManyRequests } from "@rawkoon/api/errors";
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
 * The rate limiters, enforced from the shared rateLimitCore policy, with the
 * connecting IP pulled via Hono's Bun adapter (getConnInfo). A string `message`
 * would make hono-rate-limiter answer text/plain, so each limiter answers the
 * API's JSON `{ error }` through `tooMany` instead.
 */

// The library sets Retry-After on the context before calling the handler.
const tooMany = (message: string) => (c: Context) => {
  const res = tooManyRequests(message);
  const retryAfter = c.res.headers.get("Retry-After");
  if (retryAfter) res.headers.set("Retry-After", retryAfter);
  return res;
};

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
  handler: tooMany(GLOBAL_RATE_LIMIT_MESSAGE),
  standardHeaders: true,
});

export const strictAuthRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: STRICT_AUTH_RATE_LIMIT_MAX,
  skip: (c) => strictAuthRateLimitSkip(c.req.raw),
  keyGenerator: (c) =>
    `${strictAuthRateLimitBucket(c.req.raw)}:${clientIp(c.req.raw, connAddr(c))}`,
  message: STRICT_AUTH_RATE_LIMIT_MESSAGE,
  handler: tooMany(STRICT_AUTH_RATE_LIMIT_MESSAGE),
  standardHeaders: true,
});

export const jellyfinUsernameRateLimit = rateLimiter({
  windowMs: JELLYFIN_USERNAME_RATE_LIMIT_WINDOW_MS,
  limit: JELLYFIN_USERNAME_RATE_LIMIT_MAX,
  skip: (c) => jellyfinUsernameRateLimitSkip(c.req.raw),
  keyGenerator: (c) =>
    jellyfinUsernameRateLimitKey(c.req.raw, clientIp(c.req.raw, connAddr(c))),
  message: JELLYFIN_USERNAME_RATE_LIMIT_MESSAGE,
  handler: tooMany(JELLYFIN_USERNAME_RATE_LIMIT_MESSAGE),
  standardHeaders: true,
});
