# Preferred Search Title Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let indexer search (cron, RSS, interactive) use a preferred TMDB title language from the quality profile, with per-media override and original-title fallback, instead of English-only `library_media.title`.

**Architecture:** Add nullable search/original title columns on `library_media` and `preferred_search_language` on `quality_profile`. Pure helpers resolve query order and preferred title from TMDB translations. Cron/RSS/`searchAndGrab` share that resolution. Management UI adds a TMDB-only select under the quality-profile picker; interactive search defaults to the persisted preferred title.

**Tech Stack:** Bun + TypeScript monorepo, Prisma 7 (Postgres), Elysia API, React 19 + TanStack Query web, `@rawkoon/shared` types. Tests: `bun test`. Lint: Biome.

**Spec:** `docs/superpowers/specs/2026-08-01-preferred-search-title-design.md`

## Global Constraints

- No mass backfill of existing library rows; null search fields → English `title` only (legacy).
- No automatic `search_attempts` reset / un-skip.
- Preferred search titles come from TMDB only — no free-text custom titles.
- Search order: preferred → original (if distinct) → else English `title`.
- One cron attempt increment per tick (not per title try).
- Changing a media’s quality profile later must NOT rewrite `search_title`.
- `preferred_search_language` is ISO 639-1 title language — distinct from audio `preferredLanguages` (VFQ/MULTI/…).
- Secrets / tracker `enc:` cleanup from the bug report is OUT OF SCOPE.
- Follow existing patterns: API imports via `@rawkoon/api/…`; errors via helpers (`badRequest`/`notFound`), not throws; shared types are the contract.

---

## File Structure

**Create:**

- `apps/api/src/utils/medias/resolveSearchTitles.ts` — pure `resolveSearchTitles` + `resolvePreferredSearchTitle`.
- `apps/api/src/utils/medias/resolveSearchTitles.test.ts` — unit tests for both helpers.
- `apps/api/prisma/migrations/<timestamp>_preferred_search_title/migration.sql` — schema migration (via `db:migrate:dev`).
- `apps/web/src/pages/medias/_component/LibrarySearchTitleSection.tsx` — TMDB title select under QP picker.
- `apps/web/src/features/medias/hooks/useUpdateLibrarySearchTitle.ts` — PATCH mutation hook.

**Modify:**

- `apps/api/prisma/schema.prisma` — `LibraryMedia` + `QualityProfile` fields.
- `apps/shared/src/types/library.ts` — expose search/original fields on `LibraryMedia`.
- `apps/shared/src/types/qualityProfiles.ts` — `preferred_search_language` on profile + form payloads.
- `apps/api/src/routes/library/libraryHelpers.ts` — `mapLibraryMedia` includes new fields.
- `apps/api/src/services/libraryFromTmdb.ts` — populate search/original at create.
- `apps/api/src/services/mediaGrabberSearch.ts` — match-title set; optional multi-query helper or caller loops.
- `apps/api/src/workers/checkEpisodeReleases.ts` — preferred-then-original queries.
- `apps/api/src/workers/checkMovieReleases.ts` — same.
- `apps/api/src/workers/pollIndexerRss.ts` — match any title in set.
- `apps/api/src/routes/quality-profiles/index.ts` (+ test) — map/create/update new field.
- `apps/api/src/routes/library/libraryMetaRoutes.ts` — `PATCH /:id/search-title`.
- `apps/web/src/lib/endpoints/library.ts` — `UPDATE_SEARCH_TITLE`.
- `apps/web/src/pages/settings/useQualityProfiles.ts` — form payload field.
- `apps/web/src/pages/settings/_component/QualityProfileForm.tsx` — single-select for search language.
- `apps/web/src/pages/medias/_component/LibraryQualityProfileSection.tsx` or `LibraryManagementPanel` — render search-title section below QP.
- `apps/web/src/pages/medias/_component/LibraryItemSearchTab.tsx` — default query from `item.search_title`.
- `apps/web/src/locales/{en,fr}/common.json` — i18n keys.

---

