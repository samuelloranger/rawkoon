# Replace the in-app reader/player with Audiobookshelf

Date: 2026-08-23
Status: approved for planning

## Problem

Rawkoon ships its own audiobook player and ebook reader (landed v1.8.0, patched
through v1.8.6 and the `feat/audiobook-single-stream` branch). It is roughly
4 800 lines of client and server code — a streaming engine with Range handling,
a flattened multi-file timeline, chapter probing, a service-worker offline
cache, a progress-sync queue and a playback journal — and it duplicates, badly,
what Audiobookshelf already does well.

Audiobookshelf is already running at `audiobookshelf.samlo.cloud` and already
scans the same directories rawkoon imports into:

| ABS library | Container path | Host path | Items |
|---|---|---|---|
| Audiobooks | `/audiobooks` | `/mnt/storage/Audiobooks` | 22 |
| Books | `/books` | `/mnt/storage/Books` | 28 |

No file movement, no new mounts, no ABS configuration is required.

## Decision

Rawkoon keeps discovery, indexer search, grabbing, post-processing, import,
monitoring and notifications. It stops being a reader and a player entirely.
Audiobookshelf owns consumption.

The integration is **deep-link only**: no ABS API key, no ABS API calls, no
progress mirroring. Rawkoon stores an ABS base URL and the two library ids, and
renders one button per edition that opens ABS at a title search.

### Accepted consequences

- All existing `book_progress` rows are lost. ABS tracks its own progress from
  scratch.
- The "Continue reading" dashboard widget disappears.
- Offline downloads (service-worker cached books) disappear. The ABS mobile
  apps cover that case better.
- Rawkoon shows no reading state at all for books — a book is either in the
  library or not.

## Removal

### Deleted outright (player-only paths; `git rm` restores their v1.7.1 state)

Web:
- `apps/web/src/features/player/` — `AudiobookEngine.ts` (883), its two test
  files (955), `PlayerProvider.tsx` (445), `PlayerBar.tsx`, `PlayerExpanded.tsx`,
  `formatClock.ts`
- `apps/web/src/features/reader/` — `ReaderShell.tsx`, `ReaderSettings.tsx`,
  `renderers/`, `types.ts`
- `apps/web/src/features/books/` — `ChapterRail.tsx(+test)`, `OfflineButton.tsx`,
  `useBookReading.ts`, `EditionOpenActions.tsx(+test)`
- `apps/web/src/pages/books/$bookId/listen.tsx`, `read.tsx`
- `apps/web/src/lib/offline/` — `bookCache.ts(+test)`, `playbackJournal.ts`,
  `progressQueue.ts`
- `apps/web/src/sw/` — `book-cache.ts(+test)`, `book-progress-sync.ts`
- `apps/web/src/pages/_component/` — `ContinueReadingWidget.tsx(+test)`,
  `useContinueReading.ts`

API:
- `apps/api/src/routes/books/bookReadRoutes.ts` — file-content stream with
  Range, edition manifest, progress GET/PUT/finish/reset, reading list,
  playback-diagnostic, playback-journal
- `apps/api/src/services/books/` — `bookManifest.ts`, `bookStreamLayout.ts`,
  `bookProgress.ts`, `bookReading.ts`, `bookFileChapters.ts`
- `apps/api/test/` — `bookManifest.test.ts`, `bookReading.test.ts`

### Surgical edits (files carrying non-player work that must survive)

- `apps/api/prisma/schema.prisma` — drop `BookProgress`, `BookFileChapter`,
  `BookFile.chapterCount`, and the `bookProgress` relations on `User` and
  `BookEdition`. Keep `BookFile` (import and upgrade decisions read it) and keep
  the per-author language columns added in #35.
- `apps/api/src/services/postProcessorBook.ts` — remove the two
  `syncFileChapters` calls and the import. Keep duration probing.
- `apps/api/src/routes/books/index.ts` — unwire `bookReadRoutes`.
- `apps/api/src/routes/books/bookEditionRoutes.ts` — drop `chapter_count` from
  the file payload.
