# Audiobookshelf Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete rawkoon's in-app audiobook player and ebook reader, and replace them with a deep link into an existing Audiobookshelf instance.

**Architecture:** Rawkoon keeps discovery, indexer search, grabbing, post-processing, import, monitoring and notifications; Audiobookshelf owns playback and reading over the same files on `/mnt/storage`. The integration is deep-link only — no ABS API key, no ABS API calls, no progress mirroring. Three nullable columns on `media_settings` hold the ABS base URL and the two library ids; a pure helper builds the link; one button per edition opens ABS at a title search. All player-only files are deleted; files carrying non-player work are edited surgically.

**Tech Stack:** Bun, Elysia, Prisma 7 / Postgres 17, React 19 + Vite + TanStack Router/Query, Tailwind 4, i18next, vitest (web) and `bun test` (api/shared), Biome.

**Spec:** `docs/superpowers/specs/2026-08-23-audiobookshelf-integration-design.md`

## Global Constraints

- Work on top of the current `feat/audiobook-single-stream` HEAD, **not** off `main`. Commit `1c6317a` (#35) is branch-only and carries keepers (per-author languages + its migration `20260823000000_author_monitor_languages`, delete UX, mobile header, search route).
- Never delete or edit the applied migration `20260820120000_book_progress_and_chapters`. Schema removals ship as a **new forward migration**.
- API code imports itself as `@rawkoon/api/<path>`, never by relative path.
- Errors are helpers from `src/errors.ts` (`badRequest`, `notFound`, …) that set `set.status` and are **returned**, never thrown.
- Shared types are the contract: change `apps/shared/src/types/*`, not one side only.
- TS is strict: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Both `bun run typecheck` and `bun run typecheck:native` must pass.
- Biome covers `apps/web` and `apps/api`; `apps/shared` uses prettier (`cd apps/shared && bun run formatCheck`).
- Every user-visible string goes through i18next with both `en` and `fr` entries.
- ABS deep-link routes, verified against the running client bundle: `/library/:library?/search` and `/item/:id`.
- Local seed values: url `https://audiobookshelf.samlo.cloud`, audiobook library id `5bd62c95-771f-4bc2-9b05-b8ccd54a1507`, ebook library id `385e7f72-8c57-4c0e-9a31-fe0ae68a99b0`.

---

## File Structure

**Created**
- `apps/shared/src/utils/audiobookshelf.ts` — pure link builder. No React, no fetch.
- `apps/shared/src/utils/__tests__/audiobookshelf.test.ts`
- `apps/web/src/features/books/AudiobookshelfLink.tsx` — the one button that replaces `EditionOpenActions`.
- `apps/web/src/features/books/AudiobookshelfLink.test.tsx`
- `apps/api/prisma/migrations/20260824000000_audiobookshelf_deeplink/migration.sql` — adds the three settings columns.
- `apps/api/prisma/migrations/20260824001000_drop_book_reading_state/migration.sql` — drops `book_progress`, `book_file_chapters`, `book_files.chapter_count`.

**Modified**
- `apps/api/prisma/schema.prisma` — add three `MediaSettings` columns (Task 1); drop `BookProgress`, `BookFileChapter`, `BookFile.chapterCount` and the two relations (Task 7).
- `apps/shared/src/types/library.ts` — three fields on `MediaSettings` and `MediaSettingsUpdate`.
- `apps/shared/src/types/books.ts` — drop manifest/progress/reading types and `chapter_count`.
- `apps/shared/src/utils/index.ts` — export the new module.
- `apps/api/src/routes/library/libraryMediaAdmin.ts` — map and accept the three columns.
- `apps/api/src/routes/books/index.ts` — unwire `bookReadRoutes`.
- `apps/api/src/routes/books/bookEditionRoutes.ts` — drop `chapter_count`.
- `apps/api/src/services/postProcessorBook.ts` — drop `syncFileChapters`.
- `apps/web/src/pages/books/_component/BookDetailPage.tsx` — swap `EditionOpenActions` for `AudiobookshelfLink`.
- `apps/web/src/pages/settings/_component/BooksSettingsTab.tsx` — three inputs.
- `apps/web/src/pages/__root.tsx` — drop the player mount.
- `apps/web/src/pages/_component/WidgetGrid.tsx` — drop the ContinueReading entry.
- `apps/web/src/sw/{message-handlers,activate-handler,index,types}.ts` — drop book-cache branches, keep the `app-update` work from #31.
- `apps/web/src/locales/{en,fr}/common.json` — drop player/reader keys, add ABS keys.
- `docs/library/books.md` — document the ABS hand-off.

**Deleted** — enumerated in Tasks 5 and 6.

---

### Task 1: ABS settings columns end to end

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (MediaSettings, Books block ~line 634)
- Create: `apps/api/prisma/migrations/20260824000000_audiobookshelf_deeplink/migration.sql`
- Modify: `apps/shared/src/types/library.ts:243` and `:266`
- Modify: `apps/api/src/routes/library/libraryMediaAdmin.ts:36` (export `mapSettings`), `:72` (mapper) and `:153` (update handler)
- Test: `apps/api/test/audiobookshelfSettings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MediaSettings.audiobookshelf_url: string | null`, `MediaSettings.audiobookshelf_audiobook_library_id: string | null`, `MediaSettings.audiobookshelf_ebook_library_id: string | null`, and the same three as optional fields on `MediaSettingsUpdate`. Prisma names: `audiobookshelfUrl`, `audiobookshelfAudiobookLibraryId`, `audiobookshelfEbookLibraryId`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/audiobookshelfSettings.test.ts`. Model it on the existing mock style in `apps/api/test/` — API tests mock `@rawkoon/api/db`.

```ts
import { describe, it, expect } from "bun:test";
import { mapSettings } from "@rawkoon/api/routes/library/libraryMediaAdmin";

describe("mapSettings", () => {
  it("exposes the audiobookshelf deep-link settings", () => {
    const row = {
      booksLibraryPath: "/mnt/storage/Books",
      audiobooksLibraryPath: "/mnt/storage/Audiobooks",
      bookTemplate: "{author}/{title}",
      audiobookTemplate: "{author}/{title}",
      audiobookshelfUrl: "https://audiobookshelf.samlo.cloud",
      audiobookshelfAudiobookLibraryId: "5bd62c95-771f-4bc2-9b05-b8ccd54a1507",
      audiobookshelfEbookLibraryId: "385e7f72-8c57-4c0e-9a31-fe0ae68a99b0",
      updatedAt: new Date("2026-08-24T00:00:00Z"),
    };

    const mapped = mapSettings(row as never);

    expect(mapped.audiobookshelf_url).toBe("https://audiobookshelf.samlo.cloud");
    expect(mapped.audiobookshelf_audiobook_library_id).toBe(
      "5bd62c95-771f-4bc2-9b05-b8ccd54a1507",
    );
    expect(mapped.audiobookshelf_ebook_library_id).toBe(
      "385e7f72-8c57-4c0e-9a31-fe0ae68a99b0",
    );
  });

  it("reports an unconfigured instance as null rather than empty string", () => {
    const mapped = mapSettings({
      audiobookshelfUrl: null,
      audiobookshelfAudiobookLibraryId: null,
      audiobookshelfEbookLibraryId: null,
      updatedAt: new Date("2026-08-24T00:00:00Z"),
    } as never);

    expect(mapped.audiobookshelf_url).toBeNull();
    expect(mapped.audiobookshelf_audiobook_library_id).toBeNull();
    expect(mapped.audiobookshelf_ebook_library_id).toBeNull();
  });
});
```

`mapSettings` is declared unexported at `apps/api/src/routes/library/libraryMediaAdmin.ts:36`. Export it as part of this task — the test needs it, and exporting a pure mapper is the smallest change that makes it testable. Its row parameter is an inline structural type, so the test's `as never` casts keep the fixtures short.

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd apps/api && bun test test/audiobookshelfSettings.test.ts`
Expected: FAIL — either "export named 'mapSettings' not found" or the three assertions returning `undefined`.

- [ ] **Step 3: Add the Prisma columns**

In `apps/api/prisma/schema.prisma`, in the `MediaSettings` model's `── Books ──` block, directly after `defaultBookQualityProfileId`:

```prisma
  /// Deep-link target for playback and reading. Rawkoon does not talk to the
  /// Audiobookshelf API — it only builds a URL, so an unreachable instance
  /// costs nothing but a dead link. Null means the button is not rendered.
  audiobookshelfUrl                String? @map("audiobookshelf_url")
  audiobookshelfAudiobookLibraryId String? @map("audiobookshelf_audiobook_library_id")
  audiobookshelfEbookLibraryId     String? @map("audiobookshelf_ebook_library_id")
```

- [ ] **Step 4: Write the migration**

Create `apps/api/prisma/migrations/20260824000000_audiobookshelf_deeplink/migration.sql`:

```sql
-- Deep-link settings for the Audiobookshelf hand-off. Nullable: an install
-- without Audiobookshelf simply renders no button.
ALTER TABLE "media_settings"
  ADD COLUMN "audiobookshelf_url" TEXT,
  ADD COLUMN "audiobookshelf_audiobook_library_id" TEXT,
  ADD COLUMN "audiobookshelf_ebook_library_id" TEXT;
```

- [ ] **Step 5: Apply it and regenerate the client**

Run: `bun run db:migrate:deploy && bun run db:generate`
Expected: the migration applies cleanly and the Prisma client regenerates. If `DATABASE_URL not found`, the root `.env` is missing — the `db:*` scripts source it.

- [ ] **Step 6: Extend the shared type**

In `apps/shared/src/types/library.ts`, in `MediaSettings` after `default_book_quality_profile_id` (line ~247):

```ts
  /** Deep-link target for playback/reading. Null when unconfigured. */
  audiobookshelf_url: string | null;
  audiobookshelf_audiobook_library_id: string | null;
  audiobookshelf_ebook_library_id: string | null;
```

and in `MediaSettingsUpdate` after its `default_book_quality_profile_id` (line ~270):

```ts
  audiobookshelf_url?: string | null;
  audiobookshelf_audiobook_library_id?: string | null;
  audiobookshelf_ebook_library_id?: string | null;
```

- [ ] **Step 7: Map and accept the columns**

In `apps/api/src/routes/library/libraryMediaAdmin.ts`, in the mapper after `audiobook_template` (line ~71):

```ts
    audiobookshelf_url: row.audiobookshelfUrl ?? null,
    audiobookshelf_audiobook_library_id:
      row.audiobookshelfAudiobookLibraryId ?? null,
    audiobookshelf_ebook_library_id: row.audiobookshelfEbookLibraryId ?? null,
```

and in the update handler after the `audiobook_template` branch (line ~158):

```ts
        if (body.audiobookshelf_url !== undefined)
          update.audiobookshelfUrl = body.audiobookshelf_url;
        if (body.audiobookshelf_audiobook_library_id !== undefined)
          update.audiobookshelfAudiobookLibraryId =
            body.audiobookshelf_audiobook_library_id;
        if (body.audiobookshelf_ebook_library_id !== undefined)
          update.audiobookshelfEbookLibraryId =
            body.audiobookshelf_ebook_library_id;
```

Add the three fields to the route's Elysia body schema alongside the existing optional strings, following whatever `t.Optional(...)` shape `book_template` already uses in that file.

- [ ] **Step 8: Run the test and watch it pass**

Run: `cd apps/api && bun test test/audiobookshelfSettings.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma apps/api/src/routes/library/libraryMediaAdmin.ts \
        apps/api/test/audiobookshelfSettings.test.ts apps/shared/src/types/library.ts
git commit -m "feat(books): store the Audiobookshelf deep-link settings"
```

---

### Task 2: The link builder

**Files:**
- Create: `apps/shared/src/utils/audiobookshelf.ts`
- Modify: `apps/shared/src/utils/index.ts`
- Test: `apps/shared/src/utils/__tests__/audiobookshelf.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `audiobookshelfSearchUrl(baseUrl: string | null | undefined, libraryId: string | null | undefined, title: string): string | null` — returns `null` whenever the link cannot be built, so callers use a single null check to decide whether to render.

- [ ] **Step 1: Write the failing test**

Create `apps/shared/src/utils/__tests__/audiobookshelf.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { audiobookshelfSearchUrl } from "../audiobookshelf";

describe("audiobookshelfSearchUrl", () => {
  it("builds a library search url", () => {
    expect(
      audiobookshelfSearchUrl(
        "https://audiobookshelf.samlo.cloud",
        "5bd62c95-771f-4bc2-9b05-b8ccd54a1507",
        "Fourth Wing",
      ),
    ).toBe(
      "https://audiobookshelf.samlo.cloud/library/5bd62c95-771f-4bc2-9b05-b8ccd54a1507/search?q=Fourth%20Wing",
    );
  });

  it("tolerates a trailing slash on the base url", () => {
    expect(
      audiobookshelfSearchUrl("https://abs.example.com/", "lib1", "Dune"),
    ).toBe("https://abs.example.com/library/lib1/search?q=Dune");
  });

  it("escapes characters that would break the query", () => {
    expect(
      audiobookshelfSearchUrl("https://abs.example.com", "lib1", "Q&A / Vol. 2"),
    ).toBe(
      "https://abs.example.com/library/lib1/search?q=Q%26A%20%2F%20Vol.%202",
    );
  });

  it("returns null when anything needed is missing", () => {
    expect(audiobookshelfSearchUrl(null, "lib1", "Dune")).toBeNull();
    expect(audiobookshelfSearchUrl("https://abs.example.com", null, "Dune")).toBeNull();
    expect(audiobookshelfSearchUrl("https://abs.example.com", "lib1", "")).toBeNull();
    expect(audiobookshelfSearchUrl("   ", "lib1", "Dune")).toBeNull();
    expect(audiobookshelfSearchUrl("https://abs.example.com", "   ", "Dune")).toBeNull();
  });

  it("refuses a base url that is not http(s)", () => {
    expect(audiobookshelfSearchUrl("javascript:alert(1)", "lib1", "Dune")).toBeNull();
    expect(audiobookshelfSearchUrl("not a url", "lib1", "Dune")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd apps/shared && bun test src/utils/__tests__/audiobookshelf.test.ts`
Expected: FAIL — "Cannot find module '../audiobookshelf'".

- [ ] **Step 3: Write the implementation**

Create `apps/shared/src/utils/audiobookshelf.ts`:

```ts
/**
 * Deep links into an Audiobookshelf instance.
 *
 * Rawkoon never calls the Audiobookshelf API — it has no key and stores no ABS
 * item ids — so the only handle it has on a title is a search. The route shape
 * (`/library/:library/search?q=`) is Audiobookshelf's own client route, not an
 * API endpoint.
 */

/**
 * Build a search URL into one Audiobookshelf library.
 *
 * Returns null whenever the link cannot be built — unconfigured instance,
 * missing library id, empty title, or a base URL that is not http(s). Callers
 * render the button only for a non-null result, so an install without
 * Audiobookshelf silently shows nothing rather than a dead link.
 */
export const audiobookshelfSearchUrl = (
  baseUrl: string | null | undefined,
  libraryId: string | null | undefined,
  title: string,
): string | null => {
  const base = baseUrl?.trim();
  const library = libraryId?.trim();
  const query = title.trim();
  if (!base || !library || !query) return null;

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  // A stored value is operator input; anything but http(s) would turn the
  // button into a script or file link.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const origin = base.replace(/\/+$/, "");
  return `${origin}/library/${encodeURIComponent(library)}/search?q=${encodeURIComponent(query)}`;
};
```

- [ ] **Step 4: Export it**

In `apps/shared/src/utils/index.ts`, add alongside the other exports:

```ts
export * from "./audiobookshelf";
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd apps/shared && bun test src/utils/__tests__/audiobookshelf.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Check shared formatting**

Run: `cd apps/shared && bun run formatCheck`
Expected: clean. If it complains, run the package's format script and re-check.

- [ ] **Step 7: Commit**

```bash
git add apps/shared/src/utils/audiobookshelf.ts \
        apps/shared/src/utils/__tests__/audiobookshelf.test.ts \
        apps/shared/src/utils/index.ts
git commit -m "feat(books): build Audiobookshelf deep links"
```

---

### Task 3: The button

**Files:**
- Create: `apps/web/src/features/books/AudiobookshelfLink.tsx`
- Test: `apps/web/src/features/books/AudiobookshelfLink.test.tsx`
- Modify: `apps/web/src/pages/books/_component/BookDetailPage.tsx:25` (import) and `:445` (render site)
- Modify: `apps/web/src/locales/en/common.json`, `apps/web/src/locales/fr/common.json`

**Interfaces:**
- Consumes: `audiobookshelfSearchUrl` from Task 2; `MediaSettings.audiobookshelf_*` from Task 1; `useMediaPostProcessingSettings()` from `@/features/medias/hooks/useMediaPostProcessingSettings`, whose `data` is `{ settings: MediaSettings }`.
- Produces: `<AudiobookshelfLink edition={edition} title={title} />` where `edition: BookEdition` and `title: string`. Renders nothing when the link cannot be built.

Media settings come from `useMediaPostProcessingSettings()` in `@/features/medias/hooks/useMediaPostProcessingSettings` — the same hook `BooksSettingsTab.tsx:86` uses. It returns a query result whose `data` wraps the row as `{ settings }`, so the component reads `data?.settings`. Read `apps/web/src/features/books/EditionOpenActions.tsx` first to copy how it reaches the edition's `kind` and `file_count`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/books/AudiobookshelfLink.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { AudiobookshelfLink } from "@/features/books/AudiobookshelfLink";
import type { BookEdition } from "@rawkoon/shared/types";

const settings = vi.fn();
vi.mock("@/features/medias/hooks/useMediaPostProcessingSettings", () => ({
  useMediaPostProcessingSettings: () => settings(),
}));

const edition = (over: Partial<BookEdition> = {}) =>
  ({ id: 1, kind: "audiobook", file_count: 1, status: "downloaded", ...over }) as BookEdition;

const configured = {
  data: {
    settings: {
      audiobookshelf_url: "https://audiobookshelf.samlo.cloud",
      audiobookshelf_audiobook_library_id: "abs-audio",
      audiobookshelf_ebook_library_id: "abs-ebook",
    },
  },
};

describe("AudiobookshelfLink", () => {
  it("links an audiobook edition at the audiobook library", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(<AudiobookshelfLink edition={edition()} title="Fourth Wing" />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://audiobookshelf.samlo.cloud/library/abs-audio/search?q=Fourth%20Wing",
    );
  });

  it("links an ebook edition at the ebook library", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(
      <AudiobookshelfLink edition={edition({ kind: "ebook" })} title="Dune" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://audiobookshelf.samlo.cloud/library/abs-ebook/search?q=Dune",
    );
  });

  it("opens in a new tab without leaking the referrer", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(<AudiobookshelfLink edition={edition()} title="Dune" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders nothing when Audiobookshelf is not configured", () => {
    settings.mockReturnValue({ data: { settings: { audiobookshelf_url: null } } });
    renderWithProviders(<AudiobookshelfLink edition={edition()} title="Dune" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing for an edition with no imported files", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(
      <AudiobookshelfLink edition={edition({ file_count: 0, status: "wanted" })} title="Dune" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd apps/web && bunx vitest run src/features/books/AudiobookshelfLink.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `apps/web/src/features/books/AudiobookshelfLink.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { audiobookshelfSearchUrl } from "@rawkoon/shared/utils";
import type { BookEdition } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";

/**
 * Hand-off to Audiobookshelf, which owns playback and reading.
 *
 * Rawkoon stores no Audiobookshelf item ids, so the deepest link available is a
 * search inside the library that matches the edition's kind. Nothing renders
 * when Audiobookshelf is unconfigured or the edition has no imported files —
 * a movies-only or Audiobookshelf-less install sees no change.
 */
export function AudiobookshelfLink({
  edition,
  title,
}: {
  edition: BookEdition;
  title: string;
}) {
  const { t } = useTranslation("common");
  const { data } = useMediaPostProcessingSettings();
  const settings = data?.settings;

  const imported = edition.file_count > 0 || edition.status === "downloaded";
  const libraryId =
    edition.kind === "audiobook"
      ? settings?.audiobookshelf_audiobook_library_id
      : settings?.audiobookshelf_ebook_library_id;
  const href = imported
    ? audiobookshelfSearchUrl(settings?.audiobookshelf_url, libraryId, title)
    : null;

  if (!href) return null;

  return (
    <Button asChild variant="secondary">
      <a href={href} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="size-4" />
        {t("books.audiobookshelf.open")}
      </a>
    </Button>
  );
}
```

- [ ] **Step 4: Add the strings**

In `apps/web/src/locales/en/common.json`, under `books`:

```json
    "audiobookshelf": {
      "open": "Open in Audiobookshelf"
    }
```

In `apps/web/src/locales/fr/common.json`, under `books`:

```json
    "audiobookshelf": {
      "open": "Ouvrir dans Audiobookshelf"
    }
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd apps/web && bunx vitest run src/features/books/AudiobookshelfLink.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Swap it into the detail page**

In `apps/web/src/pages/books/_component/BookDetailPage.tsx`, replace the `EditionOpenActions` import (line ~25) with `AudiobookshelfLink`, and replace the render site (line ~445):

```tsx
<AudiobookshelfLink edition={edition} title={book.title} />
```

Use whatever the page already calls the book's title in that scope — read the surrounding lines rather than assuming `book.title`.

- [ ] **Step 7: Verify the page still builds**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors from `BookDetailPage.tsx`. Errors from files scheduled for deletion in Task 5 are expected at this point only if they reference the removed import — if so, the swap missed a usage; fix it now.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/books/AudiobookshelfLink.tsx \
        apps/web/src/features/books/AudiobookshelfLink.test.tsx \
        apps/web/src/pages/books/_component/BookDetailPage.tsx \
        apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
git commit -m "feat(books): hand playback off to Audiobookshelf"
```

---

### Task 4: The settings fields

**Files:**
- Modify: `apps/web/src/pages/settings/_component/BooksSettingsTab.tsx` (state ~line 95, seeding ~line 108, `savePaths` ~line 148, the files `CardSection` ~line 280)
- Modify: `apps/web/src/locales/en/common.json`, `apps/web/src/locales/fr/common.json`

**Interfaces:**
- Consumes: `MediaSettingsUpdate.audiobookshelf_*` from Task 1.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the state**

After `const [audiobookTemplate, setAudiobookTemplate] = useState("");` (line ~99):

```tsx
  const [absUrl, setAbsUrl] = useState("");
  const [absAudiobookLibrary, setAbsAudiobookLibrary] = useState("");
  const [absEbookLibrary, setAbsEbookLibrary] = useState("");
```

- [ ] **Step 2: Seed from the server value**

Inside the existing `if (settings && seededAt !== settings.updated_at) {` block, after the `audiobookTemplate` line:

```tsx
    setAbsUrl(settings.audiobookshelf_url ?? "");
    setAbsAudiobookLibrary(settings.audiobookshelf_audiobook_library_id ?? "");
    setAbsEbookLibrary(settings.audiobookshelf_ebook_library_id ?? "");
```

- [ ] **Step 3: Send them on save**

In `savePaths`, inside `updatePaths.mutateAsync({ … })`:

```tsx
        audiobookshelf_url: absUrl.trim() || null,
        audiobookshelf_audiobook_library_id: absAudiobookLibrary.trim() || null,
        audiobookshelf_ebook_library_id: absEbookLibrary.trim() || null,
```

- [ ] **Step 4: Render the inputs**

Add a `CardSection` after the existing files section, following that section's exact markup conventions (`LABEL`, `HINT`, `Input`, the `grid gap-4 sm:grid-cols-2` wrapper):

```tsx
      <CardSection
        title={t("settings.books.audiobookshelf.title")}
        description={t("settings.books.audiobookshelf.description")}
      >
        <div>
          <label className={LABEL} htmlFor="abs-url">
            {t("settings.books.audiobookshelf.url")}
          </label>
          <Input
            id="abs-url"
            value={absUrl}
            onChange={(e) => setAbsUrl(e.target.value)}
            placeholder="https://audiobookshelf.example.com"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="abs-audiobook-library">
              {t("settings.books.audiobookshelf.audiobookLibrary")}
            </label>
            <Input
              id="abs-audiobook-library"
              value={absAudiobookLibrary}
              onChange={(e) => setAbsAudiobookLibrary(e.target.value)}
              placeholder="5bd62c95-771f-4bc2-9b05-b8ccd54a1507"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="abs-ebook-library">
              {t("settings.books.audiobookshelf.ebookLibrary")}
            </label>
            <Input
              id="abs-ebook-library"
              value={absEbookLibrary}
              onChange={(e) => setAbsEbookLibrary(e.target.value)}
              placeholder="385e7f72-8c57-4c0e-9a31-fe0ae68a99b0"
            />
          </div>
        </div>
        <p className={HINT}>{t("settings.books.audiobookshelf.hint")}</p>
      </CardSection>
```

The section is saved by the same `savePaths` button as the files section — do not add a second save button.

- [ ] **Step 5: Add the strings**

`apps/web/src/locales/en/common.json`, under `settings.books`:

```json
      "audiobookshelf": {
        "title": "Audiobookshelf",
        "description": "Rawkoon downloads and imports; Audiobookshelf plays and reads.",
        "url": "Server URL",
        "audiobookLibrary": "Audiobook library ID",
        "ebookLibrary": "Ebook library ID",
        "hint": "Point Audiobookshelf at the same folders as the paths above. Find a library ID in its URL: /library/<id>. Leave empty to hide the button."
      }
```

`apps/web/src/locales/fr/common.json`, under `settings.books`:

```json
      "audiobookshelf": {
        "title": "Audiobookshelf",
        "description": "Rawkoon télécharge et importe; Audiobookshelf lit et fait la lecture.",
        "url": "URL du serveur",
        "audiobookLibrary": "ID de la bibliothèque de livres audio",
        "ebookLibrary": "ID de la bibliothèque de livres",
        "hint": "Pointez Audiobookshelf vers les mêmes dossiers que les chemins ci-dessus. L'ID d'une bibliothèque apparaît dans son URL : /library/<id>. Laissez vide pour masquer le bouton."
      }
```

- [ ] **Step 6: Verify**

Run: `cd apps/web && bunx tsc --noEmit && bunx vitest run src/pages/settings`
Expected: no type errors; the settings suites pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/settings/_component/BooksSettingsTab.tsx \
        apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
git commit -m "feat(settings): configure the Audiobookshelf hand-off"
```

---

### Task 5: Delete the web player, reader and offline stack

**Files:**
- Delete: the paths listed in Step 1
- Modify: `apps/web/src/pages/__root.tsx:18-20,48,90-92`, `apps/web/src/pages/_component/WidgetGrid.tsx:3,15`, `apps/web/src/sw/{message-handlers,activate-handler,index,types}.ts`, `apps/web/src/lib/endpoints/books.ts`, `apps/web/src/lib/queryKeys.ts`, `apps/web/src/locales/{en,fr}/common.json`

**Interfaces:**
- Consumes: `AudiobookshelfLink` from Task 3 — the detail page must already be swapped, or this task breaks the build.
- Produces: nothing.

- [ ] **Step 1: Delete the player-only files**

```bash
git rm -r apps/web/src/features/player apps/web/src/features/reader
git rm apps/web/src/features/books/ChapterRail.tsx \
       apps/web/src/features/books/ChapterRail.test.tsx \
       apps/web/src/features/books/OfflineButton.tsx \
       apps/web/src/features/books/useBookReading.ts \
       apps/web/src/features/books/EditionOpenActions.tsx \
       apps/web/src/features/books/EditionOpenActions.test.tsx
git rm 'apps/web/src/pages/books/$bookId/listen.tsx' \
       'apps/web/src/pages/books/$bookId/read.tsx'
git rm apps/web/src/lib/offline/bookCache.ts \
       apps/web/src/lib/offline/bookCache.test.ts \
       apps/web/src/lib/offline/playbackJournal.ts \
       apps/web/src/lib/offline/progressQueue.ts
git rm apps/web/src/sw/book-cache.ts apps/web/src/sw/book-cache.test.ts \
       apps/web/src/sw/book-progress-sync.ts
git rm apps/web/src/pages/_component/ContinueReadingWidget.tsx \
       apps/web/src/pages/_component/ContinueReadingWidget.test.tsx \
       apps/web/src/pages/_component/useContinueReading.ts
```

If `apps/web/src/lib/offline/` is now empty, remove the directory too.

- [ ] **Step 2: Unmount the player**

In `apps/web/src/pages/__root.tsx`, delete the three imports on lines 18-20 and unwrap the `<PlayerProvider>` element (line 48) along with `<PlayerBar />` and `<PlayerExpanded />` (lines 90-92), keeping the children that were inside the provider.

- [ ] **Step 3: Drop the dashboard widget**

In `apps/web/src/pages/_component/WidgetGrid.tsx`, delete the `ContinueReadingWidget` import (line 3) and its render site (line 15). Then update `apps/web/src/pages/_component/WidgetGrid.test.tsx` — remove its ContinueReading assertions and any mock of that widget.

- [ ] **Step 4: Strip the service worker**

In `apps/web/src/sw/message-handlers.ts`, remove the `./book-cache` import and the `bookCacheDownload` / `bookCacheEvict` / `bookCacheStatus` message branches. In `apps/web/src/sw/activate-handler.ts`, remove the `BOOK_CACHE` import and the clause that preserves the book cache during cleanup — every non-current cache is now dropped. In `apps/web/src/sw/index.ts`, remove the book-cache and progress-sync registrations. In `apps/web/src/sw/types.ts`, remove the book message types.

Then update `apps/web/src/sw/activate-handler.test.ts`: its "keeps the current version and the book cache, drops the rest" case now asserts the opposite — that `rawkoon-books` **is** deleted along with the other stale caches. Rewrite that expectation rather than deleting the test.

Add a one-time cleanup so existing installs do not keep a stale audiobook cache on disk forever. In `activate-handler.ts`, alongside the existing cleanup:

```ts
  // The in-app player is gone; its cache is dead weight on every client that
  // ever downloaded a book. Delete it once, on the activation that ships this.
  await caches.delete("rawkoon-books");
```

- [ ] **Step 5: Drop the dead endpoints and query keys**

In `apps/web/src/lib/endpoints/books.ts`, remove the manifest, progress, reading and playback-journal entries. In `apps/web/src/lib/queryKeys.ts`, remove the matching keys. Grep for each removed name before deleting it:

```bash
cd apps/web && grep -rn "manifest\|bookProgress\|useReading\|playbackJournal\|playback-diagnostic" src | grep -v locales
```

Every remaining hit must be in a file you are deleting or editing in this task.

- [ ] **Step 6: Remove the dead strings**

In both `apps/web/src/locales/en/common.json` and `fr/common.json`, remove the `books.player.*` block and the reader keys. Find them with:

```bash
cd apps/web && grep -n "\"player\"\|\"reader\"\|continueReading" src/locales/en/common.json src/locales/fr/common.json
```

Both files must keep identical key structure — a key removed from one must be removed from the other.

- [ ] **Step 7: Verify the web app builds and tests clean**

Run: `cd apps/web && bunx tsc --noEmit && bunx vitest run`
Expected: no type errors, all suites pass. A "cannot find module" error naming a deleted file means a consumer was missed — remove that usage.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web
git commit -m "refactor(books): remove the in-app player, reader and offline cache"
```

---

### Task 6: Delete the API reading surface

**Files:**
- Delete: `apps/api/src/routes/books/bookReadRoutes.ts`; `apps/api/src/services/books/{bookManifest,bookStreamLayout,bookProgress,bookReading,bookFileChapters}.ts`; `apps/api/test/{bookManifest,bookReading,bookProgress,bookFileChapters,bookStreamLayout,bookReadRoutes,bookReadingRoutes,bookStreamRoute,bookPlaybackDiagnosticRoute}.test.ts`
- Modify: `apps/api/src/routes/books/index.ts:7,20,28`; `apps/api/src/services/books/index.ts`; `apps/api/src/services/postProcessorBook.ts:16,379-381,796`; `apps/api/src/routes/books/bookEditionRoutes.ts:180`

**Interfaces:**
- Consumes: nothing.
- Produces: `/api/books` no longer serves `/files/:fileId/content`, `/editions/:editionId/manifest`, `/progress`, `/reading`, `/editions/:editionId/progress*`, `/playback-diagnostic` or `/playback-journal`.

- [ ] **Step 1: Delete the files**

```bash
git rm apps/api/src/routes/books/bookReadRoutes.ts
git rm apps/api/src/services/books/bookManifest.ts \
       apps/api/src/services/books/bookStreamLayout.ts \
       apps/api/src/services/books/bookProgress.ts \
       apps/api/src/services/books/bookReading.ts \
       apps/api/src/services/books/bookFileChapters.ts
git rm apps/api/test/bookManifest.test.ts apps/api/test/bookReading.test.ts \
       apps/api/test/bookProgress.test.ts apps/api/test/bookFileChapters.test.ts \
       apps/api/test/bookStreamLayout.test.ts apps/api/test/bookReadRoutes.test.ts \
       apps/api/test/bookReadingRoutes.test.ts apps/api/test/bookStreamRoute.test.ts \
       apps/api/test/bookPlaybackDiagnosticRoute.test.ts
```

- [ ] **Step 2: Unwire the router**

In `apps/api/src/routes/books/index.ts`: delete the `bookReadRoutes` import (line 7), delete its line from the doc comment (line 20), and delete `.use(bookReadRoutes)` (line 28). Keep the comment explaining why `bookListRoutes` must come first — that constraint is unchanged.

- [ ] **Step 3: Clean the service barrel**

In `apps/api/src/services/books/index.ts`, remove any re-export of the five deleted modules.

- [ ] **Step 4: Stop probing chapters**

In `apps/api/src/services/postProcessorBook.ts`: delete the `syncFileChapters` import (line 16) and both call sites (lines ~379-381 and ~796), including the comment above the first one that explains the chapter rail. Keep the `durationSecs` probing that surrounds them — upgrade decisions read it.

- [ ] **Step 5: Drop chapter_count from the edition payload**

In `apps/api/src/routes/books/bookEditionRoutes.ts:180`, delete the `chapter_count: f.chapterCount,` line.

- [ ] **Step 6: Verify nothing still references the removed code**

```bash
cd apps/api && grep -rn "bookReadRoutes\|bookManifest\|bookStreamLayout\|bookProgress\|bookReading\|syncFileChapters\|chapterCount" src test
```

Expected: no output. Any hit is a consumer that must be cleaned up now.

- [ ] **Step 7: Run the API suite**

Run: `cd apps/api && bun test`
Expected: PASS. `rescanBookEdition.test.ts` and `postProcessBookUpgrade.test.ts` touch the post-processor — if either asserts on chapters, update those assertions to drop the chapter expectations rather than deleting the tests.

- [ ] **Step 8: Commit**

```bash
git add -A apps/api
git commit -m "refactor(books): remove the reading and streaming API"
```

---

### Task 7: Drop the reading-state schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`BookFile` ~line 858, `BookFileChapter` ~line 895, `BookProgress` ~line 912, plus the `User` and `BookEdition` relations)
- Create: `apps/api/prisma/migrations/20260824001000_drop_book_reading_state/migration.sql`
- Modify: `apps/shared/src/types/books.ts:36,286,313,319,323,327-350`

**Interfaces:**
- Consumes: Task 6 must be done — the API must no longer reference these models.
- Produces: `BookFile` without `chapterCount`; no `BookProgress` or `BookFileChapter` models; `apps/shared/src/types/books.ts` without manifest, progress or reading types.

- [ ] **Step 1: Write the migration**

Create `apps/api/prisma/migrations/20260824001000_drop_book_reading_state/migration.sql`:

```sql
-- The in-app player and reader are gone; Audiobookshelf owns playback,
-- reading and their progress. The tables that backed them are dropped rather
-- than left orphaned. Progress is not migrated: Audiobookshelf tracks its own
-- from scratch, and there is no shared key to map onto.
DROP TABLE IF EXISTS "book_progress";
DROP TABLE IF EXISTS "book_file_chapters";
ALTER TABLE "book_files" DROP COLUMN IF EXISTS "chapter_count";
```

The earlier migration `20260820120000_book_progress_and_chapters` stays untouched — it is already applied everywhere, and deleting it would break `prisma migrate deploy`.

- [ ] **Step 2: Update the Prisma schema**

Delete the `BookProgress` model (line ~912) and the `BookFileChapter` model (line ~895), including their doc comments. In `BookFile`, delete `chapterCount` and the `chapters BookFileChapter[]` relation. Remove the `bookProgress` back-relations from `User` and from `BookEdition` — grep for them:

```bash
cd apps/api && grep -n "BookProgress\|BookFileChapter" prisma/schema.prisma
```

Expected after editing: no output.

- [ ] **Step 3: Apply and regenerate**

Run: `bun run db:migrate:deploy && bun run db:generate`
Expected: the migration applies; the client regenerates with no `bookProgress` or `bookFileChapter` delegates.

- [ ] **Step 4: Strip the shared types**

In `apps/shared/src/types/books.ts`: delete `chapter_count` from the file type (line ~36), the `progress` fields (lines ~286, ~313, ~319), the `manifest` field (line ~323), and the `BookReadingEntry` / reading-list types with their doc comments (lines ~327-350). Also delete the now-unreferenced `BookProgress`, `BookManifest` and chapter interfaces themselves.

Then confirm nothing imports them:

```bash
grep -rn "BookManifest\|BookProgress\|BookReadingEntry" apps --include=*.ts --include=*.tsx | grep -v node_modules
```

Expected: no output.

- [ ] **Step 5: Verify the whole workspace**

Run: `bun run typecheck && bun run typecheck:native`
Expected: both clean. tsgo occasionally disagrees with tsc; both must pass because CI gates on both.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/shared/src/types/books.ts
git commit -m "refactor(books): drop the reading-state schema"
```

---

### Task 8: Full gate, docs, version

**Files:**
- Modify: `docs/library/books.md`
- Modify: `package.json` (version)

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: a branch that is ready to merge and tag.

- [ ] **Step 1: Run the full gate**

```bash
bun run test
bun run typecheck
bun run typecheck:native
bun run lint
bun run build
```

Expected: all green. Fix anything that fails before continuing — do not proceed on a red gate.

- [ ] **Step 2: Prove the removal was clean**

Run: `bun run knip`
Expected: no new orphaned files, exports or dependencies. Knip reporting a now-unused dependency (an epub or audio library pulled in only by the reader) means it should be removed from the relevant `package.json` — do that, re-run `bun install`, and re-run knip.

- [ ] **Step 3: Update the docs**

In `docs/library/books.md`, replace the reader/player sections with the hand-off: rawkoon downloads and imports into the books and audiobooks paths; Audiobookshelf is pointed at those same folders and owns playback, reading and progress; the settings fields are the server URL and the two library IDs; the button appears on an edition once files are imported. State plainly that in-app playback and offline downloads were removed in this version and that existing reading progress is not migrated.

- [ ] **Step 4: Bump the version**

Set the root `package.json` version to `1.9.0` — a feature removal plus a new integration, not a patch.

- [ ] **Step 5: Commit**

```bash
git add docs/library/books.md package.json
git commit -m "chore: bump version to 1.9.0"
```

- [ ] **Step 6: Merge the branch**

Follow `superpowers:finishing-a-development-branch` to integrate `feat/audiobook-single-stream` into `main`. Do not tag or release yet — Task 9 removes the old releases first.

---

### Task 9: Remove the v1.8.x releases and images

**Files:** none — this task is `gh` operations against a public repository.

**Interfaces:**
- Consumes: Task 8 merged.
- Produces: v1.8.0 through v1.8.6 gone from GitHub releases, tags and ghcr.

**This task is destructive, public and irreversible. Every deletion is confirmed with the operator individually. Never batch them in a loop.**

Recorded risks, to restate to the operator before the first deletion:
- The repository is public. Anyone who cloned or pinned 1.8.x loses those references.
- 1.8.x also carries the download-hook rate-limit fix, the Bun 1.4 adoption, the Docker `node_modules` fix and per-author languages. The code survives on `main`; only the published artifacts go.
- Production runs a locally built `rawkoon:1.8.7-stream.db82681`, not a ghcr tag, so the running instance is unaffected.

- [ ] **Step 1: Grant `gh` the package scopes**

The operator runs this themselves — it is an interactive browser login:

```
gh auth refresh -h github.com -s read:packages,delete:packages
```

- [ ] **Step 2: Record what exists before deleting anything**

```bash
gh release list --limit 20
gh api "/user/packages/container/rawkoon/versions?per_page=100" \
  -q '.[] | "\(.id)\t\(.metadata.container.tags | join(","))"'
```

Save both outputs into the task notes. This listing is the only record of what was removed.

- [ ] **Step 3: Confirm the exact set with the operator**

Present the list of releases to delete — v1.8.0, v1.8.1, v1.8.2, v1.8.3, v1.8.4, v1.8.5, v1.8.6 — and the ghcr version ids that carry those tags. Get an explicit yes on the full list before running anything.

- [ ] **Step 4: Delete the releases and tags, one at a time**

For each tag, run it alone and check the result before moving to the next:

```bash
gh release delete v1.8.0 --cleanup-tag --yes
```

- [ ] **Step 5: Delete the ghcr versions, one at a time**

Using the ids recorded in Step 2:

```bash
gh api -X DELETE "/user/packages/container/rawkoon/versions/<ID>"
```

A version that is the package's only remaining version cannot be deleted — GitHub refuses it. If that happens, stop and report it rather than deleting the package.

- [ ] **Step 6: Verify the end state**

```bash
gh release list --limit 20
gh api "/user/packages/container/rawkoon/versions?per_page=100" \
  -q '.[] | "\(.id)\t\(.metadata.container.tags | join(","))"'
```

Expected: no v1.8.x releases, tags or image versions remain.

- [ ] **Step 7: Cut the new release**

Follow `.claude/skills/deploying-rawkoon/SKILL.md` to tag and release v1.9.0, which publishes `ghcr.io/samuelloranger/rawkoon:1.9.0`.