### Task 1: Schema + shared types

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/shared/src/types/library.ts`
- Modify: `apps/shared/src/types/qualityProfiles.ts`
- Create: Prisma migration via `bun run db:migrate:dev`

**Interfaces:**
- Produces: DB columns + shared TypeScript fields consumed by every later task.

- [ ] **Step 1: Add Prisma fields**

On `QualityProfile`:

```prisma
preferredSearchLanguage String? @map("preferred_search_language") // ISO 639-1; null → en at add time
```

On `LibraryMedia`:

```prisma
originalTitle         String? @map("original_title")
originalLanguage      String? @map("original_language")
searchTitle           String? @map("search_title")
searchTitleLanguage   String? @map("search_title_language")
```

- [ ] **Step 2: Create migration**

Run: `bun run db:migrate:dev` (name: `preferred_search_title`)

Expected: migration SQL created and applied; client regenerated.

- [ ] **Step 3: Extend shared types**

`LibraryMedia` add:

```ts
original_title: string | null;
original_language: string | null;
search_title: string | null;
search_title_language: string | null;
```

`QualityProfile` add:

```ts
preferred_search_language: string | null;
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma apps/shared/src/types/library.ts apps/shared/src/types/qualityProfiles.ts
git commit -m "$(cat <<'EOF'
feat(db): add preferred search title columns

Store QP preferred_search_language and per-media original/search titles
for indexer query resolution.
EOF
)"
```

---

### Task 2: Pure title-resolution helpers (TDD)

**Files:**
- Create: `apps/api/src/utils/medias/resolveSearchTitles.ts`
- Create: `apps/api/src/utils/medias/resolveSearchTitles.test.ts`

**Interfaces:**
- Produces:
  - `resolveSearchTitles(media: { title: string; searchTitle: string | null; originalTitle: string | null }): { queries: string[]; matchTitles: string[] }`
  - `resolvePreferredSearchTitle(input: { englishTitle: string; preferredLanguage: string; originalTitle: string | null; originalLanguage: string | null; translations: { language_code: string; title: string }[] }): { title: string; language: string }`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "bun:test";
import {
  resolvePreferredSearchTitle,
  resolveSearchTitles,
} from "./resolveSearchTitles";

describe("resolveSearchTitles", () => {
  it("legacy nulls → english title only", () => {
    expect(
      resolveSearchTitles({
        title: "Belflower",
        searchTitle: null,
        originalTitle: null,
      }),
    ).toEqual({ queries: ["Belflower"], matchTitles: ["Belflower"] });
  });

  it("preferred then distinct original", () => {
    expect(
      resolveSearchTitles({
        title: "Belflower",
        searchTitle: "Bellefleur",
        originalTitle: "Bellefleur",
      }),
    ).toEqual({
      queries: ["Bellefleur"],
      matchTitles: ["Bellefleur"],
    });
  });

  it("preferred then different original", () => {
    expect(
      resolveSearchTitles({
        title: "English",
        searchTitle: "Français",
        originalTitle: "Original",
      }),
    ).toEqual({
      queries: ["Français", "Original"],
      matchTitles: ["Français", "Original"],
    });
  });

  it("dedupes case-insensitively but keeps first casing", () => {
    expect(
      resolveSearchTitles({
        title: "Foo",
        searchTitle: "Bar",
        originalTitle: "bar",
      }).queries,
    ).toEqual(["Bar"]);
  });
});

describe("resolvePreferredSearchTitle", () => {
  const translations = [
    { language_code: "fr", title: "Bellefleur" },
    { language_code: "de", title: "Belflower DE" },
  ];

  it("uses translation for preferred language", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "fr",
        originalTitle: "Bellefleur",
        originalLanguage: "fr",
        translations,
      }),
    ).toEqual({ title: "Bellefleur", language: "fr" });
  });

  it("falls back to original when language matches and no translation", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "fr",
        originalTitle: "Bellefleur",
        originalLanguage: "fr",
        translations: [],
      }),
    ).toEqual({ title: "Bellefleur", language: "fr" });
  });

  it("falls back to english when preferred title missing", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "ja",
        originalTitle: "Bellefleur",
        originalLanguage: "fr",
        translations,
      }),
    ).toEqual({ title: "Belflower", language: "en" });
  });

  it("null/blank preferred language → en", () => {
    expect(
      resolvePreferredSearchTitle({
        englishTitle: "Belflower",
        preferredLanguage: "",
        originalTitle: null,
        originalLanguage: null,
        translations: [],
      }),
    ).toEqual({ title: "Belflower", language: "en" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd apps/api && bun test src/utils/medias/resolveSearchTitles.test.ts`

Expected: module not found / FAIL.

- [ ] **Step 3: Implement helpers**

