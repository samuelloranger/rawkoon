// Entrypoint for the framework-agnostic contract sweep. Orchestrates:
//   guard -> seed (Prisma) -> acquire cookies -> load manifest -> coverage gate
//   -> drive every fixtured route through the dispatch seam in phase order -> report.
// The only framework touch-point is server.ts's dispatch(), imported lazily by the
// http client. Run: env -u NODE_ENV bun --preload ./e2e/mocks/preload.ts ./e2e/run.ts
import { assertE2eDatabase } from "./boot";
import { createContext } from "./context";
import { acquireCookies, resetAndSeed } from "./seed";
import { loadManifest } from "./loadManifest";
import { registry, coverageReport } from "./fixtures/index";
import type { Fixture, Phase, Route } from "./fixtures/types";
import { routeKey } from "./fixtures/types";
import { checkAuth, checkNegative, checkPositive, type Result } from "./assert";
import { printReport, writeResults } from "./report";

const PHASE_ORDER: Phase[] = [
  "bootstrap",
  "read",
  "update",
  "action",
  "delete",
];

function phaseOf(route: Route, fx: Fixture): Phase {
  if (fx.phase) return fx.phase;
  switch (route.method) {
    case "GET":
      return "read";
    case "PUT":
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "action";
  }
}

async function main(): Promise<void> {
  assertE2eDatabase(process.env.DATABASE_URL ?? "");
  const ctx = createContext();

  console.log("seeding disposable dataset...");
  await resetAndSeed(ctx);

  // Endpoints are driven in-process through the framework `dispatch` seam (this
  // sandbox forbids binding a listening socket); set BASE_URL to sweep a real
  // server instead. Either way nothing here imports the framework directly.
  await acquireCookies(ctx);
  console.log(
    `cookies acquired (${process.env.BASE_URL ? "http" : "in-process"})`,
  );

  let code = 1;
  {
    const routes = loadManifest();
    const coverage = coverageReport(routes, registry);

    // Drive only fixtured routes, in dependency-phase order.
    const covered = routes.filter((r) => registry[routeKey(r)]);
    covered.sort(
      (a, b) =>
        PHASE_ORDER.indexOf(phaseOf(a, registry[routeKey(a)])) -
        PHASE_ORDER.indexOf(phaseOf(b, registry[routeKey(b)])),
    );

    const results: Result[] = [];
    for (const route of covered) {
      const fx = registry[routeKey(route)];
      if (fx.skipReason) continue;
      results.push(await checkPositive(route, fx, ctx));
      const neg = await checkNegative(route, fx, ctx);
      if (neg) results.push(neg);
      const auth = await checkAuth(route, fx, ctx);
      if (auth) results.push(auth);
    }

    await writeResults("./e2e/results.json", results);
    code = printReport(results, coverage);
  }
  process.exit(code);
}

main().catch((err) => {
  console.error("e2e run failed:", err);
  process.exit(1);
});
