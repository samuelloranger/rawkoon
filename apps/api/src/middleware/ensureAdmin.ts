import { forbidden, unauthorized } from "@rawkoon/api/errors";

/**
 * Inline admin guard for mutation routes that live inside a `requireUser`
 * plugin (mixed read/write). Returns a 401/403 `Response` to return early, or
 * null when the user is an admin and the handler should proceed.
 *
 * Framework-neutral: it neither reads nor mutates Elysia's `set`, so it re-wraps
 * unchanged under Hono. Kept free of DB/auth imports so it can be unit-tested in
 * isolation without pulling the better-auth/Prisma import chain.
 */
export const ensureAdmin = (
  user: { is_admin: boolean } | null,
): Response | null => {
  if (!user) return unauthorized();
  if (!user.is_admin) return forbidden();
  return null;
};