```ts
export function resolveSearchTitles(media: {
  title: string;
  searchTitle: string | null;
  originalTitle: string | null;
}): { queries: string[]; matchTitles: string[] } {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = raw?.trim();
    if (!t) return;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(t);
  };

  if (media.searchTitle || media.originalTitle) {
    push(media.searchTitle);
    push(media.originalTitle);
  } else {
    push(media.title);
  }

  return { queries, matchTitles: [...queries] };
}

export function resolvePreferredSearchTitle(input: {
  englishTitle: string;
  preferredLanguage: string;
  originalTitle: string | null;
  originalLanguage: string | null;
  translations: { language_code: string; title: string }[];
}): { title: string; language: string } {
  const lang = (input.preferredLanguage || "en").toLowerCase();
  const byLang = new Map(
    input.translations.map((t) => [
      t.language_code.toLowerCase(),
      t.title.trim(),
    ]),
  );
  const fromTranslation = byLang.get(lang);
  if (fromTranslation) return { title: fromTranslation, language: lang };

  const origLang = (input.originalLanguage || "").toLowerCase();
  const origTitle = input.originalTitle?.trim();
  if (lang === origLang && origTitle) {
    return { title: origTitle, language: lang };
  }

  return { title: input.englishTitle, language: "en" };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd apps/api && bun test src/utils/medias/resolveSearchTitles.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/medias/resolveSearchTitles.ts apps/api/src/utils/medias/resolveSearchTitles.test.ts
git commit -m "$(cat <<'EOF'
feat(api): resolve preferred and fallback search titles

Pure helpers for query order and QP-language title resolution from TMDB.
EOF
)"
```

---

### Task 3: Map API responses + quality-profile field

**Files:**
- Modify: `apps/api/src/routes/library/libraryHelpers.ts` (`mapLibraryMedia`)
- Modify: `apps/api/src/routes/quality-profiles/index.ts`
- Modify: `apps/api/src/routes/quality-profiles/index.test.ts`
- Modify: `apps/web/src/pages/settings/useQualityProfiles.ts`
- Modify: `apps/web/src/pages/settings/_component/QualityProfileForm.tsx`
- Modify: `apps/web/src/locales/en/common.json`, `apps/web/src/locales/fr/common.json`

**Interfaces:**
- Consumes: schema fields from Task 1
- Produces: API snake_case fields wired end-to-end for QP CRUD + library list/item

- [ ] **Step 1: Extend `mapLibraryMedia` input + output**

Add to the input type and return object:

```ts
originalTitle?: string | null;
originalLanguage?: string | null;
searchTitle?: string | null;
searchTitleLanguage?: string | null;
// …
original_title: item.originalTitle ?? null,
original_language: item.originalLanguage ?? null,
search_title: item.searchTitle ?? null,
search_title_language: item.searchTitleLanguage ?? null,
```

(Prisma rows already include columns once selected; no include change required if full model is returned.)

- [ ] **Step 2: Wire quality-profile map/create/update**

In `mapProfile` add `preferred_search_language: p.preferredSearchLanguage ?? null`.

On create/update data: `preferredSearchLanguage: body.preferred_search_language ?? null`.

Body schema: `preferred_search_language: t.Optional(t.Union([t.String(), t.Null()]))`.

Validate when non-null: `/^[a-z]{2}$/i` else `badRequest`.

Update `index.test.ts` mocks/assertions to include the new field.

- [ ] **Step 3: Web QP form — single select (ISO title languages only)**

Add separate options (do **not** reuse audio `LANGUAGE_OPTIONS` which includes VFQ/MULTI):

```ts
export const SEARCH_TITLE_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "pt", label: "Português" },
  { value: "zh", label: "中文" },
];
```

Extend `QualityProfileFormPayload` + `profileToForm` + `emptyPayload` with `preferred_search_language: string | null`.

UI: native `<select>` below preferred languages multi-select, labeled via i18n key `settings.qualityProfiles.preferredSearchLanguage` ("Preferred search title language" / FR equivalent). Empty option = null (treat as en at add time).

- [ ] **Step 4: Verify**

Run: `cd apps/api && bun test src/routes/quality-profiles/index.test.ts`

Run: `bun run typecheck` (or at least api + shared + web tsc if full is slow)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/library/libraryHelpers.ts apps/api/src/routes/quality-profiles apps/web/src/pages/settings apps/web/src/locales
git commit -m "$(cat <<'EOF'
feat: expose preferred_search_language on quality profiles

