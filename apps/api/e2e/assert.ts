import type { Context } from "./context";
import type { Fixture, Route } from "./fixtures/types";
import { request, VALIDATION_STATUS } from "./httpClient";

export interface Result {
  route: Route;
  kind: "positive" | "negative" | "auth";
  ok: boolean;
  detail: string;
  ms: number;
}

// Replace `:name` path segments from a params map; throw loudly on a missing one
// so a fixture that forgot to seed an id fails clearly instead of hitting a
// literal ":id" URL.
export function substitutePath(
  path: string,
  params: Record<string, string>,
): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) {
      throw new Error(`missing path param "${name}" for ${path}`);
    }
    return encodeURIComponent(v);
  });
}

function statusOk(status: number, expected?: number | number[]): boolean {
  if (expected === undefined) return status >= 200 && status < 300;
  const list = Array.isArray(expected) ? expected : [expected];
  return list.includes(status);
}

function resolvePath(route: Route, fx: Fixture, ctx: Context): string {
  const params = fx.pathParams ? fx.pathParams(ctx) : {};
  return substitutePath(route.path, params);
}

export async function checkPositive(
  route: Route,
  fx: Fixture,
  ctx: Context,
): Promise<Result> {
  const start = performance.now();
  try {
    const path = resolvePath(route, fx, ctx);
    const res = await request(route.method, path, {
      cookie: ctx.cookies.admin || undefined,
      query: fx.query,
      body: fx.body ? fx.body(ctx) : undefined,
    });
    const ok = statusOk(res.status, fx.expectedStatus);
    if (ok && fx.captures) fx.captures(res.json, ctx);
    return {
      route,
      kind: "positive",
      ok,
      detail: ok
        ? String(res.status)
        : `${res.status} ${res.text.slice(0, 120)}`,
      ms: performance.now() - start,
    };
  } catch (err) {
    return {
      route,
      kind: "positive",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: performance.now() - start,
    };
  }
}

export async function checkNegative(
  route: Route,
  fx: Fixture,
  ctx: Context,
): Promise<Result | null> {
  if (fx.negativeBody === null || fx.negativeBody === undefined) return null;
  const start = performance.now();
  try {
    const path = resolvePath(route, fx, ctx);
    const res = await request(route.method, path, {
      cookie: ctx.cookies.admin || undefined,
      body: fx.negativeBody,
    });
    const ok = res.status === VALIDATION_STATUS;
    return {
      route,
      kind: "negative",
      ok,
      detail: ok
        ? `${VALIDATION_STATUS} as expected`
        : `expected ${VALIDATION_STATUS}, got ${res.status}`,
      ms: performance.now() - start,
    };
  } catch (err) {
    return {
      route,
      kind: "negative",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: performance.now() - start,
    };
  }
}

export async function checkAuth(
  route: Route,
  fx: Fixture,
  ctx: Context,
): Promise<Result | null> {
  const start = performance.now();
  try {
    const path = resolvePath(route, fx, ctx);
    // logged-out -> 401 (or 403); admin routes -> 403 as the non-admin user.
    const loggedOut = await request(route.method, path, {
      query: fx.query,
      body: fx.body ? fx.body(ctx) : undefined,
    });
    let ok = loggedOut.status === 401 || loggedOut.status === 403;
    let detail = `logged-out ${loggedOut.status}`;
    if (ok && fx.admin) {
      const asUser = await request(route.method, path, {
        cookie: ctx.cookies.user || undefined,
        body: fx.body ? fx.body(ctx) : undefined,
      });
      ok = asUser.status === 403;
      detail += `, non-admin ${asUser.status}`;
    }
    return { route, kind: "auth", ok, detail, ms: performance.now() - start };
  } catch (err) {
    return {
      route,
      kind: "auth",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: performance.now() - start,
    };
  }
}
