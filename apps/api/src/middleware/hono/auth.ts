import { forbidden, unauthorized } from "@rawkoon/api/errors";
import { factory } from "@rawkoon/api/honoEnv";
import { resolveUser } from "@rawkoon/api/middleware/auth";

/**
 * Auth guards `requireUser` / `requireAdmin`: resolve the session user,
 * short-circuit with a neutral error Response when missing/unauthorized,
 * otherwise stash the user on the typed context for handlers to read via
 * `c.get("user")`.
 */
export const requireUser = factory.createMiddleware(async (c, next) => {
  const user = await resolveUser(c.req.raw);
  if (!user) return unauthorized();
  c.set("user", user);
  await next();
});

export const requireAdmin = factory.createMiddleware(async (c, next) => {
  const user = await resolveUser(c.req.raw);
  if (!user) return unauthorized();
  if (!user.is_admin) return forbidden();
  c.set("user", user);
  await next();
});

// ensureAdmin (inline guard, already returns Response | null) stays imported
// from its neutral module by handlers that need it.
export { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";