Wire API mapping and settings form for title-language default.
EOF
)"
```

---

### Task 4: Populate titles on add-to-library

**Files:**
- Modify: `apps/api/src/services/libraryFromTmdb.ts`
- Test: extend or add `apps/api/src/services/libraryFromTmdb.test.ts` if one exists; otherwise unit-test the title packing via `resolvePreferredSearchTitle` (already covered) and a focused test that mocks `tmdbApiFetch` if the file already has that pattern — otherwise skip new integration test and rely on helper + manual smoke.

**Interfaces:**
- Consumes: `resolvePreferredSearchTitle`, `extractTitleTranslations` from `tmdbFetcherDetails.ts`
- Produces: new library rows with `searchTitle` / `originalTitle` set when TMDB succeeds

- [ ] **Step 1: On create path only, fetch translations + originals**

After English details fetch (movie and show), also fetch:

- Movie: `movie/${id}` already has `original_title` / `original_language` if requested from details endpoint — today `libraryFromTmdb` types a narrow subset. Expand the details fetch type and append `append_to_response=translations` **or** separate `movie/${id}/translations` call (match existing TMDB helper style in `tmdbFetcherDetails`).

Prefer reusing `extractTitleTranslations(translationsPayload, "movie"|"tv")`.

Load default QP (already have `defaultQualityProfileId`) and read `preferredSearchLanguage` when id present:

```ts
const preferredLang =
  defaultQualityProfileId != null
    ? (
        await prisma.qualityProfile.findUnique({
          where: { id: defaultQualityProfileId },
          select: { preferredSearchLanguage: true },
        })
      )?.preferredSearchLanguage
    : null;
```

- [ ] **Step 2: Write fields on `create` only (not on `update`)**

```ts
const preferred = resolvePreferredSearchTitle({
  englishTitle: details.title, // or details.name for TV
  preferredLanguage: preferredLang ?? "en",
  originalTitle: original_title,
  originalLanguage: original_language,
  translations: title_translations,
});

// in create: {
  originalTitle: original_title,
  originalLanguage: original_language,
  searchTitle: preferred.title,
  searchTitleLanguage: preferred.language,
// }
```

If translations/original fetch throws: log warn and create without search fields (legacy null path) — do not fail the add.

Do **not** overwrite `searchTitle*` on upsert `update` (user override sticky; English metadata update may still refresh locked-aware display fields as today).

- [ ] **Step 3: Smoke / typecheck**

Run: `bun run typecheck` for api workspace (or full).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/libraryFromTmdb.ts
git commit -m "$(cat <<'EOF'
feat(api): set search titles when adding library media

Populate original/search titles from TMDB using QP preferred language.
EOF
)"
```

---

### Task 5: `searchAndGrab` match-title set

**Files:**
- Modify: `apps/api/src/services/mediaGrabberSearch.ts`
- Create or extend: `apps/api/src/services/mediaGrabberSearch.test.ts` (mock prisma + indexer if heavy; prefer extracting a pure `releaseMatchesExpectedTitles` helper tested without I/O)

**Interfaces:**
- Consumes: `resolveSearchTitles`
- Produces: `searchAndGrab` accepts releases matching any resolved title

- [ ] **Step 1: Extract pure matcher + test**

```ts
export function releaseMatchesExpectedTitles(
  releaseTitle: string,
  matchTitles: string[],
): boolean {
  if (matchTitles.length === 0) return true;
  const normalizedRelease = normalizeTitleForMatch(releaseTitle);
  return matchTitles.some((t) => {
    const expected = normalizeTitleForMatch(t);
    return (
      normalizedRelease === expected ||
      normalizedRelease.startsWith(`${expected} `)
    );
  });
}
```

(Keep `startsWith(… + " ")` parity with today; also allow exact equality so a bare title does not fail.)

Test cases: `Bellefleur.S03E10…` matches `["Bellefleur"]`; does not match `["Belflower"]` alone; matches when set is `["Belflower","Bellefleur"]`.

- [ ] **Step 2: Wire into `searchAndGrab`**

Replace single-title select:

```ts
const media = await prisma.libraryMedia.findUnique({
  where: { id: mediaId },
  select: {
    title: true,
    searchTitle: true,
    originalTitle: true,
  },
});
const { matchTitles } = resolveSearchTitles({
  title: media?.title ?? "",
  searchTitle: media?.searchTitle ?? null,
  originalTitle: media?.originalTitle ?? null,
});
// …
if (!releaseMatchesExpectedTitles(title, matchTitles)) continue;
```

- [ ] **Step 3: Run tests**

