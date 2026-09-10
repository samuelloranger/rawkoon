# Endpoint Verification Harness — Design

**Date:** 2026-09-09
**Status:** Approved design, pre-implementation
**Origin:** Verify that the `t.`→Zod validation migration (branch
`refactor/tzod-migration`, FRAMEWORK_DECOUPLING_PLAN.md Phase 3) left every
endpoint behaving identically — and leave behind a durable, **framework-agnostic**
regression suite that also proves parity across the planned **Elysia→Hono**
migration (same suite runs against both, results must match).

## Goal

Prove that **each and every one of the 261 API endpoints** still works:
accepts a valid request, rejects an invalid one, gates auth correctly, and
returns the expected status + response shape — and do so **without depending on
any framework-specific API**, so the identical suite validates the Elysia build
today and the Hono build after migration.

Structure:

1. **Contract sweep (HTTP)** — the rigorous proof. Boot the server as a
   subprocess and drive all 261 routes over **real HTTP with `fetch`** against a
   `BASE_URL`. Nothing in the harness imports the framework or calls
   `app.handle()`/`app.routes` — it only speaks HTTP, so it is identical for
   Elysia and Hono.
2. **Browser-origin smoke (Playwright, optional)** — a thin layer hitting a few
   endpoints from a real browser origin, proving CORS + cookie behavior that a
   same-process `fetch` doesn't exercise. Not required for parity.

**Framework-agnostic contract (load-bearing requirement):** the framework is
touched in exactly ONE file — `e2e/server.ts`, which imports the app and calls
`.listen()`. Swapping Elysia for Hono means editing that import only; the runner,
fixtures, manifest, mocks, seed, and assertions are unchanged. Parity is proved
by running the suite against the Elysia server (baseline) and the Hono server and
asserting an identical pass-set (and identical route manifest).

Non-goals: load/perf testing; testing the web UI beyond the CORS/cookie smoke;
testing better-auth internals; exercising the real external providers.

## Key facts this design relies on (verified 2026-09-09)

- `app` is exported from `apps/api/src/index.ts:68` and is **side-effect-free to
  import**: `initWorkers()`/`setupScheduledJobs()`/`app.listen()` are all inside
  the `if (import.meta.main)` guard (`index.ts:204-217`). So a custom server entry
  can import `app` and call `.listen()` WITHOUT starting workers.
- `app.routes` (Elysia `InternalRoute[]`) enumerates every mounted route as
  `{ method, path }`, path params as `:param`. **Used offline, once, to GENERATE a
  static `routes.manifest.json`** (a one-off generator script) — the harness reads
  the committed manifest at runtime, never `app.routes`, keeping it framework-neutral.
  Better-auth's routes hide behind the `.all("/api/auth/*")` catch-all — append
  those from a known list into the manifest. For Hono, regenerate the manifest and
  **diff it against the committed one — a difference is itself a parity finding.**
- Auth: `POST /api/auth/sign-in/email` → `better-auth.session_token` cookie. On a
  fresh DB the **first signup becomes admin** (`lib/auth.ts:203-214`); a login
  needs a `User` row **and** a `BaAccount { providerId: "credential", password }`
  row. `bearer()` plugin also accepts `Authorization: Bearer <session.token>`.
- DB: real Postgres is used when `DATABASE_URL` is set. `seedBaseline.ts`
  (`baseline:seed`) creates library media + episodes + books/editions/files in a
  reserved id namespace (`tmdbId >= 990_000_000`, `googleVolumeId` `seed-vol-*`).
  It does **not** create users, quality profiles, custom formats, integrations,
  or requests.
- **~30+ endpoints call external services synchronously in-handler** (TMDB,
  indexer adapters, download-client adapters incl. grab→`addTorrent`,
  Audnexus/Audible/GoogleBooks/OpenLibrary, Jellyfin, local-ai, webpush/APNs).
  These must be mocked at the service boundary or a full sweep fires real
  torrents and network calls. Library reindex/remux/migrate/post-process/upgrade
  are **deferred to BullMQ workers** — inert in-process (no worker running).

## Layout

```
apps/api/e2e/
  run.ts                # entrypoint: guard -> seed -> HTTP sweep vs BASE_URL -> report
  server.ts             # THE ONLY framework touch-point: imports app, .listen(), NO initWorkers
  mocks/preload.ts      # bun --preload: mock.module external boundaries before app import
  seed.ts               # extends seedBaseline + creates user/profiles/integrations/etc.
  routes.manifest.json  # committed route list, generated offline from app.routes
  genManifest.ts        # one-off generator: app.routes -> routes.manifest.json (framework-specific, dev-only)
  loadManifest.ts       # reads routes.manifest.json (+ better-auth routes) at runtime — framework-neutral
  fixtures/<domain>.ts  # per-domain fixture registries (delegated, reviewed)
  fixtures/index.ts     # merges domain registries; coverage gate (fixtures vs manifest)
  httpClient.ts         # fetch wrapper: BASE_URL + cookie; framework-agnostic
  assert.ts             # positive (status+shape) + negative (422) + auth spot-checks
  context.ts            # shared mutable id-context passed across phases
  report.ts             # PASS/FAIL table + summary + exit code
  smoke.spec.ts         # Playwright (optional): browser-origin CORS/cookie checks
  playwright.config.ts  # points at the e2e server via BASE_URL
```

