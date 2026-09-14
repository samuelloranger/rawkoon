# Localized Display Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show movie and show titles in the UI's active language, with correct alphabetical ordering and text search in that language.

**Architecture:** A `library_media_titles` table holds one row per (media, locale) with a localized title and a locale-aware sort title. Rows are written inline when a media is added from TMDB (translations are already in that response) and backfilled/refreshed by a scheduled job. `GET /api/library` takes a `titleLanguage` param; for non-English it resolves page ids through one small raw SQL query that joins the title table, then loads those ids through the existing Prisma include so mapping stays single-sourced. English keeps the current code path untouched.

**Tech Stack:** Bun, Hono, Zod (`queryV`/`jsonV` wrappers), Prisma 7 + `@prisma/adapter-pg`, Postgres 17, BullMQ, React 19 + TanStack Query, i18next.

**Spec:** `docs/superpowers/specs/2026-09-14-localized-titles-and-image-picker-design.md`

## Global Constraints

- Supported title locales are exactly `en` and `fr` — the locales `apps/web/src/locales` ships. Exported as `SUPPORTED_TITLE_LANGUAGES` from `@rawkoon/shared/constants`.
- Localization is **display-only**. Do not touch `resolveSearchTitles`, `releaseMatchesExpectedTitles`, import filenames, library paths, or notification bodies. They keep using `LibraryMedia.title` / `searchTitle`.
- `overrides.title` keeps winning over everything. Final precedence: `overrides.title` → localized title → English `title`.
- API code imports itself as `@rawkoon/api/<path>`, never by relative path (except within the same directory, which the codebase does use — follow the neighbouring file).
- Errors are helper returns, not throws: `badRequest`/`notFound`/`serverError` from `@rawkoon/api/errors`.
- TS is strict: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`.
- `bun run typecheck` and `bun run lint` must pass before every commit.
- Run the **full** `apps/api` test suite (`bun run --filter @rawkoon/api test`), never a single file — the suite is order-dependent and a single-file pass does not predict CI.
- Never run `db:migrate:dev` or `db:push` against production.

---

### Task 1: Shared title-language constants

**Files:**
- Create: `apps/shared/src/constants/index.ts`
- Test: `apps/shared/src/constants/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SUPPORTED_TITLE_LANGUAGES: readonly ["en", "fr"]`
  - `type TitleLanguage = "en" | "fr"`
  - `DEFAULT_TITLE_LANGUAGE: TitleLanguage` (`"en"`)
  - `normalizeTitleLanguage(value: string | null | undefined): TitleLanguage`

`apps/shared/package.json` already maps `"./constants": "./src/constants/index.ts"`, but the directory does not exist. This task creates it.

- [ ] **Step 1: Write the failing test**

Create `apps/shared/src/constants/index.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_TITLE_LANGUAGE,
  SUPPORTED_TITLE_LANGUAGES,
  normalizeTitleLanguage,
} from "./index";

