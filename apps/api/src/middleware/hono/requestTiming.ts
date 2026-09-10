import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import {
  PERF_TIMING_ENABLED,
  recordRequestTiming,
} from "@rawkoon/api/services/perf/perfStore";

/**
 * Hono port of the perf-baseline request-timing plugin. Env-gated: with
 * PERF_TIMING_ENABLED unset it is a pure passthrough (zero per-request work).
 *
 * Aggregates by `c.req.routePath` — Hono's matched route template (e.g.
 * `/api/library/:id`), the equivalent of Elysia's `context.route` — so many
 * distinct ids collapse into one bucket.
 */
export const requestTiming = createMiddleware(async (c, next) => {
  if (!PERF_TIMING_ENABLED) {
    await next();
    return;
  }
  const start = performance.now();
  await next();
  const ms = performance.now() - start;
  recordRequestTiming({
    route: routePath(c) || new URL(c.req.url).pathname,
    method: c.req.method,
    status: c.res.status,
    ms,
    at: Date.now(),
  });
});
