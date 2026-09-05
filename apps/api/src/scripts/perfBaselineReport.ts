/**
 * Perf-baseline p50/p95 report driver.
 *
 * Fires N requests at a set of routes and reports per-route p50/p95/p99 latency,
 * plus the accumulated Prisma query count and process RSS, by reading the
 * in-memory perf ring buffer directly. This is measurement-only: no durable
 * storage, no /metrics endpoint, no Prometheus — just a one-shot snapshot to
 * capture a baseline before optimization.
 *
 * It starts the Elysia app on an ephemeral local port IN-PROCESS and fires real
 * HTTP requests at it — so the full response lifecycle runs exactly as in
 * production (the timing hook fires on `onAfterResponse`) — then reads the very
 * ring buffer those requests filled. It forces PERF_TIMING_ENABLED on for its
 * own process only.
 *
 * Requires a reachable, seeded database (see seedBaseline.ts).
 *
 * Usage (from monorepo root):
 *   cd apps/api && bun --env-file=../../.env src/scripts/perfBaselineReport.ts
 *   cd apps/api && bun --env-file=../../.env src/scripts/perfBaselineReport.ts --n=200 \
 *       --paths=/api/health,/api/library?type=movie --token=<bearer> --json
 */

// Must be set BEFORE importing perfStore/app so the import-time flag reads true.
process.env.PERF_TIMING_ENABLED = "true";

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const N = Math.max(1, Number.parseInt(parseArg("n", "100"), 10) || 100);
const CONCURRENCY = Math.max(
  1,
  Number.parseInt(parseArg("concurrency", "10"), 10) || 10,
);
const asJson = process.argv.includes("--json");
const token = parseArg("token", process.env.BASELINE_AUTH_TOKEN ?? "");
const paths = parseArg("paths", "/api/health,/health")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

async function main(): Promise<void> {
  const { app } = await import("@rawkoon/api/index");
  const { resetPerfStore, summarizeRequestsByRoute, getPerfReport } =
    await import("@rawkoon/api/services/perf/perfStore");

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  // Listen on an ephemeral port so the full HTTP response lifecycle runs.
  app.listen(0);
  const port = app.server?.port;
  if (!port) throw new Error("Failed to start app on an ephemeral port");
  const origin = `http://localhost:${port}`;

  resetPerfStore();

  const jobs: Array<() => Promise<void>> = [];
  for (const path of paths) {
    for (let i = 0; i < N; i++) {
      jobs.push(async () => {
        const res = await fetch(`${origin}${path}`, { headers });
        // Drain the body so the connection is fully released before the next.
        await res.arrayBuffer().catch(() => undefined);
      });
    }
  }

  const startedAt = Date.now();
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map((fn) => fn()));
  }
  // onAfterResponse is fire-and-forget relative to the fetch resolving; give
  // the last batch a beat to land in the ring buffer.
  await new Promise((r) => setTimeout(r, 50));
  const wallMs = Date.now() - startedAt;

  const routes = summarizeRequestsByRoute();
  const report = getPerfReport();

  if (asJson) {
    console.log(
      JSON.stringify(
        { wallMs, totalRequests: jobs.length, ...report },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`# Perf baseline\n`);
  console.log(
    `Fired ${jobs.length} requests across ${paths.length} route(s) in ${wallMs}ms ` +
      `(concurrency ${CONCURRENCY}).\n`,
  );

  console.log("## Per-route latency (ms)\n");
  console.log(
    "| Method | Route | Count | p50 | p95 | p99 | min | max | mean |",
  );
  console.log("|---|---|--:|--:|--:|--:|--:|--:|--:|");
  for (const r of routes) {
    console.log(
      `| ${r.method} | ${r.route} | ${r.count} | ${r.p50.toFixed(2)} | ` +
        `${r.p95.toFixed(2)} | ${r.p99.toFixed(2)} | ${r.min.toFixed(2)} | ` +
        `${r.max.toFixed(2)} | ${r.mean.toFixed(2)} |`,
    );
  }

  console.log("\n## Database\n");
  console.log(
    `Queries: ${report.db.count}, total ${report.db.totalMs.toFixed(1)}ms, ` +
      `mean ${report.db.meanMs.toFixed(2)}ms/query`,
  );

  console.log("\n## Process\n");
  console.log(
    `RSS ${(report.process.rssBytes / 1024 / 1024).toFixed(1)}MB, ` +
      `heap ${(report.process.heapUsedBytes / 1024 / 1024).toFixed(1)}MB`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    // app.handle spins up in-process workers/timers; exit explicitly.
    process.exit(0);
  });
