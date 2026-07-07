# Contributing to Rawkoon

Thanks for your interest in contributing! This guide covers the essentials for getting started.

## Development Setup

**Requirements:** [Bun](https://bun.sh) v1.3+, [Docker](https://docs.docker.com/get-docker/)

```bash
git clone https://github.com/samuelloranger/rawkoon.git
cd rawkoon
cp .env.example .env
# Edit .env: set ALLOWED_EMAILS, ADMIN_EMAILS, SECRET_KEY
```

Start the dev environment in three terminals:

```bash
make install          # Root workspaces + husky (`bun install` at repo root)
make dev-services     # Terminal 1: PostgreSQL + Redis (docker-compose.yml)
make dev-api          # Terminal 2: API with hot reload
make dev-web          # Terminal 3: Frontend with Vite
```

Run `make migrate-dev` after changing the Prisma schema.

## Project Structure

```
apps/
  api/       Elysia API server (Bun) + Prisma ORM
  web/       React 19 SPA (TanStack Router + Query, Tailwind CSS 4)
  shared/    Types, utilities, constants shared across apps
```

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run checks before pushing:
   ```bash
   make typecheck    # All workspaces exposing `typecheck`
   make lint         # ESLint on web + API (matches CI)
   make test         # Root test runner
   ```
4. Open a pull request against `main`

CI runs typecheck, lint, format check, and tests on every push and PR.

## Conventions

### Naming

| Context             | Convention                  | Example               |
| ------------------- | --------------------------- | --------------------- |
| React components    | PascalCase                  | `MediaPosterCard.tsx` |
| Hooks               | camelCase with `use` prefix | `useLibrary.ts`       |
| API route plugins   | camelCase + `Routes`        | `libraryRoutes`       |
| API response fields | snake_case                  | `created_at`          |
| URL paths           | kebab-case                  | `/api/library`        |
| Endpoint constants  | UPPER_SNAKE_CASE            | Inline or colocated   |

### Imports

- **Web:** `@/` alias (avoid `../../`)
- **API:** `@rawkoon/api/*` (`apps/api/tsconfig.json`)
- **Cross-app:** `@rawkoon/shared` / `@rawkoon/shared/types` — never deep-import `src/`

### Shared Code

Types, pure utilities, and constants used by **both** `api` and `web` go in `apps/shared/src/` and are exported via the package boundary. SPA-only TanStack hooks and `queryKeys` stay in `apps/web`.

### Frontend Features

Each feature is typically under `apps/web/src/features/<name>/` or routed pages under `routes/`. Shared UI primitives: `apps/web/src/components/ui/`.

### TanStack Query

- Hooks next to pages/features/domains (`apps/web/src/features/`, `pages/`, `hooks/<domain>/`)
- Keys in `apps/web/src/lib/queryKeys.ts`

### API Routes

```typescript
export const featureRoutes = new Elysia({ prefix: "/api/feature" })
  .use(auth)
  .use(requireUser);
```

## Adding a New Integration

1. **API:** Plugin under `apps/api/src/routes/integrations/<name>/`
2. **API:** Normalizers/helpers in `apps/api/src/utils/integrations/` (often `normalizers.ts`)
3. **Shared:** Types grouped in `apps/shared/src/types/` (e.g. `integrations.ts`); export via `types/index.ts`
4. **Web:** Settings UI under `apps/web/src/pages/settings/_component/integrations/`
5. **Web:** Strings in `apps/web/src/locales/{en,fr}/common.json`

## Database Changes

Edit `apps/api/prisma/schema.prisma`, then:

```bash
make migrate-dev     # Creates a migration file
# Review the generated SQL in prisma/migrations/
```

## Reporting Issues

Use [GitHub Issues](https://github.com/samuelloranger/rawkoon/issues). Include:

- Steps to reproduce
- Expected vs actual behavior
- Docker or local dev setup
- Browser/OS if frontend-related
