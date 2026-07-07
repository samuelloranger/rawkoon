# API

How the Elysia API is structured: route composition, the Better Auth model, error helpers, and rate limiting.

Last verified: 2026-05-25

## Composition

`apps/api/src/index.ts` constructs the root `Elysia` app and composes every feature plugin via `.use()`. Each plugin sets its own prefix (e.g. `prefix: "/api/medias"`) so URLs stay localized. Major groups:

- `dashboardRoutes`, `usersRoutes`, `notificationsRoutes`, `webhooksRoutes`
- `releasesRoutes`, `settingsRoutes`, `adminRoutes`, `analyticsRoutes`, `integrationsRoutes`
- Library family: `libraryMediaAdminRoutes`, `libraryDownloadsRoutes`, `libraryRoutes`, `qualityProfilesRoutes`, `mediasRoutes`
- `customFormatsRoutes`, `searchRoutes`, `systemRoutes`
- Better Auth: `publicAuthRoutes`, `ssoProvidersRoute`, `protectedAuthRoutes`, plus a catch-all `app.get/all("/api/auth/*", …)` that delegates to `betterAuthInstance.handler(request)`.

Two health endpoints exist: `GET /health` and `GET /api/health` (both return `{ status: "ok" }`).

## Auth

Better Auth (`apps/api/src/lib/auth.ts`) backs all session management. Configuration highlights:

- Prisma adapter, PostgreSQL, UUID IDs.
- Email + password (sign-up disabled — invitations only). Custom password hashing via `argon2id` (`apps/api/src/utils/password.ts`).
- 30-day sessions with `cookieCache: { enabled: true, maxAge: 5 * 60 }`.
- Plugins: `bearer()` for token auth, `passkey()` for WebAuthn (configurable via `WEBAUTHN_*` env), and `genericOAuth()` loaded from `OidcProvider` rows at startup. `refreshOidcProviders()` reloads after admin edits.
- Custom `User` fields: `firstName`, `lastName`, `isAdmin`, `locale` (Better Auth `additionalFields`). Better Auth's `image` is aliased to `avatarUrl`.
- A `session.create.after` hook stores the originating provider (`credential` or OIDC slug) on `BaSession.providerId`.

Trusted origins: `CORS_ORIGIN` plus `BASE_URL`.

### Middleware

`apps/api/src/middleware/auth.ts` exposes three primitives:

- `resolveUser(request)` — returns the mapped `User` or `null`. Used both inside route resolvers and by the SPA bootstrap (`apps/api/src/index.ts:165`).
- `requireUser` — plugin that resolves `user` into context and returns `401 { error: "Unauthorized" }` when missing.
- `requireAdmin` — same as above plus a 403 check on `user.is_admin`.

Compose with `.use(auth)` first (resolves the optional user) when the route mixes public + private logic; otherwise just `.use(requireUser)` directly.

## Error Helpers

`apps/api/src/errors.ts` exports small helpers that set `set.status` and return a uniform `{ error: string }`:

| Helper               | Status |
| -------------------- | ------ |
| `badRequest`         | 400    |
| `unauthorized`       | 401    |
| `forbidden`          | 403    |
| `notFound`           | 404    |
| `conflict`           | 409    |
| `unprocessable`      | 422    |
| `serverError`        | 500    |
| `badGateway`         | 502    |
| `serviceUnavailable` | 503    |

Always wrap handlers in `try/catch` and return one of these on failure. Don't `throw` — Elysia's global `onError` (`apps/api/src/index.ts:103-115`) is a last-resort fallback that returns generic 404/400/500 messages and logs the raw error.

## Rate Limiting

`apps/api/src/middleware/rateLimit.ts` registers `elysia-rate-limit` globally as `globalRateLimit`: **1000 unauthenticated requests per hour per IP**, authenticated users (any active Better Auth session) bypass the limiter entirely. The key generator uses `x-forwarded-for` (first hop) or `x-real-ip`, falling back to `"unknown"`.

Why bypass for authed users: legitimate dashboards poll frequently (SSE fallbacks, autosaves). The limit only exists to throttle pre-auth probing.

## URL Conventions

- All routes prefixed with `/api/` (so production static serving can hand the rest to the SPA catch-all).
- Path segments are kebab-case: `/api/clear-completed`, `/api/quality-profiles`, `/api/library/downloads`.
- Verbs come from HTTP methods, not URL words.
- Sub-resources nest under the parent: `/api/library/:id/grab`, `/api/library/:id/files`.

## Swagger

In non-production (`NODE_ENV !== "production"`) the API mounts `@elysiajs/swagger`. Useful for poking at routes during development.

## CORS

`@elysiajs/cors` allows `CORS_ORIGIN` (defaults to `http://localhost:5173` for dev) with `credentials: true`. In production (single container serving the SPA), web and API share an origin, so CORS is effectively a no-op.
