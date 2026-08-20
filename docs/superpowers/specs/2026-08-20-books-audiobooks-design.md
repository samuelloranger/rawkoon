# Books and Audiobooks

**Date:** 2026-08-20
**Status:** Approved design, ready for implementation planning

## Goal

Add books and audiobooks to rawkoon as a first-class media domain with the same
feature surface movies and shows already have: discovery, requests, monitoring,
automatic search, RSS, grabbing, post-process import, quality profiles, and
notifications.

## Decisions

| Decision | Choice |
|---|---|
| Where | Inside rawkoon. Not a separate project. |
| Data model | Own tables. `LibraryMedia` is not modified. |
| Entity shape | One book entity; ebook and audiobook are editions under it. |
| Monitoring | Per edition kind, independently. |
| Metadata | Hardcover primary, Open Library keyless fallback, behind a provider interface. |
| Quality | New `book_quality_profiles` table. |
| Download history | Extend `download_history`, do not fork it. |
| Rollout | `AppSettings.booksEnabled`, default false. |

### Why inside rawkoon, not a separate project

Rawkoon exists to collapse the Radarr/Sonarr/Overseerr stack into one image.
Shipping a second `rawkoon-books` container recreates exactly the sprawl the
product exists to remove, and duplicates the roughly 70% of the codebase that is
already media-agnostic: indexer adapters, download clients, the BullMQ queue,
notifications and channels, better-auth, the requests workflow, the custom-format
scoring engine, Docker/CI/entrypoint, and the entire SPA shell.

Readarr did not die of codebase size. It died of metadata rot, and being a
separate project is what forced it to run and fund its own metadata server.
Inside rawkoon, behind a provider interface, a dead provider is an adapter swap
rather than the end of the project.

### Why own tables rather than generalizing `LibraryMedia`

`LibraryMedia` is keyed `tmdbId Int @unique`. Measured coupling: `tmdbId` appears
208 times across 34 files, 18 of them as unique lookups; `libraryMedia.` appears
97 times across 36 files. The table also carries three hand-written partial
indexes Prisma cannot express and DB triggers maintaining `totalSizeBytes`,
`episodeCount`, `downloadedEpisodeCount`, `seasonCount`, `listTitle`, `listYear`,
and `lastGrabbedAt`.

Generalizing to `(provider, providerId)` would touch every one of those for no
user-visible gain over separate tables, on an application people run in
production. Separate tables avoid that risk; shared plumbing avoids the
duplication a separate project would incur.

## Data model

New tables. `LibraryMedia`, `MediaFile`, and `QualityProfile` are untouched.

