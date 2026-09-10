# apps/api — Framework Decoupling Plan

**Goal:** decouple business logic, request validation, and cross-cutting concerns
from Elysia so a future framework move (Elysia 2 **or** Hono) is a *mechanical
route re-wire*, not a rewrite. Every phase ships independently on **Elysia 1.4**,
is **behavior-neutral**, and keeps `main` green. Useful even if we never migrate
(shared contract, cleaner errors, OpenAPI).

This plan is self-contained. Any agent can execute a phase without further context.

---

## Why this shape (current coupling, measured 2026-09)

| Seam | Where | Size |
|---|---|---|
| Inline validation `t.*` (TypeBox) | `routes/**` | **~1045 occurrences across 50 files** — the biggest cost |
| Error helpers bound to Elysia `set` | `src/errors.ts` (9 helpers) + direct `set.status` | 9 helpers + **18 files** using `set.status` |
| Auth guards as Elysia plugins | `src/middleware/auth.ts` (`requireUser`/`requireAdmin`) | ~54 route files `.use()` them |
| Root composition / plugin order | `src/index.ts` | 1 file |

Two facts make this cheap and safe:
1. **Elysia 1.4 accepts Standard Schema validators (Zod/Valibot/etc.)** natively —
   see [Elysia 1.4 blog](https://elysiajs.com/blog/elysia-14). So we can replace
   `t.` with **Zod** in place, with zero behavior change, and the resulting schemas
   port unchanged to **Hono** (`@hono/standard-validator`) and **Elysia 2**.
   `zod ^4.5.4` is already a dependency of `apps/api`.
2. **Business logic already lives in `src/services/*`** (routes call services). Handlers
   are mostly thin already — keep them that way.

`resolveUser(request: Request)` in `middleware/auth.ts` is **already framework-neutral**
(takes a `Request`, returns the user). Only the `requireUser`/`requireAdmin` *plugin
wrappers* are Elysia-coupled.

---

## Ground rules (apply to EVERY phase)

- **One domain or one concern per commit/PR. Behavior-neutral.** Never change a
  response body, status code, or what validation accepts/rejects.
- **Gates — all must pass before committing** (run from repo root):
  - `bun run typecheck`
  - `bun run formatCheck` and `bun run lint`
  - `bun run --filter @rawkoon/api test` — **run the FULL suite** and compare the
    pass count to `main`. Expect **1225 pass / 0 fail**. The suite is
    order-dependent/flaky — a single-file run can look green while the full run is
    red, so never trust a single file.
  - If a change touches types shared with web: `env -u NODE_ENV bun run --filter @rawkoon/web test`
    (this shell exports `NODE_ENV=production`, which breaks the web suite — the
    `env -u` is required).
- **Coercion parity is the trap.** When converting `t.` → Zod, preserve exact
  semantics: `t.Numeric` → `z.coerce.number()`, `t.Optional(x)` → `x.optional()`,
  `t.String({ minLength, maxLength, format })` → `z.string().min().max().regex()/.email()`,
  `t.Union`/`t.Literal` → `z.union`/`z.literal`/`z.enum`, defaults, `t.Array`, nullability.
- **Do not touch:** better-auth wiring (`lib/auth.ts`, the `/api/auth/*` catch-all,
  `auth.ts` mobile routes), the SPA static/gzip catch-all in `index.ts`, or
  worker/queue code. Those are out of scope.
- iOS/macbuild is unaffected by this API work; no iOS gate needed.

---

## Phase 0 — Spike + scaffolding (1 PR)

1. Confirm `zod` is available in `apps/api` (it is: `^4.5.4`).
2. Create `apps/api/src/schemas/` for co-located request schemas (or
   `apps/shared/src/contracts/` if web/iOS will consume the same schemas — decide
   and document; default to `apps/api/src/schemas/` unless a shared contract is wanted).
3. **Spike:** pick ONE simple route with a `body: t.Object(...)`, convert it to a
   Zod schema passed to the same route. Confirm Elysia 1.4 validates it identically
   (typecheck + full api suite green). If any adapter glue is needed, add a tiny
   `zBody`/`zQuery` helper and document it. Capture the exact before/after pattern
   in the PR description — it becomes the template for Phase 3.

**Done when:** one route validates via Zod, all gates green, pattern documented.

## Phase 1 — Neutralize the error seam (1 PR)

1. Add a typed domain error: `class AppError extends Error { status: number; code: string }`
   (or a discriminated result). Rewrite the 9 `errors.ts` helpers
   (`badRequest/unauthorized/forbidden/notFound/conflict/unprocessable/serverError/badGateway/serviceUnavailable`)
   to **return/throw an `AppError`** instead of taking Elysia's `set`.
2. Add **one** edge mapper (in today's `index.ts` `onError`) that turns `AppError`
   → HTTP `{ error }` with the correct status. All other error handling flows through it.
3. Update call sites: `return helper(set, msg)` → `throw badRequest(msg)`, and the
   **18 files** using `set.status` directly → throw the matching `AppError`.
4. **Exact same JSON body + status** as before — many tests assert error shapes.

**Done when:** no route handler references Elysia `set` for errors; full suite 1225/0.

## Phase 2 — Neutralize the auth seam (1 PR)

1. Keep `resolveUser(request)` as-is (already neutral).
2. Add framework-neutral guards: `assertUser(request): Promise<User>` and
   `assertAdmin(request): Promise<User>` that throw the Phase-1 `AppError` (401/403).
3. Reduce `requireUser`/`requireAdmin` Elysia plugins to thin wrappers that call the
   neutral guards. A Hono/Elysia-2 middleware then becomes a trivial re-wrap.

**Done when:** auth logic is in neutral functions; plugins are ~3-line adapters;
same 401/403 behavior; full suite 1225/0.

## Phase 3 — Schema migration, domain by domain (≈16 PRs)

For each `routes/<domain>`, convert every inline `t.*` schema to Zod (co-located or
in the schemas/contracts dir). Elysia 1.4 accepts them directly.

Suggested order (small → large, to build confidence):
`system → dashboard → search → requests → quality-profiles → custom-formats →
releases → notifications → users → settings → integrations → labby → books →
medias → admin → library`.

- One domain per PR. Apply the coercion-parity checklist to every schema.
- Add a focused test for any schema with non-trivial coercion/optionality if one
  doesn't already cover it.
- Optionally move response types + schemas into `@rawkoon/shared` so web/iOS share
  the contract.

**Done when:** the domain has zero `t.` validation; full suite 1225/0 after each PR.

## Phase 4 — Keep handlers thin (opportunistic, 1 PR)

Audit handlers for inline business logic; push it into `services/` (+ a service
test). Most handlers are already thin — flag and fix the exceptions only.

## Phase 5 — OpenAPI contract (optional, 1 PR)

Generate OpenAPI from the Zod schemas (Elysia's `@elysiajs/openapi` supports Standard
Schema, or `zod-openapi`). This is the spec-driven artifact both Elysia 2 and Hono
can consume; it also documents the API for clients.

---

## Definition of done (whole effort)

- No `import { t } from "elysia"` used for validation; all request validation is Zod
  (Standard Schema).
- Errors and auth flow through framework-neutral adapters; **exactly one** file maps
  the neutral model to the framework's `set`/context.
- Handlers are thin; logic in `services/`.
- Gates: full api suite **1225/0**, web suite green, typecheck/lint/format green,
  `bun run build` green.
- **Net result:** a future move to Elysia 2 or Hono = re-wire ~283 route
  registrations to the new router API + swap the single edge adapter. Schemas,
  services, errors, and auth carry over unchanged — the ~1045-schema rewrite and the
  283 handler-logic ports are eliminated.

## Repo-specific gotchas

- **api suite is flaky/order-dependent** — always run the full suite, compare to `main`.
- **`NODE_ENV=production` is exported in this shell** — web tests need `env -u NODE_ENV`.
- **Don't rename response fields** (e.g. `/api/health`) without checking web/iOS consumers.
- **`rate-limit` global-scoping footgun** is out of scope here but worth a separate
  small PR: it can be fixed on Elysia 1.4 today (limiter `scoping`/`skip`) or falls out
  naturally under Hono's explicit middleware scoping.