describe("normalizeTitleLanguage", () => {
  it("passes through a supported language", () => {
    expect(normalizeTitleLanguage("fr")).toBe("fr");
    expect(normalizeTitleLanguage("en")).toBe("en");
  });

  it("strips a region suffix and lowercases", () => {
    expect(normalizeTitleLanguage("fr-CA")).toBe("fr");
    expect(normalizeTitleLanguage("FR")).toBe("fr");
    expect(normalizeTitleLanguage("en_US")).toBe("en");
  });

  it("falls back to the default for unsupported or missing values", () => {
    expect(normalizeTitleLanguage("de")).toBe(DEFAULT_TITLE_LANGUAGE);
    expect(normalizeTitleLanguage("")).toBe(DEFAULT_TITLE_LANGUAGE);
    expect(normalizeTitleLanguage(null)).toBe(DEFAULT_TITLE_LANGUAGE);
    expect(normalizeTitleLanguage(undefined)).toBe(DEFAULT_TITLE_LANGUAGE);
  });

  it("lists exactly the locales the web app ships", () => {
    expect([...SUPPORTED_TITLE_LANGUAGES]).toEqual(["en", "fr"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/shared test`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/shared/src/constants/index.ts`:

```ts
/** Locales the web app ships translations for; the set of stored title languages. */
export const SUPPORTED_TITLE_LANGUAGES = ["en", "fr"] as const;

export type TitleLanguage = (typeof SUPPORTED_TITLE_LANGUAGES)[number];

export const DEFAULT_TITLE_LANGUAGE: TitleLanguage = "en";

/** Narrow an i18n tag ("fr-CA", "EN") to a stored title language, else the default. */
export function normalizeTitleLanguage(
  value: string | null | undefined,
): TitleLanguage {
  const base = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_TITLE_LANGUAGES.includes(base as TitleLanguage)
    ? (base as TitleLanguage)
    : DEFAULT_TITLE_LANGUAGE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/shared test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add apps/shared/src/constants/index.ts apps/shared/src/constants/index.test.ts
git commit -m "feat(shared): add supported title language constants"
```

---

### Task 2: Locale-aware sort titles

**Files:**
- Modify: `apps/api/src/utils/medias/libraryHelpers.ts:13-15`
- Test: `apps/api/src/utils/medias/libraryHelpers.test.ts` (create if absent; if it exists, append the describe block)

**Interfaces:**
- Consumes: `TitleLanguage` from `@rawkoon/shared/constants` (Task 1).
- Produces: `sortTitleFromName(name: string, language?: TitleLanguage): string` — the second parameter defaults to `"en"`, so the six existing call sites (`libraryFromTmdb.ts:167,182,242,254`, `libraryMigrateRadarr.ts:103`, `libraryMigrateSonarr.ts:105`, `libraryMediaAdmin.ts:298,349`, `refreshLibraryTitlesFromTmdb.ts:139,217`) keep compiling and keep their exact current behavior.

- [ ] **Step 1: Write the failing test**

Create (or append to) `apps/api/src/utils/medias/libraryHelpers.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { sortTitleFromName } from "@rawkoon/api/utils/medias/libraryHelpers";

describe("sortTitleFromName", () => {
  it("strips English articles by default", () => {
    expect(sortTitleFromName("The Godfather")).toBe("Godfather");
    expect(sortTitleFromName("A Star Is Born")).toBe("Star Is Born");
    expect(sortTitleFromName("An Education")).toBe("Education");
  });

  it("leaves French articles alone in English", () => {
    expect(sortTitleFromName("Le Parrain")).toBe("Le Parrain");
  });

  it("strips French articles when the language is fr", () => {
    expect(sortTitleFromName("Le Parrain", "fr")).toBe("Parrain");
    expect(sortTitleFromName("La Haine", "fr")).toBe("Haine");
    expect(sortTitleFromName("Les Choristes", "fr")).toBe("Choristes");
    expect(sortTitleFromName("Un Prophète", "fr")).toBe("Prophète");
    expect(sortTitleFromName("Une Femme", "fr")).toBe("Femme");
    expect(sortTitleFromName("Des Hommes", "fr")).toBe("Hommes");
  });

  it("strips the elided French article with no following space", () => {
    expect(sortTitleFromName("L'Étranger", "fr")).toBe("Étranger");
    expect(sortTitleFromName("L’Étranger", "fr")).toBe("Étranger");
  });

  it("does not strip a word that merely starts with an article", () => {
    expect(sortTitleFromName("Lesson Plan", "fr")).toBe("Lesson Plan");
    expect(sortTitleFromName("Theory of Everything")).toBe(
      "Theory of Everything",
    );
  });

  it("never returns an empty string when the title is only an article", () => {
    expect(sortTitleFromName("The", "en")).toBe("The");
    expect(sortTitleFromName("Le", "fr")).toBe("Le");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — French cases return the input unchanged; `sortTitleFromName` takes one argument.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/api/src/utils/medias/libraryHelpers.ts:13-15` with:

```ts
/** Leading articles stripped for A-Z ordering, per stored title language. */
const SORT_ARTICLE_PATTERNS: Record<TitleLanguage, RegExp> = {
  en: /^(the|a|an)\s+/i,
  fr: /^(?:(?:le|la|les|un|une|des)\s+|l['’])/i,
};

export function sortTitleFromName(
  name: string,
  language: TitleLanguage = DEFAULT_TITLE_LANGUAGE,
): string {
  const stripped = name.replace(SORT_ARTICLE_PATTERNS[language], "").trim();
  // A title that is nothing but an article would sort as "" — keep the original.
  return stripped || name.trim();
}
```

Add to the imports at the top of the same file:

```ts
import {
  DEFAULT_TITLE_LANGUAGE,
  type TitleLanguage,
} from "@rawkoon/shared/constants";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS, and no existing test regresses (the default argument preserves current behavior).

- [ ] **Step 5: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
git add apps/api/src/utils/medias/libraryHelpers.ts apps/api/src/utils/medias/libraryHelpers.test.ts
git commit -m "feat(api): make sortTitleFromName locale-aware"
```

---

### Task 3: Localized title row resolver

**Files:**
- Create: `apps/api/src/utils/medias/localizedTitles.ts`
- Create: `apps/api/src/utils/medias/localizedTitles.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_TITLE_LANGUAGES`, `TitleLanguage` (Task 1); `sortTitleFromName` (Task 2).
- Produces: `resolveLocalizedTitleRows(input: LocalizedTitleInput): LocalizedTitleRow[]` where

```ts
export type LocalizedTitleRow = {
  language: TitleLanguage;
  title: string;
  sortTitle: string;
};

export type LocalizedTitleInput = {
  englishTitle: string;
  originalTitle: string | null;
  originalLanguage: string | null;
  translations: { language_code: string; title: string }[];
};
```

`translations` is the shape `extractTitleTranslations` from `@rawkoon/api/utils/medias/tmdbFetcherDetails` already returns and `resolvePreferredSearchTitle` already consumes.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/utils/medias/localizedTitles.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { resolveLocalizedTitleRows } from "@rawkoon/api/utils/medias/localizedTitles";

describe("resolveLocalizedTitleRows", () => {
  it("returns one row per supported language", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [{ language_code: "fr", title: "Le Parrain" }],
    });
    expect(rows.map((r) => r.language).sort()).toEqual(["en", "fr"]);
  });

  it("prefers the translation for the language", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [{ language_code: "FR", title: "  Le Parrain  " }],
    });
    const fr = rows.find((r) => r.language === "fr");
    expect(fr?.title).toBe("Le Parrain");
    expect(fr?.sortTitle).toBe("Parrain");
  });

  it("falls back to the original title when it is in that language", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "Amelie",
      originalTitle: "Le Fabuleux Destin d'Amélie Poulain",
      originalLanguage: "fr",
      translations: [],
    });
    const fr = rows.find((r) => r.language === "fr");
    expect(fr?.title).toBe("Le Fabuleux Destin d'Amélie Poulain");
    expect(fr?.sortTitle).toBe("Fabuleux Destin d'Amélie Poulain");
  });

  it("falls back to the English title when nothing else matches", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "Oldboy",
      originalTitle: "올드보이",
      originalLanguage: "ko",
      translations: [],
    });
    const fr = rows.find((r) => r.language === "fr");
    expect(fr?.title).toBe("Oldboy");
    expect(fr?.sortTitle).toBe("Oldboy");
  });

  it("ignores blank translations", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "Heat",
      originalTitle: "Heat",
      originalLanguage: "en",
      translations: [{ language_code: "fr", title: "   " }],
    });
    expect(rows.find((r) => r.language === "fr")?.title).toBe("Heat");
  });

  it("sorts the English row with English article rules", () => {
    const rows = resolveLocalizedTitleRows({
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [],
    });
    expect(rows.find((r) => r.language === "en")?.sortTitle).toBe("Godfather");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — module `localizedTitles` not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/utils/medias/localizedTitles.ts`:

```ts
import {
  SUPPORTED_TITLE_LANGUAGES,
  type TitleLanguage,
} from "@rawkoon/shared/constants";
import { sortTitleFromName } from "@rawkoon/api/utils/medias/libraryHelpers";

export type LocalizedTitleRow = {
  language: TitleLanguage;
  title: string;
  sortTitle: string;
};

export type LocalizedTitleInput = {
  englishTitle: string;
  originalTitle: string | null;
  originalLanguage: string | null;
  translations: { language_code: string; title: string }[];
};

/**
 * One title row per supported locale.
 * Order: translation for the locale → original title when it is that locale →
 * the English title. The last step guarantees every locale gets a row.
 */
export function resolveLocalizedTitleRows(
  input: LocalizedTitleInput,
): LocalizedTitleRow[] {
  const byLang = new Map<string, string>();
  for (const entry of input.translations) {
    const code = entry.language_code?.trim().toLowerCase();
    const title = entry.title?.trim();
    if (code && title && !byLang.has(code)) byLang.set(code, title);
  }

  const originalLanguage = (input.originalLanguage ?? "").trim().toLowerCase();
  const originalTitle = input.originalTitle?.trim() || null;
  const englishTitle = input.englishTitle.trim();

  return SUPPORTED_TITLE_LANGUAGES.map((language) => {
    const title =
      byLang.get(language) ??
      (language === originalLanguage && originalTitle
        ? originalTitle
        : englishTitle);
    return { language, title, sortTitle: sortTitleFromName(title, language) };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
git add apps/api/src/utils/medias/localizedTitles.ts apps/api/src/utils/medias/localizedTitles.test.ts
git commit -m "feat(api): resolve per-locale library title rows"
```

---

### Task 4: `library_media_titles` table

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add model; add back-relation on `LibraryMedia` around line 445)
- Create: `apps/api/prisma/migrations/<timestamp>_add_library_media_titles/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the Prisma model `LibraryMediaTitle` with fields `mediaId`, `language`, `title`, `sortTitle`, and the delegate `prisma.libraryMediaTitle`.

- [ ] **Step 1: Add the model to the schema**

Append to `apps/api/prisma/schema.prisma`, next to the other library models:

```prisma
/// Display title per UI locale. Populated from TMDB translations; the read path
/// COALESCEs to library_media.title so a missing row degrades to English.
model LibraryMediaTitle {
  mediaId   Int      @map("media_id")
  language  String   @db.VarChar(8)
  title     String
  sortTitle String   @map("sort_title")
  updatedAt DateTime @updatedAt @map("updated_at")

  media LibraryMedia @relation(fields: [mediaId], references: [id], onDelete: Cascade)

  @@id([mediaId, language])
  @@index([language, sortTitle], map: "ix_library_media_titles_language_sort_title")
  @@index([title(ops: raw("gin_trgm_ops"))], type: Gin, map: "ix_library_media_titles_title_trgm")
  @@map("library_media_titles")
}
```

- [ ] **Step 2: Add the back-relation on LibraryMedia**

In the `LibraryMedia` model, in the relation block that already lists `episodes`, `files`, `downloadHistories`, `blocklistEntries`, `attentionAlerts`, `mediaRequests`, add:

```prisma
  titles            LibraryMediaTitle[]
```

- [ ] **Step 3: Generate and apply the migration**

Requires the dev services running (`bun run dev:services`) and a root `.env` with `DATABASE_URL`.

```bash
bun run db:migrate:dev --name add_library_media_titles
```

- [ ] **Step 4: Verify the table and indexes exist**

```bash
docker compose -p rawkoon-dev exec db psql -U rawkoon -d rawkoon -c '\d library_media_titles'
```

Expected: the table, the composite primary key `(media_id, language)`, `ix_library_media_titles_language_sort_title`, and the GIN index `ix_library_media_titles_title_trgm`.

If the GIN index fails to create, `pg_trgm` is missing — it is already required by `ix_library_media_title_trgm` on `library_media`, so a failure here means the migration ordering is wrong, not that the extension needs adding.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run db:generate
bun run typecheck
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add library_media_titles table"
```

---

### Task 5: Write title rows on add

**Files:**
- Modify: `apps/api/src/services/libraryFromTmdb.ts`
- Create: `apps/api/src/services/localizedTitleSync.ts`
- Create: `apps/api/src/services/localizedTitleSync.test.ts`

**Interfaces:**
- Consumes: `resolveLocalizedTitleRows`, `LocalizedTitleInput` (Task 3); `prisma.libraryMediaTitle` (Task 4).
- Produces:
  - `writeLocalizedTitles(mediaId: number, input: LocalizedTitleInput): Promise<void>` — resolves rows and upserts them. Never throws; logs and returns on failure, so a library add is never lost to a title-row problem.
  - `syncLocalizedTitlesForMedia(mediaId: number): Promise<boolean>` — added in Task 6; declared here only so Task 6 knows the file.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/localizedTitleSync.test.ts`. API tests mock `@rawkoon/api/db`:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test";

const upsert = mock(async () => ({}));

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMediaTitle: { upsert } },
}));

const { writeLocalizedTitles } = await import(
  "@rawkoon/api/services/localizedTitleSync"
);

describe("writeLocalizedTitles", () => {
  beforeEach(() => {
    upsert.mockClear();
  });

  it("upserts one row per supported language", async () => {
    await writeLocalizedTitles(7, {
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [{ language_code: "fr", title: "Le Parrain" }],
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    const args = upsert.mock.calls.map((c) => c[0] as Record<string, never>);
    const fr = args.find(
      (a) =>
        (a as unknown as { where: { mediaId_language: { language: string } } })
          .where.mediaId_language.language === "fr",
    ) as unknown as {
      create: { title: string; sortTitle: string; mediaId: number };
      update: { title: string; sortTitle: string };
    };
    expect(fr.create.mediaId).toBe(7);
    expect(fr.create.title).toBe("Le Parrain");
    expect(fr.create.sortTitle).toBe("Parrain");
    expect(fr.update.title).toBe("Le Parrain");
  });

  it("swallows database errors so the caller still succeeds", async () => {
    upsert.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    await expect(
      writeLocalizedTitles(7, {
        englishTitle: "Heat",
        originalTitle: "Heat",
        originalLanguage: "en",
        translations: [],
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — module `localizedTitleSync` not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/localizedTitleSync.ts`:

```ts
import { prisma } from "@rawkoon/api/db";
import {
  resolveLocalizedTitleRows,
  type LocalizedTitleInput,
} from "@rawkoon/api/utils/medias/localizedTitles";

/**
 * Upsert the per-locale title rows for one media.
 * Never throws — a failure here must not lose a library add.
 */
export async function writeLocalizedTitles(
  mediaId: number,
  input: LocalizedTitleInput,
): Promise<void> {
  try {
    const rows = resolveLocalizedTitleRows(input);
    for (const row of rows) {
      await prisma.libraryMediaTitle.upsert({
        where: {
          mediaId_language: { mediaId, language: row.language },
        },
        create: {
          mediaId,
          language: row.language,
          title: row.title,
          sortTitle: row.sortTitle,
        },
        update: { title: row.title, sortTitle: row.sortTitle },
      });
    }
  } catch (e) {
    console.warn(
      `[localizedTitleSync] Failed to write title rows for media ${mediaId}:`,
      e,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Call it from the add path**

In `apps/api/src/services/libraryFromTmdb.ts`, add the import:

```ts
import { writeLocalizedTitles } from "@rawkoon/api/services/localizedTitleSync";
import { extractTitleTranslations } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
```

(`extractTitleTranslations` is already imported in this file — do not duplicate it.)

The movie branch already computes `searchFields` from `buildSearchTitleFields({ ... translationsRaw: details.translations, mediaType: "movie" })` and then upserts the media. **After** that upsert returns the media row, add:

```ts
    await writeLocalizedTitles(media.id, {
      englishTitle: details.title,
      originalTitle: toStringOrNull(details.original_title),
      originalLanguage: toStringOrNull(details.original_language),
      translations: extractTitleTranslations(details.translations, "movie"),
    });
```

Do the same in the show branch, using `details.name` as `englishTitle` and `"tv"` as the `extractTitleTranslations` media type.

Bind the upsert result to `media` if it is not already bound — the function returns it, so the variable exists; use whatever name the surrounding code already uses for the upserted row.

- [ ] **Step 6: Verify end to end**

With dev services and the API running:

```bash
curl -sS -X POST localhost:3000/api/library \
  -H 'content-type: application/json' \
  -H "Cookie: $RAWKOON_COOKIE" \
  -d '{"tmdb_id":238,"type":"movie"}' | head -c 300
docker compose -p rawkoon-dev exec db psql -U rawkoon -d rawkoon \
  -c "SELECT language, title, sort_title FROM library_media_titles t JOIN library_media m ON m.id = t.media_id WHERE m.tmdb_id = 238;"
```

Expected: two rows — `en | The Godfather | Godfather` and `fr | Le Parrain | Parrain`.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
bun run --filter @rawkoon/api test
git add apps/api/src/services/localizedTitleSync.ts apps/api/src/services/localizedTitleSync.test.ts apps/api/src/services/libraryFromTmdb.ts
git commit -m "feat(api): write localized title rows when adding from TMDB"
```

---

### Task 6: Scheduled backfill and refresh job

**Files:**
- Modify: `apps/api/src/services/localizedTitleSync.ts`
- Modify: `apps/api/src/services/queueService.ts:25-40`
- Create: `apps/api/src/workers/syncLocalizedTitles.ts`
- Modify: `apps/api/src/workers/index.ts` (the `initWorkers` / scheduled-job switch — follow how `SYNC_LIBRARY_ATTENTION_ALERTS` is wired)
- Modify: wherever `setupScheduledJobs()` registers repeatable jobs (same file that schedules `SYNC_LIBRARY_ATTENTION_ALERTS`)
- Create: `apps/api/src/workers/syncLocalizedTitles.test.ts`

**Interfaces:**
- Consumes: `writeLocalizedTitles` (Task 5); `getLibraryTmdbApiKey`, `tmdbApiFetch` from `@rawkoon/api/utils/medias/libraryHelpers`; `extractTitleTranslations`; `TMDB_LANGUAGE_LIBRARY_PERSISTENCE`.
- Produces:
  - `SCHEDULED_JOB_NAMES.SYNC_LOCALIZED_TITLES = "sync-localized-titles"`
  - `syncLocalizedTitles(limit?: number): Promise<{ processed: number; failed: number }>` exported from `apps/api/src/workers/syncLocalizedTitles.ts`
  - `findMediaNeedingLocalizedTitles(limit: number): Promise<{ id: number; tmdbId: number; type: string }[]>` exported from `apps/api/src/services/localizedTitleSync.ts`

This job is what covers the four write sites that create media without translations (`libraryMediaAdmin`, `libraryMigrateRadarr`, `libraryMigrateSonarr`, `refreshLibraryTitlesFromTmdb`) and what heals staleness after a TMDB retitle.

- [ ] **Step 1: Write the failing test for the selector**

Append to `apps/api/src/services/localizedTitleSync.test.ts`:

```ts
describe("findMediaNeedingLocalizedTitles", () => {
  it("asks for media with no rows or rows older than the media", async () => {
    const queryRaw = mock(async () => [{ id: 1, tmdbId: 238, type: "movie" }]);
    mock.module("@rawkoon/api/db", () => ({
      prisma: { libraryMediaTitle: { upsert }, $queryRaw: queryRaw },
    }));
    const { findMediaNeedingLocalizedTitles } = await import(
      "@rawkoon/api/services/localizedTitleSync"
    );
    const rows = await findMediaNeedingLocalizedTitles(50);
    expect(rows).toEqual([{ id: 1, tmdbId: 238, type: "movie" }]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — `findMediaNeedingLocalizedTitles` is not exported.

- [ ] **Step 3: Add the selector**

Append to `apps/api/src/services/localizedTitleSync.ts`:

Add `import { SUPPORTED_TITLE_LANGUAGES } from "@rawkoon/shared/constants";` to the file's imports, then append:

```ts
/**
 * Media whose title rows are missing or predate the media's last update.
 * Ordered by id so repeated runs make forward progress.
 */
export async function findMediaNeedingLocalizedTitles(
  limit: number,
): Promise<{ id: number; tmdbId: number; type: string }[]> {
  return prisma.$queryRaw<{ id: number; tmdbId: number; type: string }[]>`
    SELECT m.id, m.tmdb_id AS "tmdbId", m.type
    FROM library_media m
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n, MIN(t.updated_at) AS oldest
      FROM library_media_titles t
      WHERE t.media_id = m.id
    ) s ON TRUE
    WHERE s.n < ${SUPPORTED_TITLE_LANGUAGES.length}
       OR s.oldest < m.updated_at
    ORDER BY m.id
    LIMIT ${limit}
  `;
}
```

The tagged-template form needs no `Prisma` import here — do not add one, `noUnusedLocals` would reject it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Write the worker test**

Create `apps/api/src/workers/syncLocalizedTitles.test.ts`:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test";

const findMedia = mock(async () => [
  { id: 1, tmdbId: 238, type: "movie" },
  { id: 2, tmdbId: 1399, type: "show" },
]);
const write = mock(async () => {});
const getKey = mock(async () => "key");
const tmdbFetch = mock(async (path: string) => ({
  title: path.startsWith("movie") ? "The Godfather" : undefined,
  name: path.startsWith("tv") ? "Game of Thrones" : undefined,
  original_title: "The Godfather",
  original_language: "en",
  translations: {},
}));

mock.module("@rawkoon/api/services/localizedTitleSync", () => ({
  findMediaNeedingLocalizedTitles: findMedia,
  writeLocalizedTitles: write,
}));
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  getLibraryTmdbApiKey: getKey,
  tmdbApiFetch: tmdbFetch,
}));

const { syncLocalizedTitles } = await import(
  "@rawkoon/api/workers/syncLocalizedTitles"
);

describe("syncLocalizedTitles", () => {
  beforeEach(() => {
    write.mockClear();
    tmdbFetch.mockClear();
  });

  it("writes rows for every media returned by the selector", async () => {
    const result = await syncLocalizedTitles(50);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("uses the movie endpoint for movies and the tv endpoint for shows", async () => {
    await syncLocalizedTitles(50);
    const paths = tmdbFetch.mock.calls.map((c) => c[0] as string);
    expect(paths[0]).toBe("movie/238");
    expect(paths[1]).toBe("tv/1399");
  });

  it("does nothing when TMDB is not configured", async () => {
    getKey.mockImplementationOnce(async () => null);
    const result = await syncLocalizedTitles(50);
    expect(result.processed).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("counts a failing media and keeps going", async () => {
    tmdbFetch.mockImplementationOnce(async () => {
      throw new Error("429");
    });
    const result = await syncLocalizedTitles(50);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — module `syncLocalizedTitles` not found.

- [ ] **Step 7: Write the worker**

Create `apps/api/src/workers/syncLocalizedTitles.ts`:

```ts
import {
  findMediaNeedingLocalizedTitles,
  writeLocalizedTitles,
} from "@rawkoon/api/services/localizedTitleSync";
import {
  getLibraryTmdbApiKey,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { extractTitleTranslations } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import { toStringOrNull } from "@rawkoon/api/utils/medias/mappers";

const BATCH_LIMIT = 200;
const TMDB_REQUEST_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type TmdbTitleDetails = {
  title?: string;
  name?: string;
  original_title?: string | null;
  original_name?: string | null;
  original_language?: string | null;
  translations?: unknown;
};

/** Fill or refresh per-locale title rows for media the selector flags. */
export async function syncLocalizedTitles(
  limit = BATCH_LIMIT,
): Promise<{ processed: number; failed: number }> {
  const key = await getLibraryTmdbApiKey();
  if (!key) return { processed: 0, failed: 0 };

  const media = await findMediaNeedingLocalizedTitles(limit);
  let processed = 0;
  let failed = 0;

  for (const m of media) {
    const isMovie = m.type === "movie";
    try {
      const details = await tmdbApiFetch<TmdbTitleDetails>(
        `${isMovie ? "movie" : "tv"}/${m.tmdbId}`,
        key,
        {
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
          append_to_response: "translations",
        },
      );
      const englishTitle = (isMovie ? details.title : details.name) ?? "";
      if (!englishTitle) {
        failed++;
        continue;
      }
      await writeLocalizedTitles(m.id, {
        englishTitle,
        originalTitle: toStringOrNull(
          isMovie ? details.original_title : details.original_name,
        ),
        originalLanguage: toStringOrNull(details.original_language),
        translations: extractTitleTranslations(
          details.translations,
          isMovie ? "movie" : "tv",
        ),
      });
      processed++;
    } catch (e) {
      console.warn(
        `[syncLocalizedTitles] media ${m.id} (tmdb ${m.tmdbId}) failed:`,
        e,
      );
      failed++;
    }
    await sleep(TMDB_REQUEST_DELAY_MS);
  }

  return { processed, failed };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 9: Register the job**

In `apps/api/src/services/queueService.ts`, add to `SCHEDULED_JOB_NAMES`:

```ts
  SYNC_LOCALIZED_TITLES: "sync-localized-titles",
```

In the worker dispatch that handles `SCHEDULED_TASKS` jobs, add a case mirroring the existing `SYNC_LIBRARY_ATTENTION_ALERTS` case:

```ts
      case SCHEDULED_JOB_NAMES.SYNC_LOCALIZED_TITLES:
        return await syncLocalizedTitles();
```

In `setupScheduledJobs()`, register it on the same cadence the other library housekeeping jobs use — read the neighbouring `SYNC_LIBRARY_ATTENTION_ALERTS` registration and copy its repeat pattern, changing only the job name. Hourly is appropriate: the job is a backstop, not a hot path.

- [ ] **Step 10: Verify the job runs**

Restart the API and watch the log for the job firing, then:

```bash
docker compose -p rawkoon-dev exec db psql -U rawkoon -d rawkoon \
  -c "SELECT COUNT(*) FROM library_media;"
docker compose -p rawkoon-dev exec db psql -U rawkoon -d rawkoon \
  -c "SELECT COUNT(DISTINCT media_id) FROM library_media_titles;"
```

Expected: after the job has drained (it processes 200 per run), the two counts match.

- [ ] **Step 11: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
bun run --filter @rawkoon/api test
git add apps/api/src/workers/syncLocalizedTitles.ts apps/api/src/workers/syncLocalizedTitles.test.ts apps/api/src/services/localizedTitleSync.ts apps/api/src/services/localizedTitleSync.test.ts apps/api/src/services/queueService.ts apps/api/src/workers/index.ts
git commit -m "feat(api): scheduled job to backfill and refresh localized titles"
```

---

### Task 7: Localized list query

**Files:**
- Create: `apps/api/src/routes/library/libraryLocalizedListQuery.ts`
- Create: `apps/api/src/routes/library/libraryLocalizedListQuery.test.ts`

**Interfaces:**
- Consumes: `LibrarySortBy`, `LibrarySortDir` from `./libraryListQuery`; `TitleLanguage` (Task 1).
- Produces:

```ts
export function buildLocalizedIdQuery(input: {
  language: TitleLanguage;
  type?: string;
  status?: string;
  q?: string;
  fileLanguage?: string;
  sortBy: LibrarySortBy;
  sortDir: LibrarySortDir;
  take: number;
  skip: number;
}): Prisma.Sql;
```

Returns a `Prisma.Sql` selecting `id` only, ordered and paginated. Callers run it with `prisma.$queryRaw<{ id: number }[]>`.

Every value is interpolated through `Prisma.sql` placeholders; the only string concatenation is of a fixed whitelist of ORDER BY fragments keyed by `sortBy`/`sortDir`, both already narrowed by `parseLibrarySort`. No user string ever reaches the SQL text.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/library/libraryLocalizedListQuery.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildLocalizedIdQuery } from "./libraryLocalizedListQuery";

const sqlText = (s: { strings: readonly string[] }) => s.strings.join("?");

describe("buildLocalizedIdQuery", () => {
  it("joins the title table on the requested language", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    const text = sqlText(q);
    expect(text).toContain("library_media_titles");
    expect(text).toContain("LEFT JOIN");
    expect(q.values).toContain("fr");
  });

  it("orders by the coalesced localized sort title for a title sort", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "title",
      sortDir: "desc",
      take: 60,
      skip: 0,
    });
    const text = sqlText(q);
    expect(text).toContain('COALESCE(t.sort_title, m."list_title")');
    expect(text).toContain("DESC");
  });

  it("still uses the persisted column for a non-title sort", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "added_at",
      sortDir: "desc",
      take: 60,
      skip: 0,
    });
    expect(sqlText(q)).toContain('m."added_at"');
  });

  it("searches the localized title and the English title", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      q: "parrain",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    const text = sqlText(q);
    expect(text).toContain("t.title ILIKE");
    expect(text).toContain('m."title" ILIKE');
    expect(q.values).toContain("%parrain%");
  });

  it("never inlines the search term into the SQL text", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      q: "'; DROP TABLE library_media; --",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    expect(sqlText(q)).not.toContain("DROP TABLE");
  });

  it("filters by type, status and file language when given", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      type: "movie",
      status: "downloaded",
      fileLanguage: "fre",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    expect(q.values).toContain("movie");
    expect(q.values).toContain("downloaded");
    expect(q.values).toContain("fre");
    expect(sqlText(q)).toContain("media_files");
  });

  it("paginates with limit and offset", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "title",
      sortDir: "asc",
      take: 61,
      skip: 120,
    });
    expect(q.values).toContain(61);
    expect(q.values).toContain(120);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/routes/library/libraryLocalizedListQuery.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { TitleLanguage } from "@rawkoon/shared/constants";
import type { LibrarySortBy, LibrarySortDir } from "./libraryListQuery";

/**
 * ORDER BY fragments, keyed by the already-narrowed sort enum. The only place
 * SQL text varies; no caller-supplied string is ever concatenated.
 */
function orderByFragment(
  sortBy: LibrarySortBy,
  sortDir: LibrarySortDir,
): Prisma.Sql {
  const dir = sortDir === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
  const idDir = dir;
  switch (sortBy) {
    case "title":
      return Prisma.sql`COALESCE(t.sort_title, m."list_title") ${dir}, m."id" ${idDir}`;
    case "year":
      return Prisma.sql`m."list_year" ${dir} NULLS LAST, m."id" ${idDir}`;
    case "status":
      return Prisma.sql`m."status" ${dir}, m."id" ${idDir}`;
    case "digital_release_date":
      return Prisma.sql`m."digital_release_date" ${dir} NULLS LAST, m."id" ${idDir}`;
    case "file_size":
      return Prisma.sql`m."total_size_bytes" ${dir} NULLS LAST, m."id" ${idDir}`;
    case "last_grabbed_at":
      return sortDir === "asc"
        ? Prisma.sql`m."last_grabbed_at" ASC NULLS FIRST, m."id" ASC`
        : Prisma.sql`m."last_grabbed_at" DESC NULLS LAST, m."id" DESC`;
    case "added_at":
      return Prisma.sql`m."added_at" ${dir}, m."id" ${idDir}`;
  }
}

/** Page of library ids, ordered and filtered by the localized title. */
export function buildLocalizedIdQuery(input: {
  language: TitleLanguage;
  type?: string;
  status?: string;
  q?: string;
  fileLanguage?: string;
  sortBy: LibrarySortBy;
  sortDir: LibrarySortDir;
  take: number;
  skip: number;
}): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (input.type) conditions.push(Prisma.sql`m."type" = ${input.type}`);
  if (input.status) conditions.push(Prisma.sql`m."status" = ${input.status}`);
  if (input.q) {
    const pattern = `%${input.q}%`;
    conditions.push(
      Prisma.sql`(t.title ILIKE ${pattern} OR m."title" ILIKE ${pattern})`,
    );
  }
  if (input.fileLanguage) {
    conditions.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM media_files f
        WHERE f.media_id = m."id"
          AND ${input.fileLanguage} = ANY(f.language_tags)
      )`,
    );
  }

  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;

  return Prisma.sql`
    SELECT m."id"
    FROM library_media m
    LEFT JOIN library_media_titles t
      ON t.media_id = m."id" AND t.language = ${input.language}
    ${where}
    ORDER BY ${orderByFragment(input.sortBy, input.sortDir)}
    LIMIT ${input.take} OFFSET ${input.skip}
  `;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Confirm the media_files column names**

The `EXISTS` subquery hardcodes `media_files.media_id` and `media_files.language_tags`. Verify against the schema before trusting it:

```bash
docker compose -p rawkoon-dev exec db psql -U rawkoon -d rawkoon -c '\d media_files'
```

If the foreign key column is named differently, fix the fragment and the test.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
git add apps/api/src/routes/library/libraryLocalizedListQuery.ts apps/api/src/routes/library/libraryLocalizedListQuery.test.ts
git commit -m "feat(api): build localized library id query"
```

---

### Task 8: Serve localized titles from GET /api/library

**Files:**
- Modify: `apps/api/src/routes/library/libraryHelpers.ts` (`mapLibraryMedia`, `libraryMediaInclude`)
- Modify: `apps/api/src/routes/library/libraryListRoutes.ts` (`listQuery` schema, the `GET /` handler, and `GET /item/:id`)

**Interfaces:**
- Consumes: `buildLocalizedIdQuery` (Task 7); `normalizeTitleLanguage`, `DEFAULT_TITLE_LANGUAGE`, `TitleLanguage` (Task 1).
- Produces:
  - `mapLibraryMedia(item, titleLanguage?: TitleLanguage)` — second parameter optional, defaults to `"en"`, so every existing call site (`libraryListRoutes`, `libraryMetaRoutes`, `libraryGrabRoutes`, and any other) keeps compiling and keeps English behavior.
  - `libraryMediaInclude` gains `titles: { select: { language: true, title: true } }`.
  - `GET /api/library` and `GET /api/library/item/:id` accept `title_language`.

Response `title` precedence: `overrides.title` → the `titles` row for `titleLanguage` → `item.title`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/library/libraryHelpers.test.ts` (append if it exists):

```ts
import { describe, expect, it } from "bun:test";
import { mapLibraryMedia } from "./libraryHelpers";

const base = {
  id: 1,
  tmdbId: 238,
  type: "movie",
  title: "The Godfather",
  sortTitle: "Godfather",
  year: 1972,
  status: "downloaded",
  monitored: true,
  posterUrl: null,
  overview: null,
  digitalReleaseDate: null,
  qualityProfileId: null,
  searchAttempts: 0,
  qualityProfile: null,
  addedAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  titles: [
    { language: "en", title: "The Godfather" },
    { language: "fr", title: "Le Parrain" },
  ],
};

describe("mapLibraryMedia title language", () => {
  it("defaults to the English title", () => {
    expect(mapLibraryMedia(base).title).toBe("The Godfather");
  });

  it("uses the localized title when asked", () => {
    expect(mapLibraryMedia(base, "fr").title).toBe("Le Parrain");
  });

  it("falls back to the English title when the row is missing", () => {
    const noFr = { ...base, titles: [{ language: "en", title: "The Godfather" }] };
    expect(mapLibraryMedia(noFr, "fr").title).toBe("The Godfather");
  });

  it("falls back to the English title when titles were not included", () => {
    const noTitles = { ...base, titles: undefined };
    expect(mapLibraryMedia(noTitles, "fr").title).toBe("The Godfather");
  });

  it("keeps the manual override above the localized title", () => {
    const overridden = { ...base, overrides: { title: "Godfather, The" } };
    expect(mapLibraryMedia(overridden, "fr").title).toBe("Godfather, The");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — `mapLibraryMedia` takes one argument and ignores `titles`.

- [ ] **Step 3: Extend mapLibraryMedia**

In `apps/api/src/routes/library/libraryHelpers.ts`, add the import:

```ts
import {
  DEFAULT_TITLE_LANGUAGE,
  type TitleLanguage,
} from "@rawkoon/shared/constants";
```

Add `titles?: { language: string; title: string }[];` to the parameter type of `mapLibraryMedia`, add the second parameter, and replace the `title:` line in the returned object:

```ts
export function mapLibraryMedia(
  item: { /* ...existing fields..., */ titles?: { language: string; title: string }[] },
  titleLanguage: TitleLanguage = DEFAULT_TITLE_LANGUAGE,
) {
  // ...existing body up to the return...

  const localizedTitle =
    titleLanguage === DEFAULT_TITLE_LANGUAGE
      ? null
      : (item.titles?.find((t) => t.language === titleLanguage)?.title ?? null);

  return {
    // ...
    title:
      typeof ov.title === "string" ? ov.title : (localizedTitle ?? item.title),
    // ...rest unchanged
  };
}
```

`sort_title` stays as it is: it is the manual override field, not the list sort key.

- [ ] **Step 4: Add titles to the include**

In the same file, extend `libraryMediaInclude`:

```ts
export const libraryMediaInclude = {
  qualityProfile: { select: { id: true, name: true } },
  titles: { select: { language: true, title: true } },
  files: {
    select: {
      sizeBytes: true,
      resolution: true,
      videoCodec: true,
      hdrFormat: true,
      audioFormat: true,
      durationSecs: true,
      languageTags: true,
    },
  },
} as const;
```

Note: `apps/api/src/services/libraryFromTmdb.ts:19` exports a *different* `libraryMediaInclude` (profile only). Do not touch that one.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 6: Accept the param and branch the list handler**

In `apps/api/src/routes/library/libraryListRoutes.ts`, add to `listQuery`:

```ts
  title_language: z.string().optional(),
```

Add the imports:

```ts
import { normalizeTitleLanguage, DEFAULT_TITLE_LANGUAGE } from "@rawkoon/shared/constants";
import { buildLocalizedIdQuery } from "./libraryLocalizedListQuery";
```

In the `GET /` handler, after `const { sortBy, sortDir } = parseLibrarySort(sort_by, sort_dir);`, add:

```ts
      const titleLanguage = normalizeTitleLanguage(query.title_language);
```

Replace the paged branch body with:

```ts
        const take = Math.min(Math.max(1, limit ?? 60), 100);
        const skip = (Math.max(1, page ?? 1) - 1) * take;

        if (titleLanguage === DEFAULT_TITLE_LANGUAGE) {
          // English keeps the pure-Prisma path: persisted columns, skip/take.
          const rows = await prisma.libraryMedia.findMany({
            where: typedWhere,
            orderBy: buildLibraryOrderBy(sortBy, sortDir),
            include: libraryMediaInclude,
            take: take + 1,
            skip,
          });
          const sliced = slicePage(rows, take);
          has_more = sliced.has_more;
          mappedItems = sliced.items.map((r) => mapLibraryMedia(r));
        } else {
          // Prisma cannot order by a to-many relation column, so resolve the
          // page's ids in SQL and hydrate them through the normal include.
          const idRows = await prisma.$queryRaw<{ id: number }[]>(
            buildLocalizedIdQuery({
              language: titleLanguage,
              type,
              status,
              q,
              fileLanguage: language,
              sortBy,
              sortDir,
              take: take + 1,
              skip,
            }),
          );
          const sliced = slicePage(idRows, take);
          has_more = sliced.has_more;
          const ids = sliced.items.map((r) => r.id);
          const rows = await prisma.libraryMedia.findMany({
            where: { id: { in: ids } },
            include: libraryMediaInclude,
          });
          const byId = new Map(rows.map((r) => [r.id, r]));
          mappedItems = ids
            .map((id) => byId.get(id))
            .filter((r): r is (typeof rows)[number] => r !== undefined)
            .map((r) => mapLibraryMedia(r, titleLanguage));
        }
```

In the unpaged legacy branch, change `items.map(mapLibraryMedia)` to `items.map((r) => mapLibraryMedia(r, titleLanguage))` and sort the mapped array by the resulting `title` when `titleLanguage !== DEFAULT_TITLE_LANGUAGE`:

```ts
        mappedItems = items.map((r) => mapLibraryMedia(r, titleLanguage));
        if (titleLanguage !== DEFAULT_TITLE_LANGUAGE) {
          mappedItems.sort((a, b) =>
            a.title.localeCompare(b.title, titleLanguage, {
              sensitivity: "base",
            }),
          );
        }
```

Passing `mapLibraryMedia` bare to `.map()` would hand it the array index as `titleLanguage` — always use an arrow wrapper.

- [ ] **Step 7: Accept the param on the item route**

Replace the `GET /item/:id` handler body's mapping line so it reads the query param:

```ts
      const titleLanguage = normalizeTitleLanguage(
        c.req.query("title_language"),
      );
      return ok({ item: mapLibraryMedia(item, titleLanguage) });
```

- [ ] **Step 8: Verify by hand**

```bash
curl -sS "localhost:3000/api/library?limit=5&sort_by=title&sort_dir=asc&title_language=fr" \
  -H "Cookie: $RAWKOON_COOKIE" | jq '.items[].title'
curl -sS "localhost:3000/api/library?limit=5&q=parrain&title_language=fr" \
  -H "Cookie: $RAWKOON_COOKIE" | jq '.items[].title'
curl -sS "localhost:3000/api/library?limit=5&q=godfather&title_language=fr" \
  -H "Cookie: $RAWKOON_COOKIE" | jq '.items[].title'
```

Expected: French titles; "parrain" finds Le Parrain; "godfather" also finds it (English search still works from a French UI).

- [ ] **Step 9: Typecheck, lint, full test, commit**

```bash
bun run typecheck
bun run lint
bun run --filter @rawkoon/api test
git add apps/api/src/routes/library/libraryHelpers.ts apps/api/src/routes/library/libraryHelpers.test.ts apps/api/src/routes/library/libraryListRoutes.ts
git commit -m "feat(api): serve localized titles from the library list"
```

---

### Task 9: Endpoint sweep coverage

**Files:**
- Modify: the library list case file under `apps/api/e2e/` (find it with `rg -l 'api/library' apps/api/e2e`)

**Interfaces:**
- Consumes: the `title_language` param (Task 8).
- Produces: no exports — coverage only.

Read `apps/api/e2e/README.md` (or the harness entry file) before writing: the sweep dispatches in-process because the sandbox kills listening sockets, and it has its own seed/mock conventions.

- [ ] **Step 1: Write the failing cases**

Add to the library list case file, following the file's existing case shape:

- `GET /api/library?title_language=fr&sort_by=title&sort_dir=asc` → 200, and the first item's `title` is the seeded French title.
- `GET /api/library?title_language=fr&q=<French substring>` → 200, one item.
- `GET /api/library?title_language=fr&q=<English substring>` → 200, the same item (English search survives).
- `GET /api/library?title_language=de` → 200, English titles (unsupported language falls back, never 400).
- `GET /api/library` with no param → 200, English titles, unchanged from the existing expectation.

Seed at least two media with French title rows whose French A-Z order differs from their English order, so the sort assertion can actually fail.

- [ ] **Step 2: Run the sweep to verify it fails**

Run the sweep the way `apps/api/e2e/README.md` documents.
Expected: FAIL on the French cases if the route is wrong; PASS once Task 8 is in.

- [ ] **Step 3: Make it pass**

If a case fails, the bug is in Task 7 or 8 — fix it there, not by weakening the case.

- [ ] **Step 4: Commit**

```bash
bun run --filter @rawkoon/api test
git add apps/api/e2e
git commit -m "test(api): cover localized library list in the endpoint sweep"
```

---

### Task 10: Web sends the UI language

**Files:**
- Create: `apps/web/src/lib/useTitleLanguage.ts`
- Modify: `apps/web/src/lib/queryKeys.ts` (the `library` / `medias` entries)
- Modify: `apps/web/src/features/medias/hooks/useInfiniteLibrary.ts`
- Create: `apps/web/src/lib/useTitleLanguage.test.ts`

**Interfaces:**
- Consumes: `normalizeTitleLanguage`, `TitleLanguage` (Task 1); the `title_language` param (Task 8).
- Produces: `useTitleLanguage(): TitleLanguage`.

Web tests: this shell exports `NODE_ENV=production`, which removes `React.act` and makes the suite pass while faking failures. Always run web tests as `env -u NODE_ENV bun run --filter @rawkoon/web test`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/useTitleLanguage.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTitleLanguage } from "./useTitleLanguage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "fr-CA" } }),
}));

describe("useTitleLanguage", () => {
  it("narrows the i18n tag to a stored title language", () => {
    const { result } = renderHook(() => useTitleLanguage());
    expect(result.current).toBe("fr");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV bun run --filter @rawkoon/web test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/useTitleLanguage.ts`:

```ts
import { useTranslation } from "react-i18next";
import {
  normalizeTitleLanguage,
  type TitleLanguage,
} from "@rawkoon/shared/constants";

/** The active UI locale, narrowed to a language the API stores titles for. */
export function useTitleLanguage(): TitleLanguage {
  const { i18n } = useTranslation();
  return normalizeTitleLanguage(i18n.language);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV bun run --filter @rawkoon/web test`
Expected: PASS.

- [ ] **Step 5: Put the language in the query keys**

In `apps/web/src/lib/queryKeys.ts`, add a `titleLanguage` field to the params object of the library list key and to the library detail key, and include it in the returned tuple. For example, if the library list key currently reads:

```ts
    list: (params?: { type?: string; status?: string; q?: string; /* ... */ }) =>
      ["library", "list", params?.type, params?.status, params?.q /* ... */] as const,
```

it becomes:

```ts
    list: (params?: {
      type?: string;
      status?: string;
      q?: string;
      /* ...existing fields unchanged... */
      titleLanguage?: string;
    }) =>
      [
        "library",
        "list",
        params?.type,
        params?.status,
        params?.q,
        /* ...existing entries unchanged... */
        params?.titleLanguage,
      ] as const,
```

and the detail key gains a trailing `titleLanguage` segment. Read the actual current shape in the file and preserve every existing segment in its existing position — appending is safe, reordering is not.

- [ ] **Step 6: Send the param**

In `apps/web/src/features/medias/hooks/useInfiniteLibrary.ts`:

- call `const titleLanguage = useTitleLanguage();`
- add `titleLanguage` to the `queryKey` params object
- add `params.set("title_language", titleLanguage);` next to the existing `params.set("language", ...)` line

Do the same in `apps/web/src/features/medias/hooks/useLibraryItem.ts`: call `useTitleLanguage()`, append `?title_language=<lang>` to the `/api/library/item/:id` URL, and pass the language into `queryKeys.library.item(id)` (which gains a second parameter).

- [ ] **Step 7: Send the UI language to discover**

`apps/api/src/routes/medias/discover/index.ts:35` already resolves the language from `query.language` (via `resolveLanguage` in `tmdb/tmdbRouteHelpers.ts:23`, which falls back when absent), and TMDB returns localized titles natively. The API needs no change — the web simply never sends it.

In `apps/web/src/features/medias/hooks/useDiscoverMedias.ts`:

- call `const titleLanguage = useTitleLanguage();`
- add `language: titleLanguage` to the `params` object that feeds both `queryKeys.medias.discover(params)` and the request URL

`discoverKeysMatchExceptPage` compares two discover query keys ignoring the page segment — confirm it still behaves correctly with the extra segment. If it compares by index, the added field must go at the end of the key tuple, not in the middle.

Add `language` to the params type of `queryKeys.medias.discover` and append it to the returned tuple, same as for the library list key.

- [ ] **Step 8: Verify in the browser**

Start `bun run dev:api` and `bun run dev:web`, open the library page, switch the UI language to French, and confirm titles change without a reload and A-Z ordering follows the French titles. Switch back to English and confirm the English titles return (this is what proves the query key carries the language — without it you would see stale French titles).

Then open the discover page in French and confirm those titles are French too, and that paging still works (that is the `discoverKeysMatchExceptPage` check).

- [ ] **Step 9: Typecheck, lint, test, commit**

```bash
bun run typecheck
bun run lint
env -u NODE_ENV bun run --filter @rawkoon/web test
git add apps/web/src/lib/useTitleLanguage.ts apps/web/src/lib/useTitleLanguage.test.ts apps/web/src/lib/queryKeys.ts apps/web/src/features/medias/hooks/useInfiniteLibrary.ts apps/web/src/features/medias/hooks/useLibraryItem.ts apps/web/src/features/medias/hooks/useDiscoverMedias.ts
git commit -m "feat(web): request titles in the active UI language"
```

---

### Task 11: Full gate

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Run every gate**

```bash
bun run typecheck
bun run lint
bun run knip
bun run --filter @rawkoon/api test
env -u NODE_ENV bun run --filter @rawkoon/web test
bun run --filter @rawkoon/shared test
bun run build
```

- [ ] **Step 2: Confirm the non-goals held**

```bash
git diff main --stat
```

Expected: no changes under `apps/api/src/utils/medias/resolveSearchTitles.ts`, `apps/api/src/workers/` other than the new `syncLocalizedTitles.ts` and the dispatch registration, no changes to import/filename or notification code.

- [ ] **Step 3: Confirm the English path is untouched**

```bash
curl -sS "localhost:3000/api/library?limit=5&sort_by=title&sort_dir=asc" \
  -H "Cookie: $RAWKOON_COOKIE" | jq '.items[].title'
```

Expected: identical output to `main` for the same request.
