> Superseded by #70 (in-app web player/reader).

# Book reader and audiobook player — design

**Date:** 2026-08-20
**Status:** approved, ready for implementation planning
**Board task:** #741

## Problem

Rawkoon acquires, imports, and catalogues ebooks and audiobooks (shipped
2026-08-20, v1.7.0), but there is no way to consume them. `BookFile` rows point
at files on disk that nothing serves: no endpoint anywhere in
`apps/api/src/routes/` returns file bytes, and no schema records where a reader
left off. Today the library is a catalogue you look at.

This design adds an in-browser reader for epub, pdf, and cbz; a custom
audiobook player for m4b, mp3, flac, and ogg; per-user progress that survives
devices; and offline availability for both.

## Scope

**In:**

- Reader: epub, pdf, cbz. Typography and theme controls, paginated and scrolled
  epub modes, TOC drawer, keyboard and swipe navigation.
- Player: custom engine and UI (no native `<audio>` controls). Rate 0.5–3x,
  skip +/-15/30s, chapter list, Media Session integration, playback that
  survives route changes.
- Progress: one position per user per edition. Ebook and audiobook positions
  are independent.
- Offline: explicit per-file download into Cache Storage, offline progress
  queue flushed on reconnect.

**Out, with reasons:**

- **mobi/azw3 rendering.** No trustworthy browser renderer exists, and
  Calibre's `ebook-convert` would add a Qt/Python dependency chain and 200MB+
  to a Bun image. Quality profiles already prefer epub. These files get a
  download button and a stated reason.
- **Cross-format position sync** (ebook position moving the audiobook).
  Matching an epub TOC to m4b chapter marks has no stable key; it would be
  heuristics that quietly get it wrong.
- **Bookmarks, highlights, notes.** A second table plus text-anchor
  persistence plus an annotation layer. Deferred; the progress table is the
  spine they would bolt onto.
- **Full-text search inside a book.** Real work in epub.js, no equivalent for
  cbz.
- **Sleep timer.** Cheap, but only meaningful once background playback exists;
  a follow-up.
- **LRU cache eviction.** Eviction is explicit only. Silently deleting the book
  someone took on a plane is worse than a quota error.

## Architecture

Three concerns, deliberately separated:

1. **Byte delivery** — one authenticated, Range-capable endpoint used by the
   reader, the player, and the service worker cache alike.
2. **Position** — a server-owned row per (user, edition) with a conflict rule
   that tolerates offline clients.
3. **Presentation** — a format-agnostic reader shell with swappable renderers,
   and a framework-agnostic audio engine with React only as a view layer.

### Data model

Two new Prisma models.

```prisma
model BookProgress {
  id              Int       @id @default(autoincrement())
  userId          String    @map("user_id")
  editionId       Int       @map("edition_id")
  /// ebook: opaque locator - EPUB CFI, or "page:N" for pdf/cbz
  locator         String?
  /// 0..1 - drives progress bars and finished detection
  percent         Float?
  /// audiobook: seconds into the edition's flattened timeline
  positionSecs    Float?    @map("position_secs")
  /// multi-file audiobook: which BookFile the position lands in
  fileId          Int?      @map("file_id")
  finishedAt      DateTime? @map("finished_at")
  /// Client clock at write time. Conflict rule: highest wins.
  clientUpdatedAt DateTime  @map("client_updated_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([userId, editionId], map: "uq_book_progress_user_edition")
  @@map("book_progress")
}

model BookFileChapter {
  id         Int     @id @default(autoincrement())
  fileId     Int     @map("file_id")
  index      Int
  title      String?
  startSecs  Float   @map("start_secs")
  endSecs    Float   @map("end_secs")

  @@unique([fileId, index], map: "uq_book_file_chapters_file_index")
  @@map("book_file_chapters")
}
```

`BookFile.chapterCount` is a count with no offsets, so the player's chapter
list cannot be built from it. `book_file_chapters` is populated by the same
MediaInfo/ffprobe pass at import that already fills `durationSecs` and
`chapterCount`. Audiobooks split across files with no internal chapters get one
synthetic chapter per file.

### API