- `apps/shared/src/types/books.ts` — drop manifest, progress and reading types.
  Keep `byteRange` in `shared/src/utils` (generic, used elsewhere).
- `apps/web/src/pages/__root.tsx` — remove the `PlayerProvider` / `PlayerBar`
  mount.
- `apps/web/src/pages/_component/WidgetGrid.tsx` — remove the ContinueReading
  entry.
- `apps/web/src/sw/message-handlers.ts`, `activate-handler.ts`, `index.ts`,
  `types.ts` — remove the book-cache branches and message types; keep the
  `app-update` work from #31.
- `apps/web/src/locales/{en,fr}/common.json` — remove `books.player.*` and
  reader keys, add the ABS strings.

### Database

The player migration `20260820120000_book_progress_and_chapters` is already
applied in production. It is NOT deleted — removing an applied migration breaks
`prisma migrate deploy` on every existing install. A new forward migration
drops `book_progress`, `book_file_chapters` and `book_files.chapter_count`.

## Addition

Three nullable columns on the media-settings row that already holds
`booksLibraryPath` / `audiobooksLibraryPath`:

- `audiobookshelf_url`
- `audiobookshelf_audiobook_library_id`
- `audiobookshelf_ebook_library_id`

Three fields in `BooksSettingsTab`. A pure `absLink(baseUrl, libraryId, title)`
helper in `@rawkoon/shared/utils` building
`{base}/library/{libraryId}/search?q={encodeURIComponent(title)}` — both routes
verified against the running ABS client bundle (`/library/:library?/search`,
`/item/:id`).

Book detail page renders **Open in Audiobookshelf** only when the base URL and
the matching library id are set and the edition has files. Self-hosters without
ABS see no button.

Local values to seed:

```
audiobookshelf_url                   = https://audiobookshelf.samlo.cloud
audiobookshelf_audiobook_library_id  = 5bd62c95-771f-4bc2-9b05-b8ccd54a1507
audiobookshelf_ebook_library_id      = 385e7f72-8c57-4c0e-9a31-fe0ae68a99b0
```

## Branch base

The work happens on top of the current `feat/audiobook-single-stream` HEAD, not
off `main`. Commit `1c6317a` (#35) lives only on this branch and carries
keepers — per-author languages and its migration, the delete UX, the mobile
header, the search route. Branching off `main` would strand them. The player
commits already on the branch stay in history; the removal commit lands on top
and the branch merges to `main` as one unit.

## Why not a plain `git revert`

The player landed interleaved with work that must survive. Reverting the six
commits would also drop: the `isApiPath` fix (#30), the Dockerfile and
service-worker `app-update` changes (#31), the generic `byteRange` util (#33),
and per-author languages, the delete UX, the mobile header and the search route
(#35). Path-scoped deletion plus surgical edits reaches the same end state
without re-applying keepers.

## Testing

- Delete the tests of deleted code.
- New unit tests: `absLink` URL construction; the button hidden when no URL is
  configured.
- Gate on `bun run test`, `bun run typecheck`, `bun run typecheck:native`,
  `bun run lint`, and `bun run knip` — knip flagging no orphans is the proof the
  removal was clean.

## Release handling

v1.8.0 through v1.8.6 are to be erased: GitHub releases and their tags via
`gh release delete <tag> --cleanup-tag`, and the matching ghcr package versions
via `gh api -X DELETE /user/packages/container/rawkoon/versions/{id}`.

Risks recorded:

- The repo is public. Deletion is irreversible and visible to anyone who cloned
  or pinned those versions.
- 1.8.x also carries the download-hook rate-limit fix, the Bun 1.4 adoption, the
  Docker `node_modules` fix and per-author languages. Erasing those releases
  erases the only published artifacts of that work; the code survives on `main`.
- Production runs a locally built `rawkoon:1.8.7-stream.db82681`, not a ghcr
  tag, so the running instance is unaffected.
- `gh` currently lacks package scopes; the operator must run
  `gh auth refresh -h github.com -s read:packages,delete:packages` first.
- Each deletion is confirmed individually at execution time, never batched.

The removal itself ships as a normal forward release after the deletions.