Only `server.ts` and `genManifest.ts` know the framework; **everything else speaks
HTTP against `BASE_URL` and reads the manifest** — so the Hono migration edits
those two files (and regenerates+diffs the manifest), nothing else.

Runs on branch `refactor/tzod-migration` so it gates the migration PR. It is a
durable asset independent of the migration and may be split to its own PR.

## Component design

### Environment + safety (`run.ts` guard + `server.ts`)

- Requires `DATABASE_URL` whose **database name ends in `_e2e` or `_test`** — both
  `run.ts` and `server.ts` abort otherwise. Never dev, never prod. (Dedicated
  `rawkoon_e2e` DB in the `dev:services` Postgres.)
- Before each run: `prisma migrate deploy` onto the e2e DB, then truncate all
  tables (clean slate). After: leave it (idempotent next run) or `--clean`.
- Redis from `dev:services` (BullMQ `.add` is inert with no worker; still mocked
  by the preload to avoid any connection).
- The server subprocess is started with `bun --preload e2e/mocks/preload.ts run
  e2e/server.ts`. The preload runs **before** the app import in `server.ts`, so
  the mocked modules are the ones the routers close over. This mechanism is
  framework-neutral — it intercepts service modules, which sit below Elysia/Hono.
- `run.ts` waits for the server's `/api/health` to answer, then sweeps.

### External mocking (`mocks/preload.ts`)

`mock.module(...)` each boundary with deterministic canned returns, before `app`
import. Boundaries (from recon §4): TMDB provider; indexer adapters + manager
(`getIndexers`/`search`/`grabRelease`); download-client adapters
(`testConnection`/`addTorrent`/`list`); Audnexus/Audible/GoogleBooks/OpenLibrary
providers; Jellyfin; local-ai; `utils/webpush` + `utils/apns`; `queueService`
(no-op `add`). Canned returns must satisfy the handler's happy path so the
endpoint reaches its normal 2xx, and expose a knob for the failure-path variants
(`/test` endpoints that assert a bad config → error).

### Seed (`seed.ts`)

Reuse `seedBaseline.ts` for library+books. Add: admin user via the **real
first-signup flow** (so the `BaAccount` credential row is correct) then log in and
keep the cookie; a second **non-admin** user for the 403 spot-checks; one quality
profile; one custom format; a download-client integration row; an indexer
integration row; one request; notification config. Every created id lands in the
shared `context` for fixtures to reference.

### Manifest + coverage gate (`genManifest.ts`, `loadManifest.ts`, `fixtures/index.ts`)

- `genManifest.ts` (dev-only, framework-specific): imports `app`, maps `app.routes`
  → `{ method, path }[]`, drops the SPA static catch-all, appends the known
  better-auth routes, writes `routes.manifest.json`. Run manually when routes
  change; the JSON is committed.
- `loadManifest.ts` reads that committed JSON at runtime — **no framework import**.
- For the Hono migration: re-run `genManifest.ts` against the Hono app and **diff
  against the committed manifest**; any add/drop/rename is a parity finding to
  resolve before the manifests are reconciled.
- `fixtures/index.ts` merges the per-domain registries. **Coverage gate:** every
  manifest route MUST have a fixture; a route with no fixture is a hard failure.
  This is what keeps "each and every endpoint" true as routes are added.

### Fixture model

Keyed by `"METHOD /api/path"`. Uses only HTTP-level values (no framework types):

```ts
interface Fixture {
  pathParams?: (ctx: Context) => Record<string, string>; // fill :params from seeded ids
  query?: Record<string, string>;
  body?: (ctx: Context) => unknown;      // valid body
  expectedStatus?: number | number[];    // default: 2xx
  captures?: (body: unknown, ctx: Context) => void; // stash created ids from parsed JSON
  negativeBody?: unknown | null;         // invalid body -> expect 422; null = skip (no body route)
  admin?: boolean;                        // also assert 403 as non-admin
  skipReason?: string;                    // explicit, reviewed opt-out (must be justified)
}
```

### HTTP client (`httpClient.ts`)

A thin `fetch` wrapper — the single seam every request goes through, so the whole
suite is framework-agnostic: `request(method, path, { cookie, query, body }) =>
{ status, json, headers }` against `process.env.BASE_URL`. No `app.handle`, no
framework import. Swapping the server under `BASE_URL` (Elysia→Hono) changes
nothing here.

### Execution order (`run.ts`, `context.ts`)

Dependency-phased, not `app.routes` order, sharing a mutable `context`:

1. **bootstrap** — auth/setup + creates that generate ids (`captures` populate ctx).
2. **read** — GET endpoints.
3. **update** — PUT/PATCH.
4. **action** — grab/search/test/run (all externally mocked).
5. **delete** — DELETE endpoints last.

