# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rawkoon is a self-hosted movie/TV library and download manager — a single Docker image that replaces the Radarr/Sonarr/Overseerr stack. It discovers titles through TMDB, searches releases through an indexer (Prowlarr/Jackett), hands grabs to a download client (qBittorrent, Transmission, Deluge), post-processes and imports files into the library, and notifies users (web push, notification channels). The project was formerly named **reelward**; the rename is complete but old clones/remotes may still use the old name. GPL-3.0, published as `ghcr.io/samuelloranger/rawkoon`.

## Repo layout

Bun workspace, `workspaces: ["apps/*"]`. Root `package.json` is the orchestrator — most root scripts are `bun run --filter @rawkoon/<app> …` passthroughs.

| Package | Path | What lives there |
|---|---|---|
| `@rawkoon/api` | `apps/api` | Elysia (Bun) HTTP server. `src/routes/*` (one dir per domain), `src/services/*` (business logic — the bulk of the code), `src/workers/*` (BullMQ job handlers), `src/middleware/*` (auth, rate limit), `src/db` (Prisma client + ioredis), `prisma/` (schema + migrations), `src/scripts/*` (one-off maintenance CLIs). Also serves the built SPA from `./public` in production. |
| `@rawkoon/web` | `apps/web` | React 19 + Vite 8 + Tailwind 4 SPA. TanStack Router (file-based, `src/pages/**`) + TanStack Query, Radix primitives, i18next (`src/locales/{en,fr}`), service worker in `src/sw`. |
| `@rawkoon/shared` | `apps/shared` | Types and pure utils imported by both sides (`@rawkoon/shared/types`, `/utils`, `/constants`). Source-only — no build step, consumed as TS. |

## Commands

```bash
bun install                  # root only — workspaces handle the rest
bun run dev:services         # docker compose up db redis -d  (Postgres 17 :5433, Redis :6380)
bun run dev:api              # bun --watch, loads root .env, :3000
bun run dev:web              # Vite dev server :5173

bun run test                 # web (vitest) + api (bun test) + shared, in that order
bun run typecheck            # tsc --noEmit (TS 7) in every workspace — the sole typechecker
bun run lint                 # biome lint apps/web apps/api
bun run format               # biome format --write apps/web apps/api  (shared uses prettier)
bun run knip                 # dead code / unused deps
bun run build                # production web build (vite build + tsc project check)
```

`make help` lists Makefile equivalents (`make dev-services`, `make dev-api`, `make lint`, …); they wrap the same scripts with an explicit `-p rawkoon-dev` compose project.

## Database

Postgres 17 via Prisma 7 (`@prisma/adapter-pg`), Redis 7 for cache + BullMQ. Both come from `docker-compose.yml`, which contains **only** `db` and `redis` — the API and web run on the host in dev.

```bash
bun run db:migrate:dev       # dev: create + apply a migration, then generate
bun run db:migrate:deploy    # prod/CI: prisma migrate deploy (no schema drift prompts)
bun run db:migrate:push      # dev throwaway only — bypasses the migration history
bun run db:generate          # regenerate the client after editing schema.prisma
bun run db:studio
```

Every `db:*` script sources the **root** `.env` before invoking prisma (`set -a && . ../../.env`), so a missing root `.env` is the usual cause of "DATABASE_URL not found". In production the container's `entrypoint.sh` waits for the DB, runs `prisma generate`, then `prisma migrate deploy` on every start — and has a baseline fallback that resolves `0_init` if it detects a pre-existing schema. Never run `db:migrate:dev` or `db:push` against production.

## Conventions and gotchas

- **Route composition, not a router file.** Each `src/routes/<domain>/index.ts` exports an Elysia instance with its own `prefix: "/api/<domain>"` and `.use()`s sub-routers (see `routes/library/index.ts` — list/meta/grab/files/job split). `src/index.ts` only `.use()`s the domain routers; order matters, because rate-limit and auth plugins are `.use()`d between them.
- **Auth is better-auth + Prisma adapter.** `src/lib/auth.ts` owns the instance; `/api/auth/*` is delegated wholesale to its handler. Route protection comes from `src/middleware/auth.ts`: `requireUser` / `requireAdmin` resolve the session then re-fetch the Prisma `User`, 401/403 in `onBeforeHandle`. Passkeys and API keys are better-auth plugins. `user.is_admin` (snake_case, via `mapUser`) is the admin gate.
- **Errors are helpers, not exceptions.** `src/errors.ts` exports `badRequest`/`unauthorized`/`notFound`/… which set `set.status` and return `{ error }`. Return them; don't throw. The global `onError` in `index.ts` maps `NOT_FOUND`/`VALIDATION` and swallows everything else into a 500 with `{ error: "Internal server error" }` — so never rely on an error message reaching the client.
- **Workers run in-process.** `initWorkers()` + `setupScheduledJobs()` are called from `src/index.ts`; there is no separate worker container. Queues and job names are centralized in `services/queueService.ts` (`QUEUE_NAMES`, `SCHEDULED_JOB_NAMES`) and handlers live in `src/workers/`. Adding a scheduled job means touching both. Default job options: 3 attempts, exponential backoff.
- **Env is validated once by Zod.** `src/config.ts` (`loadConfig()`) is the only legitimate reader of process env for app settings. `SECRET_KEY`/`BETTER_AUTH_SECRET` must be ≥32 chars and must not be the `.env.example` placeholder — the server refuses to boot otherwise. `DATABASE_URL` is optional only under `NODE_ENV=test`.
- **`APP_VERSION` is a build arg, not a file read.** `services/versionService.ts` reads `process.env.APP_VERSION` (baked by CI from the git tag) and falls back to `0.0.0-dev+<boot ts>` so each restart busts the service-worker cache. Only non-`0.0.0-dev` versions trigger "App updated" notifications.
- **The generated route tree is gitignored.** `apps/web/src/routeTree.gen.ts` is produced by the TanStack router plugin; CI runs `bunx @tanstack/router-cli generate` before lint/typecheck/test. If typecheck fails on missing routes in a fresh clone, run `bun run dev:web` once or generate it manually.
- **TS config is strict and unforgiving** — `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` are on. Typechecking is `tsc --noEmit` (TypeScript 7); the `tsgo` native-preview binary was folded into `tsc` at GA, so one typechecker, one CI gate.
- **Biome covers `apps/web` and `apps/api` only**; `apps/shared` formats with prettier (`cd apps/shared && bun run formatCheck`) and CI checks it separately.
- **Shared types are the contract.** API responses are typed from `@rawkoon/shared/types`; change the type there, not in one side only. Web query keys are centralized in `apps/web/src/lib/queryKeys.ts`.
- **Tests are colocated** (`*.test.ts` next to the code) plus `apps/api/test/`. API tests mock `@rawkoon/api/db`; a real `DATABASE_URL` in the env switches some suites to integration mode.
- **Path aliases:** API code imports itself as `@rawkoon/api/<path>` (package `exports` maps `./*` → `./src/*.ts`), not by relative path. Follow that.

## Deployment

Releases are cut by tagging; the tag publishes `ghcr.io/samuelloranger/rawkoon` and triggers docs + screenshot jobs. See `.claude/skills/deploying-rawkoon/SKILL.md` for the full procedure, and `docs/deployment.md` for self-host, backup, and restore instructions.