```prisma
model LibraryBook {                 // the work — provider-agnostic
  id             Int
  providerSource String            // "hardcover" | "openlibrary"
  providerId     String            // Hardcover book id | OL work key (OL…W)
  altProviderIds Json?             // opportunistic cross-provider ids
  title, sortTitle, subtitle?, overview?, coverUrl?
  authors        String[]          // trigger-maintained cache of BookAuthor
  publishedYear  Int?
  seriesName     String?
  seriesPosition Float?            // Float: "Book 4.5" exists
  originalLanguage String?
  overrides      Json?
  listTitle      String            // trigger-maintained, mirrors LibraryMedia
  listYear       Int?
  addedAt, updatedAt
  @@unique([providerSource, providerId])
  // no status/monitored — those are per-edition
}

model BookEdition {
  id, bookId                       // cascade
  kind    String                   // "ebook" | "audiobook"
  status  String                   // wanted|downloading|downloaded|skipped|upgrading
  monitored Boolean
  bookQualityProfileId Int?
  providerEditionId String?        // Hardcover edition id | OL OL…M
  isbn13?, asin?                   // asin → Audnexus enrichment (future)
  publisher?, language?
  narrators   String[]             // audiobook
  durationSecs Int?                // Hardcover audio_seconds / MediaInfo
  pageCount   Int?                 // ebook
  searchAttempts Int
  lastGrabbedAt DateTime?          // trigger, mirrors LibraryMedia
  totalSizeBytes BigInt?           // trigger
  @@unique([bookId, kind])         // max 2 rows per book
}

model BookFile {
  id, editionId                    // cascade
  filePath, fileName, sizeBytes
  format String                    // epub|mobi|azw3|pdf|cbz | m4b|mp3|flac|ogg
  durationSecs?, audioBitrate?, audioCodec?, chapterCount?
  isRetail Boolean                 // retail vs scan/OCR
  releaseGroup?, languageTags String[]
  fileDev?, fileIno?, fileMtimeMs? // skip-rescan cache, verbatim from MediaFile
  scannedAt
}

model Author {
  id
  providerSource, providerId
  name, sortName
  imageUrl?, bio?
  monitored   Boolean @default(false)
  monitorFrom DateTime?            // only auto-add books published after this
  monitorEditionKinds String[]     // which edition rows to auto-create
  bookQualityProfileId Int?        // default profile for auto-added books
  lastCheckedAt DateTime?
  addedAt, updatedAt
  @@unique([providerSource, providerId])
}

model BookAuthor {
  authorId, bookId
  role String                      // author|narrator|translator|illustrator
  @@unique([authorId, bookId, role])
}

model BookQualityProfile {
  id, name @unique
  kind String                      // "ebook" | "audiobook" | "both"
  allowedFormats String[]          // ordered, first = best
  cutoffFormat String?             // stop upgrading at
  requireRetail, preferRetail Boolean
  maxSizeMb Float?, minSeeders Int
  minAudioBitrate Int?
  preferredLanguages String[], preferredSearchLanguage String?
  prioritizedTrackers String[], preferTrackerOverQuality Boolean
  createdAt, updatedAt
}

model BookQualityProfileCustomFormat {
  bookQualityProfileId, customFormatId
  score Int, required Boolean, forbidden Boolean
  @@unique([bookQualityProfileId, customFormatId])
}
```

### Rationale for the load-bearing choices

**`@@unique([bookId, kind])` — at most two edition rows per book.** Per-edition
monitoring means the user monitors *ebook* and *audiobook* independently. Which
specific ISBN was grabbed is a property of the grab, not a separately monitorable
target. Without this constraint the table degenerates into a mirror of the
provider's edition list — hundreds of rows per book with no clear monitoring
target.

**`BookFile` is a separate table, not nullable columns on `MediaFile`.**
`MediaFile` already carries 25 video-specific columns and a GIN index on
`languageTags`. Merging leaves both halves mostly null and pollutes every
existing file query.

**`isRetail` is a profile field, not only a custom format.** For ebooks it is the
dominant quality axis — a retail epub versus an OCR scan matters more than every
other signal combined.

**`LibraryBook.authors String[]` is kept alongside `BookAuthor`.** It is a
trigger-maintained denormalized cache, the same pattern the schema already uses
for `listTitle`, `totalSizeBytes`, and `episodeCount`. It keeps list queries and
indexer query construction off a join. The trigger populates it from
`BookAuthor` rows with `role = 'author'` only — narrators, translators, and
illustrators are excluded, because this column feeds indexer queries and the
reject filter's author-surname check.

**A `LibraryBook` never exists without at least one `BookEdition`.** Because
`monitored` and `status` live only on editions, a book with no edition rows would
be unreachable by every worker. The add flow therefore always creates at least
one edition; the caller chooses which kinds, defaulting to `ebook` when the
active provider lacks the `audiobookEditions` capability.

**`BookFile.isRetail` is set at import** from `parseBookReleaseTitle`'s
`isRetail` for graded grabs, and defaults to `false` for files discovered by a
library scan, where no release title exists to judge. False therefore means
"unknown or scan", never "confirmed scan".

### `download_history` extension

Add `bookEditionId Int?` with a `SetNull` relation and an index. Add a CHECK
constraint that exactly one of `media_id` and `book_edition_id` is set.

The existing partial unique index is **not modified**. A second, disjoint one is
added:

