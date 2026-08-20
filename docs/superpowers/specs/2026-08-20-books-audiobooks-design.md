# Books and Audiobooks

**Date:** 2026-08-20
**Status:** Approved design, validated against live provider and indexer data, ready for implementation planning

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
| Metadata provider | Google Books, keyed. Sole provider. |
| Book identity | One Google Books volume = one `LibraryBook`. No work/translation hierarchy. |
| Editions | `ebook` and `audiobook` only. Publisher printings are not modeled. |
| Monitoring | Per edition kind, independently. |
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
production.

### Why no work/translation hierarchy

A `LibraryBook` is exactly one Google Books volume. A French translation and its
English original are two independent rows, each carrying the title that trackers
actually use.

This was validated against live data (see *Validation*). Modeling one work with
translated editions requires the book's stored title to differ from the title
used to search indexers, which is what the movie side solved with
`LibraryMedia.searchTitle` and `resolveSearchTitles.ts`. For books it is
unnecessary: the user adds the book by searching for the title they want, so the
stored title is already the searchable one.

The cost is that a bilingual library shows two rows for the same story, with no
link between them. This matches how a Calibre library behaves and is accepted.

## Data model

New tables. `LibraryMedia`, `MediaFile`, and `QualityProfile` are untouched.

```prisma
model LibraryBook {
  id             Int
  googleVolumeId String            // Google Books volume id — the identity
  isbn13         String?           // for the "add by ISBN" path
  title          String            // as trackers use it; also the search term
  sortTitle      String?
  subtitle       String?
  overview       String?           // often empty from Google; may be null
  coverUrl       String?
  authors        String[]          // trigger-maintained cache of BookAuthor
  language       String            // ISO 639-1; a property of the book, not the edition
  publishedYear  Int?
  seriesName     String?
  seriesPosition Float?            // Float: "Book 4.5" exists
  overrides      Json?
  listTitle      String            // trigger-maintained, mirrors LibraryMedia
  listYear       Int?
  addedAt, updatedAt
  @@unique([googleVolumeId])
  // no status/monitored — those are per-edition
}

model BookEdition {
  id, bookId                       // cascade
  kind    String                   // "ebook" | "audiobook"
  status  String                   // wanted|downloading|downloaded|skipped|upgrading
  monitored Boolean
  bookQualityProfileId Int?
  narrators   String[]             // audiobook; from file tags at import, not the provider
  durationSecs Int?                // audiobook; from MediaInfo at import
  searchAttempts Int
  lastGrabbedAt DateTime?          // trigger, mirrors LibraryMedia
  totalSizeBytes BigInt?           // trigger
  @@unique([bookId, kind])         // exactly two possible rows per book
}

model BookFile {
  id, editionId                    // cascade
  filePath, fileName, sizeBytes
  format String                    // epub|mobi|azw3|pdf|cbz | m4b|mp3|flac|ogg
  durationSecs?, audioBitrate?, audioCodec?, chapterCount?
  isRetail Boolean                 // unknown-or-scan when false; see below
  releaseGroup?, languageTags String[]
  fileDev?, fileIno?, fileMtimeMs? // skip-rescan cache, verbatim from MediaFile
  scannedAt
}

model Author {
  id
  googleAuthorName String @unique   // Google Books has no author ids; name is the key
  sortName
  imageUrl?, bio?
  monitored   Boolean @default(false)
  monitorFrom DateTime?
  monitorEditionKinds String[]
  bookQualityProfileId Int?
  lastCheckedAt DateTime?
  addedAt, updatedAt
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
  cutoffFormat String?
  preferRetail Boolean             // NOTE: no requireRetail — see Validation
  maxSizeMb Float?, minSeeders Int
  minAudioBitrate Int?
  preferredLanguages String[]
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

**`@@unique([bookId, kind])` holds because editions are not printings.** A volume
has at most one ebook row and one audiobook row. Language lives on `LibraryBook`,
so "the French ebook" and "the English ebook" are editions of two different
books, not two editions of one.

**`Author.googleAuthorName` is the key because Google Books has no author ids.**
Author identity is a name string, which means homonymous authors collide. Accepted
limitation; author monitoring is a convenience, not a correctness-critical path.

**`BookFile` is a separate table, not nullable columns on `MediaFile`.**
`MediaFile` already carries 25 video-specific columns and a GIN index on
`languageTags`. Merging leaves both halves mostly null and pollutes every existing
file query.

**`LibraryBook.authors String[]` is kept alongside `BookAuthor`.** It is a
trigger-maintained denormalized cache, the same pattern the schema already uses
for `listTitle`, `totalSizeBytes`, and `episodeCount`. The trigger populates it
from `BookAuthor` rows with `role = 'author'` only — narrators, translators, and
illustrators are excluded, because this column feeds indexer queries and the
reject filter's author-surname check.

**A `LibraryBook` never exists without at least one `BookEdition`.** Because
`monitored` and `status` live only on editions, a book with no edition rows would
be unreachable by every worker. The add flow always creates at least one.

**`BookFile.isRetail` is set at import** from `parseBookReleaseTitle`, and is
`false` for scan-discovered files where no release title exists. False therefore
means "unknown or scan", never "confirmed scan" — which is why there is no
`requireRetail` profile field.

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
`bookTemplate`, `audiobookTemplate`, and `defaultBookQualityProfileId`.

`AppSettings` gains `booksEnabled Boolean @default(false)`.

`GOOGLE_BOOKS_API_KEY` is added to the `config.ts` Zod schema as optional. Books
require it; without it the feature stays off, the same shape as `TMDB_API_KEY`.

## Metadata provider layer

```
apps/api/src/services/books/
  types.ts               // interface
  googleBooksProvider.ts
  providerCache.ts
