# Conventions

Cross-references the canonical rule files in `.claude/rules/` (also mirrored as `.cursor/rules/*.mdc`). This file only adds practical notes not already captured there.

Last verified: 2026-06-15

## Canonical Rule Files

Read these first — do not duplicate them here:

- [`.claude/rules/imports.md`](../.claude/rules/imports.md) — `@/` for web, `@rawkoon/api/*` for api, `@rawkoon/shared` for cross-app
- [`.claude/rules/naming-conventions.md`](../.claude/rules/naming-conventions.md) — PascalCase / camelCase / snake_case / kebab-case rules
- [`.claude/rules/feature-structure.md`](../.claude/rules/feature-structure.md) — frontend feature folder layout and API route plugin shape
- [`.claude/rules/dry-and-shared-code.md`](../.claude/rules/dry-and-shared-code.md) — what belongs in `apps/shared`
- [`.claude/rules/tanstack-query.md`](../.claude/rules/tanstack-query.md) — query hook placement and query-key factory

`CLAUDE.md` and `AGENTS.md` at the repo root summarize the same rules; prefer the rule files when there's any drift.

## API Response Mapping (snake_case)

**Always** map Prisma camelCase columns to snake_case in API responses. This is enforced by convention, not by a layer — every route does it manually.

```typescript
const response = {
  id: media.id,
  tmdb_id: media.tmdbId,
  title: media.title,
  poster_url: media.posterUrl,
  added_at: media.addedAt.toISOString(),
};
```

Mapper helpers live in a domain utility or next to the route module they serve. Shared user mapping lives in `apps/api/src/utils/mappers.ts`; larger areas such as library and dashboard keep mapping logic under `src/utils/medias/`, `src/services/library/`, or their route folder.

Why: snake_case keeps response keys aligned with the URL convention (`/api/added-by` style) and gives any non-JS client a clean, language-agnostic shape. camelCase Prisma is just an ORM artifact.

## Query Keys Live in `apps/web`, Not `apps/shared`

`AGENTS.md` overrides what early documentation may say: the query-key factory and TanStack Query hooks live under `apps/web/src/`, not under `@rawkoon/shared`. Import from `@/lib/queryKeys`:

```typescript
import { queryKeys } from "@/lib/queryKeys";
queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
```

Why kept web-only: TanStack Query has no consumer in `apps/api`. Promoting hooks to shared would force the API to ship React as a transitive dep for no gain.

## Endpoint Constants Are Web-Local

`LIBRARY_ENDPOINTS`, `NOTIFICATIONS_ENDPOINTS`, etc. live under `apps/web/src/lib/endpoints/`. They are not shared, because the API doesn't reverse-construct its own URLs.

## Error Helpers, Not Thrown Exceptions

Route handlers wrap business logic in `try/catch` and return error helpers from `apps/api/src/errors.ts`: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `serverError`, `badGateway`, `serviceUnavailable`. Each sets `set.status` and returns `{ error: string }`.

```typescript
.get("/", async ({ user, set }) => {
  try {
    /* ... */
  } catch {
    return serverError(set, "Failed to fetch items");
  }
})
```

Why: Elysia's `onError` only catches uncaught throws; explicit returns keep the response shape predictable for the client.

## URL Conventions

Route paths are kebab-case (`/api/quality-profiles`, `/api/library/downloads`). Verbs come from HTTP methods, not from URL segments. Avoid `/api/getLibrary` — use `GET /api/library`.

## Changelog

- 2026-05-25 — Initial bootstrap pass.
- 2026-06-15 — Refreshed code examples to the current media library APIs.
