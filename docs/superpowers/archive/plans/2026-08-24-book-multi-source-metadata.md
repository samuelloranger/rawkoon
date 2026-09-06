> Shipped in #37.

# Multi-Source Book Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the book metadata fields Google Books leaves empty — narrators, series name and position, genres, publisher, page count, ratings, author bio and image — by merging four sources in an operator-editable priority order.

**Architecture:** Providers implement a widened `BookMetadataProvider` whose `enrich()` method returns a sparse `ProviderFields`. A pure `mergeBookMetadata()` resolves each field from the highest-priority source that supplies it, with `LibraryBook.overrides` beating everything. Audnexus is ASIN-keyed and has no title search, so ASINs are resolved from Audible's catalog API through a scorer with a disqualifying volume-number check. Recompute happens on add and on an explicit refresh; there is no cron.

**Tech Stack:** Bun, Elysia, Prisma 7 + Postgres 17, Redis (via `services/cache.ts`), React 19 + TanStack Query, `bun test`, Biome.

**Spec:** `docs/superpowers/specs/2026-08-24-book-multi-source-metadata-design.md`

## Global Constraints

- **Path aliases only.** API code imports itself as `@rawkoon/api/<path>`, never by relative path, except within the same directory (`./bookHelpers`).
- **Errors are returned, not thrown.** Use the helpers in `src/errors.ts` (`badRequest`, `notFound`, …) which set `set.status` and return `{ error }`. The global `onError` swallows unmapped errors into a generic 500, so no error message can be relied upon reaching the client.
- **`BookProviderUnavailableError` must never be cached and never be treated as "not found".** Google Books returns HTTP 503 `backendFailed` nondeterministically. A provider that raises it is skipped by the merge and writes **no** provenance row.
- **Absent vs null is load-bearing** in `ProviderFields`: an absent key means "this source has nothing to say"; `null` means "this source asserts empty". A high-priority source must not blank a field a lower-priority source knows.
- **Shared types are the contract.** Response types live in `@rawkoon/shared/types`; change them there, never on one side only.
- **TS config is strict:** `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Both `bun run typecheck` and `bun run typecheck:native` must pass — CI gates on both.
- **Biome covers `apps/web` and `apps/api`**; `apps/shared` uses prettier (`cd apps/shared && bun run formatCheck`).
- **No real library data in committed fixtures.** Keep captured response *structure* and quirks; rewrite title/author/series/ASIN strings to invented equivalents that preserve the hazard. Rawkoon is a public GPL repo.
- **Never run `db:migrate:dev` or `db:push` against production.**
- **Migrations are additive only.** Nothing in this plan drops or renames a column; the existing 32 production books must be valid rows before any backfill runs.
- **Audnexus region must be passed explicitly** on every call; it is not inferred.
- **Rate limit:** the public Audnexus instance allows 300 requests per 60 s per IP. Concurrency in the backfill is capped at 4.

---

### Task 1: Shared source type and provider contract

**Files:**
- Modify: `apps/shared/src/types/books.ts`
- Modify: `apps/api/src/services/books/types.ts`
- Test: `apps/shared/src/utils/__tests__/bookMetadataSources.test.ts`
- Create: `apps/shared/src/utils/bookMetadataSources.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BookMetadataSource`, `DEFAULT_BOOK_METADATA_SOURCE_ORDER`, `normalizeSourceOrder(input: unknown): BookMetadataSource[]`, `ProviderFields`, `BookMatchInput`, `MergedBookFields`, widened `BookMetadataProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/shared/src/utils/__tests__/bookMetadataSources.test.ts
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BOOK_METADATA_SOURCE_ORDER,
  normalizeSourceOrder,
} from "../bookMetadataSources";