New router `apps/api/src/routes/books/bookReadRoutes.ts`, `.use()`d from
`routes/books/index.ts` **after** `bookListRoutes`, so `/files/...` is never
matched as an `:id`.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/files/:fileId/content` | `requireUser`. Path comes only from the `BookFile` row. `Bun.file`, `Accept-Ranges: bytes`, 206 on Range, 416 with `Content-Range: bytes */size` on unsatisfiable, `ETag` from `fileIno`+`fileMtimeMs`+`sizeBytes`, `Cache-Control: private, max-age=31536000, immutable`. |
| GET | `/editions/:editionId/manifest` | Ordered files with format, size, duration, chapters, and cumulative offsets so the client has one flat audio timeline. Marks each file `readable`. Reader picks its file here (epub > pdf > cbz). |
| GET | `/progress?editionIds=1,2,3` | Batch fetch for list badges. |
| PUT | `/editions/:editionId/progress` | Body carries `clientUpdatedAt`. One `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE stored.client_updated_at < EXCLUDED.client_updated_at`, so the predicate is evaluated while Postgres holds the row. Returns the winning row either way. A read-then-write pair would let two devices saving at once both observe the same old row and the older write land last. |

Business logic lives in `services/books/bookProgress.ts` (the conditional upsert,
issued through `$queryRaw` because Prisma's `upsert` cannot carry a `WHERE` on the
conflict branch) and `services/books/bookManifest.ts`, so both are unit-testable without
HTTP. All error paths return `src/errors.ts` helpers; nothing throws, because
the global `onError` collapses thrown errors into a generic 500.

**Security.** The only client input is a `fileId`. The filesystem path is read
from the row, never composed from user input, so there is no traversal surface
to validate. Range values are clamped against `sizeBytes` before use.

### Audio engine

Three layers, so no component touches a media element.

**`AudiobookEngine`** — plain TS class, no React. Owns one `HTMLAudioElement`
and a Web Audio graph:

```
MediaElementAudioSourceNode -> GainNode -> DynamicsCompressorNode -> destination
```

The element stays because it is what gives Range streaming of a 700MB m4b,
hardware codec support for m4b and flac, Media Session, and background
playback; a pure Web Audio decode path would have to buffer whole files. The
graph adds what the element cannot: gain above 100% for quiet narration, and
light compression so whispered passages do not need a volume ride.

Public surface is intent-shaped: `play()`, `pause()`, `seekAbsolute(secs)`,
`seekChapter(i)`, `skip(secs)`, `setRate(r)`, `setBoost(db)`, plus a state
subscription. The engine owns multi-file mapping — absolute timeline seconds to
(file, offset) — preloads the next file and swaps sources at boundaries without
a gap. `preservesPitch = true` is set explicitly so narration stays natural at
3x.

**`PlayerProvider`** — React context mounted in `__root.tsx` inside
`ConfirmProvider`, holding the engine for the app's lifetime so playback
survives every route change. Reads engine state through `useSyncExternalStore`,
not `useState` on `timeupdate`, which would re-render the tree four times a
second. Owns the periodic progress PUT and the Media Session metadata and action
handlers.

The ten-second save interval depends on playback state alone and reads the
position from the engine inside the tick. Depending on `state.position` would
tear the interval down and rebuild it several times a second, so it would never
fire and a crash would cost the whole session rather than ten seconds. Pausing
saves separately, on its own effect.

**UI** — `PlayerBar` (compact, global, mounted only when something is loaded)
and `PlayerExpanded` (route `/books/$bookId/listen`, deep-linkable). Both read
context and call intents.

### Reader

`features/reader/ReaderShell.tsx` owns chrome, rail, settings, theme, and
keyboard handling, and knows nothing about formats. Each renderer implements:

```ts
interface ReaderRenderer {
  load(blob: Blob): Promise<ReaderDoc>;   // toc, total units
  goTo(locator: string): void;
  next(): void; prev(): void;
  onPositionChange(cb: (p: { locator: string; percent: number }) => void): () => void;
  applyTypography(t: Typography): void;   // no-op for pdf/cbz
}
```

- **epub** — epub.js. Paginated (column-based) and scrolled modes, typography
  through its theme API, locator is a CFI.
- **pdf** — pdf.js. Page-per-view, canvas plus text layer so selection works,
  locator is `page:N`. `applyTypography` no-ops and the settings panel hides
  the type controls rather than showing dead ones.
- **cbz** — JSZip, natural-sorted entries, one `<img>` per page from an object
  URL, revoked on unmount. A 400-page cbz leaks hundreds of megabytes
  otherwise.

Renderers are `React.lazy`, so pdf.js and JSZip never enter the bundle for
someone reading epubs.

### Offline

A `book_cache` Cache Storage bucket holds one entry per
`/api/books/files/:id/content` URL — which is why that endpoint is immutable
and ETagged: the service worker stores the response as-is. New message
handlers in `src/sw/message-handlers.ts` — `CACHE_BOOK_FILE`,
`EVICT_BOOK_FILE`, `BOOK_CACHE_STATUS` — post progress back to the page so the
download control shows real percent rather than a spinner. A fetch handler
serves `book_cache` first for these URLs.

Progress written while offline queues into IndexedDB (`bookProgressQueue`) and
flushes through the existing `sync-handler.ts` Background Sync path. The
server's `clientUpdatedAt` rule is what makes that safe: a phone offline for a
week cannot rewind a position set on the desktop yesterday.

Cached files are listed with sizes in a Downloads section of the books settings
screen, each with a Remove action.

## Visual design

The reader is a **mode, not a page**. `/books/$bookId/read` renders outside the
app shell — no sidebar, no page transition. Chrome fades after three seconds
idle and returns on pointer move or key.

**Palette** stays inside the existing tokens. Two reading themes, not three:
**Night** (`--color-surface-inset` #171311 ground, `--color-text` #e3d8cf) and
**Paper** (#f4ece4 ground, #241e1b ink) — the same tokens inverted. A sepia
option would be a third near-duplicate of an already-warm palette.

**Type.** Literata, self-hosted variable, as the reading serif, offered
alongside Hanken Grotesk. Literata was commissioned for screen reading and is
the face Google Books sets — a specific choice for a library that discovers its
books through the Google Books API. Fraunces stays on titles and chapter
openers and never sets a paragraph.

**Signature: the chapter rail.** One component, two orientations, shared by
reader and player. Segments are proportional to real chapter length rather than
equal ticks, so the widths themselves are information — you can see the long
chapter coming. Played portion fills `--color-primary-600`, the current segment
takes an apricot cap, buffered ranges undertone in `--color-neutral-700`.
Draggable, clickable per segment, hover reveals chapter name and time
remaining.

```
READER  (vertical rail, right edge - thumb-reachable, clear of the text)
+----------------------------------------------+ |
|  =  Piranesi                    Aa   (  X    | |  <- chapter segments,
|                                              | #     proportional
|      The Halls of the House                  | #
|                                              | #  <- you are here
|      When the Moon rose in the Third         | |
|      Northern Hall I went to the Ninth       | |
|      Vestibule...                            | |
|                                              | |
|  <                    ch 2 - 12 min left   > | |
+----------------------------------------------+ |

PLAYER BAR  (global, above nav, present once loaded)
+----------------------------------------------------------+
| [] Piranesi         <15   >   30>    1.5x   vol   ^      |
| ############|||||----------------------------------      |
+----------------------------------------------------------+
    same rail, horizontal, chapter-segmented

PLAYER EXPANDED  (/books/$bookId/listen)
+------------------------+
|              X         |
|      +----------+      |
|      |  cover   |      |
|      +----------+      |
|   Piranesi             |  <- Fraunces
|   Susanna Clarke       |
|   read by ...          |  <- narrators[] from the edition
|                        |
|   ########|||-------   |  <- rail
|   4:12:08   -2:47:31   |  <- tabular nums, Fira Code
|                        |
|   <15     > ||    30>  |
|   1.5x   sleep   ch    |
+------------------------+
```

**Motion is spent in one place: the rail.** Segment fill animates on chapter
change, play/pause morphs in 120ms, chrome fades in 200ms. Nothing else
animates. `prefers-reduced-motion` drops all of it to instant.

**Copy.** Buttons read `Read` and `Listen`; a book with progress reads
`Continue`, and the same word appears on the list badge. Offline reads
`Make available offline`, then `Available offline`. There is no empty player
state — the bar is simply not mounted.

Quality floor, unannounced: responsive to mobile, visible keyboard focus via
the existing `.focus-ring`, reduced motion respected, all strings through
i18next in `en` and `fr`.

## Revisions

Six findings from the review of the first implementation are folded into the
sections above: the atomic conflict predicate, caching an edition's whole file
set, storing metadata and a shell so a book can be reopened offline, streaming
downloads instead of buffering them, the progress interval's dependencies, and
teaching cache activation to keep `book_cache`.

## Failure modes

| What breaks | Server | Interface |
|---|---|---|
| Row exists, file gone from disk | `notFound()`, edition flagged for the next integrity pass | "This file is missing from the library." plus a Rescan action |
| Range malformed or unsatisfiable | 416 with `Content-Range: bytes */size` | engine seeks to 0 and keeps playing |
| Format has no renderer (mobi/azw3) | manifest marks the file `readable: false` | Download replaces Read, with the reason stated |
| Corrupt epub/pdf/cbz | - | per-renderer error boundary: "This file couldn't be opened." plus Download. The shell survives. |
| Cache quota exceeded mid-download | - | "Not enough space to store this book." Partial entry deleted; nothing half-cached. |
| Progress PUT loses the conflict | 200 with the winning row | client adopts the server position silently. A prompt over 30 seconds of drift is noise. |
| Audio decode error mid-file | - | engine advances to the next file; a toast names what it skipped |
| Offline with nothing cached | manifest request has no stored copy | the metadata route answers 503 and the reader reports it could not open the book, rather than hanging |
| Download interrupted midway | - | the partial entry is deleted, so the reader never opens a truncated file |

## Testing

- `bookProgress.test.ts` — the conflict rule is the correctness-critical piece:
  newer `clientUpdatedAt` wins, older is rejected and returns the stored row,
  equal timestamps keep the stored row, first write upserts. Mocks
  `@rawkoon/api/db` like the rest of the API suite.
- `bookReadRoutes.test.ts` — auth required; 206 with correct `Content-Range`;
  full 200 without Range; 416 on garbage; ETag and 304. There is no traversal
  case to test because there is no path input.
- `bookManifest.test.ts` — cumulative offsets across multi-file audiobooks,
  synthetic chapters when a file has none, readable flags per format.
- `AudiobookEngine.test.ts` — pure TS with a stub element: absolute-to-(file,
  offset) mapping at 0, exactly on a boundary, and the final second;
  `seekChapter`; rate clamping. The class exists so this is testable without
  React.
- `ChapterRail.test.tsx` — segment widths proportional to durations, click maps
  to the right absolute time, arrow keys move focus and seek.
- `bookCache.test.ts` — a download resolves only once every file is stored,
  progress is aggregated across the set rather than reported per file, and a
  worker failure surfaces its reason.
- `book-cache.test.ts` and `activate-handler.test.ts` — which requests the
  worker claims, and that activation keeps `book_cache` while dropping stale
  caches. Both are regression guards for review findings.
- One smoke test per renderer against a tiny fixture (TOC plus first position).
  The libraries are already tested; the integration is what breaks.

## Files

```
apps/api/src/routes/books/bookReadRoutes.ts          + .test.ts
apps/api/src/services/books/bookProgress.ts          + .test.ts
apps/api/src/services/books/bookManifest.ts          + .test.ts
apps/api/src/services/books/bookFileChapters.ts      (probe -> chapter rows, called at import)
apps/api/prisma/migrations/<ts>_book_progress_and_chapters/

apps/web/src/features/reader/ReaderShell.tsx
apps/web/src/features/reader/renderers/{Epub,Pdf,Cbz}Renderer.tsx
apps/web/src/features/reader/useReaderProgress.ts
apps/web/src/features/player/AudiobookEngine.ts      + .test.ts
apps/web/src/features/player/PlayerProvider.tsx
apps/web/src/features/player/{PlayerBar,PlayerExpanded}.tsx
apps/web/src/features/books/ChapterRail.tsx          + .test.tsx   <- shared
apps/web/src/lib/offline/bookCache.ts
apps/web/src/pages/books/$bookId/read.tsx
apps/web/src/pages/books/$bookId/listen.tsx
apps/shared/src/types/books.ts   (extend: BookProgress, BookManifest, BookChapter)
```

`pages/books/$bookId.tsx` becomes `pages/books/$bookId/index.tsx`; TanStack
file-based routing needs the directory for the nested routes.

New dependencies: `epubjs`, `pdfjs-dist`, `jszip`, and the Literata variable
font files. All web-side; the API adds none.
