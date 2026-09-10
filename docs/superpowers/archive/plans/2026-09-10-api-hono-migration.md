# HONO_MIGRATION_PLAN.md

The actual Elysia → Hono route port. Board task **1155**. Branch `refactor/tzod-migration`.

This plan assumes `FRAMEWORK_DECOUPLING_PLAN.md` is **done**: every route handler is
framework-neutral. No handler touches Elysia `set` anymore — error helpers, success
statuses (201/202/204), and `set.headers` all return Web `Response` objects (commits
`3a1484d`, `3f8ebb7`, `a1fab40`, `f369e48`, `c909d4e`). Schemas are already Zod. The
only remaining Elysia coupling is the framework wiring itself, and this document is the
mechanical map for removing it.

Hono API facts below were verified against current docs (context7 `/websites/hono_dev`
and `/honojs/middleware`, 2026-09-10).

---

## 0. Scope

**In scope** — the framework re-wire only:
- 66 `new Elysia()` route instances (73 total minus 6 `*.test.ts` minus `auth.ts`, which is
  out of scope) → Hono routers.
- The single edge adapter in `src/index.ts`: `onError`, `.resolve()` user population,
  plugin order (rate-limit, CORS, timing), the SPA static + gzip catch-all.
- `src/middleware/{auth,apiKey,requestTiming,rateLimit}.ts` → Hono middleware.
- Route validation binding `{ body|query|params: z... }` → `@hono/standard-validator`
  (`sValidator`). Schemas unchanged (already Zod).
- The 16 test files that build an Elysia app / call `.handle()` → Hono + `app.fetch`.
- e2e harness `server.ts` dispatch seam (`app.handle` → `app.fetch`).

**Out of scope** (do NOT touch):
- better-auth wiring: `src/lib/auth.ts`, the `/api/auth/*` catch-all, and `src/auth.ts`
  (public/protected/sso/mobile auth routes — these still use Elysia `t.` and `set`, and
  the mobile OAuth bridge). They stay Elysia-shaped until a separate task. **Consequence:**
  during and after this port the app is a **hybrid** — see §6.
- Workers / queues (`services/queueService.ts`, `workers/*`), all business logic in
  `services/*`.

**Gates (unchanged):** full api suite **1225/0**, `bun run typecheck`, `bun run lint` /
`format`, and the e2e parity harness (`apps/api/e2e`) green on **both** frameworks.

---

## 1. The five semantic gaps (Elysia → Hono)

These are the behavior differences that make the port more than a find-replace. Every one
is a parity risk; each has a mitigation.

### 1.1 Returned POJOs do NOT auto-serialize  ← biggest surface

Elysia auto-JSONs a returned plain object. **Hono does not** — a handler must return a
`Response`. So every `return { … }` must return a `Response` instead.

**House style — do NOT use `c.json()`.** Hono accepts a raw `Response` returned from a
handler, and we already return `Response.json(...)` everywhere (the error helpers). Keep
that consistent: add one success helper and never touch `c` on the return path.

```ts
// errors.ts (next to the neutral error helpers — same house style)
export const ok = (body: unknown, status = 200) => Response.json(body, { status });
```

- Error helpers already return `Response` → unchanged.
- SSE / avatar / gzip handlers already return raw `new Response(...)` → unchanged.
- **Every success POJO** (~200 handlers) becomes `return ok({ … })` — NOT `c.json({ … })`.
  `return { success: true, users }` → `return ok({ success: true, users })`.
- Status-bearing success: keep the existing `Response.json(body, { status: 201 })` calls
  as-is, or `ok(body, 201)`. Never `c.json(body, 201)`.

The upshot: `c` is a **read-only input handle** in a handler — `c.req.valid(...)`,
`c.get('user')`, `c.req.raw`, pulled at the top. Handler bodies and every return stay in
today's `Response.json`/`ok()` style, so the diff stays small and `c.` stays out of the
bulk of the code.

### 1.2 Context shape: `{ body, params, query, user, set }` → `c`

Elysia destructures a context bag. Hono passes one `Context` `c`:

| Elysia | Hono |
|---|---|
| `body` | `c.req.valid('json')` (needs `sValidator('json', …)`) |
| `query` | `c.req.valid('query')` or `c.req.query('k')` |
| `params.id` | `c.req.valid('param')` or `c.req.param('id')` |
| `user` | `c.get('user')` (typed via `Variables`, see §2) |
| `request` | `c.req.raw` (the Web `Request`) |
| `set.status`/`set.headers` | already removed from handlers; use `ok(body, status)` / Response headers (§1.1) |

