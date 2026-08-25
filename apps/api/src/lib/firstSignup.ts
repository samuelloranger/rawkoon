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
 * Returns the better-auth `{ data }` payload with `isAdmin` and `emailVerified`
 * forced on for the first user, or throws an `APIError` to abort the sign-up
 * otherwise.
 *
 * `emailVerified` is forced because Rawkoon ships no email verification
 * transport, so nothing would ever flip it. Leaving it false makes better-auth
 * refuse to link an OIDC provider to this account (`requireLocalEmailVerified`),
 * and since OIDC providers run with `disableSignUp`, that locks the admin out of
 * SSO entirely. See the `accountLinking` block in `lib/auth.ts`.
 *
 * Note: `existingUserCount` is read just before creation, so two simultaneous
 * first sign-ups could each observe zero users and both become admin. That
 * only matters on a brand-new instance and is acceptable for first-run setup.
 */
export function resolveFirstSignup<T extends Record<string, unknown>>(
  user: T,
  existingUserCount: number,
): { data: T & { isAdmin: boolean; emailVerified: boolean } } {
  if (existingUserCount === 0) {
    return { data: { ...user, isAdmin: true, emailVerified: true } };
  }
  throw new APIError("BAD_REQUEST", {
    message:
      "Public sign-up is disabled. The first account created becomes the " +
      "administrator; additional users are created by an administrator.",
  });
}