```sql
-- existing, untouched:
UNIQUE (media_id, COALESCE(episode_id,-1), COALESCE(season,-1))
  WHERE completed_at IS NULL AND failed = false AND media_id IS NOT NULL

-- new:
UNIQUE (book_edition_id)
  WHERE completed_at IS NULL AND failed = false AND book_edition_id IS NOT NULL
```

Because the two predicates are disjoint, `grabRelease`'s existing P2002
race-close keeps working verbatim, and the book grab path inherits the same
one-active-grab-per-target guarantee without new logic.

### Settings

`MediaSettings` gains `booksLibraryPath`, `audiobooksLibraryPath`,
`bookTemplate`, `audiobookTemplate`, `defaultBookQualityProfileId`, and
`activeBookProvider` (mirroring `activeIndexerManager`).

`AppSettings` gains `booksEnabled Boolean @default(false)`.

## Metadata provider layer

```
apps/api/src/services/books/
  types.ts              // interface + capability flags
  factory.ts            // provider resolution
  hardcoverProvider.ts  // GraphQL
  openLibraryProvider.ts
  providerCache.ts
```

Mirrors the shapes of `services/discover/{types,tmdbProvider}.ts` and
`services/indexerManager/factory.ts`.

```ts
interface BookMetadataProvider {
  readonly source: "hardcover" | "openlibrary";
  readonly capabilities: {
    audiobookEditions: boolean;   // hardcover: true, openlibrary: false
    series: boolean;
    authorBibliography: boolean;  // required for author monitoring
    trending: boolean;            // required for the provider-backed deck
  };
  searchBooks(q, opts): Promise<ProviderBook[]>;
  getBook(providerId): Promise<ProviderBookDetail | null>;
  getEditions(providerId): Promise<ProviderEdition[]>;
  searchAuthors(q): Promise<ProviderAuthor[]>;
  getAuthorBooks(authorProviderId, since?): Promise<ProviderBook[]>;
  resolveIsbn(isbn13): Promise<ProviderBook | null>;
}
```

### Provider comparison

| Provider | Model fit | Audiobook data | Key | Notes |
|---|---|---|---|---|
| Hardcover | Book → Editions natively; typed search over Book/Author/Series/Publisher | `audio_seconds`, `narrators`, series position | Free token from account settings | Smaller catalog |
| Open Library | Works → Editions, ISBN lookup, covers CDN | Effectively none | None | 20–30M titles, uneven quality, weak series and author disambiguation. Terms require caching and a descriptive User-Agent. |
| Google Books | Flat volumes | None | Key + quota | Rejected: adds nothing the other two do not cover |
| Audnexus | ASIN-keyed enrichment, not search | Chapters, narrators, series | None (public `audnex.us`, 100 req/min, self-hostable) | Deferred; audiobook edition enrichment, not core |

Requiring a user-supplied Hardcover token has precedent: `.env.example` already
makes `TMDB_API_KEY` a user-supplied optional key.

### Capabilities are declared, not thrown

Open Library genuinely cannot serve audiobook editions, trending, or reliable
author bibliography. The provider therefore advertises what it can do and
consumers degrade: with no Hardcover token, books still work and the
audiobook-edition and author-monitoring surfaces render as "requires a Hardcover
token" rather than erroring. A provider going dark downgrades features; it never
breaks the application.

### Resolution, caching, provider switching

`HARDCOVER_API_TOKEN` is added to the `config.ts` Zod schema as optional.
`factory.ts` returns the Hardcover adapter when the token is present, else Open
Library; `MediaSettings.activeBookProvider` allows an explicit override.

Caching is mandatory, not an optimization: Open Library's terms require caching
and a descriptive User-Agent, and Audnexus caps at 100 requests per minute.
`services/cache.ts` (Redis) is reused. TTLs: search 1h, book detail 24h, author
bibliography 6h. User-Agent: `rawkoon/${APP_VERSION}
(+https://github.com/samuelloranger/rawkoon)`.

A user may start keyless on Open Library and later add a Hardcover token, leaving
existing rows OL-keyed. Rows are never re-keyed destructively. `providerSource`
is per-row, so a library holds mixed rows; an opportunistic
`bookProviderReconcile` job attaches a Hardcover id by ISBN13 match into
`altProviderIds`, adding capability to old rows without a migration that can
silently mismatch books.

