import { APIError } from "better-auth/api";

/**
 * Gate for public sign-up.
 *
 * Rawkoon has no open registration. The very first account created through
 * better-auth sign-up becomes the administrator; every later sign-up attempt
 * is rejected. Additional users are created by an administrator (Settings →
 * Users), which writes directly to the database and therefore never reaches
 * this hook.
 *
 * Returns the better-auth `{ data }` payload with `isAdmin` forced on for the
 * first user, or throws an `APIError` to abort the sign-up otherwise.
 *
 * Note: `existingUserCount` is read just before creation, so two simultaneous
 * first sign-ups could each observe zero users and both become admin. That
 * only matters on a brand-new instance and is acceptable for first-run setup.
 */
export function resolveFirstSignup<T extends Record<string, unknown>>(
  user: T,
  existingUserCount: number,
): { data: T & { isAdmin: boolean } } {
  if (existingUserCount === 0) {
    return { data: { ...user, isAdmin: true } };
  }
  throw new APIError("BAD_REQUEST", {
    message:
      "Public sign-up is disabled. The first account created becomes the " +
      "administrator; additional users are created by an administrator.",
  });
}