```

Mirrors the shapes of `services/discover/{types,tmdbProvider}.ts`.

```ts
interface BookMetadataProvider {
  readonly source: "googlebooks";
  searchBooks(q, opts): Promise<ProviderBook[]>;
  getBook(volumeId): Promise<ProviderBookDetail | null>;
  searchAuthors(q): Promise<ProviderAuthor[]>;
  getAuthorBooks(authorName, since?): Promise<ProviderBook[]>;
  resolveIsbn(isbn13): Promise<ProviderBook | null>;
}
```

One implementation. The interface is kept as cheap insurance against provider
rot — it is what makes a future swap an adapter change rather than a rewrite —
but no capability-flag machinery is needed with a single required provider.

### Google Books query rules

These are not style preferences; each is a measured behavior (see *Validation*).

- **Structured queries only**: `isbn:`, `inauthor:`, `intitle:`. Loose free text
  returns 300 results ranked badly.
- **Never send quoted phrases.** They return HTTP 503.
- **Always send `country`**, derived from `AppSettings.countryCode`.
- **Retry with backoff on 503.** `503 backendFailed` is returned
  nondeterministically for valid queries; the same URL failed three times and
  then succeeded.
- **A 503 must never be cached, and must never be treated as "not found."**
  Caching it as a negative would permanently hide a book. In any fallback or
  retry logic, absent and errored are distinct outcomes.
- **Expect sparse records.** For a real French volume, Google returned title,
  authors, language, publishedDate, ISBN-10/13, and thumbnails — with
  `pageCount: 0`, empty `description`, null `categories`, and null `seriesInfo`.
  Every field except title, authors, and language must be treated as optional.

### Covers

Google Books returns only `smallThumbnail` and `thumbnail`, which are too small
for a library grid. Request a larger render via
`books.google.com/books/content?id=<volumeId>&printsec=frontcover&img=1&zoom=<n>`
and cache the result through the existing `imageService.ts`. Books without a
usable cover fall back to a generated placeholder.

### Caching

`services/cache.ts` (Redis). TTLs: search 1h, book detail 24h, author
bibliography 6h. Error responses are never cached.

Shared types live in `apps/shared/src/types/books.ts`.

## Search, release parsing, grab

**Categories.** Book and audiobook searches query `7000,3000` **together**, and
the edition kind is derived from the **parsed format and file size**, not from the
category. This is measured behavior: a real audiobook release for the test title
was filed under category 7000 (Books), not 3000.

The adapter must intersect requested categories with each indexer's advertised
caps. The live Jackett aggregate advertises only `3000 Audio` and `7000 Books` —
`3030` and `7020` are not present at the aggregate level, so hardcoding them
would silently return nothing.

**No id-based book search exists.** Confirmed from live Torznab caps:

```
<book-search  available="yes" supportedParams="q" />
<audio-search available="yes" supportedParams="q" />
<movie-search available="yes" supportedParams="q,imdbid,tmdbid" />
```

`q` only. Every book search is freetext, so query construction and match
rejection are load-bearing:

- Query ladder: `"{author surname} {title}"` → `"{title}"` →
  `"{title} {preferred format}"`.
- **Mandatory reject filter**: a release must fuzzy-match `LibraryBook.title`
  and contain the author surname. Because the stored title is the title the user
  searched for, this now matches rather than fights the real release names.

**Parsing is a new function, not an extension.**
`utils/books/bookReleaseParser.ts` exports `parseBookReleaseTitle()` returning
`{ format, isRetail, isProper, group, language, audioBitrate, narrator }`.

`filenameParser.parseReleaseTitle` is deliberately not extended: its regexes
misfire on book titles, reading `M4B` as `MP4` and four-digit years as
resolutions.

Cases drawn from real releases, to be used directly as test fixtures:

| Input fragment | Must yield |
|---|---|
| `[MP3 à 64 kb/s]` | `audioBitrate: 64` — French, spaced, `kb/s` |
| `[MP3.192kbps]` | `audioBitrate: 192` |
| `-NOTAG` | `group: null` — a "no group" convention, not a group named NOTAG |
| `–` (en dash) as separator | normalized like `-` |
| `[EPUB]`, `[Epub]`, `[ePub]` | `format: "epub"` |
| `Fr`, `FR` | `language: "fr"` |
| double spaces | collapsed before matching |

**Size as a kind discriminator.** Measured: 1–5 MB for ebooks, 262–810 MB for
audiobooks of the same title. A cheap, reliable signal where categories are
unreliable.

**Scoring.** `utils/books/bookReleaseScorer.ts` exports `scoreBookRelease` and
`scoreBookReleaseDetailed`, paralleling `releaseScorer.ts`. Axes in priority
order: format position within `allowedFormats`, `preferRetail`, custom-format
score, tracker priority, size sanity, seeders, `minAudioBitrate`.
`pickBookReleaseForGrab` mirrors `pickReleaseForGrab.ts`.

`minAudioBitrate` is not optional polish: the same title was available at both
64 kb/s and 192 kbps.

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
  and its `fileDev`/`fileIno`/`fileMtimeMs` skip-rescan cache. Container tags are
  also the only source of `narrators` and `chapterCount`, since Google Books
  provides neither.
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

**Rescan, health, upgrades.** `rescanBookEdition` parallels `rescanLibraryItem`;
`libraryIntegrityCollectors` gains book collectors. `upgradeDetection` gains a
book variant keyed on `cutoffFormat` — a retail epub replacing an OCR scan is the
book equivalent of 1080p replacing 720p.

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

**Discover deck.** Google Books has no trending or popularity signal, so the book
deck is built entirely from local data: "new from your monitored authors" and
"next in series you already own". `services/discover/bookDeck.ts` emits the same
card contract `assembleDeck` produces, so the web deck component is shared.

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
| 2 | Merged 7000/3000 category search; `bookReleaseParser`, `bookReleaseScorer`, `pickBookReleaseForGrab`, reject filter; custom-format book conditions; `bookGrabberSearch`/`bookGrabberGrab`; `download_history` migration and disjoint partial index; interactive search UI | Manual search and grab; files land but are not imported |
| 3 | `postProcessorBook`, `ebookMetadata`, audiobook scanning via `mediainfoScanner`, templates, `markEditionDownloaded`, `rescanBookEdition`, integrity collectors | End to end |
| 4 | Auto-search worker, RSS category wiring, upgrade detection on `cutoffFormat`, `checkAuthorReleases` worker and author monitoring UI, notification events | Hands-off operation |
| 5 | `bookDeck`; watchlist, dismissal, and request migrations plus approval flow; book release reminders | Full parity |

Phase 4 adds entries to both `QUEUE_NAMES` and `SCHEDULED_JOB_NAMES` in
`services/queueService.ts` alongside the handlers in `src/workers/`.

## Validation

The design was tested end to end against live services on 2026-08-20, using
Freida McFadden's *La Prof* (French translation of *The Teacher*) as the probe —
chosen because a French-language title is the primary case for this install, not
an edge case.

**Providers**

| Provider | Result |
|---|---|
| Open Library | `search.json?q=La+Prof+Freida+McFadden` → 0 results. `/isbn/9782824629094.json` → 404. Zero French coverage for this catalog. Also inconsistent about works vs editions: the Spanish translation is a separate work, the German one an edition of the English work. |
| Google Books, no key | HTTP 429, shared anonymous quota exhausted. Unusable. |
| Google Books, keyed | `isbn:9782824629094` → 1 result, "La prof", `fr`, 2025-04-16, City. `isbn:9782290422649` → 1 result, the 2026 J'ai lu printing. `inauthor:McFadden` returns the French bibliography. Record is sparse: `pageCount: 0`, empty description, null categories, null seriesInfo, thumbnails only. |
| Hardcover | HTTP 401 without a token; untested. Not adopted. |

Google Books returned `503 backendFailed` nondeterministically — the same
`isbn:` URL failed three consecutive times and then succeeded, and quoted phrase
queries failed consistently while the unquoted form returned 200. This is the
origin of the retry and never-cache-errors rules above.

**Indexer** (live Jackett aggregate)

Caps confirmed `book-search`/`audio-search` accept `q` only, and advertise only
categories `3000` and `7000`.

`q="La Prof Freida McFadden"`, `cat=7000` returned 5 results:

```
   262 MB | La Prof - Freida McFadden - 2025 [MP3 à 64 kb/s]     ← audiobook in cat 7000
     1 MB | La.Prof.Freida.McFadden.2025.FR.[EPUB]-NOTAG
     1 MB | La Prof - Freida McFadden - 2025 Fr [Epub]
     5 MB | La prof - Freida McFadden  [ePub] Fr
     0 MB | Freida McFadden – Le professeur (The Teacher) - ePUB Fr
