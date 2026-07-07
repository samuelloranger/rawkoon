# Web API access

## Default: everything goes through `httpClient`

All app data access **must** go through the shared client in this folder — via
`useFetcher` (TanStack hooks), `webFetcher`, or `fetchApi`. Do not hand-roll
`fetch` in feature/page code.

`httpClient` (`httpClient.ts`, instantiated in `client.ts`) centralizes the
rules that are easy to get wrong:

- **Cookie auth** — `authMode: "cookie"` ⇒ every request sends
  `credentials: "include"`. Auth is a session cookie; nothing is in headers.
- **Same-origin base URL** — `baseUrl: ""`. The SPA is served from the API
  origin in prod and proxied same-origin in dev, so requests use root-relative
  `/api/...` paths. Never introduce an absolute origin.
- JSON serialization, `HttpError` mapping, `204` handling, dev/prod network
  error messages, and bearer-mode 401 refresh.

Get these wrong and you get a **prod-only auth bug**: same-origin requests send
cookies by default in dev, so a missing `credentials: "include"` or a
hard-coded origin can pass locally and 401 only once deployed behind a
different origin/proxy.

## When raw `fetch` / `EventSource` is allowed

Two — and only two — situations bypass `httpClient`:

1. **Service Worker code (`src/sw/`)** — the SW is bundled separately (IIFE, see
   `apps/web/vite-plugin-service-worker.ts`) and **cannot resolve the `@/`
   alias**, so it cannot import `httpClient`. SW files must use raw `fetch` and
   manually replicate the cookie/URL rules.
2. **Fire-and-forget background calls that must stay silent** — e.g.
   `lib/notifications/useCloseReadNotifications.ts` runs on `visibilitychange`
   and intentionally swallows offline/unauthenticated errors instead of
   surfacing `httpClient`'s network-error toast.

Real-time streams use **`EventSource`**, which `httpClient` does not wrap.
Set `withCredentials: true` on any `EventSource` you create (see the streams
listed below). Hand-rolled `EventSource` is the
same bypass class as raw `fetch` and carries the same risk.

## The two non-negotiable rules for any bypass

Any raw `fetch`/`EventSource` to `/api/*` **MUST**:

1. Send cookies — `fetch`: `credentials: "include"`; `EventSource`:
   `{ withCredentials: true }`.
2. Use a **root-relative** path (`/api/...`). Never an absolute origin or an
   env-based base URL.

## Files that bypass `httpClient` and MUST duplicate these rules

Keep this list current — these are the only sanctioned bypasses.

### Service Worker (`src/sw/`) — cannot import `httpClient`

| File                               | Call                                                                 | Cookie rule                 |
| ---------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| `sw/badge.ts`                      | `GET /api/notifications/unread-count`                                | `credentials: "include"` ✅ |
| `sw/notification-click-handler.ts` | navigates to a root-relative URL via `clients.openWindow` (no fetch) | n/a — navigation only       |

### App code — intentional bypass

| File                                             | Call                          | Why raw                                                           |
| ------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------- |
| `lib/notifications/useCloseReadNotifications.ts` | `GET` unread IDs on tab focus | fire-and-forget; must no-op silently when offline/unauthenticated |

### Real-time streams (`EventSource`)

| File                                         | Stream                             | `withCredentials` |
| -------------------------------------------- | ---------------------------------- | ----------------- |
| `lib/notifications/useNotificationStream.ts` | `/api/notifications/stream`        | ✅                |
| `features/medias/hooks/useMigrateStatus.ts`  | `LIBRARY_ENDPOINTS.MIGRATE_STATUS` | ✅                |
| `features/medias/hooks/useLibraryEvents.ts`  | `/api/library/events`              | ✅                |
