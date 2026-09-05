import { Elysia } from "elysia";
import {
  PERF_TIMING_ENABLED,
  recordRequestTiming,
} from "@rawkoon/api/services/perf/perfStore";

/**
 * Global request-timing plugin for the perf baseline.
 *
 * Stamps a monotonic start on every request and, once the response has been
 * sent, records {route, method, status, ms} into a bounded in-memory ring
 * buffer (see services/perf/perfStore). It aggregates by `context.route` — the
 * matched route template (e.g. `/api/library/:id`), NOT the raw path — so a
 * thousand distinct ids collapse into one bucket.
 *
 * Entirely env-gated: with PERF_TIMING_ENABLED unset this plugin wires no hooks
 * and adds zero per-request work, so a normal run is unchanged. Mirrors the
 * shape of middleware/rateLimit.ts (a pre-built Elysia instance).
 */

// Keyed by the Request object so concurrent requests don't collide. A WeakMap
// lets entries be GC'd if a response is never emitted.
const startTimes = new WeakMap<Request, number>();

function buildRequestTiming(): Elysia {
  const plugin = new Elysia({ name: "requestTiming" });
  if (!PERF_TIMING_ENABLED) return plugin;

  return plugin
    .onRequest(({ request }) => {
      startTimes.set(request, performance.now());
    })
    .onAfterResponse({ as: "global" }, ({ request, route, path, set }) => {
      const start = startTimes.get(request);
      if (start === undefined) return;
      startTimes.delete(request);
      const ms = performance.now() - start;
      const status = typeof set.status === "number" ? set.status : 200;
      recordRequestTiming({
        route: route || path || new URL(request.url).pathname,
        method: request.method,
        status,
        ms,
        at: Date.now(),
      });
    });
}

export const requestTiming = buildRequestTiming();
