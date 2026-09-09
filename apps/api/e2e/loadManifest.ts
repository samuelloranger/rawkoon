// Framework-neutral: reads the committed route manifest (no framework import) and
// appends the specific better-auth routes under test (the catch-all can't be
// enumerated). Deduped so routes already emitted by src/auth.ts aren't doubled.
import { type Route, routeKey } from "./fixtures/types";
import manifest from "./routes.manifest.json" with { type: "json" };

export const BETTER_AUTH_ROUTES: Route[] = [
  { method: "POST", path: "/api/auth/sign-in/email" },
  { method: "POST", path: "/api/auth/sign-up/email" },
  { method: "GET", path: "/api/auth/get-session" },
  { method: "GET", path: "/api/auth/setup-status" },
];

export function loadManifest(): Route[] {
  const base = manifest as Route[];
  const seen = new Set(base.map(routeKey));
  const extra = BETTER_AUTH_ROUTES.filter((r) => !seen.has(routeKey(r)));
  return [...base, ...extra];
}
