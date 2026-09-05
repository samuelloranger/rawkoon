/**
 * In-memory perf-baseline store.
 *
 * This is measurement scaffolding for capturing a one-shot performance baseline
 * — request/job/DB/FS timing — BEFORE any optimization work. It is deliberately
 * ephemeral: everything lives in bounded in-process state, nothing is persisted,
 * and every collector is gated behind a single env flag so a normal run (flag
 * unset) behaves exactly as before.
 *
 * Toggle with PERF_TIMING_ENABLED=true. Off by default.
 */
import { RingBuffer } from "./ringBuffer";
import { summarize, type PercentileSummary } from "./percentiles";

/** One captured HTTP request. */
export interface RequestTimingSample {
  route: string; // Elysia context.route (the matched template, e.g. /api/library/:id)
  method: string;
  status: number;
  ms: number;
  at: number; // epoch ms
}

/** Accumulated BullMQ job durations, keyed by "<queue>:<jobName>". */
export interface JobDurationSample {
  queue: string;
  name: string;
  ms: number;
  outcome: "completed" | "failed";
  at: number;
}

const REQUEST_BUFFER_CAPACITY = Number.parseInt(
  process.env.PERF_TIMING_BUFFER_SIZE ?? "5000",
  10,
);

/**
 * True when perf instrumentation is enabled. Read once at import so a single
 * boolean gate protects every hot-path check. Everything is off unless the flag
 * is exactly "true" (case-insensitive).
 */
export const PERF_TIMING_ENABLED =
  (process.env.PERF_TIMING_ENABLED ?? "").toLowerCase() === "true";

// Bounded ring buffers so nothing grows without limit during a long baseline run.
const requestTimings = new RingBuffer<RequestTimingSample>(
  Number.isFinite(REQUEST_BUFFER_CAPACITY) && REQUEST_BUFFER_CAPACITY > 0
    ? REQUEST_BUFFER_CAPACITY
    : 5000,
);
const jobDurations = new RingBuffer<JobDurationSample>(2000);

// Prisma query accumulator (count + total ms). Cheap counters, no per-query row.
const dbQueryStats = { count: 0, totalMs: 0 };

export function recordRequestTiming(sample: RequestTimingSample): void {
  if (!PERF_TIMING_ENABLED) return;
  requestTimings.push(sample);
}

export function recordJobDuration(sample: JobDurationSample): void {
  if (!PERF_TIMING_ENABLED) return;
  jobDurations.push(sample);
}

export function recordDbQuery(durationMs: number): void {
  if (!PERF_TIMING_ENABLED) return;
  dbQueryStats.count++;
  dbQueryStats.totalMs += durationMs;
}

export function getRequestTimings(): RequestTimingSample[] {
  return requestTimings.toArray();
}

export function getJobDurations(): JobDurationSample[] {
  return jobDurations.toArray();
}

export function getDbQueryStats(): { count: number; totalMs: number } {
  return { ...dbQueryStats };
}

/** Reset all collected samples (used by the report driver between runs). */
export function resetPerfStore(): void {
  requestTimings.clear();
  jobDurations.clear();
  dbQueryStats.count = 0;
  dbQueryStats.totalMs = 0;
}

export interface RoutePerf extends PercentileSummary {
  route: string;
  method: string;
}

/** Group request timings by "METHOD route" and summarize each group. */
export function summarizeRequestsByRoute(): RoutePerf[] {
  const groups = new Map<
    string,
    { route: string; method: string; ms: number[] }
  >();
  for (const s of requestTimings.toArray()) {
    const key = `${s.method} ${s.route}`;
    let group = groups.get(key);
    if (!group) {
      group = { route: s.route, method: s.method, ms: [] };
      groups.set(key, group);
    }
    group.ms.push(s.ms);
  }
  return [...groups.values()]
    .map((g) => ({ route: g.route, method: g.method, ...summarize(g.ms) }))
    .sort((a, b) => b.p95 - a.p95);
}

export interface PerfReport {
  generatedAt: string;
  enabled: boolean;
  routes: RoutePerf[];
  jobs: Array<
    PercentileSummary & { job: string; completed: number; failed: number }
  >;
  db: { count: number; totalMs: number; meanMs: number };
  process: { rssBytes: number; heapUsedBytes: number };
}

/** Snapshot the current in-memory metrics as a plain object. */
export function getPerfReport(): PerfReport {
  const jobGroups = new Map<
    string,
    { ms: number[]; completed: number; failed: number }
  >();
  for (const j of jobDurations.toArray()) {
    const key = `${j.queue}:${j.name}`;
    let group = jobGroups.get(key);
    if (!group) {
      group = { ms: [], completed: 0, failed: 0 };
      jobGroups.set(key, group);
    }
    group.ms.push(j.ms);
    if (j.outcome === "completed") group.completed++;
    else group.failed++;
  }

  const mem = process.memoryUsage();
  return {
    generatedAt: new Date().toISOString(),
    enabled: PERF_TIMING_ENABLED,
    routes: summarizeRequestsByRoute(),
    jobs: [...jobGroups.entries()].map(([job, g]) => ({
      job,
      completed: g.completed,
      failed: g.failed,
      ...summarize(g.ms),
    })),
    db: {
      count: dbQueryStats.count,
      totalMs: dbQueryStats.totalMs,
      meanMs:
        dbQueryStats.count > 0 ? dbQueryStats.totalMs / dbQueryStats.count : 0,
    },
    process: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
    },
  };
}

let samplerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic CPU/RSS sampler. Env-gated and idempotent — a no-op when the
 * flag is unset, and never starts twice. `unref()` keeps it from holding the
 * process open. Logs one line per interval to stdout only.
 */
export function startResourceSampler(): void {
  if (!PERF_TIMING_ENABLED || samplerHandle) return;
  const intervalMs = Number.parseInt(
    process.env.PERF_TIMING_SAMPLE_INTERVAL_MS ?? "30000",
    10,
  );
  let lastCpu = process.cpuUsage();
  samplerHandle = setInterval(
    () => {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage(lastCpu);
      lastCpu = process.cpuUsage();
      const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
      const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
      const cpuMs = ((cpu.user + cpu.system) / 1000).toFixed(0);
      console.log(
        `[perf] rss=${rssMb}MB heap=${heapMb}MB cpu=${cpuMs}ms db_queries=${dbQueryStats.count}`,
      );
    },
    Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30000,
  );
  samplerHandle.unref?.();
}
