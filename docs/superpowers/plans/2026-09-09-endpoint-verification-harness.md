# Endpoint Verification Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-layer harness that proves each of the 261 rawkoon API endpoints still accepts valid input, rejects invalid input, gates auth, and returns the expected status + shape — verifying the `t.`→Zod migration and leaving a durable regression suite.

**Architecture:** An in-process contract sweep imports the Elysia `app` (side-effect-free import: no workers, no listener) with all external service boundaries mocked, seeds a disposable Postgres, enumerates `app.routes`, and drives every route via `app.handle()` with a per-route fixture (valid request → status+shape; invalid body → 422). A thin Playwright layer boots a worker-less e2e server and hits ~12 endpoints over real HTTP with a logged-in cookie for transport/cookie/CORS coverage.

**Tech Stack:** Bun test runner + `mock.module`, Elysia 1.4 `app.handle()`/`app.routes`, Prisma 7 on a dedicated `rawkoon_e2e` Postgres, better-auth session cookie, Zod (`@rawkoon/shared` response types), Playwright (`apps/web` config + storageState).

**Spec:** `docs/superpowers/specs/2026-09-09-endpoint-verification-harness-design.md`

## Global Constraints

- **Never touch dev/prod data.** The harness aborts unless `DATABASE_URL`'s database name ends in `_e2e` or `_test`. Copied verbatim into the guard.
- **Install mocks BEFORE importing `app`.** Routers close over the modules present at import; mocking after import is a no-op.
- **Import `app`, never run `index.ts` as main.** `initWorkers()`/`app.listen()` live behind `if (import.meta.main)` (`index.ts:204`); the in-process harness must never trip that guard. The Playwright server entry calls `app.listen()` explicitly WITHOUT `initWorkers()`.
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
- Test: `apps/api/e2e/mocks/externals.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `installExternalMocks(): void` — calls `mock.module(...)` for every external boundary; safe to call once, before importing `app`. Also `export const mockState` — a mutable object letting fixtures flip a boundary to its failure mode (e.g. `mockState.downloadClientTestConnection = "fail"`).

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

### Task 4: Route enumeration

**Files:**
- Create: `apps/api/e2e/enumerate.ts`
- Test: `apps/api/e2e/enumerate.test.ts`

**Interfaces:**
- Consumes: `installExternalMocks` (Task 2) — must run before importing `app`.
- Produces: `type Route = { method: string; path: string }`; `enumerateRoutes(): Route[]` — reads `app.routes`, drops the SPA static catch-all and `/api/auth/*`, appends `BETTER_AUTH_ROUTES` (a known const list: `POST /api/auth/sign-in/email`, `POST /api/auth/sign-up/email`, `GET /api/auth/get-session`, `GET /api/auth/setup-status`). `export const BETTER_AUTH_ROUTES: Route[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { installExternalMocks } from "./mocks/externals";
installExternalMocks();
const { enumerateRoutes } = await import("./enumerate");

describe("enumerateRoutes", () => {
  const routes = enumerateRoutes();
  it("finds a large number of routes", () => {
    expect(routes.length).toBeGreaterThan(200);
  });
  it("includes a known library route", () => {
    expect(routes.some((r) => r.path.startsWith("/api/library") && r.method === "GET")).toBe(true);
  });
  it("does not include the SPA static catch-all", () => {
    expect(routes.some((r) => r.path === "/*")).toBe(false);
  });
  it("includes better-auth sign-in", () => {
    expect(routes.some((r) => r.path === "/api/auth/sign-in/email")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && env -u NODE_ENV bun test e2e/enumerate.test.ts` → FAIL.

- [ ] **Step 3: Implement** — import `app` from `@rawkoon/api/index`, map `app.routes` to `{ method, path }`, filter out `path === "/*"` / `path.includes("/api/auth/*")` / non-`/api` static, concat `BETTER_AUTH_ROUTES`.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e): route enumeration`.

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
- Produces: `async function resetAndSeed(ctx: Context): Promise<void>` — asserts the e2e DB, `migrate deploy`, truncates all tables, then: creates admin via `POST /api/auth/sign-up/email` (first signup → admin) and stores `ctx.cookies.admin`; creates a non-admin user (direct Prisma `User` + `BaAccount` credential row, mirror `test/auth.test.ts:20-48`) and logs in → `ctx.cookies.user`; runs `seedBaseline` (small) and records the seeded ids (`libraryMediaId`, `libraryEpisodeId`, `bookId`, `editionId`, `authorId`) into `ctx`; creates one `QualityProfile`, one `CustomFormat`, a download-client `Integration`, an indexer `Integration`, one `Request`, notification config — each id into `ctx`.

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
- [ ] **Step 3: Implement** `resetAndSeed`. Reuse `src/scripts/seedBaseline.ts` exports where possible (import its seeding functions; if not exported, replicate the movie/show/book creation inline). Drive signup/login through `app.handle()` so the auth rows are correct.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e): reset + seed disposable dataset`.

---

### Task 7: Request driver + assertions

**Files:**
- Create: `apps/api/e2e/assert.ts`
- Test: `apps/api/e2e/assert.test.ts`

**Interfaces:**
- Consumes: `Fixture`, `Route`, `Context`.
- Produces:
  - `async function driveRoute(route: Route, fx: Fixture, ctx: Context, cookie: string): Promise<Response>` — builds the URL (fill `:params` from `fx.pathParams`, append `fx.query`), attaches `Cookie: cookie` + JSON body from `fx.body`, calls `app.handle`.
  - `async function checkPositive(route, fx, ctx): Promise<Result>` — drives with admin cookie, asserts status ∈ expected (default 2xx), runs `fx.captures`.
  - `async function checkNegative(route, fx, ctx): Promise<Result | null>` — if `fx.negativeBody !== null` and the route takes a body, drives with the bad body, asserts 422; else null.
  - `async function checkAuth(route, fx, ctx): Promise<Result | null>` — logged-out → 401; if `fx.admin`, non-admin cookie → 403.
  - `type Result = { route: Route; kind: "positive"|"negative"|"auth"; ok: boolean; detail: string; ms: number }`.

- [ ] **Step 1: Write the failing test** (uses a tiny in-memory route via `app.handle` against `/api/health`, which needs no seed):

```ts
import { describe, it, expect } from "bun:test";
import { installExternalMocks } from "./mocks/externals";
installExternalMocks();
import { createContext } from "./context";
const { checkPositive } = await import("./assert");

describe("checkPositive", () => {
  it("passes for GET /api/health", async () => {
    const ctx = createContext();
    const res = await checkPositive({ method: "GET", path: "/api/health" }, {}, ctx);
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && env -u NODE_ENV bun test e2e/assert.test.ts` → FAIL.
- [ ] **Step 3: Implement** the driver + three checks. URL building: replace `:name` segments from `fx.pathParams(ctx)`; throw if a `:param` has no value.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e): request driver + positive/negative/auth checks`.

---

### Task 8: Report + runner (green with zero fixtures via coverage gate)

**Files:**
- Create: `apps/api/e2e/report.ts`
- Create: `apps/api/e2e/runContract.ts`
- Modify: `apps/api/package.json` (add `"e2e:endpoints"` script)
- Test: `apps/api/e2e/report.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `function printReport(results: Result[], coverage): number` (returns exit code); `runContract.ts` is the entrypoint: `installExternalMocks()` → `assertE2eDatabase` → `resetAndSeed` → `enumerateRoutes` → `coverageReport` (fail if any uncovered) → for each route in phase order run `checkPositive`/`checkNegative`/`checkAuth` → `printReport` → `process.exit(code)`.

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
- [ ] **Step 3: Implement** `printReport` (table + summary + exit code) and `runContract.ts`. Add to `package.json`: `"e2e:endpoints": "env -u NODE_ENV bun run e2e/runContract.ts"`.
- [ ] **Step 4: Run** the unit test → PASS. Then run the whole harness against the e2e DB: `DATABASE_URL=...rawkoon_e2e bun run e2e:endpoints`. Expected at this point: **coverage gate fails** listing 261 uncovered routes (proves the gate works). Capture that output in the commit message.
- [ ] **Step 5: Commit** `feat(e2e): report + contract runner (coverage gate red, 0 fixtures)`.

---

### Task 9: Playwright transport smoke

**Files:**
- Create: `apps/api/e2e/server.ts` (worker-less server entry)
- Create: `apps/api/e2e/smoke.spec.ts`
- Create: `apps/api/e2e/playwright.config.ts`
- Modify: `apps/api/package.json` (`"e2e:smoke"` script, add `@playwright/test` devDep if absent)

**Interfaces:**
- Consumes: the running `server.ts`.
- Produces: a Playwright project that logs in once (storageState) and hits ~12 endpoints via `request` (APIRequestContext).

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

- [ ] **Step 2: Implement** `server.ts`:

```ts
// apps/api/e2e/server.ts — worker-less boot for the transport smoke
import { installExternalMocks } from "./mocks/externals";
installExternalMocks();
const { app } = await import("@rawkoon/api/index");
app.listen(process.env.E2E_PORT || 3111);
```

`playwright.config.ts`: `baseURL: http://localhost:${E2E_PORT||3111}`, a `webServer` that runs `env -u NODE_ENV DATABASE_URL=...rawkoon_e2e bun run e2e/server.ts` (after a seed step), `storageState` from a login setup mirroring `apps/web/e2e/auth.setup.ts` (first-signup admin). `workers: 1`, `fullyParallel: false`.

- [ ] **Step 3: Run** `cd apps/api && env -u NODE_ENV bun run e2e:smoke` → tests PASS against the seeded e2e DB.
- [ ] **Step 4: Verify** the server started no workers (grep the run log for the worker-init line — must be absent).
- [ ] **Step 5: Commit** `feat(e2e): playwright transport smoke (worker-less server)`.

---

### Tasks 10–28: Per-domain fixtures (delegated, reviewed)

Each domain is one task: author `apps/api/e2e/fixtures/<domain>.ts` implementing the `FixtureRegistry` contract (Task 5) for **every** route the enumerator lists under that domain's prefix, wire it into `fixtures/index.ts`, and re-run `bun run e2e:endpoints` until that domain's routes are green (positive + negative + any auth). A domain task is done when the coverage gate no longer lists its routes and all its results pass.

**Contract every fixture task follows:**
- Key each entry `"METHOD /api/path"` exactly as the enumerator prints it (path params as `:name`).
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

*(The real route list per domain comes from the enumerator, not from memory. `ctx_qp` above stands for reading the seeded quality-profile id — use `ctx.get("qualityProfileId")`.)*

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

### Task 29: Full green + CI wiring

**Files:**
- Modify: `apps/api/package.json` (ensure `e2e:endpoints`, `e2e:smoke`, `e2e:db` helper)
- Create: `.github/workflows/e2e.yml` (optional, services: postgres + redis)
- Modify: `docs/deployment.md` or a new `apps/api/e2e/README.md` documenting how to run it.

- [ ] **Step 1** Run the full sweep: `DATABASE_URL=...rawkoon_e2e bun run e2e:endpoints` → **261/261 pass, 0 uncovered**. Paste the summary line.
- [ ] **Step 2** Run `bun run e2e:smoke` → green.
- [ ] **Step 3** Deliberately break one fixture (wrong `expectedStatus`) and confirm the runner goes red; revert.
- [ ] **Step 4** Write `apps/api/e2e/README.md`: prerequisites (e2e DB, `dev:services`), the two commands, the DB-name guard, how to add a fixture when a route is added.
- [ ] **Step 5** (optional) Add `.github/workflows/e2e.yml` with postgres+redis services running `db:migrate:deploy` then `e2e:endpoints`. Commit `ci(e2e): endpoint sweep workflow + docs`.

---

## Self-Review

**Spec coverage:** safety guard (T1) ✓; external mocks (T2) ✓; context (T3) ✓; enumeration + better-auth routes (T4) ✓; fixture model + coverage gate (T5) ✓; seed incl. admin/non-admin/profiles/integrations (T6) ✓; driver + positive/negative/auth (T7) ✓; report + runner + exit code (T8) ✓; Playwright worker-less smoke (T9) ✓; all-261 fixtures dependency-ordered (T10–28) ✓; full-green + CI + docs (T29) ✓. Every spec section maps to a task.

**Placeholder scan:** the `ctx_qp` shorthand in the worked example is annotated inline as "use `ctx.get("qualityProfileId")`" — not a plan placeholder but a labelled illustration. Domain route lists are explicitly deferred to the runtime enumerator by design (the spec forbids trusting remembered route lists), with the contract fully specified — this is a deliberate interface, not a TODO.

**Type consistency:** `Context.get/set`, `Fixture`, `FixtureRegistry`, `Route`, `Result` names are used identically across T3–T8 and the fixture tasks. `installExternalMocks`/`mockState`, `resetAndSeed`, `enumerateRoutes`/`BETTER_AUTH_ROUTES`, `coverageReport`, `driveRoute`/`checkPositive`/`checkNegative`/`checkAuth`, `printReport` are defined once and consumed by name.
