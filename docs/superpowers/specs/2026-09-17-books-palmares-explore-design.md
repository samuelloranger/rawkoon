# Books Discovery (Explore) — Design

**Date:** 2026-09-17
**Status:** Approved (design gate passed)

## Problem

Movies and TV have an Explore surface backed by TMDB (trending/popular shelves +
a filterable Discover grid). Books have no discovery surface — the Books page
lists only what is already in the library. Google Books, the book metadata
source, has no popularity or bestseller ranking, so there is no built-in "what's
popular" signal to build a shelf from.

Two external sources fill that gap, both ranked bestseller lists:

- **leslibraires.ca Palmarès** (Gaspard) — weekly most-sold francophone books in
  the Québec independent-bookstore co-op. Scraped (source already shipped:
  `leslibrairesPalmares.ts`).
- **NYT Books Bestsellers** — weekly US/English bestseller lists via the NYT
  Books API. Real sales ranks, official API, free key.

This design turns those ranked lists into a books Explore surface on web and
iOS, behind a **pluggable discovery-source abstraction** so more sources can be
added later without touching the clients.

## Decisions (locked)

- **Placement:** a dedicated Books Explore page/screen, reached from a link on
  the Books page.
- **Two sources, toggled in the UI:** leslibraires Palmarès (QC francophone) and
  NYT Bestsellers (US/English). A source exposes one or more *lists* (themes for
  leslibraires; NYT list slugs).
- **Enrichment:** enrich each list entry by ISBN through the existing provider
  chain (`resolveIsbn`) to obtain a `volumeId` (needed for in-app Add) and to
  fill any missing synopsis/author. NYT already returns cover, author and
  description; leslibraires does not, so enrichment matters more there.
- **Tap action:** a read-only detail (cover, synopsis, buy link) with an
  "Add to library" action.
- **Detail presentation (web):** a modal sheet, not a dedicated route.
- **Google Books is NOT a source.** It has no sales data; a Google "bestseller"
  would be fabricated. NYT provides the real English-language ranks instead.

## Non-goals (YAGNI)

- No genre/sort/provider filters — each list is a fixed ranked list; the only
  controls are the source toggle and the list toggle.
- No pagination — lists are ~15–20 items.
- No new library-detail view — books already in the library keep
  `BookDetailPage` (`/books/:id`). Only the *not-in-library* detail sheet is new.

## Architecture

```
BookDiscoverySource (interface)
  ├─ leslibrairesSource   getPalmares(theme)          [scraper shipped]
  └─ nytSource            NYT Books API (needs key)   [new]
        │  each yields RankedEntry { rank, title, isbn13, coverUrl?, sourceUrl,
        │                            author?, overview? }
        ▼
GET /api/books/discovery?source=…&list=…   [new: enrich + cache]
GET /api/books/discovery/sources           [new: which sources/lists are usable]
        │  resolveIsbn per entry → volumeId + synopsis/author fallback
        │  library membership lookup
        ▼
BookDiscoveryResponse (shared type)
        ├──────────► web /books/explore   [new page + detail sheet]
        └──────────► iOS Books Explore     [new screen + detail view]
```

Each layer has one job: a source produces a ranked list, the route enriches and
caches, the clients render. Clients never call a source or the provider directly.

## Server: the source abstraction

```ts
interface RankedEntry {
  rank: number;
  title: string;
  isbn13: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;     // external product/list page
  author: string | null;        // when the source supplies it (NYT does)
  overview: string | null;      // when the source supplies it (NYT does)
}

interface BookDiscoveryList { id: string; label: string }

interface BookDiscoverySource {
  id: "leslibraires" | "nyt";
  label: string;
  isConfigured(): Promise<boolean>;   // NYT needs an API key
  lists(): Promise<BookDiscoveryList[]>;
  fetch(listId: string): Promise<RankedEntry[]>;
}
```