Every handler signature `async ({ … }) =>` becomes `async (c) =>` with reads pulled from
`c`. Path/query params that today rely on Elysia coercion already carry `z.coerce` (see
memory `rawkoon-elysia-param-coercion`); validate them through `sValidator('param'|'query')`
so the coercion still runs.

### 1.3 Validation error body changes  ← parity risk

Today: an invalid body throws Elysia `VALIDATION`, caught by the global `onError` →
`400 { error: <message> }`.

Hono `sValidator`/`zValidator` **default** returns `400 c.json(result)` — the raw Zod
safeParse result, a totally different body shape. To preserve the contract, supply a hook
to **every** validator:

```ts
import { sValidator } from "@hono/standard-validator";
const jsonV = <T extends z.ZodTypeAny>(schema: T) =>
  sValidator("json", schema, (result, c) => {
    if (!result.success) return badRequest(result.error.issues[0]?.message ?? "Invalid request");
  });
```

Write thin wrappers (`jsonV`, `queryV`, `paramV`) once in `middleware/validate.ts` and use
those everywhere, so the 400 shape stays `{ error: msg }`. The e2e harness's 75 negative
checks will catch any drift here — run them.

### 1.4 Route mounting: absolute prefix → `app.route()`

Elysia bakes an absolute prefix into each instance (`new Elysia({ prefix: "/api/library" })`)
and flattens on `.use()`. Nested children use **relative** prefixes (`/discover`,
`/watchlist`, `/channels`, `/oidc`) and inherit the parent's.

Hono composes by mounting: `parent.route('/sub', child)`, where `child`'s own routes are
path-relative. Two equivalent options — **pick per-router to minimize churn**:

- **Keep absolute paths**: `const r = new Hono(); r.get('/api/library/:id', …)` then mount
  at root `app.route('/', r)`. Zero path edits inside a flat router. Good for the many
  single-file routers.
- **Relative + mount**: `const r = new Hono(); r.get('/:id', …)`; `app.route('/api/library', r)`.
  Cleaner, but every path string in the router changes. Use for the composed trees
  (`library`, `medias`, `books`, `integrations`, `admin`) whose children already use
  relative prefixes — those map 1:1 to `parent.route('/discover', discoverRoutes)`.

Recommendation: default to **keep-absolute** for flat routers (least risk), use
**relative+mount** only where a parent already `.use()`s relatively-prefixed children.

### 1.5 Per-route guards: Elysia plugin fn → Hono middleware

`requireUser` / `requireAdmin` are `(app) => app.resolve(...).onBeforeHandle(...)` applied
via `.use()`. In Hono they become middleware applied as the first arg to a route or via
`router.use('*', mw)`:

```ts
// middleware/auth.ts (Hono)
export const requireUser = createMiddleware(async (c, next) => {
  const user = await resolveUser(c.req.raw);
  if (!user) return unauthorized();         // helper returns Response → short-circuits
  c.set("user", user);
  await next();
});
export const requireAdmin = createMiddleware(async (c, next) => {
  const user = await resolveUser(c.req.raw);
  if (!user) return unauthorized();
  if (!user.is_admin) return forbidden();
  c.set("user", user);
  await next();
});
```

A middleware that returns a `Response` without calling `next()` short-circuits — exactly the
`onBeforeHandle` semantics. `resolveUser(request: Request)` is already framework-neutral;
reuse it verbatim. `ensureAdmin(user)` (inline guard, already returns `Response | null`) also
reuses verbatim — call it inside handlers as today.

---

## 2. Typed context (`user`)

Declare the context variable once so `c.get('user')` is typed app-wide:

```ts
// a shared types module
type Variables = { user: MappedUser };        // set only after requireUser/requireAdmin
export const factory = createFactory<{ Variables: Variables }>();
```

Routers guarded by `requireUser`/`requireAdmin` can treat `c.get('user')` as non-null.
Public routes that optionally read a user (the SPA shell bootstrap) call `resolveUser`
directly, as `index.ts` already does.

---

## 3. The edge adapter (`src/index.ts`) — piece by piece

Current Elysia edge → Hono equivalent:

