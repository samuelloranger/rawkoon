/**
 * Keeps a post-login redirect inside the app: a single leading slash and no
 * backslashes or control characters, which some URL parsers treat as "//".
 */
export function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return "/";
  return target;
}

// better-auth's own relative-callbackURL pattern; anything else makes it 403 the SSO start.
const BETTER_AUTH_RELATIVE_URL =
  /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/i;

/** The SSO callbackURL: the safe redirect when better-auth accepts it, else "/". */
export function ssoCallbackUrl(target: string | undefined): string {
  const path = safeRedirect(target);
  return BETTER_AUTH_RELATIVE_URL.test(path) ? path : "/";
}
