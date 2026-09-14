# Localized display titles and image picker — design

Date: 2026-09-14
Status: approved, pending implementation plan

## Problem

Rawkoon stores and displays every movie/show title in English. `LibraryMedia.title`
is written from TMDB with `language=en-US` (`TMDB_LANGUAGE_LIBRARY_PERSISTENCE`)
and is the only title the UI ever shows. A French-speaking operator running the
French UI still reads "The Godfather" everywhere.

A per-language title pick already exists — `searchTitle` / `searchTitleLanguage`,
resolved by `resolvePreferredSearchTitle` from the quality profile's
`preferredSearchLanguage` and overridable through `LibrarySearchTitleSection`.
It feeds indexer queries only and never reaches the display layer.

Separately, artwork is whatever TMDB returned first. `overrides.poster_url`
exists and is applied by `mapLibraryMedia`, but nothing in the UI writes it, so
changing a poster means editing the database by hand. There is no backdrop
override at all.

## Goals

1. Display titles in the UI's active language, including correct alphabetical
   ordering and text search in that language.
2. Let the operator pick a poster and a backdrop from a grid of candidates,
   filtered by language, sourced from TMDB and fanart.tv.

## Non-goals

Localization is display-only. These keep using the English `title` or the
existing `searchTitle` and are explicitly out of scope:

- indexer queries (`resolveSearchTitles`)
- import filenames and library paths
- notification bodies
- release-name matching (`releaseMatchesExpectedTitles`)

No third image type (logos/clearlogos) in this iteration. No file upload — image
overrides are remote URLs only.

## Decisions taken

- **The UI's i18n language drives the displayed title.** There is no separate
  "display title language" setting. A French UI shows French titles.
- **Titles are stored per language, not resolved at render time.** Postgres
  sorts and text-searches the library list; a client-side resolution would leave
  "Le Parrain" sorting under G and make "Parrain" unfindable.
- **The manual `overrides.title` still wins** over the localized title, matching
  the precedence `mapLibraryMedia` already implements.
- **Image picker covers poster and backdrop**, sourced from TMDB and fanart.tv.

## Phase 1 — Localized display titles

### 1.1 Data model

```prisma
model LibraryMediaTitle {
  mediaId   Int     @map("media_id")
  language  String  // ISO 639-1, lowercase
  title     String
  sortTitle String  @map("sort_title")

  media LibraryMedia @relation(fields: [mediaId], references: [id], onDelete: Cascade)

  @@id([mediaId, language])
  @@index([language, sortTitle], map: "ix_library_media_titles_language_sort_title")
  @@index([title(ops: raw("gin_trgm_ops"))], type: Gin, map: "ix_library_media_titles_title_trgm")
  @@map("library_media_titles")
}
```

`LibraryMedia` gains the matching back-relation field (`titles LibraryMediaTitle[]`).

Stored languages are the locales the web app ships — `en` and `fr` — exported as
`SUPPORTED_TITLE_LANGUAGES` from `@rawkoon/shared/constants` so both sides agree.
Two rows per media. Adding a third locale later is a backfill, not a migration.

Per-language resolution reuses the chain already in `resolvePreferredSearchTitle`:

1. `title_translations[language]`
2. `originalTitle`, when `originalLanguage === language`
3. the English `title`

Step 3 guarantees a row exists for every (media, language) pair, so the read-path
join never misses and no fallback branch is needed in the query.

`sortTitle` is derived by `sortTitleFromName`, which today strips `the|a|an` only.
It gains a language parameter and a French article set (`le|la|les|l'|un|une|des`),
applied according to the row's language.

### 1.2 Write path

English titles are written from five places, and only one of them has
translations in hand:

| Site | Has `title_translations`? |
|---|---|
| `services/libraryFromTmdb.ts` (add/update) | yes — already appended |
| `routes/library/libraryMediaAdmin.ts` (library-scan match) | no |
| `services/jobs/libraryMigrateRadarr.ts` | no |
| `services/jobs/libraryMigrateSonarr.ts` | no |
| `scripts/refreshLibraryTitlesFromTmdb.ts` | no |

(`services/libraryTmdbRefresh.ts` and `services/libraryIntegrityCollectors.ts`
write episodes, status and dates — not titles. They need no change.)

Patching all five is not the design. Instead:

- `libraryFromTmdb` writes title rows inline, from the translations it already
  has. No extra TMDB request.
- A scheduled job, `sync-localized-titles`, fills rows for any media that has
  none and refreshes rows older than the media's `updatedAt`. That covers the
  four sites that create media without translations, without touching them, and
  it is also what keeps rows from going stale after a TMDB retitle.
- The read path uses `COALESCE(t.title, lm.title)` rather than assuming a row
  exists, so a media the job has not reached yet degrades to its English title
  instead of disappearing from the list.

Initial population is the same scheduled job, run once on first boot after the
migration.

### 1.3 Read path

`GET /api/library` and the media detail routes accept a `titleLanguage` query
param, defaulting to `en`.

The paged list path is `prisma.libraryMedia.findMany` with `orderBy` on persisted
columns — deliberately, so pagination stays `skip`/`take` in the database. Prisma
cannot order or filter by a to-many relation's column, so a localized sort cannot
be expressed through `findMany`.

Rather than convert the whole list route to `$queryRaw`, the localized path
resolves **ids only** in raw SQL — LEFT JOIN, `WHERE`, `ORDER BY`, `LIMIT`,
`OFFSET` — and then loads those ids through the existing `findMany` +
`libraryMediaInclude`, restoring the SQL order in memory. Includes and mapping
stay single-sourced; raw SQL is confined to one small function.

