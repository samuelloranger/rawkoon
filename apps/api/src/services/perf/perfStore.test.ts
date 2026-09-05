import { describe, it, expect, beforeAll, beforeEach } from "bun:test";

// The enabled/disabled gate is an import-time constant, so flip it BEFORE the
// module is loaded, then import it dynamically.
process.env.PERF_TIMING_ENABLED = "true";

type PerfStore = typeof import("./perfStore");
let store: PerfStore;

beforeAll(async () => {
  store = await import("./perfStore");
});

beforeEach(() => {
  store.resetPerfStore();
});

describe("perfStore (enabled)", () => {
  it("reports the flag as enabled", () => {
    expect(store.PERF_TIMING_ENABLED).toBe(true);
  });

  it("groups request timings by method+route and summarizes each", () => {
    // /api/library/:id hit 4x, /api/health hit twice.
    for (const ms of [10, 20, 30, 40]) {
      store.recordRequestTiming({
        route: "/api/library/:id",
        method: "GET",
        status: 200,
        ms,
        at: Date.now(),
      });
    }
    store.recordRequestTiming({
      route: "/api/health",
      method: "GET",
      status: 200,
      ms: 1,
      at: Date.now(),
    });
    store.recordRequestTiming({
      route: "/api/health",
      method: "GET",
      status: 200,
      ms: 3,
      at: Date.now(),
    });

    const routes = store.summarizeRequestsByRoute();
    expect(routes.length).toBe(2);

    const lib = routes.find((r) => r.route === "/api/library/:id");
    expect(lib).toBeDefined();
    expect(lib?.count).toBe(4);
    expect(lib?.p50).toBe(20); // nearest-rank over [10,20,30,40]
    expect(lib?.p95).toBe(40);
    expect(lib?.min).toBe(10);
    expect(lib?.max).toBe(40);

    const health = routes.find((r) => r.route === "/api/health");
    expect(health?.count).toBe(2);
  });

  it("accumulates db query count and duration", () => {
    store.recordDbQuery(2);
    store.recordDbQuery(4);
    store.recordDbQuery(6);
    const stats = store.getDbQueryStats();
    expect(stats.count).toBe(3);
    expect(stats.totalMs).toBe(12);

    const report = store.getPerfReport();
    expect(report.db.count).toBe(3);
    expect(report.db.meanMs).toBe(4);
    expect(report.enabled).toBe(true);
  });

  it("summarizes job durations by queue:name with outcome counts", () => {
    store.recordJobDuration({
      queue: "scheduled-tasks",
      name: "poll-indexer-rss",
      ms: 100,
      outcome: "completed",
      at: Date.now(),
    });
    store.recordJobDuration({
      queue: "scheduled-tasks",
      name: "poll-indexer-rss",
      ms: 300,
      outcome: "failed",
      at: Date.now(),
    });

    const report = store.getPerfReport();
    const job = report.jobs.find(
      (j) => j.job === "scheduled-tasks:poll-indexer-rss",
    );
    expect(job).toBeDefined();
    expect(job?.completed).toBe(1);
    expect(job?.failed).toBe(1);
    expect(job?.count).toBe(2);
  });
});
