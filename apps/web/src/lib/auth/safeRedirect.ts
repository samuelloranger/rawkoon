/**
 * Keeps a post-login redirect inside the app: a single leading slash and no
 * backslashes or control characters, which some URL parsers treat as "//".
 */
export function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return "/";
  return target;
}
