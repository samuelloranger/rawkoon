/**
 * Inline admin guard for mutation routes that live inside a `requireUser`
 * plugin (mixed read/write). Returns a 401/403 body to return early, or null
 * when the user is an admin and the handler should proceed.
 *
 * Kept dependency-free (no DB/auth imports) so it can be unit-tested in
 * isolation without pulling the better-auth/Prisma import chain.
 */
export const ensureAdmin = (
  user: { is_admin: boolean } | null,
  set: { status?: number | string },
): { error: string } | null => {
  if (!user) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  if (!user.is_admin) {
    set.status = 403;
    return { error: "Forbidden" };
  }
  return null;
};
