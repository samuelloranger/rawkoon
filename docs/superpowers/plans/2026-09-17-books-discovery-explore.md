# Books Discovery (Explore) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a books Explore surface backed by two ranked bestseller sources (leslibraires.ca Palmarès + NYT Books), on web and iOS.

**Architecture:** A pluggable `BookDiscoverySource` registry on the API produces ranked entries; a discovery route enriches each entry by ISBN through the existing provider chain and caches the enriched list in Valkey; web and iOS render a source/list toggle over a ranked cover grid with a not-in-library detail sheet that can add to the library.

**Tech Stack:** Bun + Hono (API), React 19 + TanStack Router/Query + Tailwind + i18next (web), SwiftUI + RawkoonKit (iOS), Valkey cache, Prisma.

**Spec:** `docs/superpowers/specs/2026-09-17-books-palmares-explore-design.md`

## Global Constraints

- Commits must NOT include `Co-Authored-By` trailers.
- Public-facing text (commit messages, PR, comments, test fixtures) describes the code and general failure mode — never instance-specific data (real titles, counts, IDs, paths).
- API errors are returned via `src/errors.ts` helpers (`badRequest`/`unauthorized`/…), never thrown; the global `onError` swallows messages, so never rely on an error string reaching the client.
- API code imports itself as `@rawkoon/api/<path>` (never relative).
- Shared types are the contract: change `@rawkoon/shared/types`, consumed by both clients.
- Web query keys live in `apps/web/src/lib/queryKeys.ts`; endpoints in `apps/web/src/lib/endpoints/`.
- TS is strict (`noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`); Biome lints/formats all three apps.
- iOS: SwiftUI, iOS 18 target, Swift 6 strict concurrency; build settings only in `project.yml`; no new third-party deps. macbuild is the only real iOS gate; never `git pull` macbuild's diverged main — use an isolated worktree at the commit.
- iOS user-facing literal strings must exist in `apps/ios/Rawkoon/Localizable.xcstrings` or `l10n-ignore.txt`; interpolated ones rewritten to `%@`/`%lld`. Verify with `apps/ios/scripts/check-l10n.py`.
- swiftformat `docComments`: a `//` comment immediately before a declaration must be `///`.
- Do NOT cut a release; this feature ships to `main` and iOS TestFlight only on explicit later ask.
- Gates before any PR: `bun run formatCheck && bun run lint && bun run typecheck && bun run test && bun run build`.

Work happens on branch `feat/books-discovery-explore` (already created; scraper + spec committed there as `ae91714`).

---

## File Structure

**API**
- `apps/api/src/services/books/leslibrairesPalmares.ts` — scraper (shipped).
- `apps/api/src/services/books/nytBooksSource.ts` — NEW: NYT Books API client + mapping.
- `apps/api/src/services/books/discoverySources.ts` — NEW: `RankedEntry`, `BookDiscoverySource` interface, registry, leslibraires + nyt source instances.
- `apps/api/src/services/books/bookDiscovery.ts` — NEW: enrich + cache + membership → `BookDiscoveryBook[]`.
- `apps/api/src/routes/books/bookDiscoveryRoutes.ts` — NEW: `/discovery` + `/discovery/sources`, mounted in the books router index.
- `apps/api/src/routes/integrations/…` — NEW `nyt` config + test routes (mirror googlebooks).
- `apps/api/src/utils/integrations/{types.ts,normalizers.ts}` — add `NytBooksIntegrationConfig` + `normalizeNytBooksConfig`.

**Shared**
- `apps/shared/types/*` — add `BookDiscoveryBook`, `BookDiscoveryList`, `BookDiscoveryResponse`, `BookDiscoverySourcesResponse`, and NYT integration response types.

**Web**
- `apps/web/src/lib/endpoints/books.ts` — discovery endpoints.
- `apps/web/src/lib/endpoints/index.ts` (`INTEGRATION_ENDPOINTS`) — NYT config endpoints.
- `apps/web/src/lib/queryKeys.ts` — discovery + nyt keys.
- `apps/web/src/pages/books/_hooks/useBookDiscovery.ts` — NEW hooks.
- `apps/web/src/pages/books/explore/` — NEW route + `BooksExplorePage.tsx` + `DiscoveryBookCard.tsx` + `DiscoveryBookSheet.tsx`.
- `apps/web/src/pages/books/_component/BooksPage.tsx` — add Explore entry link.
- `apps/web/src/pages/settings/useNytBooksIntegration.ts` + `BooksSettingsTab.tsx` — NYT settings section.

**iOS**
- `apps/ios/Rawkoon/Models.swift` — discovery + NYT DTOs.
- `apps/ios/Rawkoon/APIClient.swift` (+ `APIClient+Settings.swift`) — discovery + NYT methods.
- `apps/ios/Rawkoon/Views/Discover/BookDiscoveryView.swift` + `DiscoveryBookDetailView.swift` — NEW.
- `apps/ios/Rawkoon/Views/Settings/integrations/BooksProviderView.swift` — NYT section.
- entry point on the Books list screen.
- `apps/ios/Rawkoon/Localizable.xcstrings` — new keys.

---

## Phase A — API + shared

### Task 1: Shared discovery types