Run: `cd apps/api && bun test src/services/mediaGrabberSearch.test.ts src/utils/medias/resolveSearchTitles.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/mediaGrabberSearch.ts apps/api/src/services/mediaGrabberSearch.test.ts
git commit -m "$(cat <<'EOF'
fix(api): match indexer releases against search title set

Accept preferred or original titles in searchAndGrab filtering.
EOF
)"
```

---

### Task 6: Cron workers — preferred then original

**Files:**
- Modify: `apps/api/src/workers/checkEpisodeReleases.ts`
- Modify: `apps/api/src/workers/checkMovieReleases.ts`

**Interfaces:**
- Consumes: `resolveSearchTitles`, `searchAndGrab`
- Produces: workers query `queries[0]` then `queries[1]` on no grab

- [ ] **Step 1: Widen media selects**

Include `searchTitle`, `originalTitle` wherever `title` is selected for search.

- [ ] **Step 2: Add local helper in each worker (or shared util)**

```ts
async function searchAndGrabWithTitleFallback(opts: {
  mediaId: number;
  episodeId?: number;
  mediaType: "tv" | "movie";
  titleBaseQueries: string[]; // already ordered from resolveSearchTitles().queries
  suffix: string; // e.g. " S03E10" or " 2024" or " S03"
  qualityProfileId: number | null;
  isUpgrade?: boolean;
}) {
  for (const base of opts.titleBaseQueries) {
    const result = await searchAndGrab({
      mediaId: opts.mediaId,
      episodeId: opts.episodeId,
      mediaType: opts.mediaType,
      searchQuery: `${base}${opts.suffix}`,
      qualityProfileId: opts.qualityProfileId,
      isUpgrade: opts.isUpgrade,
    });
    if (result.grabbed) return result;
  }
  return {
    grabbed: false as const,
    reason: "No matching releases found",
  };
}
```

Prefer placing `searchAndGrabWithTitleFallback` in `mediaGrabberSearch.ts` to avoid duplication.

Episode individual: `suffix = \` S${s}E${e}\`` with padded numbers (existing `episodeSearchQuery` logic — refactor to take base title from resolver).

Season pack: `suffix = \` S${s}\``.

Movie: `suffix = year ? \` ${year}\` : ""`.

Increment `searchAttempts` **once** after the full preferred→original attempt (existing increment sites unchanged in placement).

- [ ] **Step 3: Typecheck workers**

Run: `cd apps/api && bunx tsc --noEmit` (or package script)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workers/checkEpisodeReleases.ts apps/api/src/workers/checkMovieReleases.ts apps/api/src/services/mediaGrabberSearch.ts
git commit -m "$(cat <<'EOF'
feat(api): cron search preferred title then original

Episode and movie workers try fallback title without double-counting attempts.
EOF
)"
```

---

### Task 7: RSS matching on title set

**Files:**
- Modify: `apps/api/src/workers/pollIndexerRss.ts`

**Interfaces:**
- Consumes: `resolveSearchTitles`, `normalizeTitleForMatch`

- [ ] **Step 1: Build normalized title sets per media**

For movies/episodes, compute `matchTitles` via `resolveSearchTitles`, map each to normalized form. When matching a parsed release, accept if `parsed.normalizedTitle` is in that media’s normalized set (instead of single `ep.normalizedTitle === …`).

Season-pack map keys: today keyed by `${normalizedTitle}:${season}`. Change to register the same pack eligibility under **each** normalized match title, or store `mediaId:season` and compare titles via set membership when scanning releases.

Recommended approach:

```ts
// packEligibleByMediaSeason: Map<`${mediaId}:${season}`, PackEligibleSeason & { normalizedTitles: Set<string> }>
// On release: find pack where normalizedTitles.has(parsed.normalizedTitle) && season matches
```

Same for episode/movie candidate matching.

- [ ] **Step 2: Select `searchTitle`/`originalTitle` in prisma queries**

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workers/pollIndexerRss.ts
git commit -m "$(cat <<'EOF'
fix(api): RSS match preferred and original titles

Allow RSS grabs when release title matches any resolved search title.
EOF
)"
```

---

### Task 8: PATCH search-title + Management UI + interactive default

**Files:**
- Modify: `apps/api/src/routes/library/libraryMetaRoutes.ts`
- Modify: `apps/web/src/lib/endpoints/library.ts`
- Create: `apps/web/src/features/medias/hooks/useUpdateLibrarySearchTitle.ts`
- Create: `apps/web/src/pages/medias/_component/LibrarySearchTitleSection.tsx`
- Modify: library management panel / `LibraryQualityProfileSection.tsx` parent to render the new section below QP
- Modify: `apps/web/src/pages/medias/_component/LibraryItemSearchTab.tsx`
- Modify: locales en/fr