Shared types live in `apps/shared/src/types/books.ts`.

## Search, release parsing, grab

**Categories.** `IndexerSearchParams.mediaType` widens to
`"movie" | "tv" | "book" | "audiobook"`. Torznab mapping: book → `7000` (7020
ebook, 7030 comics beneath it), audiobook → `3030`. Both the Prowlarr and Jackett
adapters gain the case.

`prowlarrAdapter.fetchRss` currently hardcodes `categories=2000,5000`. It becomes
derived from the media kinds the install actually uses, so a movies-only install
does not pull book noise into every RSS poll.

**No id-based book search exists.** Torznab offers `tmdbid` and `tvdbid` but no
`isbn` or `bookid`, so every book search is freetext. Query construction and
match rejection are therefore load-bearing:

- Query ladder, mirroring the existing `resolveSearchTitles.ts` translated-title
  pattern: `"{author surname} {title}"` → `"{title}"` →
  `"{title} {preferred format}"`.
- **Mandatory reject filter**: a release must fuzzy-match the title *and* contain
  the author surname or the ISBN. Without it, freetext book search grabs
  unrelated content. This is the single largest correctness risk in the feature.

**Parsing is a new function, not an extension.** `utils/books/bookReleaseParser.ts`
exports `parseBookReleaseTitle()` returning
`{ format, isRetail, isProper, group, language, audioBitrate, narrator }`.

`filenameParser.parseReleaseTitle` is deliberately *not* extended: its regexes
misfire on book titles, reading `M4B` as `MP4` and four-digit years as
resolutions. Two parsers, two test suites, no cross-contamination.

**Scoring.** `utils/books/bookReleaseScorer.ts` exports `scoreBookRelease` and
`scoreBookReleaseDetailed`, paralleling `releaseScorer.ts`. Axes in priority
order: format position within `allowedFormats`, retail versus scan, custom-format
score, tracker priority, size sanity, seeders. `pickBookReleaseForGrab` mirrors
`pickReleaseForGrab.ts`.

**Custom formats reuse the existing engine.** `customFormatTypes.ts` gains book
condition fields (`format`, `retail`, `narrator`, `audioBitrate`);
`customFormatEvaluator.ts` handles them. Same scoring math, same admin UI, no
second engine.

**Grab path.** `services/bookGrabberSearch.ts` and `bookGrabberGrab.ts` parallel
`mediaGrabberSearch`/`mediaGrabberGrab`, writing `download_history` rows carrying
`book_edition_id`.

**Non-goal in this spec: multi-book packs.** An "Author Complete Collection"
torrent cannot map to a single `BookEdition`, so the reject filter drops them.
This follows the same trajectory as season packs, which received a dedicated
`postProcessorSeasonPack` only after single-episode import was solid.

## Import pipeline

**Reused verbatim** (already media-agnostic):
`postProcessorHelpers.resolveTorrentContentPath`,
`placeFile(operation: "hardlink" | "move")`, and
`fileTemplate.sanitizeFilenamePart` / `sanitizePathTemplateOutput`.
`renderBookTemplate` and `renderAudiobookTemplate` join the existing renderers.

**Metadata extraction splits by kind.**

- **Audiobooks reuse `mediainfoScanner`.** MediaInfo handles audio containers, so
  `m4b` and `mp3` yield duration, bitrate, and codec through the existing scanner
  and its `fileDev`/`fileIno`/`fileMtimeMs` skip-rescan cache. No new tooling.
- **Ebooks get `utils/books/ebookMetadata.ts`.** An epub is a zip containing OPF
  XML, so title, author, ISBN, and language are read directly; mobi and azw3 via
  header parse; pdf minimally. MediaInfo is useless here and nothing is forced
  through it.

**Multi-file torrents are the norm for books**, unlike `postProcessorSingle`,
which assumes one video file per grab:

- Ebook grabs commonly ship epub, mobi, azw3, and pdf of the same book. Import
  every present format that appears in the profile's `allowedFormats` as sibling
  `BookFile` rows under the one edition; drop the rest. The edition's displayed
  quality is its best-ranked format.