**Files:**
- Modify: the shared types barrel under `apps/shared/types/` (add to the books types module that already exports `BookItemResponse`, `AddBookRequest`, etc.; follow that file's export style).

**Interfaces:**
- Produces: `BookDiscoveryBook`, `BookDiscoveryList`, `BookDiscoveryResponse`, `BookDiscoverySourcesResponse` (exact shapes below), plus `BookDiscoverySourceId = "leslibraires" | "nyt"`.

- [ ] **Step 1: Add the types** (no test — pure type declarations verified by `typecheck` when a consumer lands)

```ts
export type BookDiscoverySourceId = "leslibraires" | "nyt";

export interface BookDiscoveryBook {
  rank: number;
  title: string;
  isbn13: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  author: string | null;
  overview: string | null;
  publishedYear: number | null;
  volumeId: string | null;
  alreadyInLibrary: boolean;
}

export interface BookDiscoveryList {
  id: string;
  label: string;
}

export interface BookDiscoveryResponse {
  source: BookDiscoverySourceId;
  list: string;
  items: BookDiscoveryBook[];
}

export interface BookDiscoverySourcesResponse {
  sources: {
    id: BookDiscoverySourceId;
    label: string;
    lists: BookDiscoveryList[];
  }[];
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --filter @rawkoon/shared typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/shared
git commit -m "feat(shared): book discovery response types"
```

---

### Task 2: Source abstraction + leslibraires source

**Files:**
- Create: `apps/api/src/services/books/discoverySources.ts`
- Test: `apps/api/src/services/books/discoverySources.test.ts`

**Interfaces:**
- Consumes: `getPalmares`, `PalmaresTheme`, `palmaresCoverUrl` from `@rawkoon/api/services/books/leslibrairesPalmares`.
- Produces:
  - `interface RankedEntry { rank; title; isbn13: string | null; coverUrl: string | null; sourceUrl: string | null; author: string | null; overview: string | null }`
  - `interface BookDiscoverySource { id: BookDiscoverySourceId; label: string; isConfigured(): Promise<boolean>; lists(): Promise<BookDiscoveryList[]>; fetch(listId: string): Promise<RankedEntry[]> }`
  - `getDiscoverySource(id: string): BookDiscoverySource | null`
  - `listDiscoverySources(): BookDiscoverySource[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import {
  getDiscoverySource,
  listDiscoverySources,
} from "@rawkoon/api/services/books/discoverySources";

describe("discovery source registry", () => {
  it("registers leslibraires and nyt", () => {
    expect(listDiscoverySources().map((s) => s.id).sort()).toEqual([
      "leslibraires",
      "nyt",
    ]);
  });

  it("returns null for an unknown source", () => {
    expect(getDiscoverySource("bogus")).toBeNull();
  });

  it("leslibraires exposes general + jeunesse and is always configured", async () => {
    const src = getDiscoverySource("leslibraires");
    expect(src).not.toBeNull();
    expect(await src!.isConfigured()).toBe(true);
    expect((await src!.lists()).map((l) => l.id)).toEqual([
      "general",
      "jeunesse",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && NODE_ENV=test bun test src/services/books/discoverySources.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `discoverySources.ts`**

```ts
import type {
  BookDiscoveryList,
  BookDiscoverySourceId,
} from "@rawkoon/shared/types";
import {
  getPalmares,
  palmaresCoverUrl,
  type PalmaresTheme,
} from "@rawkoon/api/services/books/leslibrairesPalmares";
import { createNytSource } from "@rawkoon/api/services/books/nytBooksSource";

export interface RankedEntry {
  rank: number;
  title: string;
  isbn13: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  author: string | null;
  overview: string | null;
}

export interface BookDiscoverySource {
  id: BookDiscoverySourceId;
  label: string;
  isConfigured(): Promise<boolean>;
  lists(): Promise<BookDiscoveryList[]>;
  fetch(listId: string): Promise<RankedEntry[]>;
}

const LESLIBRAIRES_LISTS: BookDiscoveryList[] = [
  { id: "general", label: "Palmarès" },
  { id: "jeunesse", label: "Jeunesse" },
];

const leslibrairesSource: BookDiscoverySource = {
  id: "leslibraires",
  label: "Palmarès Québec",
  isConfigured: async () => true,
  lists: async () => LESLIBRAIRES_LISTS,
  fetch: async (listId) => {
    const theme: PalmaresTheme = listId === "jeunesse" ? "jeunesse" : "general";
    const entries = await getPalmares(theme);
    return entries.map((e) => ({
      rank: e.rank,
      title: e.title,
      isbn13: e.isbn13,
      coverUrl: e.coverUrl ?? palmaresCoverUrl(e.isbn13),
      sourceUrl: e.url,
      author: null,
      overview: null,
    }));
  },
};

const SOURCES: BookDiscoverySource[] = [leslibrairesSource, createNytSource()];

export function listDiscoverySources(): BookDiscoverySource[] {
  return SOURCES;
}

export function getDiscoverySource(id: string): BookDiscoverySource | null {
  return SOURCES.find((s) => s.id === id) ?? null;
}
```

- [ ] **Step 4: Stub `nytBooksSource.ts` enough to compile** (full impl in Task 3)

```ts
import type { BookDiscoveryList } from "@rawkoon/shared/types";
import type {
  BookDiscoverySource,
  RankedEntry,
} from "@rawkoon/api/services/books/discoverySources";

export function createNytSource(): BookDiscoverySource {
  return {
    id: "nyt",
    label: "NYT Bestsellers",
    isConfigured: async () => false,
    lists: async (): Promise<BookDiscoveryList[]> => [],
    fetch: async (): Promise<RankedEntry[]> => [],
  };
}
```

Note the import cycle is type-only (`import type`), so it is erased at build — safe.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && NODE_ENV=test bun test src/services/books/discoverySources.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/books/discoverySources.ts apps/api/src/services/books/discoverySources.test.ts apps/api/src/services/books/nytBooksSource.ts
git commit -m "feat(api): book discovery source registry + leslibraires source"
```

---

### Task 3: NYT Books source

**Files:**
- Modify: `apps/api/src/services/books/nytBooksSource.ts` (replace the stub)
- Modify: `apps/api/src/utils/integrations/types.ts` (add `NytBooksIntegrationConfig`)
- Modify: `apps/api/src/utils/integrations/normalizers.ts` (add `normalizeNytBooksConfig`)
- Test: `apps/api/src/services/books/nytBooksSource.test.ts`
- Fixture: `apps/api/src/services/books/__fixtures__/nyt-fiction.json` (a trimmed real `lists/current` payload: 3 books with `rank`, `title`, `author`, `primary_isbn13`, `book_image`, `description`, `amazon_product_url`, wrapped in `{ results: { books: [...] } }`).

**Interfaces:**
- Consumes: `getIntegrationConfigRecord` from `@rawkoon/api/services/integrationConfigCache`; `getJsonCache`/`setJsonCache` from `@rawkoon/api/services/cache`; `BookProviderUnavailableError` from `@rawkoon/api/services/books/types`.
- Produces: `createNytSource(): BookDiscoverySource`; `mapNytList(payload: unknown): RankedEntry[]` (exported for the test).

- [ ] **Step 1: Add the config type**

In `types.ts`:
```ts
export interface NytBooksIntegrationConfig {
  api_key: string;
}
```

- [ ] **Step 2: Add the normalizer**

In `normalizers.ts` (mirror `normalizeGoogleBooksConfig`):
```ts
export const normalizeNytBooksConfig = (
  config: unknown,
): NytBooksIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;
  const apiKey = normalizeSecret(cfg.api_key);
  if (!apiKey) return null;
  return { api_key: apiKey };
};
```
Add the matching `import type { NytBooksIntegrationConfig }` at the top with the other config type imports.

- [ ] **Step 3: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapNytList } from "@rawkoon/api/services/books/nytBooksSource";

