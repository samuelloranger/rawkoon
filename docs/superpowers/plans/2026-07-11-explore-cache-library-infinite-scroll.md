# Faster Explore and Library Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the two measured slow paths — cache Explore's nine TMDB calls in Redis (15 min) and convert the Library page from one ~950 KB full-list fetch to 60-row server-paginated infinite scroll — without changing product behavior.

**Architecture:** Two independent subsystems, each independently shippable and committable:
- **Part A (API only):** Wrap the Explore route's base TMDB section fetch in a Redis get-or-fetch of the *raw* section data. Library membership is still recomputed fresh on every request, so adds/removes appear immediately.
- **Part B (API + web):** Add server-side sort + pagination to `GET /api/library` (`page`, `limit`, `sort_by`, `sort_dir`, returns `has_more`), then switch only the Library page to a TanStack `useInfiniteQuery` that the existing TanStack Virtual grid pages through. The existing `useLibrary` full-list hook stays for its other callers.

Parts A and B share no code. Execute A fully (through commit) before starting B, or ship either alone.

**Tech Stack:** Elysia + Prisma + Bun (API), React + TanStack Query + TanStack Virtual + Vite (web), Redis via `bun`'s `RedisClient`. Tests: `bun test` (API), `vitest` (web). Both pure-function unit tests — the repo convention is to extract logic into pure functions and test those, never DB/HTTP integration in unit tests.

## Global Constraints

- Redis is best-effort: a cache failure is a cache miss, never a failed request. Reuse `getJsonCache`/`setJsonCache` from `apps/api/src/services/cache.ts` — they already swallow errors and no-op when Redis is unavailable.
- No new dependencies. No numbered pagination, no new scroll/virtualizer library, no PostgreSQL→SQLite migration.
- The cached Explore value is the **raw TMDB section data**, never the final library-aware response — caching an enriched response would make library membership stale.
- Library page size is exactly **60** rows per page.
- Sort must be applied **on the server** so it is correct across pages not yet loaded. Every sort uses a stable `id` tie-break.
- Preserve all seven existing sort options verbatim: `added_at`, `last_grabbed_at`, `title`, `year`, `status`, `digital_release_date`, `file_size` (from `apps/web/src/utils/libraryUtils.ts:21`).
- Formatter is Biome for `apps/web` and `apps/api`. Run `biome format --write` on touched files before committing (CI `formatCheck` fails otherwise).
- Do not commit `apps/web/scripts/bench-library-prod.mjs` (untracked baseline benchmark; credentials are env-only).

## File Structure

**Part A — Explore cache (API)**
- Modify: `apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.ts` — add `exploreBaseCacheKey`, `EXPLORE_BASE_CACHE_TTL`, `ExploreBaseSections` type, and the pure `getExploreBaseSections` get-or-fetch orchestrator.
- Create: `apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.test.ts` — unit tests for the orchestrator with injected fake cache/fetch.
- Modify: `apps/api/src/routes/medias/tmdb/tmdbExploreRoutes.ts` — wrap the nine-call `Promise.all` in `getExploreBaseSections`; enrich the (possibly cached) raw sections with a freshly loaded library map.

**Part B — Library pagination (API + web)**
- Create: `apps/api/src/routes/library/libraryListQuery.ts` — pure sort/pagination helpers: `parseLibrarySort`, `isAggregateSort`, `buildSimpleOrderBy`, `slicePage`, `orderAggregateIds`, `reorderByIds`.
- Create: `apps/api/src/routes/library/libraryListQuery.test.ts` — unit tests for those helpers.
- Modify: `apps/api/src/routes/library/libraryListRoutes.ts` — extend `GET /` query schema and branch into simple-sort vs aggregate-sort paged paths; keep the unpaged full-list path.
- Modify: `apps/shared/src/types/library.ts` — add `has_more: boolean` to `LibraryListResponse`.
- Create: `apps/web/src/features/medias/hooks/useInfiniteLibrary.ts` — `useInfiniteQuery` hook, 60/page.
- Modify: `apps/web/src/lib/queryKeys.ts` — add `queryKeys.library.infinite(filters)`.
- Modify: `apps/web/src/pages/medias/_component/LibraryGrid.tsx` — accept `hasNextPage`/`isFetchingNextPage`/`onLoadMore`; trigger load near the virtualized tail; render a tail loading state.
- Modify: `apps/web/src/pages/medias/_component/LibraryPage.tsx` — use `useInfiniteLibrary`, flatten pages, drop client-side `sortItems`, wire load-more.
- Modify: `apps/web/src/lib/routing/prefetch.ts` — prefetch the first infinite page instead of the full list.

---

## Part A — Explore base-section Redis cache

### Task A1: Pure `getExploreBaseSections` get-or-fetch orchestrator

**Files:**
- Modify: `apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.ts`
- Test: `apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.test.ts`

**Interfaces:**
- Produces:
  - `EXPLORE_BASE_CACHE_TTL: number` (= `15 * 60`)
  - `exploreBaseCacheKey(language: string, region: string): string`
  - `interface ExploreBaseSections` with nine `unknown[]` fields: `trending`, `popular_movies`, `popular_shows`, `upcoming_movies`, `now_playing`, `airing_today`, `on_the_air`, `top_rated_movies`, `top_rated_shows`
  - `getExploreBaseSections(opts: { cacheKey: string; ttlSeconds: number; skipCache: boolean; getCache: <T>(key: string) => Promise<T | null>; setCache: <T>(key: string, value: T, ttl: number) => Promise<void>; fetchSections: () => Promise<ExploreBaseSections> }): Promise<{ sections: ExploreBaseSections; cacheHit: boolean }>`
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  exploreBaseCacheKey,
  getExploreBaseSections,
  type ExploreBaseSections,
} from "./tmdbRouteHelpers";

const emptySections = (): ExploreBaseSections => ({
  trending: [],
  popular_movies: [],
  popular_shows: [],
  upcoming_movies: [],
  now_playing: [],
  airing_today: [],
  on_the_air: [],
  top_rated_movies: [],
  top_rated_shows: [],
});