- Audiobook grabs are often dozens of mp3s plus a cue sheet and cover art. One
  `BookFile` row per audio file; edition-level `durationSecs` and
  `totalSizeBytes` are aggregated by DB trigger, matching how `episodeCount` and
  `totalSizeBytes` already work on `LibraryMedia`.
- Discarded: `.nfo`, `.txt`, `.cue`, samples, and images other than the cover.

**`services/postProcessorBook.ts`** is a third sibling to `postProcessorSingle`
and `postProcessorSeasonPack`. `downloadsAssign` routes on which foreign key the
`download_history` row carries. `markItemDownloaded` gains a parallel
`markEditionDownloaded`.

**Templates.**

```
bookTemplate      {author}/{title} ({year})/{title} ({year}) [{format}]
audiobookTemplate {author}/{title} ({year})/{title}
```

Multi-track audiobooks keep their original filenames inside the rendered
directory. Renaming dozens of tracks risks destroying playback order for
downstream players; the directory is the unit worth controlling, the tracks are
not.

**Rescan, health, upgrades.** `rescanBookEdition` parallels
`rescanLibraryItem`; `libraryIntegrityCollectors` gains book collectors.
`upgradeDetection` gains a book variant keyed on `cutoffFormat` — a retail epub
replacing an OCR scan is the book equivalent of 1080p replacing 720p.

## Discover, requests, notifications

**Requests extend rather than fork**, because an admin approving requests wants a
single queue.

```
media_requests:
  tmdbId  Int?               -- was NOT NULL
  bookId  Int?               -- FK LibraryBook
  type    String             -- "movie"|"show"|"ebook"|"audiobook"
  bookEditionId Int?         -- resolved edition, mirrors libraryMediaId
  bookQualityProfileId Int?

-- drop @@unique([tmdbId, type]); replace with two disjoint partial uniques:
UNIQUE (tmdb_id, type) WHERE tmdb_id IS NOT NULL
UNIQUE (book_id, type)  WHERE book_id IS NOT NULL
-- CHECK: exactly one of tmdb_id / book_id is set
```

`type` carries the edition kind, so no extra discriminator column is needed. The
migration is hand-written because Prisma cannot express partial uniques — an
established pattern in this schema, which already does it three times.

`watchlist_items` and `discover_dismissals` receive the identical treatment:
nullable `tmdbId`, added `bookId`, disjoint partial uniques. Watchlist's
`movieReleaseDate` and `releaseReminderSentFor` reminder mechanism maps onto
publication dates via a parallel `checkBookReleaseReminders` worker reusing the
existing notification plumbing.

**Discover deck.** `services/discover/bookDeck.ts` emits the same card contract
`assembleDeck` produces, so the web deck component is shared. Rows come from
Hardcover trending and lists when that capability is available. Open Library has
no trending, so the keyless fallback deck is "new from your monitored authors"
plus "next in series you already own" — both computed from local data with zero
provider calls, which is the one deck that works with no token at all.

**Notifications** add event types only: `book.grabbed`, `book.downloaded`,
`book.import_failed`, `author.new_release`. `notificationEvents.ts` gains the
definitions; `channelDispatchers` and web push are reused untouched. Strings go
into both `locales/en` and `locales/fr`.

## API surface

Domain routers per the "route composition, not a router file" convention,
`.use()`d in `src/index.ts` after the rate-limit and auth plugins.

```
/api/books                       list + filters + sort   (mirrors /api/library)
/api/books/:id                   detail + editions + files
/api/books/:id/editions/:kind    monitor toggle, profile, status
/api/books/:id/grab              search + grab           (mirrors libraryGrabRoutes)
/api/books/:id/files
/api/books/search                provider search (add flow)
/api/books/discover
/api/authors
/api/authors/search
/api/book-quality-profiles       CRUD
```

`requireUser` throughout; `requireAdmin` on profile CRUD and author monitoring,
matching how quality-profiles is gated today. Errors use the `src/errors.ts`
helpers and are returned, not thrown.

