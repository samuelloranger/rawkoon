# Endpoint Verification Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-layer harness that proves each of the 261 rawkoon API endpoints still accepts valid input, rejects invalid input, gates auth, and returns the expected status + shape — verifying the `t.`→Zod migration and leaving a durable regression suite.

**Architecture:** A **framework-agnostic HTTP** contract sweep. A worker-less server subprocess (the ONLY file that imports the app) is booted with `bun --preload` mocks against a disposable Postgres; the runner reads a committed `routes.manifest.json` and drives every route over real HTTP (`fetch` against `BASE_URL`) with a per-route fixture (valid request → status+shape; invalid body → configured 422). Nothing but `server.ts`/`genManifest.ts` touches the framework, so the identical suite runs against Elysia today and Hono after migration — parity is the two runs' diff. An optional Playwright layer adds browser-origin CORS/cookie checks.

**Tech Stack:** Bun runtime + `bun --preload` `mock.module`, `fetch` HTTP client (no framework import in the runner), Elysia 1.4 only inside `server.ts`/`genManifest.ts`, Prisma 7 on a dedicated `rawkoon_e2e` Postgres, better-auth session cookie, Zod (`@rawkoon/shared` response types), Playwright (`apps/web` config).

**Spec:** `docs/superpowers/specs/2026-09-09-endpoint-verification-harness-design.md`

## Global Constraints

- **Never touch dev/prod data.** The harness aborts unless `DATABASE_URL`'s database name ends in `_e2e` or `_test`. Copied verbatim into the guard.
- **Framework-agnostic (load-bearing):** only `server.ts` and `genManifest.ts` may import the app/framework. The runner, `httpClient.ts`, fixtures, `assert.ts`, and manifest loader speak HTTP against `BASE_URL` and read the committed manifest — never `app.handle()`/`app.routes`. This is what lets the same suite prove the Elysia→Hono migration.
- **Install mocks via `bun --preload` BEFORE the app import in `server.ts`.** The preload runs first; routers then close over the mocked service modules. Mocking after import is a no-op. Verify `--preload` + `mock.module` actually intercepts in a real (non-`bun test`) process in Task 2 before building further.
- **`server.ts` imports `app` and calls `app.listen()` WITHOUT `initWorkers()`.** `initWorkers()`/`app.listen()` in `index.ts` live behind `if (import.meta.main)` (`index.ts:204`); `server.ts` is a separate entry that starts the listener but never the workers.
- **Pin the validation-failure status.** Assert a single `VALIDATION_STATUS` constant (422) for negative cases, so Elysia and Hono are held to the same code rather than each framework's default.
- **API self-import path alias:** import app internals as `@rawkoon/api/<path>` (maps `./src/*`), never relative.
- **Bun test gotcha:** the api suite is order-dependent; the harness is a *separate* runner (`bun run e2e:endpoints`), not part of `bun test`. Do not add e2e files to the `bun test` globs.
- **`NODE_ENV=production` is exported in this shell** — e2e scripts must run under `env -u NODE_ENV` where they load app config that branches on it (swagger mount, cookie flags).
- Location: everything under `apps/api/e2e/`. Branch `refactor/tzod-migration`.

---

### Task 1: DB-name safety guard

**Files:**
- Create: `apps/api/e2e/boot.ts`
- Test: `apps/api/e2e/boot.test.ts`

**Interfaces:**
- Produces: `assertE2eDatabase(url: string): void` — throws `Error` if the DB name is not `*_e2e`/`*_test`; returns void otherwise.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { assertE2eDatabase } from "./boot";