`titleLanguage === "en"` keeps the current Prisma path exactly, so the default
install sees no behavior or performance change.

The raw query:

- orders by `COALESCE(t.sort_title, lm.list_title)`
- matches the search term against `t.title OR lm.title`, so an English search
  still works from a French UI — a superset of today's behavior, not a
  replacement

`mapLibraryMedia` takes an optional localized title. Title precedence becomes:

```
overrides.title  →  localized title  →  English title
```

Discover and search need no API change: `services/discover/tmdbProvider` already
takes a `language` and TMDB returns localized titles natively. The work there is
making the web side pass `i18n.language` consistently.

### 1.4 Web

A `useTitleLanguage()` hook normalizes `i18n.language` to `en` or `fr`. Its value
is added to the library and detail entries in `lib/queryKeys.ts` — without that,
switching locale serves cached titles from the previous language. This is the one
change that touches code across the whole web app.

## Phase 2 — Image picker

Phase 2 is additive and independent of Phase 1. Either can ship first.

### 2.1 TMDB source

`utils/medias/tmdbFetcherDetails.ts` already appends `images` and builds
`media_stills { posters, backdrops, logos }` — but that path is wrong for a
picker: `parseImageStills` caps each list at 12, drops `iso_639_1`, and emits
`w342`/`w780` display URLs. Widening it would change the shape of an already
cached, widely consumed response.

The picker gets its own fetcher instead — `services/images/tmdbImageProvider.ts`
calling `GET /3/{movie|tv}/{id}/images?include_image_language=en,fr,null`
uncapped, keeping `iso_639_1`, and emitting both a `w342` thumbnail and an
`original` full URL. `media_stills`, `TmdbImageStill` and the details cache are
untouched.

### 2.2 fanart.tv source

fanart.tv is registered as an integration of type `fanart` holding `{ api_key }`,
following the TMDB pattern (`getIntegrationConfigRecord` + a normalizer in
`utils/integrations/normalizers`). That reuses the existing integrations settings
UI rather than adding an `AppSettings` column.

`services/images/fanartProvider.ts` calls:

- movies: `GET https://webservice.fanart.tv/v3/movies/{tmdbId}`
- shows: `GET https://webservice.fanart.tv/v3/tv/{tvdbId}`

The TV endpoint is keyed by TVDB id, not TMDB id. The id is available from TMDB
`external_ids`, but `parseExternalIds` currently drops it — it gains `tvdb_id`.

Responses are Redis-cached like the TMDB fetches. When no key is configured, or
when a show has no TVDB id, the provider returns an empty list. It never raises:
a missing optional source must not break the picker.

### 2.3 Endpoint

```
GET /api/library/:id/images?kind=poster|backdrop
```

Merges TMDB stills and fanart candidates into one list:

```ts
{ url, thumb_url, width, height, language, vote, source: "tmdb" | "fanart" }[]
```

Ordered by vote descending. The endpoint returns every candidate regardless of
language; the language filter is applied in the UI, so switching it does not
refetch.

### 2.4 Write path

`PATCH /api/library/:id/overrides` already merges arbitrary fields and
`overrides.poster_url` is already applied by `mapLibraryMedia`. The picker writes
through it unchanged.

`backdrop_url` is added to `mapLibraryMedia` the same way. `LibraryItemHero` and
`ExploreCardDetailDialog` currently fall back to `media_stills.backdrops[0]?.url`;
they prefer the override when set.

Clearing a selection sets the field to `null`, which the existing merge logic
already treats as "remove the key".

### 2.5 UI

`LibraryImagePickerSection`, rendered in `LibraryManagementPanel` alongside
`LibrarySearchTitleSection`:

- tabs for Poster and Backdrop
- language filter chips: All, en, fr, no language
- a grid of candidates, each showing its source badge and vote
- the current selection marked
- clicking a candidate writes the override; "Reset to default" clears it

## Testing

- Unit: per-language title and sort-title resolver, covering all three fallback
  steps and French article stripping.
- Unit: fanart response to candidate mapper, including the no-key path and a show
  with no TVDB id.
- Unit: candidate merge and ordering across the two sources.
- Endpoint harness (`apps/api/e2e`): `GET /api/library?titleLanguage=fr` returns
  French titles, orders by the French sort title, and finds a media by a French
  substring.
- Endpoint harness: `GET /api/library/:id/images` with fanart disabled returns
  TMDB candidates only.
- Web: picker renders candidates, the language filter narrows them, and selecting
  one issues the override PATCH.

Run the full `apps/api` suite rather than single files — it is order-dependent
and a single-file pass does not predict CI.

## Risks

- **Stale title rows.** A code path that updates `LibraryMedia.title` without
  updating `library_media_titles` leaves a stale localized title behind. The
  `sync-localized-titles` job is the backstop: it re-resolves any row older than
  its media's `updatedAt`, so staleness self-heals within one job interval rather
  than persisting.
- **Raw SQL in the list path.** The localized branch hand-writes SQL against
  `library_media`. A future column rename there breaks it at runtime, not at
  typecheck. Keeping the branch to id resolution only limits the surface.
- **Query-key cache.** Omitting the language from a query key produces titles from
  the previously active locale with no visible error.
- **fanart.tv availability.** A third-party dependency on the display path. It is
  optional, cached, and failure-tolerant by design, but it is still a new outbound
  call.