Phase assignment lives in each fixture (default inferred from method). Within a
phase, order is irrelevant.

### Assertions (`assert.ts`)

Per endpoint:
- **Positive:** status ∈ expectedStatus; if a `@rawkoon/shared` response type
  exists, zod-parse the body against it; else assert required keys present.
- **Negative:** if `negativeBody !== null`, replay with it and assert **422**
  (the direct proof the migrated validator still rejects bad input).
- **Auth spot-checks (sampled, not all 261):** a handful of routes hit
  logged-out → expect 401; `admin` routes hit as the non-admin user → expect 403.

### Reporting (`report.ts`)

Per-endpoint `PASS/FAIL METHOD path (status, ms)` line, then
`SUMMARY: passed X / 261, negative Y/Z, uncovered N`. **Exit non-zero** on any
failure or any uncovered route. `bun run e2e:endpoints` (server subprocess +
`BASE_URL` sweep). Emits a machine-readable `results.json` (per-route
status/kind/ok) so two runs (Elysia vs Hono) can be diffed programmatically.

### Framework parity use (Elysia → Hono)

The whole reason the suite is HTTP-only. To prove the migration:
1. Run against Elysia: `BASE_URL=<elysia> bun run e2e:endpoints` → `results.elysia.json` (baseline).
2. Run against Hono: `BASE_URL=<hono> bun run e2e:endpoints` → `results.hono.json`.
3. `bun run e2e:diff results.elysia.json results.hono.json` — asserts identical
   pass-set, identical status per route, identical negative (422) behavior. Any
   divergence is a migration regression. Plus the manifest diff (above) catches
   added/dropped routes.

Nothing in steps 1–3 imports a framework; only `server.ts`'s app import differs
between the two targets.

### Playwright browser-origin smoke (`smoke.spec.ts`, optional)

Against the same running `e2e/server.ts`, reuse `apps/web` Playwright +
storageState login. Hit a handful of endpoints from a real browser origin via
`APIRequestContext`: an authed GET, a validation-reject (422), a logged-out call
(401). Proves CORS + cookie flags that same-process `fetch` doesn't exercise. Not
part of the parity proof (that's the `fetch` sweep) — a wiring sanity only.
`bun run e2e:smoke`.

## Build plan (who does what)

- **Scaffolding (main agent):** `run.ts`, `server.ts`, `mocks/preload.ts`,
  `seed.ts`, `genManifest.ts` + `loadManifest.ts`, `httpClient.ts`, `assert.ts`,
  `context.ts`, `report.ts`, coverage gate, Playwright config + `smoke.spec.ts`,
  npm scripts, DB-name safety guard. This is the load-bearing correctness — and
  the framework-agnostic boundary (only `server.ts`/`genManifest.ts` touch the
  framework).
- **Fixtures (delegated per-domain, reviewed):** `fixtures/<domain>.ts` for all
  19 domains, authored against the fixture contract by Cursor/subagents; every
  batch diffed and re-run through the harness before acceptance
  (delegated-work-needs-review).

## Testing the harness itself

- The coverage gate is self-testing: a missing fixture fails the run.
- A deliberately-wrong fixture (bad expectedStatus) must make the run red — smoke
  it once during scaffolding.
- The DB-name guard must abort on a non-`_e2e`/`_test` `DATABASE_URL` — unit-test
  that guard.

## Risks

- **Mock drift:** a canned external return that diverges from the real provider's
  shape can mask a handler bug. Mitigation: mocks satisfy only the handler's
  happy-path contract; the migration under test is validation, not provider I/O.
- **Fixture volume (~130):** the bulk of the effort; mitigated by per-domain
  delegation + the coverage gate preventing silent gaps.
- **Seed/FK completeness:** endpoints whose ids aren't seeded can only assert
  4xx; the seed set must cover every `:id`-bearing domain. Tracked per-domain.
- **Preload mock interception in a real subprocess:** `mock.module` must actually
  intercept when the server is started via `bun --preload` (not under `bun test`).
  Verify this in the very first scaffolding task with a one-endpoint probe (mock
  `grabRelease`, hit a grab route, confirm no real adapter call) before building
  the rest. If `--preload` + `mock.module` doesn't intercept, fall back to an
  env-flagged stub seam in the service factories (still framework-neutral).
- **Framework-agnostic erosion:** a fixture or the runner reaching for an
  Elysia-ism (status-code quirk, header casing, error-body shape) would break the
  Hono run. Mitigation: assertions key on HTTP status + JSON body shape only; the
  Hono target must produce the same error-body contract (the decoupling plan's
  single edge mapper guarantees this). The `e2e:diff` step is the backstop.
- **422 vs framework default:** Elysia's validation failure status may differ from
  Hono's default (e.g. 400 vs 422). The negative check asserts a *configured*
  status constant (`VALIDATION_STATUS`), set once, so both frameworks are pinned
  to the same code — if they differ out of the box, that pin is where it's fixed.