describe("normalizeSourceOrder", () => {
  test("falls back to the default order for junk input", () => {
    expect(normalizeSourceOrder(null)).toEqual(
      DEFAULT_BOOK_METADATA_SOURCE_ORDER,
    );
    expect(normalizeSourceOrder("audnexus")).toEqual(
      DEFAULT_BOOK_METADATA_SOURCE_ORDER,
    );
    expect(normalizeSourceOrder([])).toEqual(
      DEFAULT_BOOK_METADATA_SOURCE_ORDER,
    );
  });

  test("drops unknown sources and de-duplicates, preserving order", () => {
    expect(
      normalizeSourceOrder([
        "audnexus",
        "goodreads",
        "audnexus",
        "local",
        42,
      ]),
    ).toEqual(["audnexus", "local"]);
  });

  // Absence from the array IS the disable switch — there is no parallel set of
  // booleans that could contradict the order.
  test("a source omitted from the order stays omitted", () => {
    expect(normalizeSourceOrder(["local", "googlebooks"])).toEqual([
      "local",
      "googlebooks",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shared && bun test src/utils/__tests__/bookMetadataSources.test.ts`
Expected: FAIL — `Cannot find module '../bookMetadataSources'`

- [ ] **Step 3: Add the source type to shared types**

```ts
// apps/shared/src/types/books.ts — append
/**
 * A metadata source, in the order the merge considers them by default.
 * "local" is on-disk file metadata: the operator can fix a file with a tagger
 * and rescan, so it must outrank every remote source or that repair would be
 * silently reverted on the next refresh.
 */
export type BookMetadataSource =
  | "local"
  | "audnexus"
  | "googlebooks"
  | "openlibrary";
```

- [ ] **Step 4: Write the normalizer**

```ts
// apps/shared/src/utils/bookMetadataSources.ts
import type { BookMetadataSource } from "../types/books";

export const DEFAULT_BOOK_METADATA_SOURCE_ORDER: BookMetadataSource[] = [
  "local",
  "audnexus",
  "googlebooks",
  "openlibrary",
];

const KNOWN = new Set<string>(DEFAULT_BOOK_METADATA_SOURCE_ORDER);

/**
 * The stored order doubles as the enable list: a source absent from the array
 * is disabled. An empty or unusable array therefore cannot be honoured as
 * "everything disabled" — that would silently stop all enrichment — so it
 * falls back to the default order.
 */
export function normalizeSourceOrder(input: unknown): BookMetadataSource[] {
  if (!Array.isArray(input)) return [...DEFAULT_BOOK_METADATA_SOURCE_ORDER];
  const seen = new Set<string>();
  const out: BookMetadataSource[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    if (!KNOWN.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw as BookMetadataSource);
  }
  return out.length > 0 ? out : [...DEFAULT_BOOK_METADATA_SOURCE_ORDER];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/shared && bun test src/utils/__tests__/bookMetadataSources.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Widen the provider contract**

Replace the `BookMetadataProvider` interface in `apps/api/src/services/books/types.ts`. Keep `ProviderBook` and `BookProviderUnavailableError` exactly as they are — the Google provider and `bookLibrary.ts` depend on both.

```ts
// apps/api/src/services/books/types.ts — add above BookMetadataProvider
import type { BookMetadataSource } from "@rawkoon/shared/types";

/**
 * A sparse contribution from one source.
 *
 * Absent key vs null is load-bearing: absent means "this source has nothing to
 * say", null means "this source asserts empty". Without the distinction a
 * high-priority source that simply lacks a field would blank a value a
 * lower-priority source knows.
 */
export interface ProviderFields {
  title?: string | null;
  subtitle?: string | null;
  authors?: string[];
  narrators?: string[];
  genres?: string[];
  publisher?: string | null;
  pageCount?: number | null;
  /** ISO-8601 date string. Stored to LibraryBook.publishedDate. */
  publishedDate?: string | null;
  publishedYear?: number | null;
  isbn13?: string | null;
  coverUrl?: string | null;
  overview?: string | null;
  seriesName?: string | null;
  seriesPosition?: number | null;
  /** ISO 639-1. */
  language?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  authorBio?: string | null;
  authorImageUrl?: string | null;
}

/** Every key resolved. Same shape; a distinct name so intent reads clearly. */
export type MergedBookFields = ProviderFields;

/** What a provider needs in order to enrich a book it did not find itself. */
export interface BookMatchInput {
  bookId: number;
  title: string;
  authors: string[];
  /** ISO 639-1. */
  language: string;
  isbn13: string | null;
  googleVolumeId: string;
  /** Already-resolved ids, keyed by source. Lets enrich skip re-resolution. */
  externalIds: Partial<Record<BookMetadataSource, string>>;
}

export interface BookMetadataProvider {
  readonly source: BookMetadataSource;
  /**
   * Identity operations. Only Google Books implements these; the add flow and
   * author monitoring call them. Optional so enrichment-only providers need
   * not stub them.
   */
  searchBooks?(query: string, opts?: { limit?: number }): Promise<ProviderBook[]>;
  getBook?(externalId: string): Promise<ProviderBook | null>;
  resolveIsbn?(isbn13: string): Promise<ProviderBook | null>;
  getAuthorBooks?(
    authorName: string,
    opts?: { limit?: number; languages?: string[] },
  ): Promise<ProviderBook[]>;
  /** Enrichment. Every provider implements this. */
  enrich(book: BookMatchInput): Promise<ProviderFields>;
}
```

- [ ] **Step 7: Make the Google provider satisfy the widened contract**

`GoogleBooksProvider` in `apps/api/src/services/books/googleBooksProvider.ts` already has `searchBooks`, `getBook`, `resolveIsbn` and `getAuthorBooks`. Add `enrich`, reusing `getBook` so there is one mapping path:

```ts
// apps/api/src/services/books/googleBooksProvider.ts — add to the class
  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const volumeId = book.externalIds.googlebooks ?? book.googleVolumeId;
    if (!volumeId) return {};
    const meta = await this.getBook(volumeId);
    if (!meta) return {};
    // Only the fields Google actually supplies. Everything it does not know is
    // absent rather than null, so a lower-priority source can still fill it.
    return {
      title: meta.title,
      subtitle: meta.subtitle,
      authors: meta.authors,
      language: meta.language,
      publishedYear: meta.publishedYear,
      isbn13: meta.isbn13,
      coverUrl: meta.coverUrl,
      overview: meta.overview,
      seriesName: meta.seriesName,
      seriesPosition: meta.seriesPosition,
    };
  }
```

Add `BookMatchInput` and `ProviderFields` to the existing type import from `./types`.

- [ ] **Step 8: Typecheck and commit**

```bash
bun run typecheck && bun run typecheck:native && bun run lint
cd apps/shared && bun run formatCheck && cd ../..
git add apps/shared/src/types/books.ts apps/shared/src/utils/bookMetadataSources.ts apps/shared/src/utils/__tests__/bookMetadataSources.test.ts apps/api/src/services/books/types.ts apps/api/src/services/books/googleBooksProvider.ts
git commit -m "feat(books): widen the metadata provider contract with enrich()"
```

---

### Task 2: Schema migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/routes/books/bookHelpers.ts`
- Modify: `apps/shared/src/types/books.ts`

**Interfaces:**
- Consumes: `BookMetadataSource` (Task 1).
- Produces: columns `LibraryBook.{narrators,genres,publisher,pageCount,publishedDate,rating,ratingCount}`, models `BookExternalId` and `BookMetadataField`, `Author.audibleAsin`, `MediaSettings.bookMetadataSourceOrder`; `Book` interface fields on the wire.

- [ ] **Step 1: Add the columns to `LibraryBook`**

Insert after the existing `seriesPosition` line in `apps/api/prisma/schema.prisma`:

```prisma
  /// Merged from the source chain. Book-level; BookEdition.narrators stays as
  /// the local-file value, which is what the "local" source contributes.
  narrators      String[] @default([])
  /// The winning source's taxonomy, untranslated. Audible's French genres and
  /// Open Library's English subjects are never unioned — that yields a
  /// bilingual mess — so this is one source's array, whole.
  genres         String[] @default([])
  publisher      String?
  pageCount      Int?     @map("page_count")
  /// Full date when a source supplies one. publishedYear is kept: list
  /// sorting (listYear) already depends on it.
  publishedDate  DateTime? @map("published_date")
  rating         Float?
  ratingCount    Int?     @map("rating_count")
```

Add to the `LibraryBook` relation block:

```prisma
  externalIds    BookExternalId[]
  metadataFields BookMetadataField[]
```

- [ ] **Step 2: Add the two new models**

Append after the `BookAuthor` model:

```prisma
/// Per-source identity. googleVolumeId stays on LibraryBook untouched, so no
/// existing query, trigger or unique constraint changes.
model BookExternalId {
  id         Int      @id @default(autoincrement())
  bookId     Int      @map("book_id")
  /// local | audnexus | googlebooks | openlibrary
  source     String
  externalId String   @map("external_id")
  fetchedAt  DateTime @default(now()) @map("fetched_at")

  book LibraryBook @relation(fields: [bookId], references: [id], onDelete: Cascade)

  @@unique([bookId, source], map: "uq_book_external_ids_book_source")
  @@index([source, externalId], map: "ix_book_external_ids_source_external")
  @@map("book_external_ids")
}

/// Which source won each field. Powers the provenance tooltip and tells a
/// refresh what is stale. A provider that raised
/// BookProviderUnavailableError writes NO row here — otherwise a transient 503
/// would read as "that source has no narrators for this book" forever.
model BookMetadataField {
  id        Int      @id @default(autoincrement())
  bookId    Int      @map("book_id")
  field     String
  source    String
  fetchedAt DateTime @default(now()) @map("fetched_at")

  book LibraryBook @relation(fields: [bookId], references: [id], onDelete: Cascade)

  @@unique([bookId, field], map: "uq_book_metadata_fields_book_field")
  @@index([bookId], map: "ix_book_metadata_fields_book_id")
  @@map("book_metadata_fields")
}
```

- [ ] **Step 3: Add `Author.audibleAsin` and the settings column**

In the `Author` model, after `googleAuthorName`:

```prisma
  audibleAsin          String?  @unique @map("audible_asin")
```

In the `MediaSettings` model:

```prisma
  /// Metadata source priority, highest first. Absence from this array is the
  /// disable switch — see normalizeSourceOrder in @rawkoon/shared/utils.
  bookMetadataSourceOrder String[] @default(["local", "audnexus", "googlebooks", "openlibrary"]) @map("book_metadata_source_order")
```

- [ ] **Step 4: Generate and apply the migration**

```bash
bun run db:migrate:dev --name book_multi_source_metadata
```

Expected: a new directory under `apps/api/prisma/migrations/`, and the client regenerated. Confirm the generated SQL contains only `ALTER TABLE … ADD COLUMN` and `CREATE TABLE` — no `DROP` and no `RENAME`. If it proposes a drop, stop and re-read the schema edit.

- [ ] **Step 5: Extend the wire type and `mapBook`**

```ts
// apps/shared/src/types/books.ts — add to interface Book
  narrators: string[];
  genres: string[];
  publisher: string | null;
  pageCount: number | null;
  publishedDate: string | null;
  rating: number | null;
  ratingCount: number | null;
  /** field name -> source that supplied it. Absent fields were not enriched. */
  metadataSources: Record<string, BookMetadataSource>;
```

In `apps/api/src/routes/books/bookHelpers.ts`, add the same seven fields plus `metadataFields` to `MappableBook`, and map them in `mapBook`. `publishedDate` serializes as `book.publishedDate?.toISOString() ?? null`. Build `metadataSources` from the `metadataFields` rows:

```ts
  metadataSources: Object.fromEntries(
    (book.metadataFields ?? []).map((f) => [f.field, f.source]),
  ) as Record<string, BookMetadataSource>,
```

Add `metadataFields: { select: { field: true, source: true } }` to `bookInclude`.

- [ ] **Step 6: Verify nothing regressed**

Run: `bun run typecheck && bun run typecheck:native && bun run test`
Expected: PASS. The existing book suites exercise `mapBook`, so a missed field surfaces here.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/shared/src/types/books.ts apps/api/src/routes/books/bookHelpers.ts
git commit -m "feat(books): add multi-source metadata columns and provenance tables"
```

---

### Task 3: Series name normalizer

**Files:**
- Create: `apps/api/src/utils/books/seriesName.ts`
- Test: `apps/api/src/utils/books/seriesName.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeSeriesName(raw: string | null | undefined): string | null`, `parseSeriesPosition(raw: unknown): number | null`.

- [ ] **Step 1: Write the failing test**

Every input below is a scrubbed stand-in for a shape observed live on 2026-08-24.

```ts
// apps/api/src/utils/books/seriesName.test.ts
import { describe, expect, test } from "bun:test";
import {
  normalizeSeriesName,
  parseSeriesPosition,
} from "@rawkoon/api/utils/books/seriesName";

describe("normalizeSeriesName", () => {
  test("strips a leading colon and surrounding whitespace", () => {
    expect(normalizeSeriesName(": Le Jardin de Verre (LJDV)")).toBe(
      "Le Jardin de Verre",
    );
  });

  test("strips a bracketed edition marker", () => {
    expect(normalizeSeriesName("The Glasshouse Series [French Edition]")).toBe(
      "The Glasshouse Series",
    );
  });

  test("strips a trailing parenthesized acronym", () => {
    expect(normalizeSeriesName("Le Jardin de Verre (LJDV)")).toBe(
      "Le Jardin de Verre",
    );
  });

  // A parenthesized fragment that is not an edition/acronym marker is part of
  // the name. Stripping every parenthesis would corrupt legitimate titles.
  test("keeps a parenthesized fragment that is prose", () => {
    expect(normalizeSeriesName("Chroniques (les années perdues)")).toBe(
      "Chroniques (les années perdues)",
    );
  });

  test("returns null for empty or absent input", () => {
    expect(normalizeSeriesName(null)).toBeNull();
    expect(normalizeSeriesName("   ")).toBeNull();
    expect(normalizeSeriesName(":  ")).toBeNull();
  });
});

describe("parseSeriesPosition", () => {
  test("parses the string positions the provider returns", () => {
    expect(parseSeriesPosition("1")).toBe(1);
    expect(parseSeriesPosition("4.5")).toBe(4.5);
    expect(parseSeriesPosition(3)).toBe(3);
  });

  // Observed live: a novella in a series carried position "".
  test("returns null for an empty or non-numeric position", () => {
    expect(parseSeriesPosition("")).toBeNull();
    expect(parseSeriesPosition("Book One")).toBeNull();
    expect(parseSeriesPosition(null)).toBeNull();
    expect(parseSeriesPosition(Number.NaN)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/utils/books/seriesName.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/utils/books/seriesName`

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/utils/books/seriesName.ts
/**
 * Series names arrive dirty from Audible. Shapes observed live on 2026-08-24:
 * a leading colon, a bracketed "[French Edition]" marker, and a trailing
 * parenthesized acronym.
 *
 * This deliberately does NOT reconcile a series that arrives under two
 * different names across its volumes — observed live, where volumes 1-3 and
 * 4-7 of one series carry different series names. That is a data reality on
 * the provider side; inventing a canonical name would be a guess, so both are
 * stored as given and the operator can fix it with `overrides`.
 */

/** Bracketed markers are always metadata, never part of a name. */
const BRACKETED = /\s*\[[^\]]*\]\s*/g;

/**
 * A trailing parenthesized run that is short and has no lowercase prose is an
 * acronym or edition marker. "(LJDV)" goes; "(les années perdues)" stays.
 */
const TRAILING_ACRONYM = /\s*\(\s*[^a-z()]{1,12}\s*\)\s*$/u;

export function normalizeSeriesName(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  let out = raw.replace(BRACKETED, " ");
  out = out.replace(TRAILING_ACRONYM, " ");
  // Leading punctuation, then collapse the whitespace the strips left behind.
  out = out.replace(/^[\s:;,\-–—]+/u, "").replace(/\s+/gu, " ").trim();
  return out.length > 0 ? out : null;
}

export function parseSeriesPosition(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/utils/books/seriesName.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/books/seriesName.ts apps/api/src/utils/books/seriesName.test.ts
git commit -m "feat(books): normalize provider series names"
```

---

### Task 4: ASIN resolver

This is the highest-risk unit in the plan. A wrong ASIN is worse than no ASIN: it attaches a confident, complete, wrong record to a book.

**Files:**
- Create: `apps/api/src/services/books/asinResolver.ts`
- Test: `apps/api/src/services/books/asinResolver.test.ts`

**Interfaces:**
- Consumes: `normalizeTitleForMatch` from `@rawkoon/api/utils/medias/filenameParser` (already NFD-strips diacritics, lowercases, and reduces non-alphanumerics to spaces — do not reimplement it).
- Produces: `AsinCandidate`, `AsinMatch`, `extractVolumeNumber(title: string): number | null`, `scoreAsinCandidate(want: AsinWant, candidate: AsinCandidate): number`, `pickBestAsin(want: AsinWant, candidates: AsinCandidate[], opts?: { minScore?: number }): AsinMatch | null`, `ASIN_MIN_SCORE`, `AsinWant`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/books/asinResolver.test.ts
import { describe, expect, test } from "bun:test";
import {
  ASIN_MIN_SCORE,
  extractVolumeNumber,
  pickBestAsin,
  scoreAsinCandidate,
  type AsinCandidate,
  type AsinWant,
} from "@rawkoon/api/services/books/asinResolver";

const candidate = (over: Partial<AsinCandidate>): AsinCandidate => ({
  asin: "B000000001",
  title: "Le Jardin de Verre",
  subtitle: null,
  authors: ["Camille Rousseau"],
  narrators: [],
  seriesName: null,
  seriesPosition: null,
  language: "french",
  runtimeMin: null,
  publisher: null,
  releaseDate: null,
  coverUrl: null,
  genres: [],
  ...over,
});

describe("extractVolumeNumber", () => {
  test("reads the volume markers providers actually use", () => {
    expect(extractVolumeNumber("Les Jeux - tome 2 L'embrasement")).toBe(2);
    expect(extractVolumeNumber("Le Jardin de Verre Tome 1")).toBe(1);
    expect(extractVolumeNumber("The Glasshouse, Book 3")).toBe(3);
    expect(extractVolumeNumber("Chroniques vol. 4")).toBe(4);
    expect(extractVolumeNumber("Chroniques, Volume 12")).toBe(12);
  });

  test("returns null when there is no volume marker", () => {
    expect(extractVolumeNumber("Le Jardin de Verre")).toBeNull();
    // A bare year must not be read as a volume.
    expect(extractVolumeNumber("Chroniques 1998")).toBeNull();
  });
});

describe("scoreAsinCandidate", () => {
  const want: AsinWant = {
    title: "Le Jardin de Verre",
    authors: ["Camille Rousseau"],
    language: "fr",
  };

  test("scores an exact normalized title with matching author above the floor", () => {
    expect(scoreAsinCandidate(want, candidate({}))).toBeGreaterThanOrEqual(
      ASIN_MIN_SCORE,
    );
  });

  test("ignores diacritics and punctuation when comparing titles", () => {
    const score = scoreAsinCandidate(want, candidate({ title: "LE JARDIN DE VERRE!" }));
    expect(score).toBeGreaterThanOrEqual(ASIN_MIN_SCORE);
  });

  /**
   * The hazard this module exists for. Observed live: a naive substring match
   * mapped a "tome 2" library title onto the tome-1 product, because the
   * tome-1 title is a strict prefix of the tome-2 title. The tome-1 product's
   * own title carries no number — only its seriesPosition does — so the
   * candidate's volume must fall back to seriesPosition or the collision
   * survives.
   */
  test("disqualifies a candidate whose volume number disagrees", () => {
    const wantVol2: AsinWant = {
      title: "Les Jeux - tome 2 L'embrasement",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const vol1 = candidate({
      title: "Les Jeux",
      seriesName: "Les Jeux",
      seriesPosition: 1,
    });
    expect(scoreAsinCandidate(wantVol2, vol1)).toBe(-1);
    expect(pickBestAsin(wantVol2, [vol1])).toBeNull();
  });

  test("reads the candidate volume from its subtitle when the title lacks one", () => {
    const wantVol3: AsinWant = {
      title: "Le Jardin de Verre Tome 3",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const vol1 = candidate({
      title: "Le Jardin de Verre",
      subtitle: "Le Jardin de Verre - Tome 1",
    });
    expect(scoreAsinCandidate(wantVol3, vol1)).toBe(-1);
  });

  /**
   * Observed live: a French edition came back from the catalog with
   * language "english". Language may score, but must never gate — gating on it
   * loses a correct match outright.
   */
  test("a mislabelled language costs points but does not disqualify", () => {
    const score = scoreAsinCandidate(want, candidate({ language: "english" }));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeGreaterThanOrEqual(ASIN_MIN_SCORE);
  });

  test("a wholly different author disqualifies", () => {
    expect(
      scoreAsinCandidate(want, candidate({ authors: ["Nenad Savic"] })),
    ).toBe(-1);
  });
});

describe("pickBestAsin", () => {
  test("returns nothing rather than a weak guess", () => {
    const want: AsinWant = {
      title: "Mises en Abyme",
      authors: ["Guillaume Tremblay"],
      language: "fr",
    };
    // Stands in for the observed live case of a title with no Audible edition:
    // the catalog returned unrelated products.
    expect(pickBestAsin(want, [candidate({})])).toBeNull();
  });

  test("picks the highest scorer among plausible candidates", () => {
    const want: AsinWant = {
      title: "Le Jardin de Verre",
      authors: ["Camille Rousseau"],
      language: "fr",
    };
    const best = pickBestAsin(want, [
      candidate({ asin: "B000000002", title: "Le Jardin de Verre - extrait" }),
      candidate({ asin: "B000000003" }),
    ]);
    expect(best?.candidate.asin).toBe("B000000003");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/books/asinResolver.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/services/books/asinResolver`

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/services/books/asinResolver.ts
import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";

/**
 * Audnexus is ASIN-keyed and exposes no book title search, so every ASIN comes
 * from a freetext catalog query. Nothing but this scorer stands between the
 * library and a confidently wrong record — which is worse than no record,
 * because it looks complete.
 */

export interface AsinCandidate {
  asin: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  /** As the provider spells it: "french", "english". Not ISO 639-1. */
  language: string | null;
  runtimeMin: number | null;
  publisher: string | null;
  releaseDate: string | null;
  coverUrl: string | null;
  genres: string[];
}

export interface AsinWant {
  title: string;
  authors: string[];
  /** ISO 639-1. */
  language: string;
}

export interface AsinMatch {
  candidate: AsinCandidate;
  score: number;
}

/** Below this, no ASIN is recorded and the book keeps its Google Books data. */
export const ASIN_MIN_SCORE = 60;

const DISQUALIFIED = -1;

/**
 * Volume markers as providers actually spell them. The trailing `\d{1,3}`
 * bound keeps a four-digit year from being read as a volume number.
 */
const VOLUME_RE =
  /\b(?:tome|tomo|volume|vol|book|livre|partie|part|t)\s*\.?\s*(\d{1,3})\b/iu;

export function extractVolumeNumber(title: string): number | null {
  const m = VOLUME_RE.exec(title);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * A candidate's volume can live in three places. The title is checked first,
 * then the subtitle, then seriesPosition — and that last fallback is what
 * catches the observed collision, where the volume-1 product's title carries
 * no number at all.
 */
const candidateVolume = (c: AsinCandidate): number | null =>
  extractVolumeNumber(c.title) ??
  (c.subtitle ? extractVolumeNumber(c.subtitle) : null) ??
  (c.seriesPosition !== null && Number.isInteger(c.seriesPosition)
    ? c.seriesPosition
    : null);

const LANG_ALIASES: Record<string, string> = {
  french: "fr",
  français: "fr",
  english: "en",
  anglais: "en",
  german: "de",
  spanish: "es",
  italian: "it",
};

const toIso639 = (raw: string | null): string | null => {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (LANG_ALIASES[key]) return LANG_ALIASES[key];
  return /^[a-z]{2}$/.test(key) ? key : null;
};

const authorTokens = (names: string[]): Set<string> => {
  const out = new Set<string>();
  for (const name of names) {
    for (const tok of normalizeTitleForMatch(name).split(" ")) {
      // Two-letter fragments are initials and particles; they match everything.
      if (tok.length > 2) out.add(tok);
    }
  }
  return out;
};

export function scoreAsinCandidate(
  want: AsinWant,
  candidate: AsinCandidate,
): number {
  // 1. Volume agreement. Disqualifying, not merely penalising.
  const wantVol = extractVolumeNumber(want.title);
  const candVol = candidateVolume(candidate);
  if (wantVol !== null && candVol !== null && wantVol !== candVol) {
    return DISQUALIFIED;
  }

  // 2. Author overlap. No shared token means a different book by a different
  // person, whatever the title similarity says.
  const wantAuthors = authorTokens(want.authors);
  const candAuthors = authorTokens(candidate.authors);
  let shared = 0;
  for (const tok of wantAuthors) if (candAuthors.has(tok)) shared++;
  if (wantAuthors.size > 0 && shared === 0) return DISQUALIFIED;
  const authorScore = wantAuthors.size === 0 ? 0 : (shared / wantAuthors.size) * 30;

  // 3. Title. Exact normalized equality is the strong signal; containment is
  // deliberately much weaker, because containment is what caused the
  // volume collision in the first place.
  const wantTitle = normalizeTitleForMatch(want.title);
  const candTitle = normalizeTitleForMatch(candidate.title);
  let titleScore = 0;
  if (wantTitle && wantTitle === candTitle) titleScore = 50;
  else if (
    wantTitle &&
    candTitle &&
    (wantTitle.includes(candTitle) || candTitle.includes(wantTitle))
  ) {
    titleScore = 25;
  }
  if (titleScore === 0) return DISQUALIFIED;

  // 4. Language. A signal only: a French edition was observed reporting
  // "english", so gating on this loses correct matches.
  const candLang = toIso639(candidate.language);
  const langScore = candLang && candLang === want.language.toLowerCase() ? 10 : 0;

  const volScore = wantVol !== null && candVol === wantVol ? 10 : 0;

  return titleScore + authorScore + langScore + volScore;
}

export function pickBestAsin(
  want: AsinWant,
  candidates: AsinCandidate[],
  opts?: { minScore?: number },
): AsinMatch | null {
  const floor = opts?.minScore ?? ASIN_MIN_SCORE;
  let best: AsinMatch | null = null;
  for (const candidate of candidates) {
    const score = scoreAsinCandidate(want, candidate);
    if (score < floor) continue;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/books/asinResolver.test.ts`
Expected: PASS, 10 tests. If the volume-collision test fails, do not relax the assertion — the `candidateVolume` seriesPosition fallback is the fix.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/asinResolver.ts apps/api/src/services/books/asinResolver.test.ts
git commit -m "feat(books): score ASIN candidates with a disqualifying volume check"
```

---

### Task 5: Audible catalog client

**Files:**
- Create: `apps/api/src/services/books/audibleCatalog.ts`
- Test: `apps/api/test/fixtures/bookMetadata/audible-catalog-series.json`
- Test: `apps/api/src/services/books/audibleCatalog.test.ts`

**Interfaces:**
- Consumes: `AsinCandidate` (Task 4), `normalizeSeriesName` / `parseSeriesPosition` (Task 3), `getJsonCache` / `setJsonCache` from `@rawkoon/api/services/cache`, `BookProviderUnavailableError` (Task 1).
- Produces: `mapAudibleProduct(raw: unknown): AsinCandidate | null`, `searchAudibleProducts(keywords: string, opts: { region: string; limit?: number }): Promise<AsinCandidate[]>`, `AUDIBLE_TLD_BY_REGION`.

- [ ] **Step 1: Write the fixture**

Structure captured live 2026-08-24; strings scrubbed. The three products share a series with sequential positions, and each carries two narrators.

```json
{
  "products": [
    {
      "asin": "B0SCRUB001",
      "title": "Le Jardin de Verre",
      "subtitle": "Le Jardin de Verre - Tome 1",
      "authors": [{ "name": "Camille Rousseau" }],
      "narrators": [{ "name": "Laure Vidal" }, { "name": "Audrey Meunier" }],
      "series": [{ "title": "Le Jardin de Verre", "sequence": "1" }],
      "language": "french",
      "runtime_length_min": 578,
      "publisher_name": "Éditions Lisière",
      "release_date": "2024-06-27",
      "product_images": { "500": "https://example.invalid/cover-1.jpg" }
    },
    {
      "asin": "B0SCRUB002",
      "title": "Les Secrets du Jardin de Verre",
      "subtitle": "Le Jardin de Verre - Tome 2",
      "authors": [{ "name": "Camille Rousseau" }],
      "narrators": [{ "name": "Laure Vidal" }, { "name": "Marie Bouchard" }],
      "series": [{ "title": "Le Jardin de Verre", "sequence": "2" }],
      "language": "french",
      "runtime_length_min": 499,
      "publisher_name": "Éditions Lisière",
      "release_date": "2024-07-11",
      "product_images": { "500": "https://example.invalid/cover-2.jpg" }
    },
    {
      "asin": "B0SCRUB003",
      "title": "Le Jardin de Verre se referme",
      "subtitle": "Une nouvelle de Camille Rousseau",
      "authors": [
        { "name": "Camille Rousseau" },
        { "name": "Karine Forestier - traducteur" }
      ],
      "narrators": [{ "name": "Jérémy Bardin" }],
      "series": [{ "title": "Le Jardin de Verre", "sequence": "" }],
      "language": "french",
      "runtime_length_min": 93,
      "publisher_name": "Éditions Lisière",
      "release_date": "2025-05-21",
      "product_images": { "500": "https://example.invalid/cover-3.jpg" }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/services/books/audibleCatalog.test.ts
import { describe, expect, test } from "bun:test";
import {
  AUDIBLE_TLD_BY_REGION,
  mapAudibleProduct,
} from "@rawkoon/api/services/books/audibleCatalog";
import fixture from "../../../test/fixtures/bookMetadata/audible-catalog-series.json";

const products = fixture.products as unknown[];

describe("mapAudibleProduct", () => {
  test("maps a product to an AsinCandidate", () => {
    const c = mapAudibleProduct(products[0]);
    expect(c).not.toBeNull();
    expect(c?.asin).toBe("B0SCRUB001");
    expect(c?.narrators).toEqual(["Laure Vidal", "Audrey Meunier"]);
    expect(c?.seriesName).toBe("Le Jardin de Verre");
    expect(c?.seriesPosition).toBe(1);
    expect(c?.runtimeMin).toBe(578);
    expect(c?.publisher).toBe("Éditions Lisière");
    expect(c?.coverUrl).toBe("https://example.invalid/cover-1.jpg");
  });

  // Observed live: a novella in a series carries sequence "".
  test("tolerates an empty series sequence", () => {
    const c = mapAudibleProduct(products[2]);
    expect(c?.seriesName).toBe("Le Jardin de Verre");
    expect(c?.seriesPosition).toBeNull();
  });

  // Observed live: the catalog lists translators inside `authors`. Letting
  // them through would propagate a translator into LibraryBook.authors via
  // the book_authors trigger, which already happened once with Google Books.
  test("drops role-annotated contributors from authors", () => {
    const c = mapAudibleProduct(products[2]);
    expect(c?.authors).toEqual(["Camille Rousseau"]);
  });

  test("returns null when the product has no asin or title", () => {
    expect(mapAudibleProduct({ title: "No asin" })).toBeNull();
    expect(mapAudibleProduct({ asin: "B0SCRUB009" })).toBeNull();
    expect(mapAudibleProduct(null)).toBeNull();
  });
});

describe("AUDIBLE_TLD_BY_REGION", () => {
  test("maps the regions Audnexus accepts", () => {
    expect(AUDIBLE_TLD_BY_REGION.fr).toBe("fr");
    expect(AUDIBLE_TLD_BY_REGION.us).toBe("com");
    expect(AUDIBLE_TLD_BY_REGION.uk).toBe("co.uk");
    expect(AUDIBLE_TLD_BY_REGION.ca).toBe("ca");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/books/audibleCatalog.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/services/books/audibleCatalog`

- [ ] **Step 4: Write the implementation**

```ts
// apps/api/src/services/books/audibleCatalog.ts
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import {
  normalizeSeriesName,
  parseSeriesPosition,
} from "@rawkoon/api/utils/books/seriesName";
import { BookProviderUnavailableError, type AsinCandidate } from "./types";

/**
 * Audnexus has no book title search — GET /books/{asin} is ASIN-keyed only —
 * so ASINs come from Audible's own catalog API. This is the route
 * Audiobookshelf takes too.
 *
 * Verified live 2026-08-24 against api.audible.fr: this response_groups set is
 * the one that returns contributors and series; without it narrators and
 * series are simply absent from the payload.
 */
const RESPONSE_GROUPS =
  "product_desc,product_attrs,contributors,series,media,product_extended_attrs";

export const AUDIBLE_TLD_BY_REGION: Record<string, string> = {
  au: "com.au",
  br: "com.br",
  ca: "ca",
  de: "de",
  es: "es",
  fr: "fr",
  in: "in",
  it: "it",
  jp: "co.jp",
  uk: "co.uk",
  us: "com",
};

const CACHE_TTL_SEARCH = 3600; // 1h — same TTL the Google provider uses.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * The catalog lists translators and other roles inside `authors`, annotated in
 * the name itself ("Karine Forestier - traducteur"). Google Books does the
 * same, and the book_authors trigger propagated a translator into
 * LibraryBook.authors as a result. Drop annotated entries here.
 */
const ROLE_ANNOTATION = /\s[-–—]\s*(traducteur|translator|adapt|illustrat)/iu;

const names = (v: unknown, dropRoles = false): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const name = str((entry as Record<string, unknown>).name);
    if (!name) continue;
    if (dropRoles && ROLE_ANNOTATION.test(name)) continue;
    out.push(name);
  }
  return out;
};

const coverFrom = (images: unknown): string | null => {
  if (!images || typeof images !== "object") return null;
  const map = images as Record<string, unknown>;
  // Widest available wins; the keys are pixel widths as strings.
  const widths = Object.keys(map)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  for (const w of widths) {
    const url = str(map[String(w)]);
    if (url) return url;
  }
  return null;
};

export function mapAudibleProduct(raw: unknown): AsinCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const asin = str(p.asin);
  const title = str(p.title);
  if (!asin || !title) return null;

  const series = Array.isArray(p.series)
    ? (p.series[0] as Record<string, unknown> | undefined)
    : undefined;

  const runtime = p.runtime_length_min;

  return {
    asin,
    title,
    subtitle: str(p.subtitle),
    authors: names(p.authors, true),
    narrators: names(p.narrators),
    seriesName: normalizeSeriesName(str(series?.title)),
    seriesPosition: parseSeriesPosition(series?.sequence),
    language: str(p.language),
    runtimeMin: typeof runtime === "number" && runtime > 0 ? runtime : null,
    publisher: str(p.publisher_name),
    releaseDate: str(p.release_date),
    coverUrl: coverFrom(p.product_images),
    genres: [],
  };
}

export async function searchAudibleProducts(
  keywords: string,
  opts: { region: string; limit?: number },
): Promise<AsinCandidate[]> {
  const term = keywords.replace(/\s+/gu, " ").trim();
  if (!term) return [];
  const region = opts.region.trim().toLowerCase();
  const tld = AUDIBLE_TLD_BY_REGION[region];
  if (!tld) {
    throw new BookProviderUnavailableError(
      `Unsupported Audible region "${region}"`,
    );
  }
  const limit = Math.min(20, Math.max(1, opts.limit ?? 5));

  const cacheKey = `books:audible:search:${region}:${term.toLowerCase()}:${limit}`;
  const hit = await getJsonCache<AsinCandidate[]>(cacheKey);
  if (hit) return hit;

  const url = new URL(`https://api.audible.${tld}/1.0/catalog/products`);
  url.searchParams.set("keywords", term);
  url.searchParams.set("num_results", String(limit));
  url.searchParams.set("products_sort_by", "Relevance");
  url.searchParams.set("response_groups", RESPONSE_GROUPS);

  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as {
        products?: unknown;
      } | null;
      const raw = Array.isArray(body?.products) ? body.products : [];
      const mapped = raw
        .map(mapAudibleProduct)
        .filter((c): c is AsinCandidate => c !== null);
      // Cache successes only. Caching an outage would make the book
      // unresolvable until the TTL expired.
      if (mapped.length > 0) {
        await setJsonCache(cacheKey, mapped, CACHE_TTL_SEARCH);
      }
      return mapped;
    }

    lastStatus = res?.status;
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `Audible rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  throw new BookProviderUnavailableError(
    `Audible unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}
```

Move the `AsinCandidate`, `AsinWant` and `AsinMatch` interfaces from `asinResolver.ts` into `services/books/types.ts` and re-export them from `asinResolver.ts`, so `audibleCatalog.ts` does not import from the scorer. Update the Task 4 test import to keep working — it imports the types from `asinResolver`, which still re-exports them.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/books/audibleCatalog.test.ts src/services/books/asinResolver.test.ts`
Expected: PASS, 15 tests total

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/books/audibleCatalog.ts apps/api/src/services/books/audibleCatalog.test.ts apps/api/src/services/books/types.ts apps/api/src/services/books/asinResolver.ts apps/api/test/fixtures/bookMetadata/audible-catalog-series.json
git commit -m "feat(books): resolve ASINs from the Audible catalog API"
```

---

### Task 6: Audnexus integration config

**Files:**
- Modify: `apps/api/src/utils/integrations/types.ts`
- Modify: `apps/api/src/utils/integrations/normalizers.ts`
- Test: `apps/api/src/utils/integrations/normalizers.test.ts` (create if absent)

**Interfaces:**
- Consumes: `normalizeSecret` (already in `normalizers.ts`) is **not** used here — Audnexus has no secret.
- Produces: `AudnexusIntegrationConfig { base_url: string; region: string }`, `normalizeAudnexusConfig(config: unknown): AudnexusIntegrationConfig | null`, `AUDNEXUS_DEFAULT_BASE_URL`, `AUDNEXUS_DEFAULT_REGION`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/utils/integrations/normalizers.test.ts
import { describe, expect, test } from "bun:test";
import {
  AUDNEXUS_DEFAULT_BASE_URL,
  AUDNEXUS_DEFAULT_REGION,
  normalizeAudnexusConfig,
} from "@rawkoon/api/utils/integrations/normalizers";

describe("normalizeAudnexusConfig", () => {
  // Unlike Google Books, Audnexus needs no key: the public instance is
  // keyless, so an empty config is fully usable and must normalize to the
  // defaults rather than to null.
  test("defaults an empty config to the public instance", () => {
    expect(normalizeAudnexusConfig({})).toEqual({
      base_url: AUDNEXUS_DEFAULT_BASE_URL,
      region: AUDNEXUS_DEFAULT_REGION,
    });
  });

  test("keeps a self-hosted base URL and strips its trailing slash", () => {
    expect(
      normalizeAudnexusConfig({ base_url: "http://audnexus.lan:3000/", region: "fr" }),
    ).toEqual({ base_url: "http://audnexus.lan:3000", region: "fr" });
  });

  test("rejects a non-http base URL", () => {
    expect(normalizeAudnexusConfig({ base_url: "file:///etc/passwd" })).toBeNull();
    expect(normalizeAudnexusConfig({ base_url: "not a url" })).toBeNull();
  });

  test("falls back to the default region for an unknown one", () => {
    expect(normalizeAudnexusConfig({ region: "atlantis" })?.region).toBe(
      AUDNEXUS_DEFAULT_REGION,
    );
  });

  test("returns null for a non-object config", () => {
    expect(normalizeAudnexusConfig(null)).toBeNull();
    expect(normalizeAudnexusConfig([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/utils/integrations/normalizers.test.ts`
Expected: FAIL — `normalizeAudnexusConfig` is not exported

- [ ] **Step 3: Add the config type**

```ts
// apps/api/src/utils/integrations/types.ts — append
/**
 * Audnexus needs no API key: the public instance at api.audnex.us is keyless
 * (verified 2026-08-24, x-ratelimit-limit 300/60s per IP). base_url exists so
 * a self-hosted instance can be pointed at instead — the project publishes no
 * prebuilt image, so self-hosting means building from source.
 */
export interface AudnexusIntegrationConfig {
  base_url: string;
  region: string;
}
```

- [ ] **Step 4: Write the normalizer**

```ts
// apps/api/src/utils/integrations/normalizers.ts — append
import { AUDIBLE_TLD_BY_REGION } from "@rawkoon/api/services/books/audibleCatalog";

export const AUDNEXUS_DEFAULT_BASE_URL = "https://api.audnex.us";
export const AUDNEXUS_DEFAULT_REGION = "us";

export const normalizeAudnexusConfig = (
  config: unknown,
): AudnexusIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;

  let baseUrl = AUDNEXUS_DEFAULT_BASE_URL;
  const rawUrl = typeof cfg.base_url === "string" ? cfg.base_url.trim() : "";
  if (rawUrl) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    baseUrl = rawUrl.replace(/\/+$/u, "");
  }

  const rawRegion =
    typeof cfg.region === "string" ? cfg.region.trim().toLowerCase() : "";
  const region = AUDIBLE_TLD_BY_REGION[rawRegion]
    ? rawRegion
    : AUDNEXUS_DEFAULT_REGION;

  return { base_url: baseUrl, region };
};
```

Add `AudnexusIntegrationConfig` to the existing type import at the top of `normalizers.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && bun test src/utils/integrations/normalizers.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/integrations/types.ts apps/api/src/utils/integrations/normalizers.ts apps/api/src/utils/integrations/normalizers.test.ts
git commit -m "feat(books): add the Audnexus integration config"
```

---

### Task 7: Audnexus provider

**Files:**
- Create: `apps/api/src/services/books/audnexusProvider.ts`
- Test: `apps/api/test/fixtures/bookMetadata/audnexus-book.json`
- Test: `apps/api/test/fixtures/bookMetadata/audnexus-author-empty-description.json`
- Test: `apps/api/test/fixtures/bookMetadata/audnexus-author-search-duplicates.json`
- Test: `apps/api/src/services/books/audnexusProvider.test.ts`
- Modify: `apps/api/src/services/books/index.ts`

**Interfaces:**
- Consumes: `searchAudibleProducts` (Task 5), `pickBestAsin` (Task 4), `normalizeAudnexusConfig` (Task 6), `ProviderFields` / `BookMatchInput` (Task 1), `getIntegrationConfigRecord`.
- Produces: `mapAudnexusBook(raw: unknown): ProviderFields`, `dedupeAudnexusAuthors(raw: unknown): Array<{ asin: string; name: string }>`, `getAudnexusProvider(): Promise<BookMetadataProvider | null>`, `AudnexusProvider` (with `enrich` and `resolveAsin`).

- [ ] **Step 1: Write the fixtures**

`audnexus-book.json` — structure captured live, strings scrubbed. Note `genres` carries two `type` values, `rating` is a string, and `language` is a word not a code:

```json
{
  "asin": "B0SCRUB001",
  "title": "Le Jardin de Verre",
  "subtitle": "Le Jardin de Verre - Tome 1",
  "authors": [{ "asin": "B0SCRUBA01", "name": "Camille Rousseau" }],
  "narrators": [{ "name": "Laure Vidal" }, { "name": "Audrey Meunier" }],
  "seriesPrimary": { "asin": "B0SCRUBS01", "name": "Le Jardin de Verre", "position": "1" },
  "genres": [
    { "asin": "21228876031", "name": "Policier et suspense", "type": "genre" },
    { "asin": "21228884031", "name": "Littérature et fiction", "type": "genre" },
    { "asin": "21228906031", "name": "Thrillers", "type": "tag" }
  ],
  "language": "french",
  "publisherName": "Éditions Lisière",
  "releaseDate": "2024-06-27T00:00:00.000Z",
  "runtimeLengthMin": 578,
  "isbn": "9791036631573",
  "rating": "4.6",
  "region": "fr",
  "formatType": "unabridged",
  "image": "https://example.invalid/cover-large.jpg",
  "summary": "<p>Chaque jour, elle nettoie la grande maison.</p>",
  "description": "Chaque jour, elle nettoie la grande maison."
}
```

`audnexus-author-empty-description.json` — the observed FR-region author shape:

```json
{
  "asin": "B0SCRUBA01",
  "name": "Camille Rousseau",
  "description": "",
  "image": "https://example.invalid/author.jpg",
  "genres": [{ "asin": "21228876031", "name": "Policier et suspense", "type": "genre" }],
  "region": "fr",
  "similar": []
}
```

`audnexus-author-search-duplicates.json` — ten identical rows for one ASIN, as observed:

```json
[
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBA01", "name": "Camille Rousseau" },
  { "asin": "B0SCRUBB02", "name": "Jonathan Rousseau" },
  { "asin": "B0SCRUBC03", "name": "Renée Rousseau-Blais" }
]
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/services/books/audnexusProvider.test.ts
import { describe, expect, test } from "bun:test";
import {
  dedupeAudnexusAuthors,
  mapAudnexusBook,
} from "@rawkoon/api/services/books/audnexusProvider";
import book from "../../../test/fixtures/bookMetadata/audnexus-book.json";
import authorEmpty from "../../../test/fixtures/bookMetadata/audnexus-author-empty-description.json";
import authorDupes from "../../../test/fixtures/bookMetadata/audnexus-author-search-duplicates.json";

describe("mapAudnexusBook", () => {
  test("maps the fields Google Books leaves empty", () => {
    const f = mapAudnexusBook(book);
    expect(f.narrators).toEqual(["Laure Vidal", "Audrey Meunier"]);
    expect(f.seriesName).toBe("Le Jardin de Verre");
    expect(f.seriesPosition).toBe(1);
    expect(f.publisher).toBe("Éditions Lisière");
    expect(f.rating).toBe(4.6);
    expect(f.coverUrl).toBe("https://example.invalid/cover-large.jpg");
    expect(f.publishedDate).toBe("2024-06-27T00:00:00.000Z");
    expect(f.publishedYear).toBe(2024);
  });

  // Audible's taxonomy splits `genre` from `tag`. Both are genres to us, but
  // they arrive in one array and the type must not leak into the value.
  test("flattens genres and tags to names", () => {
    expect(mapAudnexusBook(book).genres).toEqual([
      "Policier et suspense",
      "Littérature et fiction",
      "Thrillers",
    ]);
  });

  // Audnexus reports a language word, not ISO 639-1.
  test("converts the language word to ISO 639-1", () => {
    expect(mapAudnexusBook(book).language).toBe("fr");
  });

  // `summary` is HTML, `description` is plain. The database only ever holds
  // sanitized HTML, matching what the Google provider already does.
  test("prefers the HTML summary, sanitized", () => {
    const overview = mapAudnexusBook(book).overview ?? "";
    expect(overview).toContain("Chaque jour");
    expect(overview).not.toContain("<script");
  });

  test("returns an empty contribution for junk input", () => {
    expect(mapAudnexusBook(null)).toEqual({});
    expect(mapAudnexusBook({ asin: "B0SCRUB001" })).toEqual({});
  });

  test("carries the author image and omits an empty author bio", () => {
    const f = mapAudnexusBook(authorEmpty);
    // An empty string is not an assertion of emptiness — it is missing data,
    // so the key must be absent and a lower-priority source can still fill it.
    expect("authorBio" in f).toBe(false);
  });
});

describe("dedupeAudnexusAuthors", () => {
  // Observed live: ten identical rows for one ASIN.
  test("collapses duplicate rows by ASIN, preserving order", () => {
    expect(dedupeAudnexusAuthors(authorDupes)).toEqual([
      { asin: "B0SCRUBA01", name: "Camille Rousseau" },
      { asin: "B0SCRUBB02", name: "Jonathan Rousseau" },
      { asin: "B0SCRUBC03", name: "Renée Rousseau-Blais" },
    ]);
  });

  test("returns an empty list for junk", () => {
    expect(dedupeAudnexusAuthors(null)).toEqual([]);
    expect(dedupeAudnexusAuthors([{ name: "no asin" }])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/books/audnexusProvider.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/services/books/audnexusProvider`

- [ ] **Step 4: Write the mappers and provider**

```ts
// apps/api/src/services/books/audnexusProvider.ts
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeAudnexusConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { sanitizeProviderHtml } from "@rawkoon/shared/utils";
import {
  normalizeSeriesName,
  parseSeriesPosition,
} from "@rawkoon/api/utils/books/seriesName";
import { searchAudibleProducts } from "./audibleCatalog";
import { pickBestAsin } from "./asinResolver";
import {
  BookProviderUnavailableError,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderFields,
} from "./types";

/**
 * Audnexus (GPL-3.0) is the API Audiobookshelf uses by default. Verified live
 * 2026-08-24: the public instance is keyless and rate-limits at 300 requests
 * per 60s per IP, Cloudflare-cached for 24h.
 *
 * Two facts shape this file:
 *  - There is no book title search, so an ASIN must be resolved from the
 *    Audible catalog first (see audibleCatalog.ts + asinResolver.ts).
 *  - `region` must be passed explicitly on every call; it is not inferred.
 */

const CACHE_TTL_BOOK = 86_400; // 24h, matching Audnexus' own cache-control.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const LANG_ALIASES: Record<string, string> = {
  french: "fr",
  english: "en",
  german: "de",
  spanish: "es",
  italian: "it",
  japanese: "ja",
  portuguese: "pt",
};

const toIso639 = (raw: string | null): string | null => {
  if (!raw) return null;
  const key = raw.toLowerCase();
  return LANG_ALIASES[key] ?? (/^[a-z]{2}$/.test(key) ? key : null);
};

export function mapAudnexusBook(raw: unknown): ProviderFields {
  if (!raw || typeof raw !== "object") return {};
  const b = raw as Record<string, unknown>;
  const asin = str(b.asin);
  const title = str(b.title);
  const name = str(b.name);
  // An author payload has `name`, not `title`. Handle it here so a caller can
  // pass either without branching.
  if (asin && !title && name) {
    const fields: ProviderFields = {};
    const image = str(b.image);
    if (image) fields.authorImageUrl = image;
    // An empty description is missing data, not an assertion of emptiness, so
    // the key stays absent and a lower-priority source can still supply it.
    const bio = str(b.description);
    if (bio) fields.authorBio = bio;
    return fields;
  }
  if (!asin || !title) return {};

  const narrators = Array.isArray(b.narrators)
    ? b.narrators
        .map((n) =>
          n && typeof n === "object"
            ? str((n as Record<string, unknown>).name)
            : null,
        )
        .filter((n): n is string => n !== null)
    : [];

  // Audible splits its taxonomy into `genre` and `tag`. Both are genres here;
  // the type must not leak into the stored value.
  const genres = Array.isArray(b.genres)
    ? b.genres
        .map((g) =>
          g && typeof g === "object"
            ? str((g as Record<string, unknown>).name)
            : null,
        )
        .filter((g): g is string => g !== null)
    : [];

  const series = b.seriesPrimary as Record<string, unknown> | undefined;
  const releaseDate = str(b.releaseDate);
  const runtime = b.runtimeLengthMin;
  // `rating` arrives as a string.
  const ratingRaw = Number(str(b.rating) ?? Number.NaN);

  const fields: ProviderFields = {
    title,
    subtitle: str(b.subtitle),
    narrators,
    genres,
    publisher: str(b.publisherName),
    isbn13: str(b.isbn),
    coverUrl: str(b.image),
    overview: sanitizeProviderHtml(str(b.summary) ?? str(b.description) ?? "") || null,
    seriesName: normalizeSeriesName(str(series?.name)),
    seriesPosition: parseSeriesPosition(series?.position),
    language: toIso639(str(b.language)),
    rating: Number.isFinite(ratingRaw) ? ratingRaw : null,
  };
  if (releaseDate) {
    fields.publishedDate = releaseDate;
    const year = Number(releaseDate.slice(0, 4));
    if (Number.isFinite(year)) fields.publishedYear = year;
  }
  if (typeof runtime === "number" && runtime > 0) {
    // Runtime belongs to the edition, not the book; the caller decides what to
    // do with it, so it is not part of ProviderFields.
  }
  return fields;
}

/** The author search returns the same ASIN many times over. */
export function dedupeAudnexusAuthors(
  raw: unknown,
): Array<{ asin: string; name: string }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ asin: string; name: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const asin = str(e.asin);
    const name = str(e.name);
    if (!asin || !name || seen.has(asin)) continue;
    seen.add(asin);
    out.push({ asin, name });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown | null> {
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (res?.ok) return await res.json().catch(() => null);
    if (res?.status === 404) return null;
    lastStatus = res?.status;
    if (res && res.status < 500 && res.status !== 429) {
      throw new BookProviderUnavailableError(
        `Audnexus rejected the request (HTTP ${res.status})`,
        res.status,
      );
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  throw new BookProviderUnavailableError(
    `Audnexus unavailable after ${MAX_ATTEMPTS} attempts` +
      (lastStatus ? ` (last status ${lastStatus})` : ""),
    lastStatus,
  );
}

class AudnexusProvider implements BookMetadataProvider {
  readonly source = "audnexus" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly region: string,
  ) {}

  /** Resolve an ASIN from the Audible catalog. Null means "no confident match". */
  async resolveAsin(book: BookMatchInput): Promise<string | null> {
    const candidates = await searchAudibleProducts(
      `${book.title} ${book.authors.join(" ")}`,
      { region: this.region, limit: 5 },
    );
    const match = pickBestAsin(
      { title: book.title, authors: book.authors, language: book.language },
      candidates,
    );
    return match?.candidate.asin ?? null;
  }

  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const asin = book.externalIds.audnexus ?? (await this.resolveAsin(book));
    if (!asin) return {};

    const cacheKey = `books:audnexus:book:${this.region}:${asin}`;
    const cached = await getJsonCache<ProviderFields>(cacheKey);
    if (cached) return { ...cached, isbn13: cached.isbn13 ?? null };

    const raw = await fetchJson(
      `${this.baseUrl}/books/${encodeURIComponent(asin)}?region=${encodeURIComponent(this.region)}`,
    );
    if (!raw) return {};
    const fields = mapAudnexusBook(raw);
    if (Object.keys(fields).length > 0) {
      await setJsonCache(cacheKey, fields, CACHE_TTL_BOOK);
    }
    // Record the ASIN so refreshBookMetadata can persist it.
    return { ...fields, __asin: asin } as ProviderFields;
  }

  /**
   * Author bio and image. The FR region was observed returning a good image
   * with an EMPTY description, so fall back to the default region for the bio
   * only — the image from the requested region is correct and must be kept.
   */
  async enrichAuthor(authorName: string): Promise<ProviderFields> {
    const list = dedupeAudnexusAuthors(
      await fetchJson(
        `${this.baseUrl}/authors?name=${encodeURIComponent(authorName)}&region=${encodeURIComponent(this.region)}`,
      ),
    );
    const first = list[0];
    if (!first) return {};

    const primary = mapAudnexusBook(
      await fetchJson(
        `${this.baseUrl}/authors/${first.asin}?region=${encodeURIComponent(this.region)}`,
      ),
    );
    if (primary.authorBio) return { ...primary, __asin: first.asin } as ProviderFields;

    const fallback = mapAudnexusBook(
      await fetchJson(`${this.baseUrl}/authors/${first.asin}?region=us`),
    );
    return {
      ...primary,
      ...(fallback.authorBio ? { authorBio: fallback.authorBio } : {}),
      __asin: first.asin,
    } as ProviderFields;
  }
}

export async function getAudnexusProvider(): Promise<AudnexusProvider | null> {
  const row = await getIntegrationConfigRecord("audnexus");
  if (!row?.enabled) return null;
  const cfg = normalizeAudnexusConfig(row.config ?? {});
  if (!cfg) return null;
  return new AudnexusProvider(cfg.base_url, cfg.region);
}

export type { AudnexusProvider };
```

Note the `__asin` carrier is internal plumbing; declare it on `ProviderFields` in `types.ts` as `/** Internal: the id this source resolved. Stripped before storage. */ __asin?: string;` so the cast is unnecessary. Remove the `as ProviderFields` casts once the field is declared.

Delete the empty `if (typeof runtime === "number" …)` block — `noUnusedLocals` will flag `runtime` otherwise; drop the `const runtime` line too.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/books/audnexusProvider.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 6: Export from the barrel and commit**

```ts
// apps/api/src/services/books/index.ts
export type {
  BookMetadataProvider,
  ProviderBook,
  ProviderFields,
  BookMatchInput,
  MergedBookFields,
} from "./types";
export { BookProviderUnavailableError } from "./types";
export { getBookMetadataProvider } from "./googleBooksProvider";
export { getAudnexusProvider } from "./audnexusProvider";
```

```bash
bun run typecheck && bun run typecheck:native && bun run lint
git add apps/api/src/services/books apps/api/test/fixtures/bookMetadata
git commit -m "feat(books): add the Audnexus metadata provider"
```

---

### Task 8: The merge function

**Files:**
- Create: `apps/api/src/services/books/mergeBookMetadata.ts`
- Test: `apps/api/src/services/books/mergeBookMetadata.test.ts`

**Interfaces:**
- Consumes: `ProviderFields`, `MergedBookFields`, `BookMetadataSource`.
- Produces: `mergeBookMetadata(candidates, order, overrides): { merged: MergedBookFields; provenance: Record<string, BookMetadataSource> }`, `MERGEABLE_FIELDS`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/books/mergeBookMetadata.test.ts
import { describe, expect, test } from "bun:test";
import { mergeBookMetadata } from "@rawkoon/api/services/books/mergeBookMetadata";
import type { BookMetadataSource } from "@rawkoon/shared/types";

const ORDER: BookMetadataSource[] = [
  "local",
  "audnexus",
  "googlebooks",
  "openlibrary",
];

describe("mergeBookMetadata", () => {
  test("takes each field from the highest-priority source that has it", () => {
    const { merged, provenance } = mergeBookMetadata(
      [
        { source: "googlebooks", fields: { overview: "google blurb", pageCount: 1 } },
        { source: "audnexus", fields: { overview: "audnexus blurb", narrators: ["Laure Vidal"] } },
        { source: "openlibrary", fields: { pageCount: 304 } },
      ],
      ORDER,
      null,
    );
    expect(merged.overview).toBe("audnexus blurb");
    expect(merged.narrators).toEqual(["Laure Vidal"]);
    // googlebooks outranks openlibrary, so its pageCount wins even though
    // openlibrary is the field's usual supplier.
    expect(merged.pageCount).toBe(1);
    expect(provenance.overview).toBe("audnexus");
    expect(provenance.pageCount).toBe("googlebooks");
  });

  /**
   * The distinction the whole contract rests on. An absent key means "nothing
   * to say"; null means "asserts empty". Without it, a high-priority source
   * that simply lacks a field would blank what a lower one knows.
   */
  test("an absent key defers, an explicit null wins", () => {
    const deferred = mergeBookMetadata(
      [
        { source: "audnexus", fields: {} },
        { source: "googlebooks", fields: { publisher: "Éditions Lisière" } },
      ],
      ORDER,
      null,
    );
    expect(deferred.merged.publisher).toBe("Éditions Lisière");
    expect(deferred.provenance.publisher).toBe("googlebooks");

    const asserted = mergeBookMetadata(
      [
        { source: "audnexus", fields: { publisher: null } },
        { source: "googlebooks", fields: { publisher: "Éditions Lisière" } },
      ],
      ORDER,
      null,
    );
    expect(asserted.merged.publisher).toBeNull();
    expect(asserted.provenance.publisher).toBe("audnexus");
  });

  test("an empty array is nothing to say, not an assertion of emptiness", () => {
    const { merged, provenance } = mergeBookMetadata(
      [
        { source: "audnexus", fields: { genres: [] } },
        { source: "googlebooks", fields: { genres: ["Thriller"] } },
      ],
      ORDER,
      null,
    );
    expect(merged.genres).toEqual(["Thriller"]);
    expect(provenance.genres).toBe("googlebooks");
  });

  test("takes the winning source's array whole rather than unioning", () => {
    const { merged } = mergeBookMetadata(
      [
        { source: "audnexus", fields: { genres: ["Policier et suspense"] } },
        { source: "openlibrary", fields: { genres: ["Thriller", "Mystery"] } },
      ],
      ORDER,
      null,
    );
    // Unioning would yield a bilingual mess.
    expect(merged.genres).toEqual(["Policier et suspense"]);
  });

  test("a source absent from the order is ignored entirely", () => {
    const { merged, provenance } = mergeBookMetadata(
      [{ source: "audnexus", fields: { narrators: ["Laure Vidal"] } }],
      ["local", "googlebooks"],
      null,
    );
    expect(merged.narrators).toBeUndefined();
    expect(provenance.narrators).toBeUndefined();
  });

  test("overrides beat every source and are excluded from provenance", () => {
    const { merged, provenance } = mergeBookMetadata(
      [{ source: "local", fields: { seriesName: "Le Jardin de Verre" } }],
      ORDER,
      { seriesName: "Chroniques du Verre" },
    );
    expect(merged.seriesName).toBe("Chroniques du Verre");
    expect(provenance.seriesName).toBeUndefined();
  });

  test("ignores override keys that are not mergeable fields", () => {
    const { merged } = mergeBookMetadata([], ORDER, {
      seriesName: "Ok",
      __proto__: { polluted: true },
      nonsense: 1,
    });
    expect(merged.seriesName).toBe("Ok");
    expect("nonsense" in merged).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("returns empty results for no candidates", () => {
    const { merged, provenance } = mergeBookMetadata([], ORDER, null);
    expect(merged).toEqual({});
    expect(provenance).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/books/mergeBookMetadata.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/services/books/mergeBookMetadata`

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/services/books/mergeBookMetadata.ts
import type { BookMetadataSource } from "@rawkoon/shared/types";
import type { MergedBookFields, ProviderFields } from "./types";

/**
 * Pure. No I/O, no Prisma, no fetch.
 *
 * Auto-merge concentrates its whole correctness risk here, which is exactly
 * why this is a pure function over fixtures rather than logic tangled into the
 * fetchers.
 */

/** Every field the merge resolves. An override key outside this list is ignored. */
export const MERGEABLE_FIELDS = [
  "title",
  "subtitle",
  "authors",
  "narrators",
  "genres",
  "publisher",
  "pageCount",
  "publishedDate",
  "publishedYear",
  "isbn13",
  "coverUrl",
  "overview",
  "seriesName",
  "seriesPosition",
  "language",
  "rating",
  "ratingCount",
  "authorBio",
  "authorImageUrl",
] as const satisfies ReadonlyArray<keyof ProviderFields>;

type MergeableField = (typeof MERGEABLE_FIELDS)[number];

/**
 * Whether a source said anything about this field.
 *
 * An absent key defers to the next source. An explicit null is an assertion of
 * emptiness and wins. An empty array is treated as "nothing to say": every
 * provider builds its arrays by filtering, so `[]` is indistinguishable from
 * "this payload had no such list" and must not blank a lower source's value.
 */
const speaks = (fields: ProviderFields, field: MergeableField): boolean => {
  if (!(field in fields)) return false;
  const value = fields[field];
  if (value === undefined) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
};

export function mergeBookMetadata(
  candidates: Array<{ source: BookMetadataSource; fields: ProviderFields }>,
  order: BookMetadataSource[],
  overrides: Record<string, unknown> | null,
): {
  merged: MergedBookFields;
  provenance: Record<string, BookMetadataSource>;
} {
  const merged: MergedBookFields = {};
  const provenance: Record<string, BookMetadataSource> = {};

  const bySource = new Map<BookMetadataSource, ProviderFields>();
  for (const c of candidates) {
    // Last contribution per source wins; a source should only appear once.
    bySource.set(c.source, c.fields);
  }

  for (const field of MERGEABLE_FIELDS) {
    // A source absent from `order` is disabled — the order doubles as the
    // enable list, so it is not consulted at all.
    for (const source of order) {
      const fields = bySource.get(source);
      if (!fields || !speaks(fields, field)) continue;
      (merged as Record<string, unknown>)[field] = fields[field];
      provenance[field] = source;
      break;
    }
  }

  if (overrides) {
    for (const field of MERGEABLE_FIELDS) {
      // Own-property check only, so a crafted "__proto__" key in the stored
      // JSON cannot reach Object.prototype.
      if (!Object.hasOwn(overrides, field)) continue;
      (merged as Record<string, unknown>)[field] = overrides[field];
      // An overridden field has no source: the operator is the source.
      delete provenance[field];
    }
  }

  return { merged, provenance };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/books/mergeBookMetadata.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/mergeBookMetadata.ts apps/api/src/services/books/mergeBookMetadata.test.ts
git commit -m "feat(books): merge provider fields by source priority"
```

---

### Task 9: Refresh orchestrator and route

**Files:**
- Create: `apps/api/src/services/books/refreshBookMetadata.ts`
- Create: `apps/api/src/routes/books/bookMetadataRoutes.ts`
- Modify: `apps/api/src/routes/books/index.ts`
- Modify: `apps/api/src/services/books/bookLibrary.ts`
- Modify: `apps/shared/src/types/books.ts`
- Test: `apps/api/test/refreshBookMetadata.test.ts`

**Interfaces:**
- Consumes: `mergeBookMetadata` (Task 8), `getAudnexusProvider` (Task 7), `getBookMetadataProvider` (Task 1), `normalizeSourceOrder` (Task 1).
- Produces: `refreshBookMetadata(bookId: number): Promise<RefreshMetadataOutcome>`, `RefreshMetadataOutcome`, `POST /api/books/:id/refresh-metadata`, `BookRefreshMetadataResponse`.

- [ ] **Step 1: Write the failing test**

Mock `@rawkoon/api/db` as the existing API suites do.

```ts
// apps/api/test/refreshBookMetadata.test.ts
import { describe, expect, mock, test } from "bun:test";

const book = {
  id: 1,
  googleVolumeId: "GV1",
  title: "Le Jardin de Verre",
  authors: ["Camille Rousseau"],
  language: "fr",
  isbn13: null,
  overrides: null,
  externalIds: [],
};

const updated: Record<string, unknown>[] = [];
const provenanceWrites: Record<string, unknown>[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryBook: {
      findUnique: async () => book,
      update: async (args: { data: Record<string, unknown> }) => {
        updated.push(args.data);
        return { ...book, ...args.data };
      },
    },
    mediaSettings: {
      findUnique: async () => ({
        bookMetadataSourceOrder: ["audnexus", "googlebooks"],
      }),
    },
    bookExternalId: { upsert: async () => ({}) },
    bookMetadataField: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async (args: { data: Record<string, unknown>[] }) => {
        provenanceWrites.push(...args.data);
        return { count: args.data.length };
      },
    },
    author: { findMany: async () => [], update: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@rawkoon/api/db");
      return fn(prisma);
    },
  },
}));

describe("refreshBookMetadata", () => {
  test("writes merged fields and their provenance", async () => {
    mock.module("@rawkoon/api/services/books/audnexusProvider", () => ({
      getAudnexusProvider: async () => ({
        source: "audnexus" as const,
        enrich: async () => ({
          narrators: ["Laure Vidal"],
          seriesName: "Le Jardin de Verre",
          seriesPosition: 1,
          __asin: "B0SCRUB001",
        }),
      }),
    }));
    mock.module("@rawkoon/api/services/books/googleBooksProvider", () => ({
      getBookMetadataProvider: async () => ({
        source: "googlebooks" as const,
        enrich: async () => ({ overview: "blurb" }),
      }),
    }));

    const { refreshBookMetadata } = await import(
      "@rawkoon/api/services/books/refreshBookMetadata"
    );
    const outcome = await refreshBookMetadata(1);

    expect(outcome.ok).toBe(true);
    expect(updated.at(-1)?.narrators).toEqual(["Laure Vidal"]);
    expect(updated.at(-1)?.seriesName).toBe("Le Jardin de Verre");
    expect(provenanceWrites.some((p) => p.field === "narrators" && p.source === "audnexus")).toBe(true);
    expect(provenanceWrites.some((p) => p.field === "overview" && p.source === "googlebooks")).toBe(true);
    // __asin is internal plumbing and must never be written as a column.
    expect(updated.at(-1)).not.toHaveProperty("__asin");
  });

  /**
   * A provider outage must not be recorded as "this source has nothing to say
   * about this book" — that would make a transient 503 permanent.
   */
  test("reports a failed source and writes no provenance for it", async () => {
    provenanceWrites.length = 0;
    const { BookProviderUnavailableError } = await import(
      "@rawkoon/api/services/books/types"
    );
    mock.module("@rawkoon/api/services/books/audnexusProvider", () => ({
      getAudnexusProvider: async () => ({
        source: "audnexus" as const,
        enrich: async () => {
          throw new BookProviderUnavailableError("Audnexus down", 503);
        },
      }),
    }));
    mock.module("@rawkoon/api/services/books/googleBooksProvider", () => ({
      getBookMetadataProvider: async () => ({
        source: "googlebooks" as const,
        enrich: async () => ({ overview: "blurb" }),
      }),
    }));

    const { refreshBookMetadata } = await import(
      "@rawkoon/api/services/books/refreshBookMetadata"
    );
    const outcome = await refreshBookMetadata(1);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.failedSources).toContain("audnexus");
    expect(provenanceWrites.some((p) => p.source === "audnexus")).toBe(false);
  });

  test("returns not-found for a missing book", async () => {
    mock.module("@rawkoon/api/db", () => ({
      prisma: { libraryBook: { findUnique: async () => null } },
    }));
    const { refreshBookMetadata } = await import(
      "@rawkoon/api/services/books/refreshBookMetadata"
    );
    const outcome = await refreshBookMetadata(999);
    expect(outcome.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test test/refreshBookMetadata.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/services/books/refreshBookMetadata`

- [ ] **Step 3: Write the orchestrator**

```ts
// apps/api/src/services/books/refreshBookMetadata.ts
import { prisma } from "@rawkoon/api/db";
import type { BookMetadataSource } from "@rawkoon/shared/types";
import { normalizeSourceOrder } from "@rawkoon/shared/utils";
import { getAudnexusProvider } from "./audnexusProvider";
import { getBookMetadataProvider } from "./googleBooksProvider";
import { mergeBookMetadata, MERGEABLE_FIELDS } from "./mergeBookMetadata";
import {
  BookProviderUnavailableError,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderFields,
} from "./types";

export type RefreshMetadataOutcome =
  | {
      ok: true;
      bookId: number;
      changedFields: string[];
      failedSources: BookMetadataSource[];
      usedSources: BookMetadataSource[];
    }
  | { ok: false; reason: string };

/** Columns on LibraryBook that a merged field maps to, by field name. */
const BOOK_COLUMNS = new Set([
  "subtitle",
  "narrators",
  "genres",
  "publisher",
  "pageCount",
  "publishedDate",
  "publishedYear",
  "isbn13",
  "coverUrl",
  "overview",
  "seriesName",
  "seriesPosition",
  "rating",
  "ratingCount",
]);

/**
 * Deliberately NOT written by a refresh:
 *  - title: it is the indexer search term and may have been hand-corrected.
 *  - language: a property of book identity; LibraryBook.language is set only
 *    on insert by design, and flipping it would re-point indexer searches.
 *  - authors: owned by the book_authors join table and its trigger.
 */

async function collectProviders(
  order: BookMetadataSource[],
): Promise<BookMetadataProvider[]> {
  const out: BookMetadataProvider[] = [];
  for (const source of order) {
    if (source === "audnexus") {
      const p = await getAudnexusProvider();
      if (p) out.push(p as unknown as BookMetadataProvider);
    } else if (source === "googlebooks") {
      const p = await getBookMetadataProvider();
      if (p) out.push(p);
    }
    // "local" and "openlibrary" are added by their own tasks.
  }
  return out;
}

export async function refreshBookMetadata(
  bookId: number,
): Promise<RefreshMetadataOutcome> {
  const book = await prisma.libraryBook.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      googleVolumeId: true,
      title: true,
      authors: true,
      language: true,
      isbn13: true,
      overrides: true,
      externalIds: { select: { source: true, externalId: true } },
    },
  });
  if (!book) return { ok: false, reason: "Book not found" };

  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { bookMetadataSourceOrder: true },
  });
  const order = normalizeSourceOrder(settings?.bookMetadataSourceOrder);

  const externalIds: BookMatchInput["externalIds"] = {};
  for (const row of book.externalIds) {
    externalIds[row.source as BookMetadataSource] = row.externalId;
  }

  const input: BookMatchInput = {
    bookId: book.id,
    title: book.title,
    authors: book.authors,
    language: book.language,
    isbn13: book.isbn13,
    googleVolumeId: book.googleVolumeId,
    externalIds,
  };

  const providers = await collectProviders(order);
  const failedSources: BookMetadataSource[] = [];
  const resolvedIds: Array<{ source: BookMetadataSource; externalId: string }> = [];

  const settled = await Promise.all(
    providers.map(async (provider) => {
      try {
        const fields = await provider.enrich(input);
        const asin = (fields as { __asin?: string }).__asin;
        if (asin) resolvedIds.push({ source: provider.source, externalId: asin });
        return { source: provider.source, fields };
      } catch (e) {
        // An outage is skipped, never recorded. Recording it would make a
        // transient 503 look like a permanent absence.
        if (e instanceof BookProviderUnavailableError) {
          failedSources.push(provider.source);
          return null;
        }
        throw e;
      }
    }),
  );

  const candidates = settled.filter(
    (c): c is { source: BookMetadataSource; fields: ProviderFields } => c !== null,
  );

  const overrides =
    book.overrides && typeof book.overrides === "object" && !Array.isArray(book.overrides)
      ? (book.overrides as Record<string, unknown>)
      : null;

  const { merged, provenance } = mergeBookMetadata(candidates, order, overrides);

  const data: Record<string, unknown> = {};
  for (const field of MERGEABLE_FIELDS) {
    if (!BOOK_COLUMNS.has(field)) continue;
    if (!(field in merged)) continue;
    const value = merged[field];
    data[field] =
      field === "publishedDate" && typeof value === "string"
        ? new Date(value)
        : value;
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.libraryBook.update({ where: { id: book.id }, data });
    }
    for (const { source, externalId } of resolvedIds) {
      await tx.bookExternalId.upsert({
        where: { bookId_source: { bookId: book.id, source } },
        create: { bookId: book.id, source, externalId },
        update: { externalId, fetchedAt: new Date() },
      });
    }
    const rows = Object.entries(provenance).map(([field, source]) => ({
      bookId: book.id,
      field,
      source,
    }));
    // Replace wholesale: a field that no longer resolves must lose its stale
    // provenance row rather than keep claiming a source.
    await tx.bookMetadataField.deleteMany({ where: { bookId: book.id } });
    if (rows.length > 0) await tx.bookMetadataField.createMany({ data: rows });
  });

  return {
    ok: true,
    bookId: book.id,
    changedFields: Object.keys(data),
    failedSources,
    usedSources: [...new Set(candidates.map((c) => c.source))],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test test/refreshBookMetadata.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Add the route**

```ts
// apps/api/src/routes/books/bookMetadataRoutes.ts
import { Elysia, t } from "elysia";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { badRequest, notFound } from "@rawkoon/api/errors";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";

/**
 * POST /api/books/:id/refresh-metadata
 *
 * Re-runs the source chain for one book. There is no scheduled sweep: metadata
 * changes only when someone asks, so a source that failed is reported back
 * rather than silently retried later.
 */
export const bookMetadataRoutes = new Elysia().use(requireUser).post(
  "/:id/refresh-metadata",
  async ({ params, set }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return badRequest(set, "Invalid book id");

    const outcome = await refreshBookMetadata(id);
    if (!outcome.ok) return notFound(set, outcome.reason);

    return {
      bookId: outcome.bookId,
      changedFields: outcome.changedFields,
      failedSources: outcome.failedSources,
      usedSources: outcome.usedSources,
    };
  },
  { params: t.Object({ id: t.String() }) },
);
```

Register it in `apps/api/src/routes/books/index.ts` after `bookListRoutes`, keeping the existing comment block accurate:

```ts
import { bookMetadataRoutes } from "./bookMetadataRoutes";
// …
  .use(bookListRoutes)
  .use(bookMetadataRoutes)
  .use(bookEditionRoutes)
  .use(bookGrabRoutes);
```

Add the response type to `apps/shared/src/types/books.ts`:

```ts
export interface BookRefreshMetadataResponse {
  bookId: number;
  changedFields: string[];
  failedSources: BookMetadataSource[];
  usedSources: BookMetadataSource[];
}
```

- [ ] **Step 6: Call it from the add flow**

In `apps/api/src/services/books/bookLibrary.ts`, after the `$transaction` returns `bookId` and before the final `return`:

```ts
  // Enrich on add so an unattended add (author monitoring) gets the same
  // metadata a hand-added book does. A failure here must not fail the add —
  // the book exists and can be refreshed later.
  try {
    await refreshBookMetadata(bookId);
  } catch (e) {
    console.warn(
      `[books] metadata enrichment failed for book ${bookId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
```

- [ ] **Step 7: Verify and commit**

```bash
bun run typecheck && bun run typecheck:native && bun run lint && bun run test
git add apps/api/src/services/books apps/api/src/routes/books apps/shared/src/types/books.ts apps/api/test/refreshBookMetadata.test.ts
git commit -m "feat(books): refresh merged metadata on add and on demand"
```

---

### Task 10: Local file metadata source

**Files:**
- Create: `apps/api/src/services/books/localFileProvider.ts`
- Test: `apps/api/src/services/books/localFileProvider.test.ts`
- Modify: `apps/api/src/services/books/refreshBookMetadata.ts`

**Interfaces:**
- Consumes: `readEbookMetadata` and `EbookMetadata` from `@rawkoon/api/utils/books/ebookMetadata`, `BookEdition.narrators` / `durationSecs` rows.
- Produces: `mapLocalFields(input: LocalMetadataInput): ProviderFields`, `getLocalFileProvider(): BookMetadataProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/books/localFileProvider.test.ts
import { describe, expect, test } from "bun:test";
import { mapLocalFields } from "@rawkoon/api/services/books/localFileProvider";

describe("mapLocalFields", () => {
  /**
   * Local wins so a tagger repair sticks. If a remote source outranked the
   * file, the next refresh would silently revert the fix and the tagger would
   * be useless.
   */
  test("contributes narrators recorded from container tags", () => {
    const f = mapLocalFields({
      editionNarrators: ["Laure Vidal", "Audrey Meunier"],
      ebook: null,
    });
    expect(f.narrators).toEqual(["Laure Vidal", "Audrey Meunier"]);
  });

  test("contributes publisher and series from epub OPF metadata", () => {
    const f = mapLocalFields({
      editionNarrators: [],
      ebook: {
        title: "Le Jardin de Verre",
        authors: ["Camille Rousseau"],
        publisher: "Éditions Lisière",
        seriesName: "Le Jardin de Verre",
        seriesPosition: 1,
        language: "fr",
      },
    });
    expect(f.publisher).toBe("Éditions Lisière");
    expect(f.seriesName).toBe("Le Jardin de Verre");
    expect(f.seriesPosition).toBe(1);
  });

  // The key must be ABSENT, not null: an untagged file knows nothing, and a
  // null here would blank what Audnexus supplies.
  test("omits keys it knows nothing about", () => {
    const f = mapLocalFields({ editionNarrators: [], ebook: null });
    expect("narrators" in f).toBe(false);
    expect("publisher" in f).toBe(false);
    expect(f).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/books/localFileProvider.test.ts`
Expected: FAIL — cannot resolve the module

- [ ] **Step 3: Read the existing extractors before writing**

Read `apps/api/src/utils/books/ebookMetadata.ts` (the `EbookMetadata` interface and `readEbookMetadata`) and `collectNarrators` in `apps/api/src/services/postProcessorBook.ts:417`. This provider **promotes existing extraction into the chain**; it must not add a second, divergent parser. If `EbookMetadata` lacks `publisher`, `seriesName` or `seriesPosition`, extend that interface and its parser rather than parsing the OPF again here, and adjust the test above to the real field names.

- [ ] **Step 4: Write the implementation**

```ts
// apps/api/src/services/books/localFileProvider.ts
import { prisma } from "@rawkoon/api/db";
import { readEbookMetadata } from "@rawkoon/api/utils/books/ebookMetadata";
import type {
  BookMatchInput,
  BookMetadataProvider,
  ProviderFields,
} from "./types";

/**
 * On-disk metadata, ranked above every remote source.
 *
 * Rationale: the operator can fix a file with a tagger and rescan. If a remote
 * source outranked the file, that repair would be reverted on the next
 * refresh. Ranking local highest makes the file an override mechanism that
 * needs no UI.
 *
 * This is a promotion of extraction rawkoon already does at import — audio
 * container tags for narrators, epub OPF for the rest — not a new parser.
 */

export interface LocalMetadataInput {
  /** BookEdition.narrators, from container tags at import. */
  editionNarrators: string[];
  ebook: {
    title?: string | null;
    authors?: string[];
    publisher?: string | null;
    seriesName?: string | null;
    seriesPosition?: number | null;
    language?: string | null;
  } | null;
}

export function mapLocalFields(input: LocalMetadataInput): ProviderFields {
  const fields: ProviderFields = {};
  if (input.editionNarrators.length > 0) {
    fields.narrators = input.editionNarrators;
  }
  const e = input.ebook;
  if (e) {
    if (e.publisher) fields.publisher = e.publisher;
    if (e.seriesName) fields.seriesName = e.seriesName;
    if (typeof e.seriesPosition === "number") {
      fields.seriesPosition = e.seriesPosition;
    }
  }
  return fields;
}

class LocalFileProvider implements BookMetadataProvider {
  readonly source = "local" as const;

  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const editions = await prisma.bookEdition.findMany({
      where: { bookId: book.bookId },
      select: {
        narrators: true,
        files: { select: { filePath: true, format: true }, take: 1 },
      },
    });

    const editionNarrators = editions.flatMap((e) => e.narrators);
    const ebookFile = editions
      .flatMap((e) => e.files)
      .find((f) => f.format === "epub");

    let ebook: LocalMetadataInput["ebook"] = null;
    if (ebookFile) {
      // A missing or unreadable file is "nothing to say", never a failure:
      // this provider must not be able to break a refresh.
      ebook = await readEbookMetadata(ebookFile.filePath).catch(() => null);
    }

    return mapLocalFields({
      editionNarrators: [...new Set(editionNarrators)],
      ebook,
    });
  }
}

export function getLocalFileProvider(): BookMetadataProvider {
  return new LocalFileProvider();
}
```

- [ ] **Step 5: Register it in the orchestrator**

In `collectProviders` in `refreshBookMetadata.ts`, add the branch:

```ts
    } else if (source === "local") {
      out.push(getLocalFileProvider());
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/books/localFileProvider.test.ts test/refreshBookMetadata.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/books apps/api/src/utils/books
git commit -m "feat(books): rank on-disk file metadata above remote sources"
```

---

### Task 11: Open Library provider

**Files:**
- Create: `apps/api/src/services/books/openLibraryProvider.ts`
- Test: `apps/api/test/fixtures/bookMetadata/openlibrary-search.json`
- Test: `apps/api/test/fixtures/bookMetadata/openlibrary-isbn-html-404.txt`
- Test: `apps/api/src/services/books/openLibraryProvider.test.ts`
- Modify: `apps/api/src/services/books/refreshBookMetadata.ts`

**Interfaces:**
- Consumes: `ProviderFields`, `BookMatchInput`, cache helpers.
- Produces: `mapOpenLibraryDoc(raw: unknown): ProviderFields`, `isHtmlBody(text: string): boolean`, `getOpenLibraryProvider(): BookMetadataProvider`.

- [ ] **Step 1: Write the fixtures**

`openlibrary-search.json` — the observed doc shape, scrubbed. Note there is no `series` and no `language`:

```json
{
  "numFound": 1,
  "docs": [
    {
      "key": "/works/OL00000000W",
      "title": "Le Jardin De Verre",
      "author_name": ["Camille Rousseau"],
      "cover_i": 15168394,
      "first_publish_year": 2023,
      "isbn": ["9782824621456", "2824621451"],
      "number_of_pages_median": 304,
      "ratings_average": 3.8947368,
      "ratings_count": 133
    }
  ]
}
```

`openlibrary-isbn-html-404.txt` — the first line of the HTML body the ISBN route returns:

```
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/services/books/openLibraryProvider.test.ts
import { describe, expect, test } from "bun:test";
import {
  isHtmlBody,
  mapOpenLibraryDoc,
} from "@rawkoon/api/services/books/openLibraryProvider";
import search from "../../../test/fixtures/bookMetadata/openlibrary-search.json";

describe("mapOpenLibraryDoc", () => {
  test("contributes only the fields Open Library is actually good for", () => {
    const f = mapOpenLibraryDoc(search.docs[0]);
    expect(f.pageCount).toBe(304);
    expect(f.rating).toBeCloseTo(3.8947368, 5);
    expect(f.ratingCount).toBe(133);
    expect(f.publishedYear).toBe(2023);
  });

  /**
   * Observed live: the work record carries no series and no language, and its
   * ISBN is a different printing than the library's. Claiming any of those
   * would let the weakest source overwrite better data whenever it outranked
   * another — so they are never contributed.
   */
  test("never claims series, language, or isbn13", () => {
    const f = mapOpenLibraryDoc(search.docs[0]);
    expect("seriesName" in f).toBe(false);
    expect("language" in f).toBe(false);
    expect("isbn13" in f).toBe(false);
  });

  test("returns an empty contribution for junk", () => {
    expect(mapOpenLibraryDoc(null)).toEqual({});
    expect(mapOpenLibraryDoc({})).toEqual({});
  });
});

describe("isHtmlBody", () => {
  // Observed live: /isbn/{isbn}.json returns an HTML error page. Parsing it as
  // JSON throws, and treating the throw as an outage would retry forever.
  test("detects an HTML body served from a JSON route", () => {
    expect(isHtmlBody("\n\n<!DOCTYPE html>\n<html lang=\"en\">")).toBe(true);
    expect(isHtmlBody("{\"key\":\"/works/OL1W\"}")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/books/openLibraryProvider.test.ts`
Expected: FAIL — cannot resolve the module

- [ ] **Step 4: Write the implementation**

```ts
// apps/api/src/services/books/openLibraryProvider.ts
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";
import {
  BookProviderUnavailableError,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderFields,
} from "./types";

/**
 * Open Library, ranked last deliberately.
 *
 * Verified live 2026-08-24 against a French-language library:
 *  - /isbn/{isbn}.json returned an HTML 404 page for every French ISBN tried.
 *    The route is close to useless here, so this provider does not use it.
 *  - /search.json did find the work, but with no series, no language, and a
 *    different printing's ISBN.
 *
 * So it contributes page count, ratings, and author bio only. It must never
 * claim series, language, or isbn13 — a weak source asserting those would
 * overwrite better data wherever it outranked another source.
 */

const SEARCH_URL = "https://openlibrary.org/search.json";
const AUTHOR_URL = "https://openlibrary.org/search/authors.json";
const FIELDS =
  "key,title,author_name,first_publish_year,number_of_pages_median,ratings_average,ratings_count,cover_i";
const CACHE_TTL = 86_400;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A JSON route that answers with HTML is a 404 in disguise, not an outage. */
export function isHtmlBody(text: string): boolean {
  return /^\s*<(?:!doctype|html)/iu.test(text);
}

export function mapOpenLibraryDoc(raw: unknown): ProviderFields {
  if (!raw || typeof raw !== "object") return {};
  const d = raw as Record<string, unknown>;
  const fields: ProviderFields = {};
  const pages = num(d.number_of_pages_median);
  if (pages !== null) fields.pageCount = pages;
  const rating = num(d.ratings_average);
  if (rating !== null) fields.rating = rating;
  const ratingCount = num(d.ratings_count);
  if (ratingCount !== null) fields.ratingCount = ratingCount;
  const year = num(d.first_publish_year);
  if (year !== null) fields.publishedYear = year;
  return fields;
}

async function fetchOpenLibrary(url: string): Promise<unknown | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "rawkoon" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res) throw new BookProviderUnavailableError("Open Library unreachable");
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) {
      throw new BookProviderUnavailableError(
        `Open Library unavailable (HTTP ${res.status})`,
        res.status,
      );
    }
    return null;
  }
  const text = await res.text();
  // An HTML body on a .json route means "no record", not "server broken".
  if (isHtmlBody(text)) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

class OpenLibraryProvider implements BookMetadataProvider {
  readonly source = "openlibrary" as const;

  async enrich(book: BookMatchInput): Promise<ProviderFields> {
    const query = `${book.title} ${book.authors.join(" ")}`.trim();
    if (!query) return {};

    const cacheKey = `books:ol:search:${normalizeTitleForMatch(query)}`;
    const cached = await getJsonCache<ProviderFields>(cacheKey);
    if (cached) return cached;

    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("fields", FIELDS);
    url.searchParams.set("limit", "3");

    const body = (await fetchOpenLibrary(url.toString())) as {
      docs?: unknown;
    } | null;
    const docs = Array.isArray(body?.docs) ? body.docs : [];
    if (docs.length === 0) return {};

    // Only accept a doc whose normalized title matches; Open Library's
    // relevance ranking is loose enough to return an unrelated first hit.
    const wanted = normalizeTitleForMatch(book.title);
    const doc = docs.find((d) => {
      const t = (d as Record<string, unknown>).title;
      return typeof t === "string" && normalizeTitleForMatch(t) === wanted;
    });
    if (!doc) return {};

    const fields = mapOpenLibraryDoc(doc);
    if (Object.keys(fields).length > 0) {
      await setJsonCache(cacheKey, fields, CACHE_TTL);
    }
    return fields;
  }

  /** Author bio and birth date, the one thing Open Library is clearly best at. */
  async enrichAuthor(authorName: string): Promise<ProviderFields> {
    const url = new URL(AUTHOR_URL);
    url.searchParams.set("q", authorName);
    const body = (await fetchOpenLibrary(url.toString())) as {
      docs?: unknown;
    } | null;
    const docs = Array.isArray(body?.docs) ? body.docs : [];
    const first = docs[0] as Record<string, unknown> | undefined;
    if (!first) return {};
    const subjects = Array.isArray(first.top_subjects)
      ? first.top_subjects.filter((s): s is string => typeof s === "string")
      : [];
    return subjects.length > 0 ? { genres: subjects } : {};
  }
}

export function getOpenLibraryProvider(): BookMetadataProvider {
  return new OpenLibraryProvider();
}
```

- [ ] **Step 5: Register it in the orchestrator**

```ts
    } else if (source === "openlibrary") {
      out.push(getOpenLibraryProvider());
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/books/openLibraryProvider.test.ts test/refreshBookMetadata.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/books apps/api/test/fixtures/bookMetadata
git commit -m "feat(books): add Open Library for page count and ratings"
```

---

### Task 12: Audnexus integration route and settings UI

**Files:**
- Modify: `apps/api/src/routes/integrations/` (follow the Google Books route in this directory)
- Modify: `apps/shared/src/types/books.ts`
- Modify: `apps/web/src/lib/endpoints.ts`
- Modify: `apps/web/src/lib/queryKeys.ts`
- Create: `apps/web/src/pages/settings/useAudnexusIntegration.ts`
- Modify: `apps/web/src/pages/settings/_component/BooksSettingsTab.tsx`
- Create: `apps/web/src/pages/settings/_component/BookMetadataSourcesSection.tsx`

**Interfaces:**
- Consumes: `normalizeAudnexusConfig` (Task 6), `BookMetadataSource` / `normalizeSourceOrder` (Task 1).
- Produces: `GET`/`PUT`/`POST test` for `/api/integrations/audnexus`, `useAudnexusIntegration` / `useUpdateAudnexusIntegration` / `useTestAudnexusIntegration`, `useBookMetadataSourceOrder` / `useUpdateBookMetadataSourceOrder`.

- [ ] **Step 1: Read the pattern to copy**

Read the Google Books integration route under `apps/api/src/routes/integrations/`, plus `apps/web/src/pages/settings/useGoogleBooksIntegration.ts` and the card it renders in `BooksSettingsTab.tsx:76`. Audnexus is a second card in the same shape — route, endpoint constant, hook trio, test button — **not** a new pattern. Copy the structure exactly, including the `queryClient.invalidateQueries({ queryKey: queryKeys.books.all })` on success, since a source change makes every book's metadata stale.

- [ ] **Step 2: Add the API route**

Mirror the Google Books handler. The test action calls the configured base URL's `/books/B0SCRUB001?region=<region>` — any 2xx or 404 proves reachability; a 5xx or a network error is a failure. Do not use a real ASIN from the operator's library in a health check that ships in the repo.

Response types in `apps/shared/src/types/books.ts`:

```ts
export interface AudnexusIntegrationResponse {
  enabled: boolean;
  base_url: string;
  region: string;
}
export interface AudnexusIntegrationUpdateResponse {
  ok: true;
}
export interface AudnexusTestResponse {
  ok: boolean;
  message: string;
}
export interface BookMetadataSourceOrderResponse {
  order: BookMetadataSource[];
}
```

- [ ] **Step 3: Add the source-order route**

`GET` and `PUT /api/books/metadata-sources`, in `bookMetadataRoutes.ts`. `PUT` is admin-only (`requireAdmin`), takes `{ order: string[] }`, runs it through `normalizeSourceOrder`, and writes `MediaSettings.bookMetadataSourceOrder`. Register `bookMetadataRoutes` **before** `bookEditionRoutes` — already done in Task 9 — and note that `/metadata-sources` is a literal path that must not be matched as `:id`, so it must be declared in a router that runs before any `:id` route. Verify by calling it after wiring; if it 404s or parses "metadata-sources" as an id, move the literal route into `bookListRoutes`, which already comes first for exactly this reason.

- [ ] **Step 4: Write the web hooks**

Copy `useGoogleBooksIntegration.ts` verbatim into `useAudnexusIntegration.ts`, swapping the endpoint constant, query key, and body shape (`{ base_url, region, enabled }`). Add `audnexus: () => [...queryKeys.integrations.all, "audnexus"] as const` and `metadataSources: () => ["books", "metadata-sources"] as const` to `queryKeys.ts`.

- [ ] **Step 5: Build the source-order section**

`BookMetadataSourcesSection.tsx` renders the ordered list with move-up/move-down buttons and a per-source checkbox. Removing a source's check drops it from the array — the order **is** the enable list, so there is no second boolean to keep in sync. Use the existing `CardSection` helper in `BooksSettingsTab.tsx:37` so it matches the tab's other cards. Render it in `BooksSettingsTab`, below the Google Books card.

Keyboard-accessible buttons, not drag-only: a drag-only reorder is unusable without a pointer.

- [ ] **Step 6: Verify**

```bash
bun run typecheck && bun run typecheck:native && bun run lint && bun run test
```

Then start `bun run dev:api` and `bun run dev:web`, open Settings → Books, save an Audnexus config, and press Test. Expected: a success message. Reorder the sources and reload the page — the order persists.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes apps/shared/src/types/books.ts apps/web/src
git commit -m "feat(books): add Audnexus settings and metadata source ordering"
```

---

### Task 13: Book detail fields and refresh button

**Files:**
- Modify: `apps/web/src/pages/books/_component/BookDetailPage.tsx`
- Create: `apps/web/src/pages/books/_hooks/useRefreshBookMetadata.ts`
- Modify: `apps/web/src/lib/queryKeys.ts`
- Modify: `apps/web/src/locales/en/*.json` and `apps/web/src/locales/fr/*.json`

**Interfaces:**
- Consumes: `Book.narrators` / `genres` / `publisher` / `pageCount` / `rating` / `metadataSources` (Task 2), `BookRefreshMetadataResponse` (Task 9).
- Produces: `useRefreshBookMetadata(bookId: number)`.

- [ ] **Step 1: Write the mutation hook**

```ts
// apps/web/src/pages/books/_hooks/useRefreshBookMetadata.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import type { BookRefreshMetadataResponse } from "@rawkoon/shared/types";

export function useRefreshBookMetadata(bookId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<BookRefreshMetadataResponse>(
        `/api/books/${bookId}/refresh-metadata`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.books.detail(bookId),
      });
    },
  });
}
```

- [ ] **Step 2: Render the fields**

In `BookDetailPage.tsx`, add narrators, series with position, genres, publisher, page count, and rating. Each field renders only when present. Attach a `title` attribute naming its source from `book.metadataSources[field]`, so provenance is visible without a new component.

- [ ] **Step 3: Render the refresh button and its result**

A "Refresh metadata" button calling the hook. On success, show which fields changed and — critically — name any entry in `failedSources`, so an Audnexus outage is legible rather than looking like "this book has no narrators". On an empty `changedFields`, say so rather than showing nothing.

- [ ] **Step 4: Add the i18n keys**

Add every new string to both `en` and `fr` locale files. A missing `fr` key renders the raw key to the operator, whose library is entirely French.

- [ ] **Step 5: Verify in the browser**

Run `bun run dev:web`, open a book, press Refresh metadata. Expected: narrators and series appear; the provenance tooltip names `audnexus`. Then disable Audnexus in settings and refresh again: the button reports the source as unused rather than blanking the fields.

- [ ] **Step 6: Commit**

```bash
bun run lint && bun run test
git add apps/web/src
git commit -m "feat(books): show merged metadata and a refresh action on book detail"
```

---

### Task 14: Backfill script

**Files:**
- Create: `apps/api/src/scripts/backfillBookMetadata.ts`
- Modify: `docs/library/books.md`

**Interfaces:**
- Consumes: `refreshBookMetadata` (Task 9).
- Produces: a CLI taking `--dry-run`, `--limit=<n>`, `--book=<id>`.

- [ ] **Step 1: Write the script**

Follow `apps/api/src/scripts/importExistingBooks.ts` for CLI shape and logging.

```ts
// apps/api/src/scripts/backfillBookMetadata.ts
import { prisma } from "@rawkoon/api/db";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";

/**
 * Re-runs the source chain over the existing library.
 *
 * Per-book error catching is mandatory, not defensive: a backfill that aborts
 * the batch on one bad book is what made the original import painful.
 *
 * Concurrency is capped at 4. The public Audnexus instance allows 300 requests
 * per 60s per IP and each book costs an Audible search plus an Audnexus fetch.
 */
const CONCURRENCY = 4;

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const only = arg("book");
  const limit = Number(arg("limit") ?? "0");

  const books = await prisma.libraryBook.findMany({
    where: only ? { id: Number(only) } : {},
    select: { id: true, title: true },
    orderBy: { id: "asc" },
    ...(limit > 0 ? { take: limit } : {}),
  });

  console.log(
    `[backfill] ${books.length} book(s)${dryRun ? " (dry run — no writes)" : ""}`,
  );

  let ok = 0;
  let failed = 0;
  const queue = [...books];

  const worker = async () => {
    for (;;) {
      const book = queue.shift();
      if (!book) return;
      if (dryRun) {
        console.log(`[backfill] would refresh ${book.id} — ${book.title}`);
        ok++;
        continue;
      }
      try {
        const outcome = await refreshBookMetadata(book.id);
        if (!outcome.ok) {
          failed++;
          console.warn(`[backfill] ${book.id} ${book.title}: ${outcome.reason}`);
          continue;
        }
        ok++;
        const failedNote =
          outcome.failedSources.length > 0
            ? ` (unavailable: ${outcome.failedSources.join(", ")})`
            : "";
        console.log(
          `[backfill] ${book.id} ${book.title}: ${outcome.changedFields.length} field(s)${failedNote}`,
        );
      } catch (e) {
        failed++;
        console.error(
          `[backfill] ${book.id} ${book.title} threw: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[backfill] done — ${ok} ok, ${failed} failed`);
  await prisma.$disconnect();
}

void main();
```

- [ ] **Step 2: Dry-run it**

Run: `cd apps/api && bun run src/scripts/backfillBookMetadata.ts --dry-run`
Expected: one "would refresh" line per book, no writes.

- [ ] **Step 3: Run it against a single book**

Run: `cd apps/api && bun run src/scripts/backfillBookMetadata.ts --book=<an id>`
Expected: a changed-field count. Then verify in the DB that `narrators` and `series_name` are populated and that `book_metadata_fields` has rows naming the source.

- [ ] **Step 4: Run the full backfill**

Run: `cd apps/api && bun run src/scripts/backfillBookMetadata.ts`
Expected: every book reports. Books with no Audible edition report 0 or few fields and no failure — that is the Google Books floor working, not a bug.

- [ ] **Step 5: Document and commit**

Add a "Metadata sources" section to `docs/library/books.md` covering the source order, the refresh button, the Audnexus config including the self-host note, and the backfill command.

```bash
git add apps/api/src/scripts/backfillBookMetadata.ts docs/library/books.md
git commit -m "feat(books): add a metadata backfill script"
```

---

### Task 15: Audnexus chapters — DROPPED, do not implement

Cancelled during implementation, not deferred.

`book_file_chapters` and `book_progress` were dropped by migration
`20260824001000_drop_book_reading_state`, one day before this plan was written:
the in-app player and reader are gone and Audiobookshelf owns playback and
progress. There is no table to write chapters into and nothing that would read
them. Implementing the task below would re-create a table the project had just
deliberately removed.

The steps are left in place only as a record of what was investigated. **Do not
execute them.**

**Files:**
- Create: `apps/api/src/services/books/audnexusChapters.ts`
- Test: `apps/api/test/fixtures/bookMetadata/audnexus-chapters.json`
- Test: `apps/api/src/services/books/audnexusChapters.test.ts`

**Interfaces:**
- Consumes: `AudnexusProvider` base URL and region (Task 7).
- Produces: `mapAudnexusChapters(raw: unknown): { runtimeMs: number; isAccurate: boolean; chapters: Array<{ title: string; startOffsetMs: number; lengthMs: number }> } | null`, `shouldApplyChapters(remoteRuntimeMs: number, localRuntimeSecs: number, tolerance?: number): boolean`.

- [ ] **Step 1: Write the fixture**

Structure captured live; titles scrubbed:

```json
{
  "asin": "B0SCRUB001",
  "brandIntroDurationMs": 14558,
  "brandOutroDurationMs": 14303,
  "isAccurate": true,
  "region": "fr",
  "runtimeLengthMs": 34744844,
  "runtimeLengthSec": 34744,
  "chapters": [
    { "title": "Crédits", "startOffsetMs": 0, "startOffsetSec": 0, "lengthMs": 54558 },
    { "title": "Le commencement", "startOffsetMs": 54558, "startOffsetSec": 54, "lengthMs": 1905901 },
    { "title": "La vitre brisée", "startOffsetMs": 1960459, "startOffsetSec": 1960, "lengthMs": 1344179 }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/services/books/audnexusChapters.test.ts
import { describe, expect, test } from "bun:test";
import {
  mapAudnexusChapters,
  shouldApplyChapters,
} from "@rawkoon/api/services/books/audnexusChapters";
import fixture from "../../../test/fixtures/bookMetadata/audnexus-chapters.json";

describe("mapAudnexusChapters", () => {
  test("maps named chapters with their offsets", () => {
    const c = mapAudnexusChapters(fixture);
    expect(c?.isAccurate).toBe(true);
    expect(c?.chapters).toHaveLength(3);
    expect(c?.chapters[1]?.title).toBe("Le commencement");
    expect(c?.chapters[1]?.startOffsetMs).toBe(54558);
  });

  test("returns null when the payload claims no accuracy", () => {
    expect(mapAudnexusChapters({ ...fixture, isAccurate: false })).toBeNull();
  });

  test("returns null for junk", () => {
    expect(mapAudnexusChapters(null)).toBeNull();
    expect(mapAudnexusChapters({ chapters: "no" })).toBeNull();
  });
});

describe("shouldApplyChapters", () => {
  /**
   * The offsets describe Audible's single-file edition. Library audiobooks are
   * per-file rips whose boundaries need not align, so importing offsets
   * blindly would desynchronize the player. Runtime agreement is the only
   * evidence that the two editions are the same recording.
   */
  test("applies when the local runtime agrees", () => {
    expect(shouldApplyChapters(34_744_844, 34_744)).toBe(true);
    expect(shouldApplyChapters(34_744_844, 34_700)).toBe(true);
  });

  test("refuses when the local runtime disagrees", () => {
    // An abridged or differently-narrated edition.
    expect(shouldApplyChapters(34_744_844, 20_000)).toBe(false);
    expect(shouldApplyChapters(34_744_844, 0)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/books/audnexusChapters.test.ts`
Expected: FAIL — cannot resolve the module

- [ ] **Step 4: Write the implementation**

```ts
// apps/api/src/services/books/audnexusChapters.ts
/**
 * Audnexus chapter marks.
 *
 * Motivation: syncFileChapters reads only internal m4b/mka "Menu" marks, so
 * per-file mp3 and opus audiobooks legitimately end up with zero
 * book_file_chapters rows. Audnexus supplies real, named chapters — verified
 * live 2026-08-24 with isAccurate: true and French chapter titles.
 *
 * The catch: the offsets describe Audible's single-file edition. Applying them
 * to a per-file rip whose boundaries differ would desynchronize the player, so
 * they are applied only when the runtimes agree.
 */

export interface AudnexusChapters {
  runtimeMs: number;
  isAccurate: boolean;
  chapters: Array<{ title: string; startOffsetMs: number; lengthMs: number }>;
}

/** 1% of the runtime, floored at 60s: encoder padding differs harmlessly. */
const DEFAULT_TOLERANCE_RATIO = 0.01;
const MIN_TOLERANCE_SECS = 60;

export function mapAudnexusChapters(raw: unknown): AudnexusChapters | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.isAccurate !== true) return null;
  if (!Array.isArray(c.chapters) || c.chapters.length === 0) return null;
  const runtimeMs = c.runtimeLengthMs;
  if (typeof runtimeMs !== "number" || runtimeMs <= 0) return null;

  const chapters: AudnexusChapters["chapters"] = [];
  for (const entry of c.chapters) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const title = typeof e.title === "string" ? e.title.trim() : "";
    const startOffsetMs = e.startOffsetMs;
    const lengthMs = e.lengthMs;
    if (
      !title ||
      typeof startOffsetMs !== "number" ||
      typeof lengthMs !== "number"
    ) {
      continue;
    }
    chapters.push({ title, startOffsetMs, lengthMs });
  }
  if (chapters.length === 0) return null;
  return { runtimeMs, isAccurate: true, chapters };
}

export function shouldApplyChapters(
  remoteRuntimeMs: number,
  localRuntimeSecs: number,
  tolerance?: number,
): boolean {
  if (!(remoteRuntimeMs > 0) || !(localRuntimeSecs > 0)) return false;
  const remoteSecs = remoteRuntimeMs / 1000;
  const allowed =
    tolerance ??
    Math.max(MIN_TOLERANCE_SECS, remoteSecs * DEFAULT_TOLERANCE_RATIO);
  return Math.abs(remoteSecs - localRuntimeSecs) <= allowed;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/books/audnexusChapters.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Wire it into the refresh, behind the gate**

Apply chapters only when: the edition is an audiobook, it has **zero** existing `book_file_chapters` rows, an ASIN is known, and `shouldApplyChapters` passes against the edition's summed `durationSecs`. Log a one-line reason on every refusal — a silent skip here is indistinguishable from a bug.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/books apps/api/test/fixtures/bookMetadata/audnexus-chapters.json
git commit -m "feat(books): import Audnexus chapters when runtimes agree"
```

---

## Self-Review

**Spec coverage.** Each spec section maps to a task: source chain → 1, 7, 10, 11; schema → 2; ASIN resolution → 4, 5; merge → 8; series normalization → 3; refresh flow → 9; UI → 12, 13; error handling → threaded through 5, 7, 9, 11; testing → fixtures in 5, 7, 11, 15; phases 1–8 → tasks 2, 5+7, 9, 10, 11, 12+13, 14, 15. The Audnexus config (spec's "config field, defaulting to the public instance") is Task 6.

**Two deliberate deviations from the spec, both narrowing scope:**

1. The spec's `Author` enrichment (bio, image, birth date) has mappers in Tasks 7 and 11 (`enrichAuthor`) but **no task writes them to the `Author` table.** `Author.audibleAsin` is added in Task 2 and left unpopulated. Author enrichment needs its own decision — authors are shared across books, so refreshing one book should probably not rewrite an author row every time — and it is not on the critical path for the fields the operator actually asked about.
2. Task 11's `enrichAuthor` returns `genres` from `top_subjects`, which is book-level genre data derived from an author. That is loose; it exists only because Open Library's work docs carry no subjects. Consider dropping it in review.

**Known gaps to resolve during execution, not now:**

- Task 10 asserts field names on `EbookMetadata` (`publisher`, `seriesName`, `seriesPosition`) that may not exist yet. Step 3 of that task instructs reading the real interface first and adjusting; that is a real fork in the work, flagged rather than guessed.
- Task 12's exact API route file path under `apps/api/src/routes/integrations/` is not named, because the Google Books route's filename was not verified. Step 1 instructs reading it first.
- `MediaSettings` is assumed to have an `id: 1` singleton row, matching how `resolveBookProfileId` in `bookLibrary.ts` already queries it.

**Type consistency.** `ProviderFields`, `BookMatchInput`, `AsinCandidate`, `AsinWant`, `BookMetadataSource` and `MERGEABLE_FIELDS` are defined once (Tasks 1, 4→moved to types in 5, 8) and referenced by those names throughout. `__asin` is declared on `ProviderFields` in Task 7 Step 4 and stripped before column writes in Task 9. `normalizeSourceOrder` is shared, defined in Task 1, used in Tasks 9 and 12.
