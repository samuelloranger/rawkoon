import type { Context } from "../context";

// A route as it appears in the committed manifest: HTTP method + path with
// `:param` segments. No framework types — this is the whole contract the
// framework-agnostic runner speaks.
export interface Route {
  method: string;
  path: string;
}

export type Phase = "bootstrap" | "read" | "update" | "action" | "delete";

// One endpoint's test recipe, keyed in a registry by "METHOD /api/path".
// Everything is HTTP-level values so the same fixture drives Elysia and Hono.
export interface Fixture {
  phase?: Phase; // default inferred from method
  pathParams?: (ctx: Context) => Record<string, string>;
  query?: Record<string, string>;
  body?: (ctx: Context) => unknown; // valid payload
  expectedStatus?: number | number[]; // default: any 2xx
  captures?: (body: unknown, ctx: Context) => void; // stash created ids
  negativeBody?: unknown | null; // invalid body -> expect VALIDATION_STATUS; null = skip
  admin?: boolean; // also assert 403 as the non-admin user
  skipReason?: string; // explicit, reviewed opt-out
}

export type FixtureRegistry = Record<string, Fixture>;

export function routeKey(r: Route): string {
  return `${r.method} ${r.path}`;
}