```

`cat=3000` returned one more: `La.Prof.Freida.McFadden.2025.FR.[MP3.192kbps]-NOTAG`
at 810 MB.

Findings that changed the design:

1. An audiobook appeared in category 7000, so kind must come from parsed format
   and size, not category.
2. Under an earlier design that stored the English work title, four of the five
   correct French releases failed the reject filter, and the only one that passed
   was a different, unofficial translation. Storing the volume's own title fixes
   this and is why the work/translation hierarchy was dropped.
3. None of the five releases carried a retail or scan marker, so `requireRetail`
   would have rejected every real result. Only `preferRetail` survives.
4. The same title existed at 64 kb/s and 192 kbps, confirming `minAudioBitrate`
   is necessary rather than cosmetic.
5. Real release names supplied the parser fixture table above.

## Risks

1. **Freetext match quality.** No `isbn` or `bookid` Torznab parameter exists, so
   correctness rests entirely on the reject filter. Reduced substantially by
   storing the volume's own title, but still the highest residual risk, and it
   will need tuning against real results after phase 2.
2. **Google Books is a single point of failure**, sparse in metadata and flaky in
   availability. Mitigated by the provider interface, retry with backoff, and the
   never-cache-errors rule. Not eliminated.
3. **Author identity is a name string**, since Google Books exposes no author
   ids. Homonymous authors will collide in monitoring.
4. **The `media_requests` and `watchlist_items` unique-constraint migration** is
   the only place existing tables are structurally altered, and needs a tested
   down path.
5. **Six phases is a large surface**, mitigated by `booksEnabled` permitting
   incremental merges.

## Deferred

- Multi-book and author-collection pack handling.
- Linking translations of the same work.
- Audiobook chapter metadata beyond what container tags provide.
- Comics and manga as a distinct kind, though `cbz` appears in the format list.
- Calibre and Audiobookshelf library integration.