- `leslibrairesSource`: `isConfigured` always true; `lists()` →
  `general`, `jeunesse`; `fetch` wraps `getPalmares` and maps to `RankedEntry`
  (author/overview null → filled by enrichment).
- `nytSource`: `isConfigured` = NYT key present; `lists()` from the NYT
  `lists/names.json` (cached long) trimmed to a sensible default set (fiction,
  nonfiction, combined print & e-book, young adult); `fetch` calls
  `lists/current/{list}.json` and maps `rank`, `title`, `author`,
  `primary_isbn13`, `book_image`, `amazon_product_url`.

A small registry maps `source` id → instance. Adding a source later is one file
plus a registry line; no client or route change.

### NYT client

New `apps/api/src/services/books/nytBooksSource.ts`:

- Endpoints: `https://api.nytimes.com/svc/books/v3/lists/names.json` and
  `…/lists/current/{list}.json`, `api-key` query param.
- Retry/backoff + `BookProviderUnavailableError` like `googleBooksProvider`.
- Rate limit is tight (~5/min, ~500–1000/day, shared across NYT APIs), so the
  names list is cached ~24h and each current list is cached 12h (below).

### NYT configuration

Mirror the existing Google Books integration config:

- Integration config row `nyt` holding `{ api_key }`, read via
  `getIntegrationConfigRecord("nyt")`, `enabled` gate — exactly like
  `googlebooks`.
- Web + iOS settings gain an "NYT Books" section next to Google Books
  (`BooksProviderView` / `putGoogleBooks` / `SaveGoogleBooksBody` are the
  templates to follow), with save + test-connection.

## API

### `GET /api/books/discovery/sources`

Returns the sources that are usable right now and their lists, so the UI only
shows a toggle for a configured source.

```ts
interface BookDiscoverySourcesResponse {
  sources: {
    id: "leslibraires" | "nyt";
    label: string;
    lists: BookDiscoveryList[];
  }[];
}
```

leslibraires is always present; NYT appears only when its key is set.

### `GET /api/books/discovery?source=…&list=…`

`requireUser`. Defaults: `source=leslibraires`, `list=general`.

1. Resolve the source from the registry; 400 on unknown/unconfigured source.
2. `source.fetch(list)` → ranked entries (each source has its own scrape/API
   cache underneath).
