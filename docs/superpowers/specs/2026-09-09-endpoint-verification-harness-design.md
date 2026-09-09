# Endpoint Verification Harness — Design

**Date:** 2026-09-09
**Status:** Approved design, pre-implementation
**Origin:** Verify that the `t.`→Zod validation migration (branch
`refactor/tzod-migration`, FRAMEWORK_DECOUPLING_PLAN.md Phase 3) left every
endpoint behaving identically — and leave behind a durable regression suite that
proves every API endpoint still works.

## Goal

Prove that **each and every one of the 261 API endpoints** still works:
accepts a valid request, rejects an invalid one, gates auth correctly, and
returns the expected status + response shape. Layered as:

1. **Contract sweep (in-process)** — the rigorous proof. Import the Elysia `app`
   and drive all 261 routes via `app.handle()`.
2. **Transport smoke (Playwright)** — a thin real-HTTP layer over ~12
   representative endpoints with a logged-in cookie, proving cookie/CORS/transport
   wiring the in-process path bypasses.

Non-goals: load/perf testing; testing the web UI beyond the login+cookie smoke;
testing better-auth internals; exercising the real external providers.

## Key facts this design relies on (verified 2026-09-09)

- `app` is exported from `apps/api/src/index.ts:68` and is **side-effect-free to
  import**: `initWorkers()`/`setupScheduledJobs()`/`app.listen()` are all inside
  the `if (import.meta.main)` guard (`index.ts:204-217`). So importing `app`
  starts no workers and no server.
- `app.routes` (Elysia `InternalRoute[]`) enumerates every mounted route as
  `{ method, path }`, path params as `:param`. Better-auth's routes hide behind
  the single `.all("/api/auth/*")` catch-all — enumerate those from a known list.
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
  runContract.ts        # entrypoint: boot -> seed -> sweep -> report (in-process)
  server.ts             # thin e2e server entry: imports app, app.listen(), NO initWorkers
  boot.ts               # env guard, mock installation, app import, admin login
  mocks/externals.ts    # mock.module of every external service boundary
  seed.ts               # extends seedBaseline + creates user/profiles/integrations/etc.
  enumerate.ts          # app.routes -> route list (+ better-auth known routes)
  fixtures/<domain>.ts  # per-domain fixture registries (delegated, reviewed)
  fixtures/index.ts     # merges domain registries; coverage gate
  assert.ts             # positive (status+shape) + negative (422) + auth spot-checks
  context.ts            # shared mutable id-context passed across phases
  report.ts             # PASS/FAIL table + summary + exit code
  smoke.spec.ts         # Playwright: ~12 endpoints over real HTTP w/ storageState
  playwright.config.ts  # points at the e2e server; reuses storageState login
```

Runs on branch `refactor/tzod-migration` so it gates the migration PR. It is a
durable asset independent of the migration and may be split to its own PR.

## Component design

### Environment + safety (`boot.ts`)

- Requires `DATABASE_URL` whose **database name ends in `_e2e` or `_test`** — the
  harness aborts otherwise. Never dev, never prod. (Dedicated `rawkoon_e2e` DB in
  the `dev:services` Postgres.)
- Before each run: `prisma migrate deploy` onto the e2e DB, then truncate all
  tables (clean slate). After: leave it (idempotent next run) or `--clean`.
- Redis from `dev:services` (BullMQ `.add` is inert with no worker; still mocked
  by `mocks/externals.ts` to avoid any connection).
- Import order is load-bearing: **install mocks, THEN import `app`** so the mocked
  modules are the ones the routers close over.

### External mocking (`mocks/externals.ts`)

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

### Enumeration + coverage gate (`enumerate.ts`, `fixtures/index.ts`)

- `app.routes` → `{ method, path }[]`; append the known better-auth routes under
  test. Drop the SPA static catch-all.
- `fixtures/index.ts` merges the per-domain registries. **Coverage gate:** every
  enumerated route MUST have a fixture; a route with no fixture is a hard failure.
  This is what keeps "each and every endpoint" true as routes are added.

### Fixture model

Keyed by `"METHOD /api/path"`:

```ts
interface Fixture {
  pathParams?: (ctx: Context) => Record<string, string>; // fill :params from seeded ids
  query?: Record<string, string>;
  body?: (ctx: Context) => unknown;      // valid body
  expectedStatus?: number | number[];    // default: 2xx
  captures?: (res: Response, ctx: Context) => void; // stash created ids
  negativeBody?: unknown | null;         // invalid body -> expect 422; null = skip (no body route)
  admin?: boolean;                        // also assert 403 as non-admin
  skipReason?: string;                    // explicit, reviewed opt-out (must be justified)
}
```

### Execution order (`runContract.ts`, `context.ts`)

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
failure or any uncovered route. `bun run e2e:endpoints`.

### Playwright transport smoke (`smoke.spec.ts`)

Boot `e2e/server.ts` (imports `app`, `app.listen()`, no workers) against the e2e
DB with mocks. Reuse `apps/web` Playwright + storageState login (first-signup
admin). Via `APIRequestContext` with the logged-in cookie, hit ~12
representative endpoints: a public GET, an authed GET, an admin GET, a create, a
validation-reject (expect 422), a logged-out call (expect 401). Proves real HTTP
+ cookie + CORS. `bun run e2e:smoke`.

## Build plan (who does what)

- **Scaffolding (main agent):** `boot.ts`, `server.ts`, `mocks/externals.ts`,
  `seed.ts`, `enumerate.ts`, `assert.ts`, `context.ts`, `report.ts`,
  `runContract.ts`, coverage gate, Playwright config + `smoke.spec.ts`, npm
  scripts, DB-name safety guard. This is the load-bearing correctness.
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