describe("assertE2eDatabase", () => {
  it("accepts a *_e2e database", () => {
    expect(() => assertE2eDatabase("postgresql://u:p@localhost:5433/rawkoon_e2e")).not.toThrow();
  });
  it("accepts a *_test database", () => {
    expect(() => assertE2eDatabase("postgresql://u:p@localhost:5433/foo_test")).not.toThrow();
  });
  it("rejects the dev database", () => {
    expect(() => assertE2eDatabase("postgresql://u:p@localhost:5433/rawkoon")).toThrow(/refuses/i);
  });
  it("rejects when DATABASE_URL is empty", () => {
    expect(() => assertE2eDatabase("")).toThrow(/DATABASE_URL/);
  });
  it("rejects a url with query params but prod-like name", () => {
    expect(() => assertE2eDatabase("postgresql://u:p@h/rawkoon?sslmode=require")).toThrow(/refuses/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test e2e/boot.test.ts`
Expected: FAIL — `assertE2eDatabase` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/e2e/boot.ts
export function assertE2eDatabase(url: string): void {
  if (!url) throw new Error("DATABASE_URL is required for the e2e harness");
  // db name = last path segment, minus any ?query
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/_(e2e|test)$/.test(name)) {
    throw new Error(
      `e2e harness refuses to run against database "${name}" — name must end in _e2e or _test`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test e2e/boot.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/e2e/boot.ts apps/api/e2e/boot.test.ts
git commit -m "feat(e2e): db-name safety guard"
```

---

### Task 2: External-service mocks

**Files:**
- Create: `apps/api/e2e/mocks/externals.ts`
- Create: `apps/api/e2e/mocks/preload.ts` (one-liner: `import { installExternalMocks } from "./externals"; installExternalMocks();` — this is the `bun --preload` target used by `server.ts` and `genManifest.ts`)
- Test: `apps/api/e2e/mocks/externals.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `installExternalMocks(): void` — calls `mock.module(...)` for every external boundary; safe to call once, before importing `app`. Also `export const mockState` — a mutable object letting fixtures flip a boundary to its failure mode (e.g. `mockState.downloadClientTestConnection = "fail"`).

**Critical probe (framework-agnostic interception):** after implementing, verify `mock.module` intercepts when loaded via `bun --preload` in a real process, not just under `bun test`. Add a throwaway `e2e/mocks/_probe.ts` that imports a mocked service and prints a marker; run `bun --preload e2e/mocks/preload.ts run e2e/mocks/_probe.ts` and confirm the mock (not the real module) ran. If it does NOT intercept, stop and switch to an env-flagged stub seam in the service factories before proceeding — the whole harness depends on this. Delete `_probe.ts` after.

**Reference — boundaries to mock** (from spec §"External mocking"; verify each module path against the tree before writing):
`services/discover/tmdbProvider`, `services/indexerManager/prowlarrAdapter`, `services/indexerManager/jackettAdapter`, `services/indexerManager` (manager: `getActiveIndexerManager`/`tieredSearch`), `services/mediaGrabberGrab` (`grabRelease`), `services/downloadClient/registry` (adapter `buildAdapter`), `services/books/audnexusProvider`, `services/books/audibleCatalog`, `services/books/googleBooksProvider`, `services/books/openLibraryProvider`, `services/books/bookDownloadHandoff`, `utils/webpush`, `utils/apns`, `services/queueService` (no-op queues — mirror `test/preload.ts:81-112`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "bun:test";
import { installExternalMocks, mockState } from "./externals";

describe("installExternalMocks", () => {
  beforeAll(() => installExternalMocks());
  it("mocks grabRelease to a deterministic success (no real torrent)", async () => {
    const { grabRelease } = await import("@rawkoon/api/services/mediaGrabberGrab");
    const res = await grabRelease({} as never);
    expect(res).toBeDefined();
  });
  it("exposes a failure knob for download-client test", () => {
    mockState.downloadClientTestConnection = "fail";
    expect(mockState.downloadClientTestConnection).toBe("fail");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test e2e/mocks/externals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Write `installExternalMocks()` using `mock.module("@rawkoon/api/services/...", () => ({ ... }))` for each boundary above, each returning canned happy-path data shaped to what the handler destructures (read each real module's exported signature first). Back failure-path returns with `mockState`. Mirror the queue no-op from `test/preload.ts`.

*(Implementer: open each listed module, copy its export names + return shapes, and mock those exact names. The mock must satisfy the handler's happy path so the endpoint returns its normal 2xx.)*

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test e2e/mocks/externals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/e2e/mocks/
git commit -m "feat(e2e): external-service boundary mocks"
```

---

### Task 3: Shared id-context

**Files:**
- Create: `apps/api/e2e/context.ts`
- Test: `apps/api/e2e/context.test.ts`

**Interfaces:**
- Produces: `interface Context { ids: Record<string, string>; cookies: { admin: string; user: string }; set(k: string, v: string): void; get(k: string): string }`; `createContext(): Context`. `get` throws if the key is missing (so a fixture referencing an unseeded id fails loudly, not with `undefined` in a URL).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { createContext } from "./context";

describe("Context", () => {
  it("stores and retrieves ids", () => {
    const ctx = createContext();
    ctx.set("libraryMediaId", "42");
    expect(ctx.get("libraryMediaId")).toBe("42");
  });
  it("throws on a missing id rather than returning undefined", () => {
    const ctx = createContext();
    expect(() => ctx.get("nope")).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && bun test e2e/context.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/api/e2e/context.ts
export interface Context {
  ids: Record<string, string>;
  cookies: { admin: string; user: string };
  set(k: string, v: string): void;
  get(k: string): string;
}
export function createContext(): Context {
  const ids: Record<string, string> = {};
  return {
    ids,
    cookies: { admin: "", user: "" },
    set(k, v) { ids[k] = v; },
    get(k) {
      const v = ids[k];
      if (v === undefined) throw new Error(`e2e context missing id "${k}"`);
      return v;
    },
  };
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e): shared id-context`.

---

### Task 4: Route manifest (generate offline, load framework-neutrally)

**Files:**
- Create: `apps/api/e2e/genManifest.ts` (dev-only generator — the ONLY route file that imports the framework besides `server.ts`)
- Create: `apps/api/e2e/routes.manifest.json` (committed output)
- Create: `apps/api/e2e/loadManifest.ts` (runtime reader — NO framework import)
- Test: `apps/api/e2e/loadManifest.test.ts`

**Interfaces:**
- Produces: `type Route = { method: string; path: string }`; `loadManifest(): Route[]` reads `routes.manifest.json` and appends `BETTER_AUTH_ROUTES`; `export const BETTER_AUTH_ROUTES: Route[]` (`POST /api/auth/sign-in/email`, `POST /api/auth/sign-up/email`, `GET /api/auth/get-session`, `GET /api/auth/setup-status`).
- `genManifest.ts` is run by hand (`bun --preload e2e/mocks/preload.ts run e2e/genManifest.ts`), imports `app` from `@rawkoon/api/index`, maps `app.routes`, drops `path === "/*"` and `/api/auth/*` and non-`/api` static, writes the sorted JSON.

- [ ] **Step 1: Generate the manifest first**

Run: `cd apps/api && env -u NODE_ENV bun --preload e2e/mocks/preload.ts run e2e/genManifest.ts`
Expected: writes `routes.manifest.json` with >200 `{method,path}` entries. Eyeball it: library/books/medias routes present, no `/*`.

- [ ] **Step 2: Write the failing test** (against the committed JSON — framework-free)

```ts
import { describe, it, expect } from "bun:test";
import { loadManifest } from "./loadManifest";

describe("loadManifest", () => {
  const routes = loadManifest();
  it("loads >200 routes from the committed manifest", () => {
    expect(routes.length).toBeGreaterThan(200);
  });
  it("includes a known library GET", () => {
    expect(routes.some((r) => r.path.startsWith("/api/library") && r.method === "GET")).toBe(true);
  });
  it("appends better-auth sign-in", () => {
    expect(routes.some((r) => r.path === "/api/auth/sign-in/email")).toBe(true);
  });
  it("never contains the SPA catch-all", () => {
    expect(routes.some((r) => r.path === "/*")).toBe(false);
  });
});
```

- [ ] **Step 3: Run** `cd apps/api && bun test e2e/loadManifest.test.ts` → FAIL (no `loadManifest`). Note this test needs NO `env -u NODE_ENV` and NO mocks — it only reads JSON.

- [ ] **Step 4: Implement** `loadManifest.ts`: `JSON` import of `routes.manifest.json`, concat `BETTER_AUTH_ROUTES`. Implement `genManifest.ts` as described. Run test → PASS.

- [ ] **Step 5: Commit** `feat(e2e): route manifest generator + framework-neutral loader`.

> **Hono migration note:** re-run `genManifest.ts` against the Hono app and `git diff routes.manifest.json`; any change is a parity finding.

---

### Task 5: Fixture model + coverage gate

**Files:**
- Create: `apps/api/e2e/fixtures/types.ts` (the `Fixture` interface + `Phase` type)
- Create: `apps/api/e2e/fixtures/index.ts` (registry merge + coverage gate)
- Test: `apps/api/e2e/fixtures/coverage.test.ts`

**Interfaces:**
- Consumes: `Route` (Task 4), `Context` (Task 3).
- Produces:
```ts
export type Phase = "bootstrap" | "read" | "update" | "action" | "delete";
export interface Fixture {
  phase?: Phase;                        // default inferred: GET->read, POST->action|bootstrap, PUT/PATCH->update, DELETE->delete
  pathParams?: (ctx: Context) => Record<string, string>;
  query?: Record<string, string>;
  body?: (ctx: Context) => unknown;
  expectedStatus?: number | number[];   // default 2xx
  captures?: (body: unknown, ctx: Context) => void;
  negativeBody?: unknown | null;         // null = skip negative check
  admin?: boolean;
  skipReason?: string;
}
export type FixtureRegistry = Record<string, Fixture>; // key "METHOD /api/path"
export function coverageReport(routes: Route[], registry: FixtureRegistry): { uncovered: Route[]; extra: string[] };
```
`coverageReport` returns routes with no fixture (`uncovered`) and fixture keys matching no route (`extra`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { coverageReport } from "./index";

const routes = [{ method: "GET", path: "/api/system/version" }, { method: "POST", path: "/api/requests" }];

describe("coverageReport", () => {
  it("flags a route with no fixture as uncovered", () => {
    const { uncovered } = coverageReport(routes, { "GET /api/system/version": {} });
    expect(uncovered.map((r) => r.path)).toEqual(["/api/requests"]);
  });
  it("flags a fixture key matching no route as extra", () => {
    const { extra } = coverageReport(routes, {
      "GET /api/system/version": {}, "POST /api/requests": {}, "GET /api/ghost": {},
    });
    expect(extra).toEqual(["GET /api/ghost"]);
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && bun test e2e/fixtures/coverage.test.ts` → FAIL.
- [ ] **Step 3: Implement** `types.ts` (interfaces above) + `coverageReport` (set diff on `"${method} ${path}"` keys). `index.ts` also exports `registry: FixtureRegistry` built by spreading the per-domain files (empty for now).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e): fixture model + coverage gate`.

---

### Task 6: Seed

**Files:**
- Create: `apps/api/e2e/seed.ts`
- Test: `apps/api/e2e/seed.test.ts` (integration — guarded on `DATABASE_URL` ending `_e2e`)

**Interfaces:**
- Consumes: `Context` (Task 3), `assertE2eDatabase` (Task 1).
- Produces: `async function resetAndSeed(ctx: Context): Promise<void>` — framework-neutral (Prisma + `betterAuth.api`, no `app.handle`, no HTTP). Asserts the e2e DB, `migrate deploy`, truncates all tables, then: creates the admin user + credential account and mints a session via `betterAuth.api` (first user → admin), formats the `better-auth.session_token` cookie into `ctx.cookies.admin`; same for a non-admin user → `ctx.cookies.user`; runs `seedBaseline` (small) recording seeded ids (`libraryMediaId`, `libraryEpisodeId`, `bookId`, `editionId`, `authorId`) into `ctx`; creates one `QualityProfile`, one `CustomFormat`, a download-client `Integration`, an indexer `Integration`, one `Request`, notification config — each id into `ctx`.

> Seeding via `betterAuth.api` + Prisma (both below the framework) keeps seed agnostic. It runs before/independently of the HTTP sweep; the cookies it mints are replayed as `Cookie:` headers over HTTP.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { createContext } from "./context";
import { resetAndSeed } from "./seed";

const hasE2eDb = /_(e2e|test)$/.test((process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "");
describe.if(hasE2eDb)("resetAndSeed", () => {
  it("seeds an admin cookie and core ids", async () => {
    const ctx = createContext();
    await resetAndSeed(ctx);
    expect(ctx.cookies.admin).toContain("better-auth.session_token=");
    expect(ctx.get("libraryMediaId")).toBeTruthy();
    expect(ctx.get("qualityProfileId")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** (with the e2e DB up):
`cd apps/api && env -u NODE_ENV DATABASE_URL=postgresql://rawkoon:rawkoon@localhost:5433/rawkoon_e2e bun test e2e/seed.test.ts` → FAIL.
- [ ] **Step 3: Implement** `resetAndSeed`. Reuse `src/scripts/seedBaseline.ts` exports where possible (import its seeding functions; if not exported, replicate the movie/show/book creation inline). Create users + sessions via `betterAuth.api` (framework-neutral) and format the cookie string — NOT `app.handle()`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e): reset + seed disposable dataset`.

---

### Task 7: HTTP client + request driver + assertions

**Files:**
- Create: `apps/api/e2e/httpClient.ts`
- Create: `apps/api/e2e/assert.ts`
- Test: `apps/api/e2e/httpClient.test.ts`, `apps/api/e2e/assert.test.ts`

**Interfaces:**
- Consumes: `Fixture`, `Route`, `Context`. `process.env.BASE_URL`, `VALIDATION_STATUS` (422 constant, defined in `httpClient.ts` and exported).
- Produces:
  - `httpClient.ts`: `async function request(method: string, path: string, opts?: { cookie?: string; query?: Record<string,string>; body?: unknown }): Promise<{ status: number; json: unknown; text: string }>` — **`fetch(new URL(path, process.env.BASE_URL))`**, no framework import. Fills nothing itself; callers pre-substitute `:params`. `export const VALIDATION_STATUS = 422`.
  - `assert.ts`:
    - `substitutePath(path: string, params: Record<string,string>): string` — replaces `:name` segments; throws if a `:param` has no value.
    - `async function checkPositive(route, fx, ctx): Promise<Result>` — request with admin cookie (substituted path + query + `fx.body(ctx)`), assert status ∈ expected (default 2xx range), run `fx.captures(json, ctx)`.
    - `async function checkNegative(route, fx, ctx): Promise<Result | null>` — if `fx.negativeBody !== null`, request the bad body, assert `status === VALIDATION_STATUS`; else null.
    - `async function checkAuth(route, fx, ctx): Promise<Result | null>` — no cookie → 401; if `fx.admin`, non-admin cookie → 403.
  - `type Result = { route: Route; kind: "positive"|"negative"|"auth"; ok: boolean; detail: string; ms: number }`.

- [ ] **Step 1: Write the failing `httpClient` test** (needs a running server — guarded on `BASE_URL`):

```ts
import { describe, it, expect } from "bun:test";
import { request } from "./httpClient";

describe.if(!!process.env.BASE_URL)("request", () => {
  it("GET /api/health returns 200 over HTTP", async () => {
    const res = await request("GET", "/api/health");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run** with a server up:
`cd apps/api && BASE_URL=http://localhost:3111 bun test e2e/httpClient.test.ts` (start `server.ts` first, Task 9 provides it; until then this test is skipped when `BASE_URL` is unset) → FAIL (no `request`).
- [ ] **Step 3: Implement** `httpClient.ts` (`fetch`, JSON parse with text fallback) and `assert.ts` (`substitutePath` + three checks, all going through `request`). No `app.handle`, no framework import anywhere in these files.
- [ ] **Step 4: Run** → PASS (with server up). `substitutePath` has a pure unit test needing no server.
- [ ] **Step 5: Commit** `feat(e2e): framework-agnostic http client + positive/negative/auth checks`.

---

### Task 8: Worker-less server + report + HTTP runner (green with zero fixtures via coverage gate)

**Files:**
- Create: `apps/api/e2e/server.ts` (worker-less server entry — the ONLY runtime framework import)
- Create: `apps/api/e2e/report.ts`
- Create: `apps/api/e2e/run.ts` (entrypoint)
- Modify: `apps/api/package.json` (add `"e2e:endpoints"`, `"e2e:server"` scripts)
- Test: `apps/api/e2e/report.test.ts`

**Interfaces:**
- Consumes: everything above, over HTTP.
- Produces:
  - `server.ts`: asserts the e2e DB, imports `app` from `@rawkoon/api/index`, `app.listen(E2E_PORT||3111)`, NO `initWorkers()`. Started via `bun --preload e2e/mocks/preload.ts run e2e/server.ts`.
  - `printReport(results: Result[], coverage): number` (exit code) + writes `results.json`.
  - `run.ts` entrypoint: `assertE2eDatabase` → `resetAndSeed(ctx)` → **spawn the server subprocess** (`bun --preload mocks/preload.ts run server.ts`) → poll `/api/health` until 200 → `loadManifest()` → `coverageReport` (fail if any uncovered) → for each route in phase order `checkPositive`/`checkNegative`/`checkAuth` over HTTP → `printReport` → kill the server → `process.exit(code)`. `BASE_URL` defaults to the spawned server; if `BASE_URL` is already set (parity run against an external target), skip spawning and sweep that.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { printReport } from "./report";

describe("printReport", () => {
  it("returns non-zero when a result failed", () => {
    const code = printReport(
      [{ route: { method: "GET", path: "/x" }, kind: "positive", ok: false, detail: "500", ms: 1 }],
      { uncovered: [], extra: [] },
    );
    expect(code).toBe(1);
  });
  it("returns non-zero when a route is uncovered", () => {
    const code = printReport([], { uncovered: [{ method: "GET", path: "/y" }], extra: [] });
    expect(code).toBe(1);
  });
  it("returns zero when all pass and coverage is complete", () => {
    expect(printReport([{ route: { method: "GET", path: "/x" }, kind: "positive", ok: true, detail: "200", ms: 1 }], { uncovered: [], extra: [] })).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && bun test e2e/report.test.ts` → FAIL.
- [ ] **Step 3: Implement** `server.ts`, `printReport`, and `run.ts` (spawn+poll+sweep+teardown). Add to `package.json`: `"e2e:server": "env -u NODE_ENV bun --preload e2e/mocks/preload.ts run e2e/server.ts"` and `"e2e:endpoints": "env -u NODE_ENV bun run e2e/run.ts"`.
- [ ] **Step 4: Run** the unit test → PASS. Then the whole harness against the e2e DB: `DATABASE_URL=...rawkoon_e2e bun run e2e:endpoints`. Expected now: server boots (grep log — NO worker-init line), health passes, then **coverage gate fails** listing 261 uncovered routes (proves the gate works). Capture that output in the commit message.
- [ ] **Step 5: Commit** `feat(e2e): worker-less server + report + http runner (coverage gate red, 0 fixtures)`.

---

### Task 9: Playwright browser-origin smoke (optional)

**Files:**
- Create: `apps/api/e2e/smoke.spec.ts`
- Create: `apps/api/e2e/playwright.config.ts`
- Modify: `apps/api/package.json` (`"e2e:smoke"` script, add `@playwright/test` devDep if absent)

**Interfaces:**
- Consumes: the `server.ts` from Task 8 (booted by Playwright's `webServer` via `bun run e2e:server`, after a seed step).
- Produces: a Playwright project that hits a few endpoints from a real browser origin via `APIRequestContext`. This is a CORS/cookie wiring sanity, NOT part of the parity proof (the `fetch` sweep in Task 8 is).

- [ ] **Step 1: Write the failing test** (`smoke.spec.ts`):

```ts
import { test, expect } from "@playwright/test";

test("authed GET returns 200", async ({ request }) => {
  const res = await request.get("/api/system/version");
  expect(res.status()).toBe(200);
});
test("bad body returns 422", async ({ request }) => {
  const res = await request.post("/api/medias/watchlist", { data: { tmdb_id: "not-a-number" } });
  expect(res.status()).toBe(422);
});
test("logged-out call returns 401", async ({ request }) => {
  const res = await request.get("/api/users/me", { headers: { Cookie: "" } });
  expect([401, 403]).toContain(res.status());
});
```

- [ ] **Step 2: Implement** `playwright.config.ts` (reuses `server.ts` from Task 8): `baseURL: http://localhost:${E2E_PORT||3111}`, a `webServer` running `bun run e2e:server` (after a seed step; `DATABASE_URL=...rawkoon_e2e`), `storageState` from a login setup that seeds+mints the admin cookie (reuse `resetAndSeed` or mirror `apps/web/e2e/auth.setup.ts`). `workers: 1`, `fullyParallel: false`.

- [ ] **Step 3: Run** `cd apps/api && env -u NODE_ENV bun run e2e:smoke` → tests PASS against the seeded e2e DB.
- [ ] **Step 4: Verify** the server started no workers (grep the run log for the worker-init line — must be absent).
- [ ] **Step 5: Commit** `feat(e2e): playwright browser-origin smoke`.

---

### Tasks 10–28: Per-domain fixtures (delegated, reviewed)

Each domain is one task: author `apps/api/e2e/fixtures/<domain>.ts` implementing the `FixtureRegistry` contract (Task 5) for **every** route the manifest lists under that domain's prefix, wire it into `fixtures/index.ts`, and re-run `bun run e2e:endpoints` until that domain's routes are green (positive + negative + any auth). A domain task is done when the coverage gate no longer lists its routes and all its results pass.

**Contract every fixture task follows:**
- Key each entry `"METHOD /api/path"` exactly as the manifest prints it (path params as `:name`).
- `pathParams` pulls ids from `ctx` (seeded in Task 6); if a route needs an id no seed provides, extend `seed.ts` in that task and note it.
- `body` returns a valid payload; cross-check the route's Zod schema in `src/routes/<domain>` for required/optional/coercion so the negative case is meaningful.
- `negativeBody`: a payload that violates the schema (wrong type / missing required) → must yield 422. `null` only for no-body routes.
- `expectedStatus`: default 2xx; set explicitly where the happy path is a documented 4xx (e.g. a conflict route) or 204.
- `captures`: for create routes, stash the new id into `ctx` for dependent read/update/delete fixtures.
- `phase`: override the method-inferred default when ordering matters (a delete that must run after its read).
- `admin: true` for admin-gated routes (adds the 403-as-non-admin check).
- `skipReason`: only with an explicit, reviewed justification (e.g. "irreversibly external even when mocked") — never to dodge effort.

**Worked example — `fixtures/requests.ts`:**

```ts
import type { FixtureRegistry } from "./types";

export const requestsFixtures: FixtureRegistry = {
  "GET /api/requests": { phase: "read", negativeBody: null },
  "POST /api/requests": {
    phase: "bootstrap",
    body: () => ({ type: "movie", tmdb_id: 27205, title: "Inception" }),
    captures: (b: any, ctx) => ctx.set("requestId", String(b.id)),
    negativeBody: { type: "movie" }, // missing tmdb_id/title -> 422
  },
  "POST /api/requests/:id/approve": {
    phase: "action", admin: true,
    pathParams: (ctx) => ({ id: ctx.get("requestId") }),
    body: () => ({ quality_profile_id: Number(ctx_qp(ctx)) }),
    negativeBody: { quality_profile_id: "x" }, // wrong type -> 422
  },
  "POST /api/requests/:id/deny": {
    phase: "action", admin: true,
    pathParams: (ctx) => ({ id: ctx.get("requestId") }),
    body: () => ({ deny_reason: "dup" }),
    negativeBody: { deny_reason: 123 }, // wrong type -> 422
  },
  "DELETE /api/requests/:id": {
    phase: "delete", pathParams: (ctx) => ({ id: ctx.get("requestId") }), negativeBody: null,
  },
};
```

*(The real route list per domain comes from the manifest, not from memory. `ctx_qp` above stands for reading the seeded quality-profile id — use `ctx.get("qualityProfileId")`.)*

**Domain task list** (one task each; route counts approximate, confirm from enumerator):
- Task 10: `system` (2) + `dashboard` (several GET)
- Task 11: `search` + `requests`
- Task 12: `quality-profiles` + `custom-formats`
- Task 13: `notifications`
- Task 14: `users`
- Task 15: `settings`
- Task 16: `releases`
- Task 17: `integrations` — download-client sub-routes (mocked adapters)
- Task 18: `integrations` — indexer + provider test routes (audnexus/googlebooks/jellyfin/local-ai)
- Task 19: `medias` — watchlist + discover
- Task 20: `medias` — tmdb + search + collections
- Task 21: `library` — list + meta
- Task 22: `library` — grab + files
- Task 23: `library` — job/worker + media-admin
- Task 24: `books` — list + editions
- Task 25: `books` — grab + playback
- Task 26: `books` — metadata + quality-profiles + authors
- Task 27: `admin`
- Task 28: `labby`

Each Task 10–28 ends with: coverage gate no longer lists that domain, `bun run e2e:endpoints` green for those routes, commit `test(e2e): <domain> endpoint fixtures`.

---

### Task 29: Full green + parity diff tooling + CI wiring

**Files:**
- Create: `apps/api/e2e/diff.ts` (compares two `results.json`)
- Modify: `apps/api/package.json` (ensure `e2e:endpoints`, `e2e:server`, `e2e:smoke`, add `e2e:diff`)
- Create: `.github/workflows/e2e.yml` (optional, services: postgres + redis)
- Create: `apps/api/e2e/README.md` documenting how to run it + the Hono parity flow.

- [ ] **Step 1** Run the full sweep: `DATABASE_URL=...rawkoon_e2e bun run e2e:endpoints` → **261/261 pass, 0 uncovered**. Paste the summary line.
- [ ] **Step 2** Run `bun run e2e:smoke` → green.
- [ ] **Step 3** Deliberately break one fixture (wrong `expectedStatus`) and confirm the runner goes red; revert.
- [ ] **Step 4: Parity diff tool.** Implement `diff.ts`: reads two `results.json` files, asserts identical route set + identical `{status, kind, ok}` per route, prints divergences, exits non-zero on any. Add `"e2e:diff": "bun run e2e/diff.ts"`. Test it: copy the baseline `results.json` to two files, tweak one row, confirm `e2e:diff` reports it. This is the tool that proves Elysia≡Hono: run the suite against each, diff the outputs.
- [ ] **Step 5** Write `apps/api/e2e/README.md`: prerequisites (e2e DB, `dev:services`); the commands; the DB-name guard; **the framework-agnostic contract (only `server.ts`/`genManifest.ts` import the framework)**; **the Hono parity procedure** (swap `server.ts`'s import, regenerate+`git diff` the manifest, run `e2e:endpoints` against both, `e2e:diff` the results); how to add a fixture when a route is added.
- [ ] **Step 6** (optional) Add `.github/workflows/e2e.yml` with postgres+redis services running `db:migrate:deploy` then `e2e:endpoints`. Commit `ci(e2e): endpoint sweep + parity diff + docs`.

---

## Self-Review

**Spec coverage:** safety guard (T1) ✓; external mocks + `--preload` interception probe (T2) ✓; context (T3) ✓; route manifest generate/load + better-auth routes (T4) ✓; fixture model + coverage gate vs manifest (T5) ✓; seed via `betterAuth.api`+Prisma, admin/non-admin/profiles/integrations (T6) ✓; framework-agnostic HTTP client + positive/negative(pinned 422)/auth (T7) ✓; worker-less server + report + spawn/poll/sweep runner (T8) ✓; optional Playwright browser-origin smoke (T9) ✓; all-261 fixtures dependency-ordered (T10–28) ✓; full-green + **parity diff tool** + framework-agnostic/Hono docs + CI (T29) ✓. Every spec section — including the framework-agnostic requirement and the Elysia→Hono parity flow — maps to a task.

**Framework-agnostic check:** the framework is imported only in `server.ts` (T8) and `genManifest.ts` (T4). `httpClient.ts`, `assert.ts`, `run.ts`, `loadManifest.ts`, fixtures, `diff.ts` are HTTP/JSON-only. No `app.handle`/`app.routes` anywhere in the runtime path. ✓

**Placeholder scan:** the `ctx_qp` shorthand in the worked example is annotated inline as "use `ctx.get("qualityProfileId")`" — a labelled illustration, not a TODO. Per-domain route lists are read from the committed `routes.manifest.json` by design (the spec forbids trusting remembered route lists) with the fixture contract fully specified — a deliberate interface.

**Type consistency:** `Context.get/set`, `Fixture`, `FixtureRegistry`, `Route`, `Result`, `VALIDATION_STATUS` are used identically across T3–T8 and the fixture tasks. `installExternalMocks`/`mockState`, `resetAndSeed`, `loadManifest`/`BETTER_AUTH_ROUTES`, `coverageReport`, `request`/`substitutePath`/`checkPositive`/`checkNegative`/`checkAuth`, `printReport` are each defined once and consumed by name.