| Concern (Elysia) | Hono port |
|---|---|
| `new Elysia()` root | `const app = new Hono<{ Variables }>()` |
| `cors({ origin, credentials })` | `hono/cors` `cors({ origin, credentials: true })` |
| `swagger()` (dev only) | drop, or `@hono/swagger-ui` (optional, dev-gated). Simplest: drop for now. |
| debug `beforeHandle` logger | `app.use(async (c,next)=>{ if(debug) console.log(...); await next() })` |
| `requestTiming` plugin | Hono middleware (§4) |
| `.onError({code,error,set})` mapping NOT_FOUND/VALIDATION/500 | `app.onError((err,c)=>…)` for 500; `app.notFound((c)=>notFound("Not found"))` for 404; VALIDATION now handled at the `sValidator` hook (§1.3), not here |
| `strictAuthRateLimit` / `globalRateLimit` | `hono-rate-limiter` middleware (§4) |
| `.use(publicAuthRoutes/…)` + `.all('/api/auth/*', betterAuth.handler)` | **stay Elysia** — mounted via the hybrid bridge (§6) |
| domain `.use(xRoutes)` ×20 | `app.route('/', xRoutes)` (keep-absolute) or `app.route('/api/x', xRoutes)` |
| `.get('/api/health', …)` | `app.get('/api/health', (c)=>…)` returning `ok(health, degraded?503:200)` |
| `staticPlugin({assets:'./public'})` + SPA `.get('*')` | `serveStatic` from `hono/bun` + `app.get('*', …)` shell (§5) |
| gzip `.onAfterHandle` for `/assets/*.js|css` | Hono middleware that runs, `await next()`, then rewrites `c.res` for pre-compressed `.gz` (§5) |
| `app.listen(port)` | `export default { port, fetch: app.fetch }` for `bun run`, or `Bun.serve({ fetch: app.fetch, port })` |

**onError:**
```ts
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[unhandled]", err);
  return serverError("Internal server error");   // helper → Response
});
app.notFound(() => notFound("Not found"));
```
Note the current `onError` swallows all unknown errors into a 500 with a fixed body — keep
that behavior (never leak an internal message).

---

## 4. Middleware ports

