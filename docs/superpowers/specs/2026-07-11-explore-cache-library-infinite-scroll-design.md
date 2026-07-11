# Faster Explore and Library loading

## Goal

Make the two measured slow paths feel immediate without changing the product's
navigation model:

- `GET /api/medias/explore` has a 1.24 s production p95 because it waits for
  nine TMDB calls on every cache miss.
- `GET /api/library` has a 207 ms production p95 and returns about 950 KB,
  because it sends the full nested library (787 media items and 5,134 files).

PostgreSQL is not a target of this work: the app shell is about 7 ms through
Caddy and the database showed neither waits nor ungranted locks.

## Scope

### Explore

Cache the TMDB-derived Explore sections in Redis for 15 minutes, keyed by
language and region. The cached value is the external TMDB data, not the final
library-aware response. On every request, Rawkoon still reads the current
library-ID map and enriches the cached TMDB data, so adding a title is reflected
immediately.

On a cache miss, retain today's parallel TMDB requests and existing error
handling. The existing one-hour recommendation cache remains unchanged.

### Library

Keep the existing TanStack Virtual grid and list. Add page loading to it rather
than adding controls or a second virtualizer:

1. The Library page uses TanStack Query's existing `useInfiniteQuery` to fetch
   60 rows at a time.
2. TanStack Virtual requests the next page when its rendered range reaches the
   last loaded rows. A small inline loading state is rendered at the tail.
3. Changing a filter or sort creates a new infinite-query key and starts at the
   first page. Loaded rows remain visible if a later page fails; retrying the
   tail continues pagination.
4. The existing `useLibrary` hook and its full-list behaviour stay available to
   its non-Library-page callers. Only the Library page adopts the paged API.

The paged API accepts `page`, `limit`, `sort_by`, and `sort_dir`, returns
`has_more`, and applies every current sort on the server. It uses a stable `id`
tie-breaker. Simple fields use Prisma ordering; `file_size` and
`last_grabbed_at` use an aggregate ordering query over media files and download
history, then fetch full mapped records only for that page. This preserves the
meaning of every existing sort across unloaded pages instead of sorting only
the rows already in the browser.

## Data flow

```text
Explore request
  Redis TMDB-section hit -> fresh library membership map -> response
  Redis miss             -> parallel TMDB fetches -> cache -> fresh map -> response

Library scroll
  TanStack Virtual nears loaded tail -> useInfiniteQuery(page + 1)
  API ordered page IDs -> Prisma full includes for 60 IDs -> mapped rows
  append page -> Virtual grid/list expands its measured range
```

## Error handling

- Redis remains best-effort, matching the existing cache service: a cache
  failure is a cache miss, never a failed Explore page.
- TMDB failures keep the route's current error response on a cold miss.
- A failed later Library page does not clear already rendered items. It exposes
  a retryable tail state and must not issue concurrent duplicate page requests.

## Tests and acceptance criteria

1. Explore cache tests prove a second request with the same language and region
   makes no additional base TMDB requests while current library membership is
   still applied.
2. Library route tests prove each paged result is ordered, contains no duplicate
   IDs across adjacent pages, reports `has_more` accurately, and preserves all
   current sort options.
3. Library page tests prove reaching the virtualized tail fetches exactly one
   next page and changing a filter or sort restarts from page one.
4. Production verification samples Caddy access logs before and after rollout:
   a warm Explore request should avoid the present ~1.24 s path, and initial
   Library responses should be one 60-item page rather than ~950 KB.

## Non-goals

- No PostgreSQL-to-SQLite migration.
- No numbered pagination, new scroll library, or new dependency.
- No caching of a final Explore response that could make library membership
  stale.
