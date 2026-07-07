# Patterns

Concrete recurring code patterns in Rawkoon with short snippets. Use these as templates when adding new features.

Last verified: 2026-06-15

## Elysia Route Plugin Shape

Every feature area exports an Elysia plugin from `apps/api/src/routes/<area>/index.ts` and is composed in `apps/api/src/index.ts` via `.use()`. Plugins set their `prefix` so route paths stay localized.

```typescript
// apps/api/src/routes/releases/index.ts
import { Elysia } from "elysia";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { serverError } from "@rawkoon/api/errors";
import { getCachedGitHubReleases } from "@rawkoon/api/services/githubReleases";

export const releasesRoutes = new Elysia({ prefix: "/api/releases" })
  .use(requireAdmin) // returns 401/403 unless the caller is an admin
  .get("/", async ({ set }) => {
    try {
      return await getCachedGitHubReleases();
    } catch {
      return serverError(set, "Failed to load GitHub releases");
    }
  });
```

Use `requireUser` (instead of `requireAdmin`) for routes any signed-in user may call, and `auth` alone when a handler wants the optional `{ user }` in context without enforcing a session — all from `apps/api/src/middleware/auth.ts`.

Sub-plugins for large feature areas keep `index.ts` thin and let each domain own its own file (see `apps/api/src/routes/library/index.ts` — list, meta, grab, files, jobs).

## Route Handler + snake_case Mapping

Handlers query Prisma directly, catch errors, map camelCase → snake_case before returning.

```typescript
.get("/", async ({ set }) => {
  try {
    const items = await prisma.libraryMedia.findMany({
      orderBy: { addedAt: "desc" },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        tmdb_id: item.tmdbId,
        title: item.title,
        poster_url: item.posterUrl,
        added_at: item.addedAt.toISOString(),
      })),
    };
  } catch {
    return serverError(set, "Failed to fetch library");
  }
});
```

Mapper functions for non-trivial entities live in a domain utility such as `apps/api/src/utils/medias/mappers.ts`, or alongside the route when they're route-local. Shared mappers like `mapUser()` live in `apps/api/src/utils/mappers.ts`.

## TanStack Query Hook (Read)

Web hooks live next to their feature (`apps/web/src/pages/<area>/use*.ts` or `apps/web/src/features/<area>/`). They always pull the query key from the factory and the URL from the local endpoints map.

```typescript
// apps/web/src/features/medias/hooks/useLibrary.ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryListResponse } from "@rawkoon/shared/types";

export function useLibrary(filters?: { type?: string; status?: string }) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.list(filters),
    queryFn: () => fetcher<LibraryListResponse>(LIBRARY_ENDPOINTS.LIST),
    placeholderData: keepPreviousData,
  });
}
```

For mutations, invalidate the matching root after success: `queryClient.invalidateQueries({ queryKey: queryKeys.library.all })`. If a mutation affects a dashboard tile, invalidate the relevant `queryKeys.dashboard.*` key too.

## Feature Folder Layout (Web)

Two valid placements depending on domain size:

- Large domains with a separate data layer: `apps/web/src/features/<name>/hooks/` plus page UI under `apps/web/src/pages/<name>/` (`medias` is the reference shape).
- Route-owned domains: `apps/web/src/pages/<name>/index.tsx` with `_component/`, optional `_hooks/`, and colocated `use*.ts` files.

Don't create a `features/` split for a small page unless it removes real complexity. See `.claude/rules/feature-structure.md`.

Modal pattern: search params drive modal state (for example a media detail ID). The route's `validateSearch` narrows the params and the page component renders the corresponding modal.

## SSE Stream (Server)

Use the helper rather than hand-rolling a stream — it gives you JSON dedup, abort handling, and a 15s heartbeat for free.

```typescript
return createJsonSseResponse({
  request,
  intervalMs: 2000,
  poll: async () => fetchTorrentSpeed(),
  onError: (err) => ({ speed_bytes: 0, error: String(err) }),
  logLabel: "downloads-speed",
});
```

Defined in `apps/api/src/utils/sse.ts`. Consumed in the web app via `apps/web/src/lib/realtime/useEventSource.ts`.

## Background Job (Cron)

Repeatable jobs are registered once at startup in `apps/api/src/services/queueService.ts:setupScheduledJobs()`. The processor file lives under `apps/api/src/workers/` and is wired into `apps/api/src/services/jobs/scheduledTasksWorker.ts`.

To add a new cron job:

1. Add a constant to `SCHEDULED_JOB_NAMES` in `queueService.ts`.
2. Add it to the `jobs` array with a cron pattern.
3. Implement the processor in `apps/api/src/workers/<name>.ts` (export a function).
4. Map the job name → processor in `scheduledTasksWorker.ts`.

## Webhook Handler

Inbound webhooks live in `apps/api/src/routes/webhooks/index.ts`. The only inbound webhooks are qBittorrent's dedicated endpoints under `/api/webhooks/qbittorrent/*`, auto-configured into qBittorrent's "Run external program on torrent finished" hook with a shared bearer secret. There is no generic `:serviceName` dispatcher or per-service handler registry.