## Web

Pages under `apps/web/src/pages/books/**`, which regenerates the gitignored
`routeTree.gen.ts`. Keys added to `apps/web/src/lib/queryKeys.ts`. List and card
components are shared with the media library where the contract matches; the
detail page is separate, because editions are not seasons and forcing one
component would distort both.

## Rollout and phasing

`AppSettings.booksEnabled` defaults to false, gating nav entries, the added RSS
categories, the author-release scheduled job, and the settings section. A
movies-only install sees no change after upgrading. The flag also lets every
phase merge to `main` independently instead of accumulating on a long-lived
branch.

| Phase | Content | Ships |
|---|---|---|
| 0 | All migrations and triggers; `services/books/*`; `shared/types/books.ts` | Nothing visible; test-verified only |
| 1 | `/api/books` list/detail/add, `/api/books/search`, edition monitor toggle, `/api/book-quality-profiles` CRUD with seeded defaults; web list, detail, add dialog, profile admin | Browse and manually add books; no downloads |
| 2 | Indexer categories; `bookReleaseParser`, `bookReleaseScorer`, `pickBookReleaseForGrab`, reject filter; custom-format book conditions; `bookGrabberSearch`/`bookGrabberGrab`; `download_history` migration and disjoint partial index; interactive search UI | Manual search and grab; files land but are not imported |
| 3 | `postProcessorBook`, `ebookMetadata`, audiobook scanning via `mediainfoScanner`, templates, `markEditionDownloaded`, `rescanBookEdition`, integrity collectors | End to end |
| 4 | Auto-search worker, RSS category wiring, upgrade detection on `cutoffFormat`, `checkAuthorReleases` worker and author monitoring UI, notification events | Hands-off operation |
| 5 | `bookDeck`; watchlist, dismissal, and request migrations plus approval flow; book release reminders | Full parity |

Phase 4 adds entries to both `QUEUE_NAMES` and `SCHEDULED_JOB_NAMES` in
`services/queueService.ts` alongside the handlers in `src/workers/`.

## Testing

- **Provider adapters share one contract suite** that both must pass, driven off
  their `capabilities` flags, with recorded fixtures and no live API calls in CI.
  This is what makes a future provider swap cheap; the insurance against
  Readarr's failure mode is only real if it is tested.
- **`bookReleaseParser` is table-driven**, mirroring the case-array style of
  `releaseTitleParser.test.ts`, with adversarial cases proving the video parser's
  mistakes do not recur: `"Title 1984 [epub]"` yields no resolution, and
  `"Book.M4B"` does not parse as MP4.
- **The reject filter has its own suite** — the highest-risk unit in the feature,
  with positive and negative fixtures drawn from real tracker titles.
- **Migration tests cover the partial uniques**: two concurrent active grabs on
  one edition must raise P2002, and a movie grab must not collide with a book
  grab.
- Existing suites stay green untouched. `LibraryMedia` is not modified, so any
  failure there is an unambiguous regression signal.
- Gates: `bun run typecheck` and `bun run typecheck:native`, biome on
  `apps/web` and `apps/api`, prettier on `apps/shared`.

## Risks

1. **Freetext match quality.** No `isbn` or `bookid` Torznab parameter exists, so
   correctness rests entirely on the reject filter. This is the highest residual
   risk and will need real-world tuning after phase 2; it cannot be fully
   de-risked on paper.
2. **Metadata provider rot** — Readarr's actual cause of death. Reduced, not
   eliminated, by the provider interface, capability flags, contract tests, and
   the keyless Open Library fallback.
3. **The `media_requests` and `watchlist_items` unique-constraint migration** is
   the only place existing tables are structurally altered, and needs a tested
   down path.
4. **Six phases is a large surface**, mitigated by `booksEnabled` permitting
   incremental merges.

## Deferred

- Multi-book and author-collection pack handling.
- Audnexus enrichment for audiobook chapters and ASIN-keyed metadata.
- Comics and manga as a distinct kind, though `cbz` appears in the format list.
- Calibre and Audiobookshelf library integration.