**Interfaces:**
- Consumes: TMDB details already loaded on `LibraryItemPage` (`original_title`, `original_language`, `title_translations`)
- Produces: persisted override; interactive default uses `item.search_title`

- [ ] **Step 1: API route `PATCH /api/library/:id/search-title`**

Body:

```ts
t.Object({
  search_title_language: t.String({ minLength: 2, maxLength: 2 }),
  search_title: t.String({ minLength: 1, maxLength: 500 }),
})
```

Admin-gated like other management patches (follow neighbouring routes — `requireAdmin` if that’s how quality-profile updates work; otherwise match existing pattern on this file).

Validation:

1. Load media (`tmdbId`, `type`, `title`).
2. Fetch TMDB details/translations (reuse library TMDB helpers / `extractTitleTranslations`).
3. Build allowed options with the same rules as web `buildTitleOptions` (english library title as `en`, original, translations). Prefer sharing a small server-side `buildSearchTitleOptions({ englishTitle, originalTitle, originalLanguage, translations })` in `resolveSearchTitles.ts` that returns `{ languageCode, title }[]` without season suffix.
4. Accept only if some option has matching language **and** case-insensitive equal title.
5. Update `searchTitle` + `searchTitleLanguage` (do not touch original_*).
6. Return `{ item: mapLibraryMedia(…) }`.

- [ ] **Step 2: Web hook + endpoint**

```ts
UPDATE_SEARCH_TITLE: (id: number) => `/api/library/${id}/search-title`,
```

Mutation invalidates `queryKeys.library.*` like other library updates.

- [ ] **Step 3: `LibrarySearchTitleSection`**

Props: `libraryId`, `item: LibraryMedia`, `tmdbOriginalTitle`, `tmdbOriginalLanguage`, `tmdbTitleTranslations` (pass from Management panel / page — same sources as Search tab).

Build options via existing `buildTitleOptions` (suffix `""`). Select value = `item.search_title_language` when set and present in options, else `en` / first option.

On change: call PATCH with selected language + base title (strip any suffix — none here).

Place **immediately below** the quality-profile `<ManagementSection>` in the management layout.

If translations empty / pending: disable select; show `item.title` as hint.

- [ ] **Step 4: Interactive default**

In `LibraryItemSearchTab`, set:

```ts
const defaultBase = item.search_title?.trim() || item.title;
const localizedQuery = `${defaultBase}${ctxSuffix}`;
```

Pass `defaultSearchQuery={localizedQuery}` as today. Keep session `SearchTitleSelect` local (no write on change).

Ensure `titleOptions` still lists all languages; preselect option whose query matches `localizedQuery` (InteractiveSearchPanel already keys off `defaultSearchQuery` — verify; adjust if needed).

- [ ] **Step 5: i18n**

Keys e.g. `library.management.searchTitle`, `library.management.searchTitleUpdated`, `library.management.searchTitleUpdateFailed`, `settings.qualityProfiles.preferredSearchLanguage`.

- [ ] **Step 6: Typecheck + lint touched packages**

Run: `bun run typecheck` and `bun run lint`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/library apps/api/src/utils/medias/resolveSearchTitles.ts apps/web
git commit -m "$(cat <<'EOF'
feat: per-media search title picker and interactive default

Allow TMDB-validated override under quality profile; default interactive search.
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| QP `preferred_search_language` | 1, 3 |
| Library columns original/search | 1 |
| `resolveSearchTitles` order + legacy null | 2 |
| Add-time populate from QP language | 4 |
| Match set in `searchAndGrab` | 5 |
| Cron preferred→original, one attempt | 6 |
| RSS multi-title match | 7 |
| Management TMDB select under QP | 8 |
| Interactive defaults to `search_title` | 8 |
| No backfill / no attempt reset | Global (no task) |
| No rewrite on QP change | 4 (create-only) + 8 (override only) |

---

## Self-review notes

- No free-text titles; PATCH validates against TMDB-built options.
- Audio `preferredLanguages` untouched; search language uses separate ISO list.
- `releaseMatchesExpectedTitles` adds exact equality in addition to `startsWith`+space to avoid rejecting bare titles — intentional small hardening vs today.