describe("exploreBaseCacheKey", () => {
  it("keys by language and region", () => {
    expect(exploreBaseCacheKey("en-US", "US")).toBe(
      "medias:explore:base:en-US:US",
    );
    expect(exploreBaseCacheKey("fr-CA", "CA")).toBe(
      "medias:explore:base:fr-CA:CA",
    );
  });
});

describe("getExploreBaseSections", () => {
  it("returns cached sections without fetching on a hit", async () => {
    const cached = { ...emptySections(), trending: [{ id: 1 }] };
    let fetched = false;
    let setCalled = false;
    const res = await getExploreBaseSections({
      cacheKey: "k",
      ttlSeconds: 900,
      skipCache: false,
      getCache: async () => cached as unknown as never,
      setCache: async () => {
        setCalled = true;
      },
      fetchSections: async () => {
        fetched = true;
        return emptySections();
      },
    });
    expect(res.cacheHit).toBe(true);
    expect(res.sections.trending).toEqual([{ id: 1 }]);
    expect(fetched).toBe(false);
    expect(setCalled).toBe(false);
  });

  it("fetches and caches on a miss", async () => {
    let fetched = false;
    let setValue: unknown = null;
    const res = await getExploreBaseSections({
      cacheKey: "k",
      ttlSeconds: 900,
      skipCache: false,
      getCache: async () => null,
      setCache: async (_k, v) => {
        setValue = v;
      },
      fetchSections: async () => {
        fetched = true;
        return { ...emptySections(), popular_movies: [{ id: 9 }] };
      },
    });
    expect(res.cacheHit).toBe(false);
    expect(fetched).toBe(true);
    expect((setValue as ExploreBaseSections).popular_movies).toEqual([{ id: 9 }]);
  });

  it("skips the cache read when skipCache is true", async () => {
    let getCalled = false;
    let fetched = false;
    const res = await getExploreBaseSections({
      cacheKey: "k",
      ttlSeconds: 900,
      skipCache: true,
      getCache: async () => {
        getCalled = true;
        return emptySections() as unknown as never;
      },
      setCache: async () => {},
      fetchSections: async () => {
        fetched = true;
        return emptySections();
      },
    });
    expect(getCalled).toBe(false);
    expect(fetched).toBe(true);
    expect(res.cacheHit).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/routes/medias/tmdb/tmdbRouteHelpers.test.ts`
Expected: FAIL — `exploreBaseCacheKey`/`getExploreBaseSections` are not exported.

- [ ] **Step 3: Add the implementation**

Append to `apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.ts`:

```typescript
export const EXPLORE_BASE_CACHE_TTL = 15 * 60;

export function exploreBaseCacheKey(language: string, region: string): string {
  return `medias:explore:base:${language}:${region}`;
}

export interface ExploreBaseSections {
  trending: unknown[];
  popular_movies: unknown[];
  popular_shows: unknown[];
  upcoming_movies: unknown[];
  now_playing: unknown[];
  airing_today: unknown[];
  on_the_air: unknown[];
  top_rated_movies: unknown[];
  top_rated_shows: unknown[];
}

/**
 * Redis get-or-fetch for the raw TMDB Explore sections. The cached value is the
 * external TMDB data only — never the enriched response — so callers must apply
 * the current library membership map after this returns.
 */
export async function getExploreBaseSections(opts: {
  cacheKey: string;
  ttlSeconds: number;
  skipCache: boolean;
  getCache: <T>(key: string) => Promise<T | null>;
  setCache: <T>(key: string, value: T, ttl: number) => Promise<void>;
  fetchSections: () => Promise<ExploreBaseSections>;
}): Promise<{ sections: ExploreBaseSections; cacheHit: boolean }> {
  if (!opts.skipCache) {
    const cached = await opts.getCache<ExploreBaseSections>(opts.cacheKey);
    if (cached) return { sections: cached, cacheHit: true };
  }
  const sections = await opts.fetchSections();
  await opts.setCache(opts.cacheKey, sections, opts.ttlSeconds);
  return { sections, cacheHit: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/routes/medias/tmdb/tmdbRouteHelpers.test.ts`
Expected: PASS (7 assertions across 4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.ts apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.test.ts
git add apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.ts apps/api/src/routes/medias/tmdb/tmdbRouteHelpers.test.ts
git commit -m "feat(api): add cached Explore base-section orchestrator"
```

### Task A2: Wire the Explore route through the cache

**Files:**
- Modify: `apps/api/src/routes/medias/tmdb/tmdbExploreRoutes.ts:22-133` (the `GET /explore` handler)

**Interfaces:**
- Consumes: `exploreBaseCacheKey`, `EXPLORE_BASE_CACHE_TTL`, `ExploreBaseSections`, `getExploreBaseSections` from Task A1; existing `getJsonCache`/`setJsonCache` from `@rawkoon/api/services/cache`.
- Produces: unchanged response shape (nine enriched section arrays + `recommended`).

- [ ] **Step 1: Extend the import from `./tmdbRouteHelpers`**

In `apps/api/src/routes/medias/tmdb/tmdbExploreRoutes.ts`, add these names to the existing import block (lines 10-20):

```typescript
import {
  enrichSearchItems,
  EXPLORE_CATEGORY_PATHS,
  exploreBaseCacheKey,
  EXPLORE_BASE_CACHE_TTL,
  fetchTmdbResults,
  getExploreBaseSections,
  injectMediaType,
  libraryIdMapForTmdbIds,
  loadAllLibraryTmdbIds,
  loadEnabledTmdbConfig,
  resolveLanguage,
  shuffle,
} from "./tmdbRouteHelpers";
```

Add to the top-level `cache` import (line 3):

```typescript
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
```

(already present — no change needed; listed here so the engineer confirms it.)

- [ ] **Step 2: Replace the nine-call `Promise.all` (lines 39-64) with a cached fetch**

Replace the destructured `const [ trending, ... ] = await Promise.all([...])` block with:

```typescript
      const cacheKey = exploreBaseCacheKey(language, region);
      const { sections } = await getExploreBaseSections({
        cacheKey,
        ttlSeconds: EXPLORE_BASE_CACHE_TTL,
        skipCache,
        getCache: getJsonCache,
        setCache: setJsonCache,
        fetchSections: async () => {
          const [
            trending,
            popularMovies,
            popularShows,
            upcomingMovies,
            nowPlaying,
            airingToday,
            onTheAir,
            topRatedMovies,
            topRatedShows,
          ] = await Promise.all([
            fetchTmdb("trending/all/day"),
            fetchTmdb("movie/popular").then(injectMediaType("movie")),
            fetchTmdb("tv/popular").then(injectMediaType("tv")),
            fetchTmdb("movie/upcoming").then(injectMediaType("movie")),
            fetchTmdb("movie/now_playing").then(injectMediaType("movie")),
            fetchTmdb("tv/airing_today").then(injectMediaType("tv")),
            fetchTmdb("tv/on_the_air").then(injectMediaType("tv")),
            fetchTmdb("movie/top_rated").then(injectMediaType("movie")),
            fetchTmdb("discover/tv", {
              sort_by: "vote_average.desc",
              with_origin_country: region,
              "vote_count.gte": "200",
              without_genres: "16",
            }).then(injectMediaType("tv")),
          ]);
          return {
            trending,
            popular_movies: popularMovies,
            popular_shows: popularShows,
            upcoming_movies: upcomingMovies,
            now_playing: nowPlaying,
            airing_today: airingToday,
            on_the_air: onTheAir,
            top_rated_movies: topRatedMovies,
            top_rated_shows: topRatedShows,
          };
        },
      });
```

- [ ] **Step 3: Enrich the (possibly cached) sections with a fresh library map**

The block at lines 66-70 that loads `loadAllLibraryTmdbIds()` and defines `normalize` stays exactly as-is (it always runs, keeping membership fresh). Change only the final `return` (lines 117-128) to read from `sections` instead of the old local variables:

```typescript
      return {
        trending: normalize(sections.trending),
        popular_movies: normalize(sections.popular_movies),
        popular_shows: normalize(sections.popular_shows),
        upcoming_movies: normalize(sections.upcoming_movies),
        now_playing: normalize(sections.now_playing),
        airing_today: normalize(sections.airing_today),
        on_the_air: normalize(sections.on_the_air),
        top_rated_movies: normalize(sections.top_rated_movies),
        top_rated_shows: normalize(sections.top_rated_shows),
        recommended,
      };
```

The recommendations block (lines 72-115) is unchanged — it keeps its own 1-hour cache.

- [ ] **Step 4: Typecheck and verify existing tests still pass**

Run: `cd apps/api && bun run typecheck && bun test src/routes/medias/`
Expected: typecheck clean; existing medias tests PASS.

- [ ] **Step 5: Manually verify cache behavior against a running API**

Run (with the dev stack up and TMDB configured):
```bash
# First call populates the cache; second must not re-hit TMDB.
curl -s -H "Cookie: <session>" "http://127.0.0.1:3000/api/medias/explore?lang=en-US" -o /dev/null -w "cold: %{time_total}s\n"
curl -s -H "Cookie: <session>" "http://127.0.0.1:3000/api/medias/explore?lang=en-US" -o /dev/null -w "warm: %{time_total}s\n"
```
Expected: `warm` markedly faster than `cold`. Confirm the Redis key exists: `redis-cli KEYS 'medias:explore:base:*'`.

(If no dev stack is available, note it in the task record and rely on the Step 4 tests + the production log check in Task B7.)

- [ ] **Step 6: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/api/src/routes/medias/tmdb/tmdbExploreRoutes.ts
git add apps/api/src/routes/medias/tmdb/tmdbExploreRoutes.ts
git commit -m "perf(api): cache Explore base TMDB sections for 15 min"
```

---

## Part B — Library server pagination + infinite scroll

### Task B1: Pure sort/pagination helpers

**Files:**
- Create: `apps/api/src/routes/library/libraryListQuery.ts`
- Test: `apps/api/src/routes/library/libraryListQuery.test.ts`

**Interfaces:**
- Produces:
  - `type LibrarySortBy = "added_at" | "last_grabbed_at" | "title" | "year" | "status" | "digital_release_date" | "file_size"`
  - `type LibrarySortDir = "asc" | "desc"`
  - `parseLibrarySort(sortBy?: string, sortDir?: string): { sortBy: LibrarySortBy; sortDir: LibrarySortDir }` — defaults to `added_at`/`desc` on unknown input
  - `isAggregateSort(sortBy: LibrarySortBy): boolean` — true for `file_size` and `last_grabbed_at`
  - `buildSimpleOrderBy(sortBy: LibrarySortBy, sortDir: LibrarySortDir): Prisma.LibraryMediaOrderByWithRelationInput[]` — simple columns only, with `id` tie-break; throws on aggregate sort keys
  - `slicePage<T>(rows: T[], limit: number): { items: T[]; has_more: boolean }` — expects `rows` fetched as `limit + 1`
  - `interface AggregateSortRow { id: number; fileSizeTotal: bigint | null; lastGrabbedAt: number | null }`
  - `orderAggregateIds(rows: AggregateSortRow[], sortBy: LibrarySortBy, sortDir: LibrarySortDir): number[]`
  - `reorderByIds<T extends { id: number }>(records: T[], orderedIds: number[]): T[]`
- Consumes: `Prisma` from `@prisma/client`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/library/libraryListQuery.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  parseLibrarySort,
  isAggregateSort,
  buildSimpleOrderBy,
  slicePage,
  orderAggregateIds,
  reorderByIds,
  type AggregateSortRow,
} from "./libraryListQuery";

describe("parseLibrarySort", () => {
  it("passes through valid values", () => {
    expect(parseLibrarySort("title", "asc")).toEqual({
      sortBy: "title",
      sortDir: "asc",
    });
  });
  it("defaults unknown sortBy to added_at and unknown dir to desc", () => {
    expect(parseLibrarySort("bogus", "sideways")).toEqual({
      sortBy: "added_at",
      sortDir: "desc",
    });
  });
  it("defaults missing values", () => {
    expect(parseLibrarySort(undefined, undefined)).toEqual({
      sortBy: "added_at",
      sortDir: "desc",
    });
  });
});

describe("isAggregateSort", () => {
  it("is true for derived aggregates", () => {
    expect(isAggregateSort("file_size")).toBe(true);
    expect(isAggregateSort("last_grabbed_at")).toBe(true);
  });
  it("is false for simple columns", () => {
    expect(isAggregateSort("title")).toBe(false);
    expect(isAggregateSort("added_at")).toBe(false);
  });
});

describe("buildSimpleOrderBy", () => {
  it("maps title with an id tie-break", () => {
    expect(buildSimpleOrderBy("title", "asc")).toEqual([
      { title: "asc" },
      { id: "asc" },
    ]);
  });
  it("orders nullable columns nulls-last", () => {
    expect(buildSimpleOrderBy("year", "desc")).toEqual([
      { year: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(buildSimpleOrderBy("digital_release_date", "asc")).toEqual([
      { digitalReleaseDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]);
  });
  it("maps added_at to addedAt", () => {
    expect(buildSimpleOrderBy("added_at", "desc")).toEqual([
      { addedAt: "desc" },
      { id: "desc" },
    ]);
  });
  it("throws for aggregate sorts", () => {
    expect(() => buildSimpleOrderBy("file_size", "asc")).toThrow();
  });
});

describe("slicePage", () => {
  it("reports has_more and trims the sentinel row", () => {
    expect(slicePage([1, 2, 3], 2)).toEqual({ items: [1, 2], has_more: true });
  });
  it("reports no more when under the limit", () => {
    expect(slicePage([1, 2], 2)).toEqual({ items: [1, 2], has_more: false });
  });
});

describe("orderAggregateIds", () => {
  const rows: AggregateSortRow[] = [
    { id: 1, fileSizeTotal: 100n, lastGrabbedAt: 5 },
    { id: 2, fileSizeTotal: null, lastGrabbedAt: null },
    { id: 3, fileSizeTotal: 300n, lastGrabbedAt: 9 },
  ];
  it("sorts file_size desc, nulls last, id tie-break", () => {
    expect(orderAggregateIds(rows, "file_size", "desc")).toEqual([3, 1, 2]);
  });
  it("sorts file_size asc, nulls last", () => {
    expect(orderAggregateIds(rows, "file_size", "asc")).toEqual([1, 3, 2]);
  });
  it("sorts last_grabbed_at desc treating null as oldest", () => {
    expect(orderAggregateIds(rows, "last_grabbed_at", "desc")).toEqual([3, 1, 2]);
  });
  it("sorts last_grabbed_at asc treating null as oldest", () => {
    expect(orderAggregateIds(rows, "last_grabbed_at", "asc")).toEqual([2, 1, 3]);
  });
});

describe("reorderByIds", () => {
  it("orders records by the id list and drops missing", () => {
    const recs = [{ id: 3, v: "c" }, { id: 1, v: "a" }];
    expect(reorderByIds(recs, [1, 2, 3])).toEqual([
      { id: 1, v: "a" },
      { id: 3, v: "c" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/routes/library/libraryListQuery.test.ts`
Expected: FAIL — module `./libraryListQuery` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/routes/library/libraryListQuery.ts`:

```typescript
import { Prisma } from "@prisma/client";

export type LibrarySortBy =
  | "added_at"
  | "last_grabbed_at"
  | "title"
  | "year"
  | "status"
  | "digital_release_date"
  | "file_size";
export type LibrarySortDir = "asc" | "desc";

const VALID_SORT_BY = new Set<LibrarySortBy>([
  "added_at",
  "last_grabbed_at",
  "title",
  "year",
  "status",
  "digital_release_date",
  "file_size",
]);

const AGGREGATE_SORTS = new Set<LibrarySortBy>(["file_size", "last_grabbed_at"]);

export function isAggregateSort(sortBy: LibrarySortBy): boolean {
  return AGGREGATE_SORTS.has(sortBy);
}

export function parseLibrarySort(
  sortBy?: string,
  sortDir?: string,
): { sortBy: LibrarySortBy; sortDir: LibrarySortDir } {
  const by: LibrarySortBy = VALID_SORT_BY.has(sortBy as LibrarySortBy)
    ? (sortBy as LibrarySortBy)
    : "added_at";
  const dir: LibrarySortDir = sortDir === "asc" ? "asc" : "desc";
  return { sortBy: by, sortDir: dir };
}

// Non-null simple columns.
const PLAIN_COLUMN: Partial<Record<LibrarySortBy, string>> = {
  added_at: "addedAt",
  title: "title",
  status: "status",
};
// Nullable simple columns → ordered nulls-last (matches the client's
// null-last intent for these fields).
const NULLABLE_COLUMN: Partial<Record<LibrarySortBy, string>> = {
  year: "year",
  digital_release_date: "digitalReleaseDate",
};

export function buildSimpleOrderBy(
  sortBy: LibrarySortBy,
  sortDir: LibrarySortDir,
): Prisma.LibraryMediaOrderByWithRelationInput[] {
  const plain = PLAIN_COLUMN[sortBy];
  if (plain) {
    return [{ [plain]: sortDir }, { id: sortDir }];
  }
  const nullable = NULLABLE_COLUMN[sortBy];
  if (nullable) {
    return [{ [nullable]: { sort: sortDir, nulls: "last" } }, { id: sortDir }];
  }
  throw new Error(`buildSimpleOrderBy called with aggregate sort: ${sortBy}`);
}

export function slicePage<T>(
  rows: T[],
  limit: number,
): { items: T[]; has_more: boolean } {
  const has_more = rows.length > limit;
  return { items: has_more ? rows.slice(0, limit) : rows, has_more };
}

export interface AggregateSortRow {
  id: number;
  fileSizeTotal: bigint | null;
  lastGrabbedAt: number | null;
}

export function orderAggregateIds(
  rows: AggregateSortRow[],
  sortBy: LibrarySortBy,
  sortDir: LibrarySortDir,
): number[] {
  const sign = sortDir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    let cmp: number;
    if (sortBy === "file_size") {
      // nulls always last, regardless of direction (matches client sort).
      const aNull = a.fileSizeTotal === null;
      const bNull = b.fileSizeTotal === null;
      if (aNull && bNull) cmp = 0;
      else if (aNull) return 1;
      else if (bNull) return -1;
      else cmp = a.fileSizeTotal! < b.fileSizeTotal! ? -1 : a.fileSizeTotal! > b.fileSizeTotal! ? 1 : 0;
    } else {
      // last_grabbed_at: client treats null as epoch 0 (oldest).
      const aTime = a.lastGrabbedAt ?? 0;
      const bTime = b.lastGrabbedAt ?? 0;
      cmp = aTime - bTime;
    }
    if (cmp !== 0) return sign * cmp;
    return sign * (a.id - b.id);
  });
  return sorted.map((r) => r.id);
}

export function reorderByIds<T extends { id: number }>(
  records: T[],
  orderedIds: number[],
): T[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((r): r is T => r != null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/routes/library/libraryListQuery.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/api/src/routes/library/libraryListQuery.ts apps/api/src/routes/library/libraryListQuery.test.ts
git add apps/api/src/routes/library/libraryListQuery.ts apps/api/src/routes/library/libraryListQuery.test.ts
git commit -m "feat(api): add pure library sort/pagination helpers"
```

### Task B2: Add `has_more` to the shared `LibraryListResponse` type

**Files:**
- Modify: `apps/shared/src/types/library.ts:107-111`

**Interfaces:**
- Produces: `LibraryListResponse.has_more: boolean`
- Consumes: nothing.

- [ ] **Step 1: Add the field**

In `apps/shared/src/types/library.ts`, change `LibraryListResponse`:

```typescript
export interface LibraryListResponse {
  items: LibraryMedia[];
  movie_count: number;
  show_count: number;
  has_more: boolean;
}
```

- [ ] **Step 2: Typecheck the shared package**

Run: `cd apps/shared && bun run typecheck`
Expected: PASS (this package has no consumers of the new field yet, but the API route in B3 will now be required to set it).

- [ ] **Step 3: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/shared/src/types/library.ts
git add apps/shared/src/types/library.ts
git commit -m "feat(shared): add has_more to LibraryListResponse"
```

### Task B3: Branch `GET /api/library` into paged simple-sort and aggregate-sort paths

**Files:**
- Modify: `apps/api/src/routes/library/libraryListRoutes.ts:25-78`

**Interfaces:**
- Consumes: `parseLibrarySort`, `isAggregateSort`, `buildSimpleOrderBy`, `slicePage`, `orderAggregateIds`, `reorderByIds`, `AggregateSortRow` (Task B1); existing `mapLibraryMedia`, `libraryMediaInclude` (`./libraryHelpers`).
- Produces: `GET /api/library` accepting `sort_by`, `sort_dir` (plus existing `page`, `limit`, `type`, `status`, `q`, `language`) and returning `{ items, movie_count, show_count, has_more }`.

Behavior contract:
- **Unpaged** (neither `page` nor `limit` present): unchanged — `title asc`, up to 5000 items, `has_more: false`. Preserves `useLibrary` full-list callers.
- **Paged, simple sort**: `orderBy = buildSimpleOrderBy(...)`, fetch `take + 1` with `libraryMediaInclude`, `slicePage` → `has_more`.
- **Paged, aggregate sort** (`file_size`/`last_grabbed_at`): fetch lightweight `{ id, files.sizeBytes, episodes.files.sizeBytes, downloadHistories[0].grabbedAt }` for all matching rows, `orderAggregateIds`, take the `limit + 1` page slice of ids, `has_more` from the slice, fetch full records for the page ids with `libraryMediaInclude`, `reorderByIds`, map.

- [ ] **Step 1: Add imports**

At the top of `apps/api/src/routes/library/libraryListRoutes.ts`, add:

```typescript
import {
  parseLibrarySort,
  isAggregateSort,
  buildSimpleOrderBy,
  slicePage,
  orderAggregateIds,
  reorderByIds,
  type AggregateSortRow,
} from "./libraryListQuery";
```

- [ ] **Step 2: Replace the `GET "/"` handler body (lines 27-66) and its query schema (lines 68-77)**

Handler body:

```typescript
    async ({ query, set }) => {
      try {
        const { type, status, q, language, page, limit, sort_by, sort_dir } =
          query;
        const titleFilter = q
          ? { title: { contains: q, mode: "insensitive" as const } }
          : {};
        const sharedWhere: Prisma.LibraryMediaWhereInput = {
          ...(status ? { status } : {}),
          ...titleFilter,
          ...(language && language.length > 0
            ? { files: { some: { languageTags: { has: language } } } }
            : {}),
        };
        const typedWhere: Prisma.LibraryMediaWhereInput = {
          ...sharedWhere,
          ...(type ? { type } : {}),
        };

        const countsPromise = prisma.libraryMedia.groupBy({
          by: ["type"],
          where: sharedWhere,
          _count: true,
        });

        const paged = page !== undefined || limit !== undefined;
        const { sortBy, sortDir } = parseLibrarySort(sort_by, sort_dir);

        let mappedItems: ReturnType<typeof mapLibraryMedia>[];
        let has_more = false;

        if (!paged) {
          // Legacy full-list path (title asc) for non-Library-page callers.
          const items = await prisma.libraryMedia.findMany({
            where: typedWhere,
            orderBy: { title: "asc" },
            include: libraryMediaInclude,
            take: 5000,
          });
          mappedItems = items.map(mapLibraryMedia);
        } else {
          const take = Math.min(Math.max(1, limit ?? 60), 100);
          const skip = (Math.max(1, page ?? 1) - 1) * take;

          if (!isAggregateSort(sortBy)) {
            const rows = await prisma.libraryMedia.findMany({
              where: typedWhere,
              orderBy: buildSimpleOrderBy(sortBy, sortDir),
              include: libraryMediaInclude,
              take: take + 1,
              skip,
            });
            const sliced = slicePage(rows, take);
            has_more = sliced.has_more;
            mappedItems = sliced.items.map(mapLibraryMedia);
          } else {
            // Aggregate sort: order lightweight rows, then fetch full records
            // only for the requested page.
            const lightRows = await prisma.libraryMedia.findMany({
              where: typedWhere,
              select: {
                id: true,
                files: { select: { sizeBytes: true } },
                episodes: { select: { files: { select: { sizeBytes: true } } } },
                downloadHistories: {
                  orderBy: { grabbedAt: "desc" as const },
                  take: 1,
                  select: { grabbedAt: true },
                },
              },
            });
            const aggRows: AggregateSortRow[] = lightRows.map((r) => {
              let total = 0n;
              for (const f of r.files) total += f.sizeBytes;
              for (const ep of r.episodes)
                for (const f of ep.files) total += f.sizeBytes;
              return {
                id: r.id,
                fileSizeTotal: total === 0n ? null : total,
                lastGrabbedAt:
                  r.downloadHistories[0]?.grabbedAt.getTime() ?? null,
              };
            });
            const orderedIds = orderAggregateIds(aggRows, sortBy, sortDir);
            const pageIdsPlusOne = orderedIds.slice(skip, skip + take + 1);
            const sliced = slicePage(pageIdsPlusOne, take);
            has_more = sliced.has_more;
            const pageRecords = await prisma.libraryMedia.findMany({
              where: { id: { in: sliced.items } },
              include: libraryMediaInclude,
            });
            mappedItems = reorderByIds(pageRecords, sliced.items).map(
              mapLibraryMedia,
            );
          }
        }

        const counts = await countsPromise;
        const movieCount = counts.find((c) => c.type === "movie")?._count ?? 0;
        const showCount = counts.find((c) => c.type === "show")?._count ?? 0;
        return {
          items: mappedItems,
          movie_count: movieCount,
          show_count: showCount,
          has_more,
        };
      } catch {
        return serverError(set, "Failed to fetch library");
      }
    },
```

Query schema:

```typescript
    {
      query: t.Object({
        type: t.Optional(t.String()),
        status: t.Optional(t.String()),
        q: t.Optional(t.String()),
        language: t.Optional(t.String()),
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        sort_by: t.Optional(t.String()),
        sort_dir: t.Optional(t.String()),
      }),
    },
```

- [ ] **Step 3: Typecheck and run API tests**

Run: `cd apps/api && bun run typecheck && bun test src/routes/library/`
Expected: typecheck clean; library tests PASS (`libraryListQuery.test.ts`, `libraryStats.test.ts`).

- [ ] **Step 4: Manually verify pagination + sort against a running API**

Run (dev stack up, authenticated):
```bash
# Page 1 of 60, sorted by size desc.
curl -s -H "Cookie: <session>" \
  "http://127.0.0.1:3000/api/library?page=1&limit=60&sort_by=file_size&sort_dir=desc" \
  | bun -e 'const d=JSON.parse(await Bun.stdin.text()); console.log({n:d.items.length, has_more:d.has_more, first:d.items[0]?.total_size_bytes, last:d.items.at(-1)?.total_size_bytes});'
# Page 2 must not repeat page-1 ids.
```
Expected: `n` = 60, `has_more` = true (787 items), sizes descending, and page-2 ids disjoint from page-1 ids. Confirm the unpaged call still returns the full list: `curl ".../api/library" | ... items.length` → ~787.

- [ ] **Step 5: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/api/src/routes/library/libraryListRoutes.ts
git add apps/api/src/routes/library/libraryListRoutes.ts
git commit -m "perf(api): server-side sort + pagination for GET /api/library"
```

### Task B4: `queryKeys.library.infinite` + `useInfiniteLibrary` hook

**Files:**
- Modify: `apps/web/src/lib/queryKeys.ts:250-286` (the `library` block)
- Create: `apps/web/src/features/medias/hooks/useInfiniteLibrary.ts`

**Interfaces:**
- Consumes: `LibraryListResponse` (now with `has_more`) from `@rawkoon/shared/types`; `LIBRARY_ENDPOINTS.LIST`; `useFetcher`.
- Produces:
  - `queryKeys.library.infinite(filters: { type?: string; status?: string; q?: string; language?: string; sortBy?: string; sortDir?: string })`
  - `useInfiniteLibrary(filters?: { type?: string; status?: string; q?: string; language?: string; sortBy?: string; sortDir?: string })` returning a TanStack `useInfiniteQuery` result whose pages are `LibraryListResponse`.

- [ ] **Step 1: Add the query key**

In `apps/web/src/lib/queryKeys.ts`, inside the `library` object (after the `list` entry near line 257), add:

```typescript
    infinite: (filters?: {
      type?: string;
      status?: string;
      q?: string;
      language?: string;
      sortBy?: string;
      sortDir?: string;
    }) => [...queryKeys.library.all, "infinite", filters] as const,
```

- [ ] **Step 2: Write the hook**

Create `apps/web/src/features/medias/hooks/useInfiniteLibrary.ts`:

```typescript
import { useInfiniteQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryListResponse } from "@rawkoon/shared/types";

export const LIBRARY_PAGE_SIZE = 60;

export interface LibraryInfiniteFilters {
  type?: string;
  status?: string;
  q?: string;
  language?: string;
  sortBy?: string;
  sortDir?: string;
}

export function useInfiniteLibrary(filters?: LibraryInfiniteFilters) {
  const fetcher = useFetcher();

  return useInfiniteQuery({
    queryKey: queryKeys.library.infinite(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("page", String(pageParam));
      params.set("limit", String(LIBRARY_PAGE_SIZE));
      if (filters?.type) params.set("type", filters.type);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.q) params.set("q", filters.q);
      if (filters?.language) params.set("language", filters.language);
      if (filters?.sortBy) params.set("sort_by", filters.sortBy);
      if (filters?.sortDir) params.set("sort_dir", filters.sortDir);
      return fetcher<LibraryListResponse>(
        `${LIBRARY_ENDPOINTS.LIST}?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.has_more ? allPages.length + 1 : undefined,
    initialPageParam: 1,
  });
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/web/src/lib/queryKeys.ts apps/web/src/features/medias/hooks/useInfiniteLibrary.ts
git add apps/web/src/lib/queryKeys.ts apps/web/src/features/medias/hooks/useInfiniteLibrary.ts
git commit -m "feat(web): add useInfiniteLibrary infinite-query hook"
```

### Task B5: Teach `LibraryGrid` to load more near the virtualized tail

**Files:**
- Modify: `apps/web/src/pages/medias/_component/LibraryGrid.tsx`

**Interfaces:**
- Consumes: existing `LibraryMedia`, `ViewMode`.
- Produces: `LibraryGrid`/`VirtualGrid`/`VirtualList` gain three optional props: `hasNextPage?: boolean`, `isFetchingNextPage?: boolean`, `onLoadMore?: () => void`. When the virtualizer's last visible item reaches within `overscan` of the end and `hasNextPage && !isFetchingNextPage`, `onLoadMore()` fires once per boundary.

- [ ] **Step 1: Extend `LibraryGridProps` and forward the new props**

In `apps/web/src/pages/medias/_component/LibraryGrid.tsx`, add to `LibraryGridProps` (line 41):

```typescript
interface LibraryGridProps {
  items: LibraryMedia[];
  isLoading: boolean;
  viewMode: ViewMode;
  onMovieSearch: (id: number) => void;
  movieSearchPending: boolean;
  movieSearchId: number | null;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
}
```

Destructure them in `LibraryGrid({...})` and pass `hasNextPage`, `isFetchingNextPage`, `onLoadMore` to both `<VirtualList .../>` and `<VirtualGrid .../>`. Add the same three optional props to `VirtualGridProps` (line 138) and `VirtualListProps` (line 250).

- [ ] **Step 2: Fire `onLoadMore` from the grid virtualizer**

In `VirtualGrid`, after the `useEffect` that calls `rowVirtualizer.measure()` (line 192-194), add:

```typescript
  const virtualRows = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last) return;
    if (
      last.index >= rowCount - 1 &&
      hasNextPage &&
      !isFetchingNextPage &&
      onLoadMore
    ) {
      onLoadMore();
    }
  }, [virtualRows, rowCount, hasNextPage, isFetchingNextPage, onLoadMore]);
```

Then replace `rowVirtualizer.getVirtualItems().map((vrow) => {` (line 205) with `virtualRows.map((vrow) => {` so both uses share one snapshot.

- [ ] **Step 3: Fire `onLoadMore` from the list virtualizer**

In `VirtualList`, replace the `rowVirtualizer.getVirtualItems().map(...)` usage similarly. After the `useWindowVirtualizer` call (line 272), add:

```typescript
  const virtualRows = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last) return;
    if (
      last.index >= items.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage &&
      onLoadMore
    ) {
      onLoadMore();
    }
  }, [virtualRows, items.length, hasNextPage, isFetchingNextPage, onLoadMore]);
```

Add `import { useEffect } ...` — `useEffect` is already imported (line 1-7 imports `useEffect`). Change the list render to iterate `virtualRows`.

- [ ] **Step 4: Render a tail loading indicator**

In `LibraryGrid`, wrap the returned `VirtualGrid`/`VirtualList` so a spinner row shows while fetching the next page. Change the final `return` (lines 102-117) to:

```typescript
  return (
    <>
      {viewMode === "list" ? (
        <VirtualList
          items={items}
          onMovieSearch={onMovieSearch}
          movieSearchPending={movieSearchPending}
          movieSearchId={movieSearchId}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={onLoadMore}
        />
      ) : (
        <VirtualGrid
          items={items}
          viewMode={viewMode}
          onMovieSearch={onMovieSearch}
          movieSearchPending={movieSearchPending}
          movieSearchId={movieSearchId}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={onLoadMore}
        />
      )}
      {isFetchingNextPage && (
        <div className="flex justify-center py-4 text-sm text-neutral-400">
          {t("common.loading", { defaultValue: "Loading…" })}
        </div>
      )}
    </>
  );
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/web/src/pages/medias/_component/LibraryGrid.tsx
git add apps/web/src/pages/medias/_component/LibraryGrid.tsx
git commit -m "feat(web): LibraryGrid loads next page near virtualized tail"
```

### Task B6: Switch `LibraryPage` to infinite query; drop client sort

**Files:**
- Modify: `apps/web/src/pages/medias/_component/LibraryPage.tsx:16,72-97,112-113,193-200`

**Interfaces:**
- Consumes: `useInfiniteLibrary` (Task B4); `LibraryGrid`'s new props (Task B5).
- Produces: Library page renders server-paged, server-sorted results; movie/show counts come from the first page; changing any filter or sort produces a new infinite-query key (fresh page 1) because `useInfiniteLibrary` keys on all filters including `sortBy`/`sortDir`.

- [ ] **Step 1: Swap the hook import**

Replace line 16:

```typescript
import { useInfiniteLibrary } from "@/features/medias/hooks/useInfiniteLibrary";
```

Remove the now-unused `sortItems` and `SortDir` from the `@/utils/libraryUtils` import (line 21-26); keep `FilterType`, `FilterStatus`.

- [ ] **Step 2: Replace the data fetch (lines 72-97)**

```typescript
  const {
    data,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteLibrary({
    type: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    q: search || undefined,
    language: languageFilter !== "all" ? languageFilter : undefined,
    sortBy,
    sortDir,
  });

  const { data: languageTagsData } = useLibraryLanguageTags();
  const languageTags = languageTagsData?.tags ?? [];

  useEffect(() => {
    if (languageTags.length === 0 && languageFilter !== "all") {
      setState({ language: "all" });
    }
  }, [languageTags.length, languageFilter, setState]);

  // Server returns already-sorted, already-filtered pages; the client only
  // flattens the loaded pages into one list for the virtualized grid.
  const sorted = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data?.pages],
  );
```

- [ ] **Step 3: Read counts from the first page (lines 112-113)**

```typescript
  const movieCount = data?.pages[0]?.movie_count ?? 0;
  const showCount = data?.pages[0]?.show_count ?? 0;
```

- [ ] **Step 4: Pass load-more props to `LibraryGrid` (lines 193-200)**

```typescript
        <LibraryGrid
          items={sorted}
          isLoading={isLoading}
          viewMode={viewMode}
          onMovieSearch={handleMovieSearch}
          movieSearchPending={searchMovie.isPending}
          movieSearchId={searchMovie.variables?.id ?? null}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => fetchNextPage()}
        />
```

- [ ] **Step 5: Typecheck, lint, run web tests**

Run: `cd apps/web && bun run typecheck && bun run lint && bunx vitest run`
Expected: typecheck clean; lint clean (no unused `sortItems`/`SortDir`); existing web tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/web/src/pages/medias/_component/LibraryPage.tsx
git add apps/web/src/pages/medias/_component/LibraryPage.tsx
git commit -m "perf(web): Library page uses server-paged infinite scroll"
```

### Task B7: Prefetch the first infinite page; end-to-end verification

**Files:**
- Modify: `apps/web/src/lib/routing/prefetch.ts:90-93` (the `/library` entry)

**Interfaces:**
- Consumes: `queryKeys.library.infinite`, `LIBRARY_ENDPOINTS.LIST`, `LIBRARY_PAGE_SIZE`.

- [ ] **Step 1: Inspect the current `/library` prefetch entry**

Run: `sed -n '80,110p' apps/web/src/lib/routing/prefetch.ts`
Expected: shows the `"/library": () => [ { queryKey: queryKeys.library.list({}), queryFn: ... } ]` entry and whether the file uses `prefetchQuery` or `prefetchInfiniteQuery`. Match the existing helper's shape when editing.

- [ ] **Step 2: Change the entry to prefetch the first infinite page**

Replace the `/library` prefetch descriptor so it warms `queryKeys.library.infinite(undefined)` with page 1 (`?page=1&limit=60`) using `prefetchInfiniteQuery` (`initialPageParam: 1`). Mirror the exact registration/return shape the surrounding entries use (the file may register descriptors consumed by a shared runner rather than calling the client directly — follow that pattern; do not invent a new call style).

Reference query string: `${LIBRARY_ENDPOINTS.LIST}?page=1&limit=${LIBRARY_PAGE_SIZE}`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Full workspace gate**

Run:
```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run lint && bun run formatCheck && bun run test
```
Expected: all green.

- [ ] **Step 5: Drive the real Library page**

Rerun the uncommitted baseline benchmark to confirm the page now loads one 60-item page and still scrolls to the end:
```bash
cd apps/web && DISPLAY=:1 BASE_URL=https://rawkoon.samlo.cloud \
  TEST_EMAIL="$RAWKOON_EMAIL" TEST_PASSWORD="$RAWKOON_PASSWORD" \
  bun scripts/bench-library-prod.mjs
```
(Deploy the branch first, or point `BASE_URL` at a local prod-like build.) Expected: initial `/api/library` body is ~one 60-row page (tens of KB), not ~928 KB; scrolling triggers additional page fetches and reaches the end without duplicates or jank.

- [ ] **Step 6: Production log check (per spec acceptance criterion 4)**

After rollout, sample Caddy access logs: a warm `/api/medias/explore` avoids the ~1.24 s path, and initial `/api/library` responses are one 60-item page rather than ~950 KB.

- [ ] **Step 7: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
biome format --write apps/web/src/lib/routing/prefetch.ts
git add apps/web/src/lib/routing/prefetch.ts
git commit -m "perf(web): prefetch first Library page as infinite query"
```

---

## Self-Review

**Spec coverage:**
- Explore 15-min Redis cache keyed by language + region, raw TMDB data, fresh membership every request → Tasks A1, A2. ✓
- Cache miss retains parallel TMDB fetches + error handling; 1-hour recommendation cache unchanged → A2 (recommendations block untouched, `fetchSections` keeps `Promise.all`). ✓
- Library keeps TanStack Virtual grid + list; adds paging, 60/page, load near tail, tail loading state, filter/sort restarts at page 1, failed later page keeps rendered items and no duplicate concurrent requests → B4, B5, B6. (`useInfiniteQuery` dedupes in-flight page fetches; a failed `fetchNextPage` leaves loaded pages intact and is retryable — TanStack default.) ✓
- `useLibrary` full-list behavior preserved for non-Library-page callers → B3 unpaged path + hook left untouched (`LibraryItemPage`, `LibraryQualityProfileSection` still import `useLibrary`). ✓
- Paged API accepts `page`, `limit`, `sort_by`, `sort_dir`, returns `has_more`, server-applies all sorts, stable `id` tie-break; simple fields via Prisma ordering, `file_size`/`last_grabbed_at` via aggregate ordering then page fetch → B1, B2, B3. ✓
- Redis best-effort; TMDB cold-miss error response retained; failed later page retryable, no concurrent dup requests → Global Constraints + A2 + B5/B6. ✓
- Tests: Explore no-second-fetch (A1), ordered/no-dup/has_more/all sorts (B1 + B3 manual), tail fetches one page + filter/sort restart (B6 behavior; verified via B7 drive) → covered; note B5/B6 UI behavior is verified by driving the page in B7 rather than a jsdom virtualizer test, since TanStack Virtual needs real layout. ✓
- Non-goals respected: no Postgres→SQLite, no numbered pagination/new scroll lib/new dep, no cached final Explore response. ✓

**Placeholder scan:** No TBD/"handle edge cases"/"similar to Task N". B7 Step 2 intentionally defers to the file's existing prefetch registration shape (inspected in Step 1) rather than guessing the call style — the reference key and query string are given explicitly.

**Type consistency:** `LibrarySortBy`/`LibrarySortDir`, `AggregateSortRow`, `ExploreBaseSections`, `LibraryInfiniteFilters`, `LIBRARY_PAGE_SIZE`, and `has_more` are named identically across defining and consuming tasks. `parseLibrarySort`, `buildSimpleOrderBy`, `slicePage`, `orderAggregateIds`, `reorderByIds`, `getExploreBaseSections`, `exploreBaseCacheKey`, `useInfiniteLibrary`, `queryKeys.library.infinite` match between producer and consumer tasks.
