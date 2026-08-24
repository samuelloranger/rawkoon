# Multi-Source Book Metadata

**Date:** 2026-08-24
**Status:** Approved design, validated against live provider data and the operator's real 32-book library, ready for implementation planning

## Goal

Replace the single Google Books provider with a merged chain of metadata sources,
so a book carries the fields Google Books does not supply: narrators, series name
and position, genres, publisher, page count, full publication date, ratings, and
author bio and image. Audiobookshelf is the reference for the feature, not for the
mechanism — see [Why auto-merge and not ABS's flow](#why-auto-merge-and-not-abss-flow).

## Decisions

| Decision | Choice |
|---|---|
| Merge model | Auto-merge by a single global source order. Not per-provider manual matching. |
| Sources | Local file metadata, Audnexus/Audible, Google Books, Open Library. |
| Priority | Local files highest. Open Library last. Order is operator-editable. |
| Identity | `LibraryBook.googleVolumeId` stays the primary key of identity. Unchanged. |
| Other source ids | New `book_external_ids` table. One row per (book, source). |
| Provenance | New `book_metadata_fields` table. One row per (book, field). |
| Recompute | On add, and on an explicit per-book "Refresh metadata" action. No cron. |
| Overrides | Existing `LibraryBook.overrides` JSON always wins over every source. |
| Narrators | Promoted to `LibraryBook`. `BookEdition.narrators` stays as the local-file value. |
| Audnexus endpoint | Config field, defaulting to the public instance. |
| Chapters | Separate optional phase, gated on a runtime match. |

### Why auto-merge and not ABS's flow

Audiobookshelf queries one provider per match and asks the operator to tick which
fields to apply. That is predictable, and wrong for rawkoon: rawkoon adds books
unattended through author monitoring (`workers/checkAuthorReleases.ts`), where
there is no operator to tick anything. A default provider per unattended add
would mean unattended books get systematically worse metadata than hand-added
ones. Auto-merge gives one code path for both.

The cost is that merge logic can be wrong in ways manual selection cannot. That
cost is paid down by making the merge a pure function over captured fixtures
(see [Testing](#testing)) rather than logic tangled into the fetchers.

### Why local file metadata ranks highest

The operator can fix a file with a tagger and rescan. If a remote source
outranked local tags, that repair would be silently reverted on the next refresh,
which makes the tagger useless. Ranking local highest makes the file the escape
hatch for anything the remote chain gets wrong — a second override mechanism that
needs no UI.

Rawkoon already extracts narrators and duration from container tags at import, so
this is a promotion of existing behaviour into the chain, not new extraction.

## Validation

Every rule below came out of probing these APIs live on 2026-08-24 against the
operator's actual library: 32 books, **all French**, spanning Freida McFadden,
J.K. Rowling, Sarah J. Maas, Rebecca Yarros, Suzanne Collins, Colleen Hoover,
Andy Weir, Hannah Grace, Joyce Kitten, and Guillaume Morrissette.

### The baseline being fixed

Measured on the production database, not assumed:

- `series_name` and `series_position` are **NULL on all 32 books**. Google Books'
  `seriesInfo` never populated for any French title in the library.
- `narrators` is **empty on all 12 downloaded audiobook editions**.
- Subtitles carry garbage: `Lapos;embrasement` (an HTML-entity mangling), and
  `The Empyrean Tome 1` stuffed into the subtitle field rather than into series.

So the field this feature exists to fill is not merely sparse. It is empty.

### Audnexus and Audible

Audnexus (`api.audnex.us`, GPL-3.0, Fastify + MongoDB + Redis + cheerio) is the
API Audiobookshelf uses by default. The public instance requires no key and
advertises `x-ratelimit-limit: 300` per 60 s per IP, Cloudflare-cached at
`max-age=86400`.

- **Audnexus has no book title search.** `GET /books/{asin}` is ASIN-keyed only.
  ASINs must be resolved elsewhere.
- `api.audible.fr/1.0/catalog/products` resolves them, with
  `response_groups=product_desc,product_attrs,contributors,series,media`. This is
  the same route ABS takes.
- `GET /books/{asin}?region=fr` returned, for `B0D53WYQ3S`: French `title`, French
  `summary` and `description`, French `genres` (typed `genre` vs `tag`),
  `narrators`, `seriesPrimary` with `name` and `position`, `publisherName`,
  `releaseDate`, `runtimeLengthMin`, `rating`, an audio-edition `isbn`, and a
  high-resolution `image`. This is the whole gap, from one source.
- `GET /authors?name=…` returns duplicate rows for the same ASIN — ten identical
  `B00ELQLN2I` entries for "Freida McFadden". Deduplicate by ASIN.
- `GET /authors/{asin}?region=fr` returned a good `image` but an **empty
  `description`**. Author bio needs a fallback to another region.
- `region` must be passed explicitly. It is not inferred.

### Match rate and the matching trap

31 of 32 books matched a French Audible product. The single miss is
`Mises en scène` by Guillaume Morrissette, a Québec title with no Audible edition
— which is why Google Books stays in the chain as the floor rather than being
replaced.

**The failure that dictates the design:** naive substring title matching mapped
`Hunger Games - tome 2 L'embrasement` onto tome **1**'s ASIN (`B00KX5UGGA`),
because the tome-1 title is a substring of the tome-2 title. A wrong ASIN is
worse than no ASIN: it attaches a confident, complete, wrong record. Matching
therefore requires scoring with an explicit volume-number agreement check, and a
confidence floor below which no match is recorded.

Two further data hazards, both observed:

- `Fourth Wing - Version française` came back from Audible with
  `language: english` despite being the French edition. Language cannot be a hard
  match requirement; it can only be a scoring signal.
- Series names arrive dirty and inconsistent:
  `": Un palais d'épines et de roses (ACOTAR)"` (leading colon),
  `"The Maple Hills Series [French Edition]"` (bracketed edition marker), and the
  Harry Potter books split across two series names — `"Harry Potter"` for volumes
  1–3, `"Le Monde des sorciers"` for 4–7. Normalization is required, and it
  cannot assume one series name per series.

### Open Library

Weak for this library, kept only for the fields nothing else supplies.

- `GET /isbn/{isbn}.json` returned an HTML 404 page for **every** French ISBN
  tried (`9782824637167`, `9782824629766`, `9782755673081`). Only the UK-group
  Harry Potter ISBN resolved, and with a 302. The ISBN route is close to useless
  here.
- `GET /search.json` did find the work (`/works/OL44895711W`) but returned no
  series, no language, and a different printing's ISBN than the one in the
  library.
- `GET /search/authors.json` is the useful one: `birth_date`, `top_subjects`,
  `work_count`, and `ratings_average` with a full histogram.

Net: page count, ratings, and author birth date. Nothing else. Rank last.

### Chapters

`GET /books/{asin}/chapters?region=fr` returned `isAccurate: true` with real
French chapter titles — "Le survivant", "Une vitre disparaît" for Harry Potter 1
— plus `startOffsetMs`, `lengthMs`, `runtimeLengthMs`, and brand intro/outro
durations.

This addresses a known gap: `syncFileChapters` reads only internal m4b/mka "Menu"
marks, so per-file mp3 and opus audiobooks legitimately end up with zero
`book_file_chapters` rows.

**But the offsets describe Audible's single-file edition.** Library audiobooks are
per-file rips whose file boundaries need not align. Importing these offsets
blindly would desynchronize the player. Hence a separate phase, applied only when
the summed local runtime agrees with `runtimeLengthMs` within a tolerance, and
only when the edition has no chapters of its own.

## Architecture

### Provider contract

`services/books/types.ts` widens in two ways.

`BookMetadataProvider.source` becomes a union of `"googlebooks" | "audnexus" |
"openlibrary" | "local"` instead of a `"googlebooks"` literal.

The interface splits along a seam the current one conflates: **searching for
identity** and **filling fields for a known book** are different operations with
different callers.

```
interface BookMetadataProvider {
  readonly source: BookMetadataSource;
  // Identity. Only Google Books implements this; the add flow uses it.
  searchBooks?(query, opts): Promise<ProviderBook[]>;
  getBook?(externalId): Promise<ProviderBook | null>;
  resolveIsbn?(isbn13): Promise<ProviderBook | null>;
  getAuthorBooks?(authorName, opts): Promise<ProviderBook[]>;
  // Enrichment. Every provider implements this.
  enrich(book: BookMatchInput): Promise<ProviderFields>;
}
```

`ProviderFields` is a partial record: every field optional, absent meaning "this
source has nothing to say", which is distinct from `null` meaning "this source
asserts empty". The merge needs that distinction to avoid a high-priority source
blanking a field a lower one knows.

`BookProviderUnavailableError` keeps its existing contract and gains a second
duty: a provider that raises it is skipped in the merge, and its absence is
recorded so a later refresh retries. A failed provider must never write a
provenance row, or a transient Audnexus 503 would look like "Audnexus has no
narrators for this book" forever.

### ASIN resolution

A dedicated module, `services/books/asinResolver.ts`, modeled on the existing
`utils/books/bookReleaseScorer.ts` rather than invented fresh.

Scoring inputs, in descending weight:

1. **Volume-number agreement.** Extract the tome/volume/book number from both
   titles. Disagreement is disqualifying, not merely penalizing. This is the
   Hunger Games fix and the reason the module exists.
2. **Normalized title equality**, then containment as a weaker signal. Normalize
   by NFKD-stripping diacritics, lowercasing, and collapsing non-alphanumerics —
   the operator's library is entirely French, so diacritic-insensitive comparison
   is the common case, not an edge case.
3. **Author overlap** after the same normalization.
4. **Language match**, as a signal only. `Fourth Wing` proves it cannot gate.

Below the confidence floor, the resolver returns no match. No ASIN is recorded and
the book keeps whatever Google Books gave it.

### Merge

`services/books/mergeBookMetadata.ts` exports a pure function:

```
mergeBookMetadata(
  candidates: Array<{ source: BookMetadataSource; fields: ProviderFields }>,
  order: BookMetadataSource[],
  overrides: Record<string, unknown> | null,
): { merged: MergedBookFields; provenance: Record<string, BookMetadataSource> }
```

No I/O, no Prisma, no fetch. Fetching happens in the caller; this function is
where the correctness risk of auto-merge concentrates, so it is the part that is
exhaustively testable against fixtures.

Rules:

- For each field, walk `order` and take the first source that supplies it.
- `overrides` wins over all sources, and its fields are excluded from provenance.
- Array fields (`genres`, `narrators`, `authors`) take the winning source's array
  whole rather than unioning across sources. Unioning genres across Audible's
  French taxonomy and Open Library's English subjects produces a bilingual mess.
- Series name passes through the normalizer before comparison or storage.

### Series normalization

`utils/books/seriesName.ts`: strips leading punctuation, strips bracketed and
parenthesized edition markers (`[French Edition]`, `(ACOTAR)`), and trims. It does
**not** attempt to reconcile Harry Potter's two series names into one — that is a
data reality on Audible's side, and inventing a canonical name would be a guess.
Both names are stored as given, post-cleanup, and the operator can fix it with
`overrides`.

### Refresh flow

`services/books/refreshBookMetadata.ts` orchestrates: read the book and its
external ids, resolve any missing ASIN, call every enabled provider's `enrich`
concurrently, merge, write the book, write `book_external_ids` and
`book_metadata_fields`, and return a summary of what changed and which sources
failed.

Called from the add flow in `services/books/bookLibrary.ts` and from a new
`POST /api/books/:id/refresh-metadata` route. No scheduled job.

## Schema

`LibraryBook` additions:

| Column | Type | Note |
|---|---|---|
| `narrators` | `String[] @default([])` | Book-level. Audiobook editions keep their own local-file value. |
| `genres` | `String[] @default([])` | From the winning source's taxonomy, untranslated. |
| `publisher` | `String?` | |
| `pageCount` | `Int?` | Open Library's `number_of_pages_median` is the usual supplier. |
| `publishedDate` | `DateTime?` | `publishedYear` is kept; list sorting already depends on it. |
| `rating` | `Float?` | |
| `ratingCount` | `Int?` | |

New `book_external_ids`: `id`, `bookId`, `source`, `externalId`,
`@@unique([bookId, source])`, indexed on `[source, externalId]`. `googleVolumeId`
stays on `LibraryBook` untouched, so no existing query, trigger, or unique
constraint changes.

New `book_metadata_fields`: `id`, `bookId`, `field`, `source`, `fetchedAt`,
`@@unique([bookId, field])`. Powers the per-field provenance tooltip and tells a
refresh which fields are stale.

`Author` additions: `audibleAsin String? @unique`. The existing `bio` and
`imageUrl` columns finally get written, from Audnexus (image) and Open Library
(bio, birth date).

Migration is additive throughout. Nothing is dropped or renamed, so the existing
32 books are valid rows before the backfill runs.

## UI

**Settings → Books.** A new Metadata section inside the existing
`BooksSettingsTab.tsx`, which already renders the Google Books integration card
(key, enable, test) through `useGoogleBooksIntegration.ts` and
`INTEGRATION_ENDPOINTS.GOOGLE_BOOKS`. The section holds a drag-ordered source
list plus an Audnexus card with base URL, region, enable, and a test button.

Audnexus is therefore not a new UI pattern: it is a second integration card
copying the Google Books route, endpoint, hook, and test-button shape exactly.

**Source order doubles as the enable list.** A source absent from the ordered
array is disabled. One array, no parallel set of booleans that could contradict
it.

**Book detail.** Narrators, series and position, genres, publisher, page count,
and rating rendered as fields; each carries a provenance tooltip naming its
source. A "Refresh metadata" button reports what changed and names any source that
failed, so an Audnexus outage is legible rather than silent.

## Error handling

- A provider raising `BookProviderUnavailableError` is skipped; the merge proceeds
  with the remaining sources. No provenance row is written for it, and the failure
  is never cached.
- A provider returning nothing is recorded as having nothing, so refresh does not
  retry it pointlessly.
- Below-threshold ASIN matching records no ASIN, leaving the book on Google Books
  data alone.
- Every provider response is cached in Redis through the existing
  `services/cache.ts` helpers, following the TTL split the Google provider already
  uses: short for searches, long for resolved records.

## Testing

Fixtures live under `apps/api/test/fixtures/bookMetadata/`. They keep the exact
**response structure** captured during the 2026-08-24 probe — field names,
nesting, types, and every quirk — but their title, author, series, and ASIN
strings are rewritten to invented equivalents that preserve the hazard.

This follows the convention `utils/books/bookReleaseScorer.test.ts` already
established ("synthetic fixtures with an invented title and author … the set
deliberately includes a decoy"). Rawkoon is a public GPL repository, and
committing captures of the operator's own library would publish their reading
list in git history for no test benefit — the hazards are structural, so they
survive renaming.

Scrubbing must preserve the property under test, which is the easy thing to get
wrong. A renamed series whose volume 1 title is *not* a substring of its volume 2
title silently stops testing the collision, and the test would pass for the wrong
reason. Each fixture therefore carries a comment naming its hazard, and each
test asserts the hazard directly rather than asserting a whole merged object.

| Fixture | Hazard it pins |
|---|---|
| A 3-volume series, multi-narrator | Series name and position; several narrators per book |
| A series whose vol-1 title is a strict prefix of vol-2's | The substring collision. Asserts **no** match rather than a wrong one |
| A translated edition reporting `language: "english"` | Language must score, never gate |
| A series name with a leading colon and a parenthesized acronym | Series-name normalization |
| One series arriving under two different names across volumes | Split series is preserved, not invented away |
| A series name carrying `[French Edition]` | Bracketed edition-marker stripping |
| A title absent from Audible entirely | Google Books floor; below-threshold means no ASIN |
| Audnexus author with an empty `description` | Region fallback for author bio |
| Audnexus `/authors?name=…` with ten duplicate rows for one ASIN | Deduplication by ASIN |
| Open Library ISBN route returning an HTML body | HTML 404 on a 200-shaped route |

The uncommitted `test:live` script re-probes the real APIs against the operator's
actual library, so provider rot stays detectable without the fixtures carrying
personal data.

`mergeBookMetadata` and the ASIN resolver are tested as pure functions over these
fixtures, with no network. The API tests mock `@rawkoon/api/db` as the existing
suites do.

A `test:live` style script, excluded from CI, re-probes the live APIs so provider
rot is detectable on purpose rather than discovered through a silent regression.

## Phases

1. **Schema and contract.** Migration, widened `BookMetadataProvider`,
   `ProviderFields`, provenance and external-id tables.
2. **Audnexus provider.** Audible catalog search, `asinResolver`, Audnexus book
   enrichment, series normalizer, fixtures and their tests.
3. **Merge and refresh.** `mergeBookMetadata`, `refreshBookMetadata`, the refresh
   route, wiring into the add flow.
4. **Local file source.** Promote the existing container-tag and OPF extraction
   into a provider at the top of the chain.
5. **Open Library provider.** Page count, ratings, author bio and birth date.
6. **UI.** Settings page, book-detail fields, provenance tooltips, refresh button.
7. **Backfill.** A script over the existing 32 books, following the
   `importExistingBooks.ts` pattern: per-book error catching so one failure does
   not abort the batch.
8. **Chapters (optional).** Audnexus chapters into `book_file_chapters`, gated on
   summed local runtime matching `runtimeLengthMs` within tolerance, and only for
   editions with no chapters of their own.

## Out of scope

- Hardcover, Goodreads, iTunes, and FantLab providers.
- Per-field-group priority ordering. One global order, by decision.
- A scheduled metadata refresh job.
- Reconciling Audible's split series names into a canonical series.
- Any change to `LibraryBook` identity or to the work/translation hierarchy the
  original books design deliberately excluded.
