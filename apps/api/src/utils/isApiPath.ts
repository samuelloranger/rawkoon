/**
 * True for paths the API owns, so the SPA fallback can refuse them.
 *
 * An unmatched `/api/...` request is a bug, and answering it with the SPA shell
 * and a 200 turns that bug silent: the caller receives HTML where it expected
 * JSON or XML and fails somewhere far away from the cause.
 */
export const isApiPath = (pathname: string): boolean =>
  pathname === "/api" || pathname.startsWith("/api/");
