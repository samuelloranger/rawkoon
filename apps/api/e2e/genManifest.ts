// Dev-only generator (run by hand): dumps the framework's route table to the
// committed routes.manifest.json. This and server.ts are the ONLY files that
// import the framework. Run:
//   env -u NODE_ENV bun --preload ./e2e/mocks/preload.ts ./e2e/genManifest.ts
// For the Hono migration: re-run and `git diff routes.manifest.json` — any change
// is a parity finding.
import { app } from "@rawkoon/api/index";
import type { Route } from "./fixtures/types";

const seen = new Set<string>();
const routes: Route[] = [];
for (const r of app.routes) {
  const method = r.method.toUpperCase();
  const path = r.path;
  // Drop the SPA static catch-all, the better-auth catch-all, and any non-/api.
  if (path === "/*" || path.includes("/api/auth/*")) continue;
  if (!path.startsWith("/api")) continue;
  if (method === "HEAD" || method === "OPTIONS" || method === "ALL") continue;
  const key = `${method} ${path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  routes.push({ method, path });
}

routes.sort((a, b) =>
  a.path === b.path
    ? a.method.localeCompare(b.method)
    : a.path.localeCompare(b.path),
);

const out = new URL("./routes.manifest.json", import.meta.url).pathname;
await Bun.write(out, `${JSON.stringify(routes, null, 2)}\n`);
console.log(`wrote ${routes.length} routes to ${out}`);
process.exit(0);
