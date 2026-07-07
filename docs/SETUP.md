# Setup

How to get Rawkoon running locally. Uses Bun + Makefile for everything.

Last verified: 2026-05-25

## Prerequisites

- **Bun** ≥ 1.3 (`oven/bun:1.3.11` in CI). Rawkoon is Bun-native — do **not** use `npm`, `yarn`, or `pnpm`.
- **Docker + Docker Compose** for PostgreSQL and Redis in dev.
- A `.env` file at the repo root — copy `.env.example` and edit.

## First Run

```bash
make install           # bun install at the workspace root
cp .env.example .env   # then edit (see required vars below)
make dev-services      # docker compose up db redis -d
make dev-api           # in a second terminal — bun --watch on the API
make dev-web           # in a third terminal — Vite dev server on :5173
```

API listens on `${API_PORT:-3000}`. The dev web server proxies API calls; the production single-container build serves both from one port.

## Required Env Vars

The full template is `.env.example`. Bare minimum to boot:

| Var                                          | Purpose                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                               | `postgresql://rawkoon:…@db:5432/rawkoon` (use `localhost:5433` if you're running the API on the host)               |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Used by the `db` Compose service.                                                                       |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` (or `REDIS_URL`) | BullMQ queues + caching.                                                                       |
| `SECRET_KEY`                                 | App-wide signing secret. Generate with `openssl rand -base64 32`.                                                  |
| `BETTER_AUTH_SECRET`                         | Better Auth session secret (≥ 32 chars). Falls back to `SECRET_KEY` if unset, but set this explicitly in prod.    |
| `BASE_URL`                                   | Public URL (e.g. `http://localhost:3000`). Used by Better Auth and the qBittorrent webhook URL resolver.          |
| `CORS_ORIGIN`                                | Frontend origin for dev (`http://localhost:5173`); same as `BASE_URL` in single-container prod.                   |
| `ALLOWED_EMAILS`                             | Comma-separated allowlist. Only these addresses can register/be invited.                                          |
| `ADMIN_EMAILS`                               | Subset of `ALLOWED_EMAILS` that get admin privileges.                                                            |
| `IMAGE_STORAGE_DIR`                          | Defaults to `./data/images` (resolved from API cwd, which is `apps/api` in dev). Mount as a volume in prod.       |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CONTACT_EMAIL` | Web Push. Generate via `bunx web-push generate-vapid-keys`. Can also live in `vapid_keys/` files. |

Optional but commonly enabled: `TMDB_API_KEY`, `OMDB_API_KEY`, SMTP credentials, OIDC providers (configured via Settings UI → stored in `OidcProvider` table).

Why `BETTER_AUTH_SECRET` is required separately from `SECRET_KEY`: the API fast-fails on startup if it's missing (see `apps/api/src/lib/auth.ts:13-20`) because session cookies signed with a dev fallback would be silently invalid after rotation.

## Database

Schema lives at `apps/api/prisma/schema.prisma`. **Always use the Makefile** — never run Prisma CLI directly (the targets handle `cwd` and pass the correct env file):

```bash
make migrate-dev     # create + apply a new migration (interactive)
make migrate-deploy  # apply pending migrations (used in prod entrypoint)
make migrate-push    # push schema without a migration file (dev scratch only)
make migrate-studio  # open Prisma Studio
```

For schema changes: edit `schema.prisma`, then `make migrate-dev` from the repo root.

## Docker Dev (Alternative)

To run everything (API + web + DB + Redis) in containers, copy `docker-compose.prod-example.yml` → `docker-compose.prod.yml` and `docker compose -f docker-compose.prod.yml up -d`. This mirrors prod and is useful for testing the unified container, but loses hot reload.

The default `docker-compose.yml` only starts `db` and `redis` (used by `make dev-services`).

## Common Commands

```bash
make test          # bun run test across web, api, shared
make lint          # ESLint (same as CI)
make typecheck     # TS check on each workspace that defines a typecheck script
make build         # production web build (apps/web → dist/)
```

Inline scripts useful during development:

```bash
make library-refresh-titles-dry    # preview TMDB en-US title refresh, no writes
make library-refresh-titles-apply  # apply en-US TMDB metadata to all library_media
make db-refresh-collation          # PostgreSQL collation refresh (after libc upgrades)
```