const payload = JSON.parse(
  readFileSync(join(import.meta.dir, "__fixtures__", "nyt-fiction.json"), "utf-8"),
);

describe("mapNytList", () => {
  it("maps NYT books to ranked entries with source-supplied fields", () => {
    const entries = mapNytList(payload);
    expect(entries.length).toBe(3);
    expect(entries[0].rank).toBe(1);
    expect(entries[0].isbn13).toMatch(/^\d{13}$/);
    expect(entries[0].coverUrl).toContain("http");
    expect(entries[0].author).toBeTruthy();
    expect(entries[0].overview).toBeTruthy();
    const ranks = entries.map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("returns empty for a malformed payload", () => {
    expect(mapNytList({})).toEqual([]);
    expect(mapNytList(null)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/api && NODE_ENV=test bun test src/services/books/nytBooksSource.test.ts`
Expected: FAIL (`mapNytList` not exported)

- [ ] **Step 5: Implement `nytBooksSource.ts`**

```ts
import type {
  BookDiscoveryList,
  BookDiscoverySourceId,
} from "@rawkoon/shared/types";
import type {
  BookDiscoverySource,
  RankedEntry,
} from "@rawkoon/api/services/books/discoverySources";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeNytBooksConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books/types";

const BASE = "https://api.nytimes.com/svc/books/v3";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const LIST_CACHE_TTL = 12 * 60 * 60;

// A curated subset of NYT weekly lists. The full names list is large and mostly
// niche; these are the ones a general library cares about.
const DEFAULT_LISTS: BookDiscoveryList[] = [
  { id: "combined-print-and-e-book-fiction", label: "Fiction" },
  { id: "combined-print-and-e-book-nonfiction", label: "Nonfiction" },
  { id: "young-adult-hardcover", label: "Young adult" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadKey(): Promise<string | null> {
  const row = await getIntegrationConfigRecord("nyt");
  if (!row?.enabled) return null;
  const cfg = normalizeNytBooksConfig(row.config);
  return cfg?.api_key ?? null;
}

export function mapNytList(payload: unknown): RankedEntry[] {
  const books = (payload as { results?: { books?: unknown[] } })?.results?.books;
  if (!Array.isArray(books)) return [];
  const entries: RankedEntry[] = [];
  const seen = new Set<string>();
  for (const raw of books) {
    const b = raw as Record<string, unknown>;
    const title =
      typeof b.title === "string" ? b.title.trim() : "";
    if (!title) continue;
    const isbn13 =
      typeof b.primary_isbn13 === "string" && /^\d{13}$/.test(b.primary_isbn13)
        ? b.primary_isbn13
        : null;
    if (isbn13 && seen.has(isbn13)) continue;
    if (isbn13) seen.add(isbn13);
    const rank = typeof b.rank === "number" ? b.rank : entries.length + 1;
    entries.push({
      rank,
      title,
      isbn13,
      coverUrl: typeof b.book_image === "string" ? b.book_image : null,
      sourceUrl:
        typeof b.amazon_product_url === "string" ? b.amazon_product_url : null,
      author: typeof b.author === "string" ? b.author.trim() || null : null,
      overview:
        typeof b.description === "string" ? b.description.trim() || null : null,
    });
  }
  entries.sort((a, b) => a.rank - b.rank);
  return entries;
}

async function fetchNytJson(path: string, apiKey: string): Promise<unknown> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}api-key=${encodeURIComponent(apiKey)}`;
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => null);
    if (res?.ok) return res.json().catch(() => null);
    lastStatus = res?.status;
    // 4xx other than 429 is permanent (bad key / bad list).
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `NYT Books rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  throw new BookProviderUnavailableError(
    `NYT Books unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}

export function createNytSource(): BookDiscoverySource {
  const id: BookDiscoverySourceId = "nyt";
  return {
    id,
    label: "NYT Bestsellers",
    isConfigured: async () => (await loadKey()) !== null,
    lists: async () => DEFAULT_LISTS,
    fetch: async (listId) => {
      const apiKey = await loadKey();
      if (!apiKey) return [];
      // Validate the list against the curated set so an arbitrary slug can't be
      // used to probe the NYT API through this endpoint.
      if (!DEFAULT_LISTS.some((l) => l.id === listId)) return [];
      const cacheKey = `books:discovery:nyt:raw:${listId}`;
      const cached = await getJsonCache<RankedEntry[]>(cacheKey);
      if (cached) return cached;
      const payload = await fetchNytJson(
        `/lists/current/${encodeURIComponent(listId)}.json`,
        apiKey,
      );
      const entries = mapNytList(payload);
      if (entries.length > 0) await setJsonCache(cacheKey, entries, LIST_CACHE_TTL);
      return entries;
    },
  };
}
```

- [ ] **Step 6: Create the fixture** `__fixtures__/nyt-fiction.json` — trim a real `lists/current/combined-print-and-e-book-fiction.json` response to 3 books, keeping `results.books[].{rank,title,author,primary_isbn13,book_image,description,amazon_product_url}`. (Fetch it live with a throwaway key, or hand-author 3 realistic entries; keep no key in the file.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && NODE_ENV=test bun test src/services/books/nytBooksSource.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/books/nytBooksSource.ts apps/api/src/services/books/nytBooksSource.test.ts apps/api/src/services/books/__fixtures__/nyt-fiction.json apps/api/src/utils/integrations/types.ts apps/api/src/utils/integrations/normalizers.ts
git commit -m "feat(api): NYT Books discovery source"
```

---

### Task 4: Enrich + cache + membership (`bookDiscovery.ts`)

**Files:**
- Create: `apps/api/src/services/books/bookDiscovery.ts`
- Test: `apps/api/src/services/books/bookDiscovery.test.ts`

**Interfaces:**
- Consumes: `getDiscoverySource`, `listDiscoverySources`, `RankedEntry` (Task 2); `getBookMetadataProvider` from `@rawkoon/api/services/books` (`resolveIsbn(isbn13, opts?) => Promise<ProviderBook | null>`); `getJsonCache`/`setJsonCache`; `prisma`.
- Produces:
  - `getDiscovery(source: string, list: string): Promise<{ source; list; items: BookDiscoveryBook[] }>`
  - `getConfiguredSources(): Promise<BookDiscoverySourcesResponse>`

- [ ] **Step 1: Write the failing test** (mock the source registry, provider, and prisma)

```ts
import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock the provider chain and the library membership query.
const resolveIsbn = mock(async (isbn: string) =>
  isbn === "9780000000001"
    ? {
        volumeId: "vol-1",
        title: "T",
        subtitle: null,
        authors: ["Enriched Author"],
        language: "en",
        publishedYear: 2020,
        isbn13: isbn,
        coverUrl: null,
        overview: "Enriched overview",
        seriesName: null,
        seriesPosition: null,
      }
    : null,
);
mock.module("@rawkoon/api/services/books", () => ({
  getBookMetadataProvider: async () => ({ resolveIsbn }),
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryBook: {
      findMany: async () => [{ isbn13: "9780000000001" }],
    },
  },
}));
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async () => null,
  setJsonCache: async () => {},
}));
mock.module("@rawkoon/api/services/books/discoverySources", () => ({
  getDiscoverySource: (id: string) =>
    id === "test"
      ? {
          id: "leslibraires",
          label: "Test",
          isConfigured: async () => true,
          lists: async () => [{ id: "l", label: "L" }],
          fetch: async () => [
            {
              rank: 1,
              title: "A",
              isbn13: "9780000000001",
              coverUrl: "c1",
              sourceUrl: "u1",
              author: null,
              overview: null,
            },
            {
              rank: 2,
              title: "B",
              isbn13: "9780000000002",
              coverUrl: "c2",
              sourceUrl: "u2",
              author: "NYT Author",
              overview: "NYT overview",
            },
          ],
        }
      : null,
  listDiscoverySources: () => [],
}));

const { getDiscovery } = await import(
  "@rawkoon/api/services/books/bookDiscovery"
);

beforeEach(() => resolveIsbn.mockClear());

describe("getDiscovery", () => {
  it("enriches by ISBN, keeps source fields, and flags library membership", async () => {
    const res = await getDiscovery("test", "l");
    expect(res.items.length).toBe(2);
    // Entry 1: enrichment fills author/overview/volumeId; in library.
    expect(res.items[0].author).toBe("Enriched Author");
    expect(res.items[0].volumeId).toBe("vol-1");
    expect(res.items[0].alreadyInLibrary).toBe(true);
    // Entry 2: no enrichment (resolveIsbn null) → source fields kept, not in library.
    expect(res.items[1].author).toBe("NYT Author");
    expect(res.items[1].volumeId).toBeNull();
    expect(res.items[1].alreadyInLibrary).toBe(false);
  });

  it("prefers source-supplied author over enrichment", async () => {
    const res = await getDiscovery("test", "l");
    // Entry 2 had a source author and would not be overwritten even if resolved.
    expect(res.items[1].author).toBe("NYT Author");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && NODE_ENV=test bun test src/services/books/bookDiscovery.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `bookDiscovery.ts`**

```ts
import type {
  BookDiscoveryBook,
  BookDiscoverySourcesResponse,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { getBookMetadataProvider } from "@rawkoon/api/services/books";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import {
  getDiscoverySource,
  listDiscoverySources,
  type RankedEntry,
} from "@rawkoon/api/services/books/discoverySources";

const ENRICHED_TTL = 12 * 60 * 60;
const ENRICH_CONCURRENCY = 5;

/** Enriched items WITHOUT the membership flag (which is computed post-cache). */
type EnrichedBook = Omit<BookDiscoveryBook, "alreadyInLibrary">;

async function enrichEntries(entries: RankedEntry[]): Promise<EnrichedBook[]> {
  const provider = await getBookMetadataProvider();
  const out: EnrichedBook[] = new Array(entries.length);

  const worker = async (start: number) => {
    for (let i = start; i < entries.length; i += ENRICH_CONCURRENCY) {
      const e = entries[i];
      let volumeId: string | null = null;
      let author = e.author;
      let overview = e.overview;
      let publishedYear: number | null = null;
      let coverUrl = e.coverUrl;
      if (provider && e.isbn13) {
        // resolveIsbn is individually cached (24h); a failure here degrades the
        // single card, never the whole shelf.
        const meta = await provider.resolveIsbn(e.isbn13).catch(() => null);
        if (meta) {
          volumeId = meta.volumeId;
          author = author ?? (meta.authors[0] ?? null);
          overview = overview ?? meta.overview;
          publishedYear = meta.publishedYear;
          coverUrl = coverUrl ?? meta.coverUrl;
        }
      }
      out[i] = {
        rank: e.rank,
        title: e.title,
        isbn13: e.isbn13,
        coverUrl,
        sourceUrl: e.sourceUrl,
        author,
        overview,
        publishedYear,
        volumeId,
      };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, entries.length) }, (_, k) =>
      worker(k),
    ),
  );
  return out;
}

async function membershipFlags(
  items: EnrichedBook[],
): Promise<Set<string>> {
  const isbns = items
    .map((i) => i.isbn13)
    .filter((v): v is string => v != null);
  if (isbns.length === 0) return new Set();
  const rows = await prisma.libraryBook.findMany({
    where: { isbn13: { in: isbns } },
    select: { isbn13: true },
  });
  return new Set(
    rows.map((r) => r.isbn13).filter((v): v is string => v != null),
  );
}

export async function getDiscovery(
  sourceId: string,
  listId: string,
): Promise<{ source: string; list: string; items: BookDiscoveryBook[] }> {
  const source = getDiscoverySource(sourceId);
  if (!source) throw new Error(`unknown discovery source: ${sourceId}`);

  const cacheKey = `books:discovery:enriched:${source.id}:${listId}`;
  let enriched = await getJsonCache<EnrichedBook[]>(cacheKey);
  if (!enriched) {
    const entries = await source.fetch(listId);
    enriched = await enrichEntries(entries);
    if (enriched.length > 0) await setJsonCache(cacheKey, enriched, ENRICHED_TTL);
  }

  const inLibrary = await membershipFlags(enriched);
  const items: BookDiscoveryBook[] = enriched.map((b) => ({
    ...b,
    alreadyInLibrary: b.isbn13 != null && inLibrary.has(b.isbn13),
  }));
  return { source: source.id, list: listId, items };
}

export async function getConfiguredSources(): Promise<BookDiscoverySourcesResponse> {
  const sources: BookDiscoverySourcesResponse["sources"] = [];
  for (const s of listDiscoverySources()) {
    if (!(await s.isConfigured())) continue;
    sources.push({ id: s.id, label: s.label, lists: await s.lists() });
  }
  return { sources };
}
```

> **Verify before implementing:** the library book table/column names (`prisma.libraryBook.findMany` / `isbn13`) — confirm against `apps/api/prisma/schema.prisma`. If books are stored under a different model (e.g. `book`) or the ISBN column differs, adjust the query and the membership set accordingly. The rest of the logic is unaffected.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && NODE_ENV=test bun test src/services/books/bookDiscovery.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/bookDiscovery.ts apps/api/src/services/books/bookDiscovery.test.ts
git commit -m "feat(api): enrich + cache + membership for book discovery"
```

---

### Task 5: Discovery routes

**Files:**
- Create: `apps/api/src/routes/books/bookDiscoveryRoutes.ts`
- Modify: the books router index (the file that `app.route()`s `bookListRoutes` — follow that mount exactly, guarded by `requireUser`).
- Test: `apps/api/test/bookDiscoveryRoutes.test.ts` (mirror the existing route-test harness, e.g. `googleBooksIntegrationRoutes.test.ts`).

**Interfaces:**
- Consumes: `getDiscovery`, `getConfiguredSources` (Task 4); `requireUser` middleware; error helpers from `@rawkoon/api/errors`; `BookProviderUnavailableError`.
- Produces: `GET /api/books/discovery/sources` → `BookDiscoverySourcesResponse`; `GET /api/books/discovery?source=&list=` → `BookDiscoveryResponse`.

- [ ] **Step 1: Write the failing test** (dispatch in-process like the existing book route tests; mock `bookDiscovery`)

```ts
import { describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/services/books/bookDiscovery", () => ({
  getConfiguredSources: async () => ({
    sources: [{ id: "leslibraires", label: "Palmarès Québec", lists: [{ id: "general", label: "Palmarès" }] }],
  }),
  getDiscovery: async (source: string, list: string) => ({
    source,
    list,
    items: [
      {
        rank: 1,
        title: "A",
        isbn13: "9780000000001",
        coverUrl: null,
        sourceUrl: null,
        author: null,
        overview: null,
        publishedYear: null,
        volumeId: null,
        alreadyInLibrary: false,
      },
    ],
  }),
}));

// Build the app / router as the sibling route tests do, with an authenticated user.
// Then:

describe("book discovery routes", () => {
  it("GET /discovery/sources returns configured sources", async () => {
    const res = await app.request("/api/books/discovery/sources", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources[0].id).toBe("leslibraires");
  });

  it("GET /discovery returns items, defaulting source+list", async () => {
    const res = await app.request("/api/books/discovery", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("leslibraires");
    expect(body.list).toBe("general");
    expect(body.items).toHaveLength(1);
  });

  it("401 without a session", async () => {
    const res = await app.request("/api/books/discovery");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && NODE_ENV=test bun test test/bookDiscoveryRoutes.test.ts`
Expected: FAIL (routes not mounted)

- [ ] **Step 3: Implement `bookDiscoveryRoutes.ts`**

```ts
import { Hono } from "hono";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { badRequest } from "@rawkoon/api/errors";
import {
  getConfiguredSources,
  getDiscovery,
} from "@rawkoon/api/services/books/bookDiscovery";
import { getDiscoverySource } from "@rawkoon/api/services/books/discoverySources";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books/types";

export const bookDiscoveryRoutes = new Hono();

bookDiscoveryRoutes.use("*", requireUser);

bookDiscoveryRoutes.get("/discovery/sources", async (c) => {
  return c.json(await getConfiguredSources());
});

bookDiscoveryRoutes.get("/discovery", async (c) => {
  const source = c.req.query("source") || "leslibraires";
  const list = c.req.query("list") || "general";
  if (!getDiscoverySource(source)) return badRequest("Unknown discovery source");
  try {
    return c.json(await getDiscovery(source, list));
  } catch (e) {
    if (e instanceof BookProviderUnavailableError) {
      return c.json({ error: "Discovery source unavailable" }, 503);
    }
    throw e;
  }
});
```

> **Verify:** the exact `requireUser` import path and the router-mount idiom against `bookListRoutes.ts` and the books router index. Mount `bookDiscoveryRoutes` on the same books instance so the paths resolve under `/api/books`.

- [ ] **Step 4: Mount the router** in the books index next to the other `.route()` calls (match order/guards of `bookListRoutes`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && NODE_ENV=test bun test test/bookDiscoveryRoutes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Full api suite (flaky-order guard)**

Run: `cd apps/api && NODE_ENV=test bun test`
Expected: PASS (compare to main if any pre-existing flake appears)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/books/bookDiscoveryRoutes.ts apps/api/src/routes/books apps/api/test/bookDiscoveryRoutes.test.ts
git commit -m "feat(api): book discovery routes"
```

---

### Task 6: NYT integration config routes + web/shared response types

**Files:**
- Create: `apps/api/src/routes/integrations/…` NYT config + test routes (mirror the googlebooks integration routes and `apps/api/test/googleBooksIntegrationRoutes.test.ts`).
- Modify: shared types — add `NytBooksIntegrationResponse`, `NytBooksIntegrationUpdateResponse`, `NytBooksTestResponse` mirroring the `GoogleBooks*` ones.
- Modify: the integrations router index to mount them.
- Test: `apps/api/test/nytBooksIntegrationRoutes.test.ts`.

**Interfaces:**
- Produces: `GET/PUT /api/integrations/nyt`, `POST /api/integrations/nyt/test`. PUT body `{ api_key: string; enabled: boolean }`; GET returns `{ integration: { enabled, has_api_key } }` (match the googlebooks response shape exactly). Test POST body `{ api_key?: string }` → `{ success: boolean; error?: string }`, verifying the key against `GET /svc/books/v3/lists/names.json`.

- [ ] **Step 1–5:** Copy the googlebooks integration route module, its test, and its shared response types; rename `googlebooks` → `nyt`, `GoogleBooks` → `NytBooks`; swap the normalizer to `normalizeNytBooksConfig`; swap the test-connection call to hit the NYT names endpoint. Call `invalidateIntegrationConfigCache("nyt")` after a successful PUT. Run the new test to PASS, then commit.

```bash
git commit -m "feat(api): NYT Books integration config + test routes"
```

---

## Phase B — Web

### Task 7: Web endpoints, query keys, hooks

**Files:**
- Modify: `apps/web/src/lib/endpoints/books.ts` — add `DISCOVERY` and `DISCOVERY_SOURCES`.
- Modify: `apps/web/src/lib/endpoints/index.ts` — add `INTEGRATION_ENDPOINTS.NYT_BOOKS` + `NYT_BOOKS_TEST`.
- Modify: `apps/web/src/lib/queryKeys.ts` — `books.discovery(source, list)`, `books.discoverySources()`, `integrations.nytBooks()`.
- Create: `apps/web/src/pages/books/_hooks/useBookDiscovery.ts`.
- Create: `apps/web/src/pages/settings/useNytBooksIntegration.ts` (copy `useGoogleBooksIntegration.ts`, rename).

**Interfaces:**
- Produces: `useBookDiscoverySources()`, `useBookDiscovery(source: string, list: string)`; plus the NYT integration hooks mirroring the Google Books ones.

- [ ] **Step 1: Add endpoints + keys**

`endpoints/books.ts`:
```ts
DISCOVERY: `${BOOKS_BASE}/discovery`,
DISCOVERY_SOURCES: `${BOOKS_BASE}/discovery/sources`,
```
(Use the module's existing base-path constant.)

`queryKeys.ts` under `books`:
```ts
discoverySources: () => [...books.all, "discovery", "sources"] as const,
discovery: (source: string, list: string) =>
  [...books.all, "discovery", source, list] as const,
```

- [ ] **Step 2: Write the hooks** (`useBookDiscovery.ts`)

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints/books";
import type {
  BookDiscoveryResponse,
  BookDiscoverySourcesResponse,
} from "@rawkoon/shared/types";

export function useBookDiscoverySources() {
  return useQuery({
    queryKey: queryKeys.books.discoverySources(),
    queryFn: () =>
      fetchApi<BookDiscoverySourcesResponse>(BOOKS_ENDPOINTS.DISCOVERY_SOURCES),
    staleTime: 60 * 60 * 1000,
  });
}

export function useBookDiscovery(source: string, list: string) {
  return useQuery({
    queryKey: queryKeys.books.discovery(source, list),
    queryFn: () =>
      fetchApi<BookDiscoveryResponse>(
        `${BOOKS_ENDPOINTS.DISCOVERY}?source=${encodeURIComponent(source)}&list=${encodeURIComponent(list)}`,
      ),
    staleTime: 30 * 60 * 1000,
  });
}
```
(Match the exact `fetchApi` import path used by `useBooks.ts`.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib apps/web/src/pages/books/_hooks/useBookDiscovery.ts apps/web/src/pages/settings/useNytBooksIntegration.ts
git commit -m "feat(web): book discovery + NYT integration hooks"
```

---

### Task 8: Web Explore page (grid + toggles)

**Files:**
- Create: `apps/web/src/pages/books/explore/index.tsx` (TanStack route → `/books/explore`, renders `BooksExplorePage`).
- Create: `apps/web/src/pages/books/explore/BooksExplorePage.tsx`
- Create: `apps/web/src/pages/books/explore/DiscoveryBookCard.tsx`
- Test: `apps/web/src/pages/books/explore/BooksExplorePage.test.tsx`

**Interfaces:**
- Consumes: `useBookDiscoverySources`, `useBookDiscovery` (Task 7); `PageLayout`, `PageHeader`.
- Produces: `BooksExplorePage` component; `DiscoveryBookCard({ book, onOpen })`.

- [ ] **Step 1: Write the failing test** (render with a mocked hook; assert source toggle shows only configured sources, cards render, in-library badge appears)

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BooksExplorePage } from "./BooksExplorePage";

vi.mock("@/pages/books/_hooks/useBookDiscovery", () => ({
  useBookDiscoverySources: () => ({
    data: { sources: [{ id: "leslibraires", label: "Palmarès Québec", lists: [{ id: "general", label: "Palmarès" }] }] },
    isLoading: false,
  }),
  useBookDiscovery: () => ({
    data: {
      source: "leslibraires",
      list: "general",
      items: [
        { rank: 1, title: "Livre A", isbn13: "9780000000001", coverUrl: null, sourceUrl: null, author: "Auteur", overview: null, publishedYear: 2026, volumeId: "v1", alreadyInLibrary: true },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

describe("BooksExplorePage", () => {
  it("renders the source toggle and ranked cards with an in-library badge", () => {
    render(<BooksExplorePage />);
    expect(screen.getByText("Palmarès Québec")).toBeInTheDocument();
    expect(screen.getByText("Livre A")).toBeInTheDocument();
    expect(screen.getByText(/library|bibliothèque/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/pages/books/explore/BooksExplorePage.test.tsx`
Expected: FAIL (component missing)

> Note: this shell exports `NODE_ENV=production`, which breaks `React.act`; always run web tests with `env -u NODE_ENV`.

- [ ] **Step 3: Implement `DiscoveryBookCard.tsx` and `BooksExplorePage.tsx`**

`BooksExplorePage.tsx` — state for `source`/`list` (default first configured source + its first list), two pill toggle rows (source, then the selected source's lists), a responsive grid of `DiscoveryBookCard`, and a `DiscoveryBookSheet` (Task 9) opened on card click. Use `PageLayout` + `PageHeader` (icon `Compass`/`Trophy`, `t("books.explore.pageTitle")`). Reuse the pill styling from `BooksPage` kind filter. Handle `isLoading` (skeleton grid) and `isError` (retry message). i18n via `useTranslation("common")`.

`DiscoveryBookCard.tsx` — cover (fallback block when `coverUrl` is null, like `BookDetailPage`'s coverless treatment), a rank badge, title, author line, and an in-library badge when `book.alreadyInLibrary`. `onOpen(book)` on click.

- [ ] **Step 4: Add i18n keys** to `apps/web/src/locales/{en,fr}/common.json`: `books.explore.pageTitle`, `books.explore.pageSubtitle`, `books.explore.inLibrary`, `books.explore.empty`, `books.explore.error`, `books.explore.retry`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/pages/books/explore/BooksExplorePage.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/books/explore apps/web/src/locales
git commit -m "feat(web): books Explore page with source/list toggles"
```

---

### Task 9: Web detail sheet + add flow + entry link

**Files:**
- Create: `apps/web/src/pages/books/explore/DiscoveryBookSheet.tsx`
- Modify: `apps/web/src/pages/books/explore/BooksExplorePage.tsx` (wire the sheet)
- Modify: `apps/web/src/pages/books/_component/BooksPage.tsx` (add the Explore link beside "Authors")
- Test: `apps/web/src/pages/books/explore/DiscoveryBookSheet.test.tsx`

**Interfaces:**
- Consumes: `useAddBook` from `@/pages/books/_hooks/useBooks` (mutation over `AddBookRequest`); `providerHtmlParagraphs` (same helper `BookDetailPage` uses); a Radix dialog/sheet primitive already used in the app.
- Produces: `DiscoveryBookSheet({ book, open, onClose })`.

- [ ] **Step 1: Write the failing test** — open sheet, click "Ajouter", assert `useAddBook.mutate` called with the volumeId; when `volumeId` is null, the Add button is absent and the external link shows.

```tsx
// mock useAddBook to capture mutate; render sheet with a book having volumeId,
// click add, expect the captured payload to reference the volumeId.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/pages/books/explore/DiscoveryBookSheet.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `DiscoveryBookSheet.tsx`**

Modal sheet: cover, title, author, year, synopsis via `providerHtmlParagraphs(book.overview)`, an external link (`book.sourceUrl`, label depends on host — leslibraires vs nytimes/amazon), and, when `book.volumeId`, an **Ajouter** button calling `useAddBook().mutate` with the add request built from the volumeId (match the exact `AddBookRequest` shape used by `AddBookDialog.tsx`). On success show "Dans la bibliothèque" + a `Link` to `/books` (or the created book when the response carries an id). Hide Add when `volumeId` is null.

> **Verify:** `AddBookRequest` field names in `AddBookDialog.tsx` — build the payload identically (volumeId + any kind defaults it sends).

- [ ] **Step 4: Wire the sheet in `BooksExplorePage`** and add the entry `Link` in `BooksPage` header (mirror the existing "Authors" `Link`, `to="/books/explore"`, icon `Compass`, label `t("books.explore.link")`; add that key to locales).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/pages/books/explore`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/books
git commit -m "feat(web): discovery detail sheet + add-to-library + Explore entry"
```

---

### Task 10: NYT settings section (web)

**Files:**
- Modify: `apps/web/src/pages/settings/_component/BooksSettingsTab.tsx` — add an "NYT Books" card beside Google Books, using `useNytBooksIntegration`/`useUpdate…`/`useTest…` (Task 7).

- [ ] **Step 1:** Add the card (API-key secret field, Save, Test connection), copying the Google Books card's markup and swapping the hooks + labels. i18n keys under `settings.integrations.nyt.*`.
- [ ] **Step 2: Typecheck + the settings tab test if one exists.**

Run: `cd apps/web && bun run typecheck && env -u NODE_ENV bunx vitest run src/pages/settings`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/settings apps/web/src/locales
git commit -m "feat(web): NYT Books integration settings"
```

- [ ] **Step 4: Full web gates**

Run: `cd /home/samuelloranger/sites/rawkoon && bun run lint && bun run typecheck && bun run build && env -u NODE_ENV bun run --filter @rawkoon/web test`
Expected: PASS

---

## Phase C — iOS

> All iOS verification is on macbuild via an isolated worktree at the current commit (never `git pull` its diverged main). Linux only builds RawkoonKit.

### Task 11: iOS models + APIClient methods

**Files:**
- Modify: `apps/ios/Rawkoon/Models.swift` — add `BookDiscoveryBook`, `BookDiscoveryList`, `BookDiscoveryResponse`, `BookDiscoverySourcesResponse` (Codable, matching the snake_case JSON via `.convertFromSnakeCase`); NYT integration DTOs (`SaveNytBooksBody`, `NytBooksTestBody`, response structs) mirroring `SaveGoogleBooksBody`/`GoogleBooksTestBody`.
- Modify: `apps/ios/Rawkoon/APIClient.swift` — `bookDiscovery(source:list:)` and `bookDiscoverySources()`.
- Modify: `apps/ios/Rawkoon/APIClient+Settings.swift` — `nytBooksIntegration()`, `updateNytBooksIntegration(_:)`, `testNytBooks(_:)` (mirror the Google Books methods).

**Interfaces:**
- Produces the Swift DTOs and client methods consumed by Task 12–13.

- [ ] **Step 1:** Add the DTOs and methods, copying the shapes/paths from the Google Books equivalents and the discovery JSON contract. Paths: `GET api/books/discovery?source=&list=`, `GET api/books/discovery/sources`, `GET/PUT api/integrations/nyt`, `POST api/integrations/nyt/test`.
- [ ] **Step 2: Build RawkoonKit on Linux** (fast compile check of the package portion).

Run: `cd apps/ios && swift build` (RawkoonKit only) — Expected: builds. (App target is verified on macbuild in Task 13.)

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Rawkoon/Models.swift apps/ios/Rawkoon/APIClient.swift apps/ios/Rawkoon/APIClient+Settings.swift
git commit -m "feat(ios): book discovery + NYT integration client"
```

---

### Task 12: iOS Explore views

**Files:**
- Create: `apps/ios/Rawkoon/Views/Discover/BookDiscoveryView.swift`
- Create: `apps/ios/Rawkoon/Views/Discover/DiscoveryBookDetailView.swift`
- Modify: the Books list screen — add a toolbar button opening `BookDiscoveryView`.
- Modify: `apps/ios/Rawkoon/Localizable.xcstrings` — new keys.

**Interfaces:**
- Consumes: `APIClient.bookDiscovery`, `bookDiscoverySources` (Task 11); `CachedAsyncImage`, `Theme` (as `ExploreView` uses).

- [ ] **Step 1:** Build `BookDiscoveryView` mirroring `ExploreView`: source picker + list picker (segmented, from `bookDiscoverySources()`), `LazyVGrid` poster grid (`CachedAsyncImage`, rank overlay, in-library badge), pull-to-refresh, and the same error-banner pattern `ExploreView` uses. Tapping a poster pushes `DiscoveryBookDetailView`.
- [ ] **Step 2:** Build `DiscoveryBookDetailView`: cover, title, author, year, synopsis, external buy link, and an **Add** button (calls the existing book-add API path with the `volumeId`; hidden when nil). Already-in-library books show a badge and route to the existing book detail.
- [ ] **Step 3:** Add the entry toolbar button on the Books list screen.
- [ ] **Step 4:** Add every new user-facing string to `Localizable.xcstrings` (interpolated → `%@`/`%lld`).

Run: `cd apps/ios && python3 scripts/check-l10n.py`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/Views apps/ios/Rawkoon/Localizable.xcstrings
git commit -m "feat(ios): books Explore views"
```

---

### Task 13: iOS NYT settings + macbuild verification

**Files:**
- Modify: `apps/ios/Rawkoon/Views/Settings/integrations/BooksProviderView.swift` — add an "NYT Books" `Section` mirroring the Google Books one (secret field, Test, Save), wired to the Task 11 methods.

- [ ] **Step 1:** Add the NYT section + its `load()`/`saveNyt()`/`testNyt()` methods (copy the `googleBooks` trio). Add strings to `Localizable.xcstrings`.
- [ ] **Step 2: l10n gate**

Run: `cd apps/ios && python3 scripts/check-l10n.py`
Expected: `ok`

- [ ] **Step 3: swiftformat**

Run: `cd apps/ios && swiftformat . --lint` (fix any `docComments`/formatting; run without `--lint` to auto-fix)
Expected: no violations

- [ ] **Step 4: macbuild build (the real gate)** — sync the working tree to an isolated worktree at HEAD on macbuild, `xcodegen generate`, build the app scheme. Expected: `** BUILD SUCCEEDED **`. Remove the worktree after.

- [ ] **Step 5: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): NYT Books integration settings"
```

---

## Finalization

- [ ] **Full monorepo gates**

Run: `cd /home/samuelloranger/sites/rawkoon && bun run formatCheck && bun run lint && bun run typecheck && bun run test && bun run build`
Expected: PASS. Also run the api suite once more (`cd apps/api && NODE_ENV=test bun test`) for order-flake, and `bun run knip` to confirm the earlier "unused export" warnings for the scraper are gone now that consumers exist.

- [ ] **Open the PR** — title describing the general capability ("Add a books Explore surface with pluggable bestseller sources"); body summarizes the source abstraction, the two sources, enrichment/caching, and the settings addition. No instance-specific data. Push `feat/books-discovery-explore`, open PR against `main`. Do NOT release.

---

## Self-review notes (against the spec)

- Spec §"Server: the source abstraction" → Tasks 2–3. §"API" (both endpoints, caching, degrade) → Tasks 4–5. §"Shared types" → Task 1. §NYT config → Tasks 3, 6, 10, 13. §Web → Tasks 7–10. §iOS → Tasks 11–13. §Testing → tests in each task + finalization.
- Membership computed post-cache (spec) → Task 4 `getDiscovery` reads cache then `membershipFlags`.
- Source-field precedence over enrichment (spec) → Task 4 `author = author ?? …`, covered by a test.
- Degrade paths (NYT absent from `/sources`, per-ISBN failure, empty uncached, 503 on source failure) → Tasks 4–5, tested.
- Open verification points flagged inline (library model/column names; `requireUser` path + books router mount idiom; `AddBookRequest` shape) — resolve against the codebase during the relevant task, not by guessing.