- **`requestTiming.ts`**: env-gated (`PERF_TIMING_ENABLED`). Hono `createMiddleware`:
  stamp start on entry, `await next()`, then read `c.res.status` and `c.req.routePath`
  (Hono's matched-template equivalent of Elysia `route`) into `recordRequestTiming`. Inert
  branch stays a no-op passthrough.
- **`rateLimit.ts`**: replace `elysia-rate-limit` with `hono-rate-limiter`. Preserve
  `skip`/`generator`/`errorResponse` semantics: `keyGenerator` = the `ip:`/`ip_auth:` key,
  `skip` = the async credential/session bypass (needs the session lookup — `hono-rate-limiter`
  supports an async `skip`; if not, gate inside a wrapping middleware). **Watch the global
  scoping trap** (memory `elysia-rate-limit-global-scoping`): mount the limiter exactly where
  it applies, not on a shared router.
- **`apiKey.ts`** (`requireApiKey`): `createMiddleware` — read `x-api-key`, verify, else
  `unauthorized()`. Direct port of the current one-liner.

Add deps: `hono`, `@hono/standard-validator`, `hono-rate-limiter`. Remove `elysia`,
`@elysiajs/*`, `elysia-rate-limit` **only after** `auth.ts` is also ported (it still imports
`elysia` — hybrid phase keeps Elysia installed).

---

## 5. Static + SPA + gzip

- `serveStatic({ root: "./public" })` from `hono/bun`, mounted so it does not shadow `/api/*`.
  Keep the `ignorePatterns` intent: `.html` must not be served as a module — Hono's
  `serveStatic` serves files directly (no Bun HTML-module quirk), but keep the SPA shell on
  the `*` catch-all so bootstrap injection still happens.
- **SPA catch-all** `app.get('*', …)`: identical logic — `isApiPath()` guard returns
  `notFound()` for unmatched `/api/*` (the epub.js bug fix, keep it verbatim), else read
  `spaIndexHtmlPromise` + `resolveUser`, inject `window.__RAWKOON_BOOTSTRAP__`, return the
  HTML Response with `Cache-Control: no-cache`.
- **gzip pre-compressed assets**: middleware form —
  ```ts
  app.use("/assets/*", async (c, next) => {
    await next();
    // then: same path-normalize guard, accept-encoding check, swap c.res for the .gz Response
  });
  ```
  Reuse the existing normalize/ext/accept-encoding guards unchanged; only the "how to replace
  the response" step changes (`c.res = new Response(gzFile, {...})`).

---

## 6. Hybrid phase (auth.ts stays Elysia)

`src/auth.ts` (public/protected/sso/mobile) and the `/api/auth/*` better-auth catch-all are
out of scope. During this port the process runs **both** frameworks. Bridge options:

- **Preferred — Hono owns the edge, delegates the auth subtree to Elysia.** Build a small
  Elysia app holding exactly the auth routers + the better-auth catch-all, expose its
  `.handle`, and from Hono mount a catch-all for the auth paths that forwards `c.req.raw`:
  ```ts
  app.all("/api/auth/*", (c) => elysiaAuthApp.handle(c.req.raw));
  app.all("/api/mobile/*", (c) => elysiaAuthApp.handle(c.req.raw));
  ```
  Both are Web `Request` → `Response`, so the boundary is clean. Rate-limit for auth
  (`strictAuthRateLimit`) can wrap the Hono catch-all so the limiter stays in Hono.
- Order matters: mount the auth catch-all and `downloadClientHookRoutes` before the SPA `*`.

When `auth.ts` is later ported (separate task), delete the bridge and the Elysia deps.

---

## 7. Execution order (incremental, one concern per commit)

Same cadence as the decoupling phase: each step keeps 1225/0 + typecheck/lint green, e2e
run at the milestones marked ⎇.

1. **Deps + scaffolding.** Add `hono`, `@hono/standard-validator`, `hono-rate-limiter`.
   Create `middleware/validate.ts` (`jsonV`/`queryV`/`paramV` wrappers, §1.3) and the typed
   `factory`/`Variables` (§2). No behavior change yet.
2. **Middleware ports.** `auth.ts` guards, `apiKey.ts`, `requestTiming.ts`, `rateLimit.ts`
   → Hono forms, living alongside the Elysia ones (new file names or exports). Unit-test the
   guards.
3. **Leaf routers first.** Port flat, dependency-free routers (`system`, `search`,
   `releases`, `settings`, `labby`, `custom-formats`, `quality-profiles`, `users`,
   `dashboard/*`) — one router per commit: signature rewrite (§1.2), `c.json` wrapping
   (§1.1), validators (§1.3). Their colocated `*.test.ts` port in the same commit.
4. **Composed trees.** `library/*`, `medias/*`, `books/*`, `integrations/*`, `admin/*`,
   `notifications/*`, `requests` — mount children with `route()` (§1.4). SSE routes
   (`library/events`, `migrate/status`) need no handler rewrite (already raw Response) —
   only the mount changes.
5. **Edge adapter.** Rewrite `src/index.ts` (§3): Hono root, onError/notFound, CORS, timing,
   rate-limit, health, static/SPA/gzip, `export default { fetch }`. Add the auth hybrid
   bridge (§6). ⎇ **Run e2e here** — first full-stack Hono dispatch.
6. **Test harness.** Port the 16 `.handle`/`new Elysia` test files to `new Hono` + `app.fetch`.
   Flip e2e `server.ts` `dispatch` from `app.handle` → `app.fetch`. ⎇ **Run e2e on Hono**;
   compare to the Elysia baseline (477/477, positive 205 / negative 75 / auth 197).
7. **Cleanup.** Once green on Hono and `auth.ts` still bridged: leave Elysia deps in place
   (auth.ts needs them). Do NOT remove `elysia`/`@elysiajs/*` until the auth port lands.

**Milestone parity check (both frameworks):** run the e2e harness per its recipe (memory
`rawkoon-endpoint-harness` / task 1155 note):
```
env -u BASE_URL -u NODE_ENV DATABASE_URL=<…rawkoon_e2e> \
  SECRET_KEY=<32+> BETTER_AUTH_SECRET=<32+> \
  bun --preload ./e2e/mocks/preload.ts ./e2e/run.ts
```
Elysia baseline is already **477/477**. Hono must match exactly, including the 75 negative
(validation-shape) and 197 auth (401/403) checks — those cover gaps §1.3 and §1.5.

---

## 8. Risk register

| Risk | Where | Mitigation |
|---|---|---|
| Validation 400 body drifts from `{ error }` | §1.3 | shared validator hook; e2e negative checks |
| A `return {…}` left unwrapped → handler returns undefined/500 | §1.1 | typecheck won't always catch it; e2e positive checks (205) will |
| Rate-limiter silently global-scoped | §4 | mount precisely; memory `elysia-rate-limit-global-scoping` |
| Param/query coercion lost | §1.2 | keep `z.coerce`, validate through `sValidator('param'|'query')` |
| Auth hybrid path ordering (auth catch-all vs SPA `*`) | §6 | mount auth + hooks before `*`; e2e auth checks |
| SSE stream regressions | §4 | handlers already return raw Response; only mount changes; smoke `/api/library/events` |
| Removing Elysia deps too early breaks `auth.ts` | §7 | keep deps until the separate auth port |

---

## 9. Definition of done

- All 66 in-scope routers + edge on Hono; `auth.ts` bridged (hybrid), documented as the next
  task.
- `bun run test` (api) **1225/0**, `bun run typecheck` clean, `bun run lint`/`format` clean.
- e2e harness **477/477 on Hono**, matching the Elysia baseline check-for-check.
- Board 1155 note updated with the Hono e2e result and any parity deltas found + fixed.