3. Enrich: for each entry with an ISBN, `resolveIsbn(isbn13)` for `volumeId` and
   to fill missing `author`/`overview`. Bounded concurrency (~5). Source-supplied
   fields win when present (NYT's own cover/author/description are kept).
4. Library membership: one query mapping ISBNs/volumeIds → `alreadyInLibrary`.
5. Merge into `BookDiscoveryBook[]`.

### Caching

- **Enriched** list cached in Valkey per source+list:
  `books:discovery:{source}:{list}` for 12h, so the ISBN lookups run once per
  window. `alreadyInLibrary` is computed *after* the cache read (membership
  changes faster than the shelf), so the cached value omits that flag.
- NYT names list cached ~24h; the scraper keeps its own 12h cache.

### Degrade path

- NYT key missing → NYT simply absent from `/sources`; the page shows
  leslibraires only.
- Source fetch fails (`BookProviderUnavailableError`) → 503 with the standard
  error shape; client shows a retry state.
- A single ISBN fails to enrich → keep the source-supplied card
  (`volumeId: null`); its detail sheet falls back to the external buy link and
  hides the in-app Add. The shelf never breaks.
- Empty enriched result is not cached.

## Shared types (`@rawkoon/shared/types`)

```ts
export interface BookDiscoveryBook {
  rank: number;
  title: string;
  isbn13: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  author: string | null;
  overview: string | null;
  publishedYear: number | null;
  volumeId: string | null;        // present when enriched → enables in-app Add
  alreadyInLibrary: boolean;
}

export interface BookDiscoveryList { id: string; label: string }

export interface BookDiscoveryResponse {
  source: "leslibraires" | "nyt";
  list: string;
  items: BookDiscoveryBook[];
}

export interface BookDiscoverySourcesResponse {
  sources: {
    id: "leslibraires" | "nyt";
    label: string;
    lists: BookDiscoveryList[];
  }[];
}
```

## Web

### Route and entry point

- New route folder `apps/web/src/pages/books/explore/` → `/books/explore`.
- Entry: a "Palmarès" / "Explore" link in the `BooksPage` header, beside the
  existing "Authors" link.

### Components

- `BooksExplorePage`: `PageLayout` + `PageHeader` + a **source toggle**
  (Palmarès QC | NYT Bestsellers — only configured sources shown) + a **list
  toggle** whose options come from the selected source + a ranked responsive
  cover grid. Toggle pattern reuses the Books kind-filter pills.
- Cover card: cover, rank badge, title, author line, "in library" badge when
  `alreadyInLibrary`.
- `DiscoveryBookSheet`: modal sheet — cover, synopsis (sanitized via
  `providerHtmlParagraphs`), year, an external buy link
  ("Voir sur leslibraires" / "Voir sur nytimes.com"), and an **Ajouter** button.
  - Add uses `useAddBook` with `volumeId`; on success shows "Dans la
    bibliothèque" and links to `/books/:id`.
  - `volumeId` null → Add hidden, only the external link shows.

### Data

- `useBookDiscoverySources()` and `useBookDiscovery(source, list)` hooks.
- Endpoint constants in `apps/web/src/lib/endpoints/books.ts`.
- Query keys in `queryKeys.books`.
- Selected source/list persisted in URL state (like the Discover page) so a
  reload keeps the view.

## iOS

Mirror the existing `ExploreView` (Discover) structure.

- `BookDiscoveryView`: source picker + list picker (segmented) + `LazyVGrid` of
  poster cards (`CachedAsyncImage`, rank overlay), pull-to-refresh.
- Entry: a toolbar button on the Books list screen.
- `DiscoveryBookDetailView`: cover, synopsis, year, external buy link, Add
  button (existing book-add API path). Already-in-library books show a badge and
  route to the existing book detail.
- `APIClient.bookDiscovery(source, list)` + `APIClient.bookDiscoverySources()`;
  `BookDiscoveryBook` / `BookDiscoveryResponse` / sources types in `Models.swift`
  (`.convertFromSnakeCase`).
- NYT key settings row in the books provider settings view, mirroring the Google
  Books section (`saveGoogleBooks` / `testGoogleBooks` / `SaveGoogleBooksBody`).
- Localization: new strings in `Localizable.xcstrings`, interpolated ones as
  `%@`/`%lld`. Verify `scripts/check-l10n.py` + build on macbuild.

## Error handling

Summarized above per layer: 503 on source failure, per-ISBN degrade, empty
result uncached, client retry/toast states matching existing patterns.

## Testing

- **Scraper:** already covered (`leslibrairesPalmares.test.ts`, 6 tests).
- **NYT source:** unit test the map from the NYT payload to `RankedEntry`
  (fixture), the names-list trim, and the unconfigured/unavailable paths.
- **Discovery route:** enrich merge, source-field precedence over enrichment,
  degrade paths (NYT absent, single-ISBN failure), cache hit, `alreadyInLibrary`
  after cache. `resolveIsbn`, the source fetch, and the library query mocked.
- **Web:** `useBookDiscovery`/sources hooks + `BooksExplorePage` render (source
  toggle shows only configured sources, in-library badge, empty/error states);
  `DiscoveryBookSheet` Add flow.
- **iOS:** RawkoonKit stays pure; extract rank/label formatting into the kit
  only if it earns a unit test; otherwise rely on the macbuild build gate.

## Rollout

Additive — no migration, no dropped setting. Inert until a user opens the
Explore surface. leslibraires works out of the box; NYT appears once its key is
configured. Both degrade to source-supplied cards + external links when
enrichment (Google Books) is unavailable.
