# apps/api/e2e — endpoint verification harness

A **framework-agnostic** regression sweep that drives every API endpoint and
asserts it still accepts valid input, rejects invalid input (HTTP 400), and
gates auth (401/403). One run is **477 checks** across the fixtured routes,
written to `e2e/results.json`.

It was originally built to verify the `t.`→Zod migration and to prove parity
across the Elysia→Hono move (the same suite ran against both frameworks); Elysia
is now fully removed and Hono is the only backend, but the suite remains as the
standing endpoint regression gate.

Spec/plan: `docs/superpowers/specs|plans/2026-09-09-endpoint-verification-harness.*`.

## Run it

Prerequisites: `dev:services` up (Postgres on :5433) and a dedicated **`rawkoon_e2e`**
database (`createdb rawkoon_e2e` + `prisma migrate deploy` against it).

```bash
cd apps/api
DATABASE_URL=postgresql://rawkoon:<pw>@localhost:5433/rawkoon_e2e \
SECRET_KEY=<32+ chars> BETTER_AUTH_SECRET=<32+ chars> \
bun run e2e:endpoints
```

The script adds `--preload ./e2e/mocks/preload.ts` (installs external mocks). A
**DB-name guard** refuses to run unless the database name ends in `_e2e`/`_test`.
Every run truncates + reseeds a disposable dataset. Exit code is non-zero on any
failed check or any uncovered/extra route.

`bun run e2e:manifest` regenerates `routes.manifest.json` from the app's route table.

## How it works (and why in-process)

- **In-process dispatch.** The runner drives routes through `server.ts`'s
  `dispatch(req) = app.fetch(req)` seam — real HTTP `fetch` is used instead when
  `BASE_URL` is set. In-process is the default because this sandbox SIGTERMs any
  process that binds a listening socket.
- **Framework touch-point is isolated to two files:** `server.ts` (dispatch/listen)
  and `genManifest.ts` (route dump). Everything else — runner, http client,
  fixtures, assertions, manifest loader, mocks, seed — speaks HTTP/JSON only.
- **External services are mocked** in `mocks/externals.ts`: `ioredis` + `bullmq`
  stubs (no Redis/queue connection), `web-push` stub, and a `globalThis.fetch`
  shim for the ~14 HTTP providers. Prisma uses the real disposable `rawkoon_e2e` DB.
- **Coverage gate:** every route in `routes.manifest.json` must have a fixture; a
  missing fixture fails the run. This keeps "each and every endpoint" honest.

## Adding / editing a fixture

Fixtures live in `fixtures/<domain>.ts` as a `FixtureRegistry` keyed by
`"METHOD /api/path"` (see `fixtures/types.ts` and any existing domain). When a new
route is added, the coverage gate fails until it has a fixture. Key flags:

- `body(ctx)` valid payload; `negativeBody` an invalid one → asserts **400**
  (`VALIDATION_STATUS`, pinned in `httpClient.ts`); `null` for no-body routes.
- `pathParams(ctx)` fills `:params` from seeded ids (see `seed.ts` for what's seeded).
- `admin: true` adds a non-admin-403 check; `public: true` skips the logged-out-401 check.
- `expectedStatus` overrides the default 2xx (e.g. a documented 404/409/400).
- `captures(body, ctx)` stashes created ids; `phase` orders create→read→update→action→delete.
- `skipReason` opts a route out (SSE streams, custom-header-gated, multipart uploads,
  OAuth redirect flows, better-auth CSRF POSTs, pipelines needing shaped external data).

## Migration gotcha this harness caught

Elysia auto-coerced **path/query** params for `t.Number`/`t.Integer`/`t.Boolean`;
Zod `z.number()` does not. So a `t.Number`→`z.number()` conversion was correct for
JSON **bodies** but a regression for **params/query** — those need
`z.coerce.number()`. Fixed in `blocklist/:id` and `libraryJobStats` query params.
