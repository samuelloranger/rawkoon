import { JELLYFIN_PROVIDER_ID } from "@rawkoon/api/services/jellyfinUsers";

/** Which sign-in method opened a session, from the better-auth endpoint path. */
export function sessionProviderId(
  path: string,
  params?: { providerId?: string },
): string | null {
  if (path === "/sign-in/email") return "credential";
  if (path === "/sign-in/jellyfin") return JELLYFIN_PROVIDER_ID;
  if (path.startsWith("/callback/")) {
    // better-auth 1.7: OIDC providers use the social callback path
    // /callback/:providerId (was /oauth2/callback/:providerId).
    return params?.providerId ?? path.split("/callback/")[1] ?? null;
  }
  return null;
}
