// The ONLY file that imports the framework. Exposes one seam, `dispatch`, that
// turns a standard Request into a Response via the Hono app's `fetch`. The runner
// drives every endpoint through dispatch() in-process (no socket).
//
// Run directly (`bun run e2e/server.ts`) to also bind a real port for the
// Playwright browser-origin smoke; imported by the runner, it only exports dispatch.
import { app } from "@rawkoon/api/index";
import { assertE2eDatabase } from "./boot";

export function dispatch(req: Request): Promise<Response> {
  return Promise.resolve(app.fetch(req));
}

if (import.meta.main) {
  assertE2eDatabase(process.env.DATABASE_URL ?? "");
  const port = Number(process.env.E2E_PORT || 3111);
  Bun.serve({ fetch: app.fetch, port });
  console.log(`e2e server listening on http://localhost:${port}`);
}
