# Single-file audiobook: download + playback model

**Date:** 2026-09-09
**Status:** Approved design, pre-implementation
**Board task:** 1148
**Scope:** server manifest route, `@rawkoon/shared` types, API route test,
RawkoonKit + iOS app, web player. No Android-TV change.

## Problem

A single-file audiobook (one `.m4b`/`.mp3` for the whole book) with embedded
chapter atoms registers as **many `book_chapters` rows that all point at the
same `book_file`**. `registerSingleFileEdition`
(`apps/api/src/services/books/registerBookChapters.ts:152`) maps each atom to a
row with `bookFileId: file.id` — the one file — so N chapters share one
`file_id`.

Confirmed in production: edition **65** ("La femme de ménage voit tout") is
**1 file (`book_file` 1059), 82 chapters, `distinct book_file_id = 1`**,
`offline_ready = true`.

The manifest route (`apps/api/src/routes/books/bookPlaybackRoutes.ts:114`)
emits one chapter per row with `file_id: chapter.bookFile.id`, so this book's
manifest is **82 chapters all carrying `file_id: 1059`**.

Every client treats `file_id` as a per-chapter identity, which breaks three
ways:

1. **iOS crash.** `DownloadPlan.init` and `ChapterDownloader` build
   `Dictionary(uniqueKeysWithValues: chapters.map { ($0.fileId, …) })`
   (`DownloadPlan.swift:34-35`, `ChapterDownloader.swift:51,115`). Duplicate
   keys **trap at runtime** the moment this book is opened or downloaded.
2. **iOS/web wrong playback.** Both players assume the physical file's `t=0`
   equals `chapter.start_secs` (iOS `buildQueue` offset `= clamped −
   chapter.startSecs` and `wholeBookPosition = chapter.startSecs + itemTime`;
   web `applyChapter` offset `= position − chapter.start_secs` and
   `onTimeUpdate` `position = chapter.start_secs + audio.currentTime`). For a
   single file the chapter's `start_secs` is its offset **into** the file, so
   the offset math double-counts and seeks to the wrong place.
3. **iOS wasted downloads / disk collision.** `FileStore` is keyed by
   `(editionId, fileId)`; 82 chapters → one path, and the download plan would
   (absent the crash) try to fetch the same 500 MB file up to 82 times.

Root cause is a model mismatch, not an emission bug: `file_id` is per-file,
chapters are per-atom, and a single-file book has many chapters on one file.

## Decision

Unify **both** clients on: **the physical FILE is the download and playback
unit; a chapter is a timeline marker.** `files.length ≤ chapters.length`.
Multi-file books have one file per chapter (`file.start_secs ==
chapter.start_secs`) and must behave byte-for-byte as today.

The server manifest is made truthful by adding an explicit `files[]` array.
Per-chapter `size_bytes`/`sha256`/`url` are **kept** (additive) so Android-TV
compiles and behaves unchanged; iOS and web switch to `files[]`.

Rejected alternatives:
- *Per-chapter `file_start_secs` only* — leaves the download unit implicit and
  keeps per-chapter file-field duplication. Rejected.
- *Client-derived grouping, no server change* — was on the table, overruled:
  the contract should name the download unit rather than have three clients
  re-derive it.
- *Single-file special case* — overruled in favor of one unified path.

## Manifest contract

New field on `BookManifest` (snake_case wire shape):

```jsonc
{
  "edition_id", "book_id", "title", "authors", "total_duration_secs",
  "files": [
    {
      "id":            number,   // book_file id
      "start_secs":    number,   // whole-book position of this file's t=0
      "duration_secs": number,   // playable length of the file
      "size_bytes":    number,
      "sha256":        string | null,
      "url":           string    // ONE signed grant for the file
    }
  ],
  "chapters": [
    { "index", "title", "start_secs", "end_secs", "file_id",
      "size_bytes", "sha256", "url" }        // per-chapter fields retained
  ]
}
```

Invariants:
- `files` is ordered by `start_secs`.
- Each chapter's `file_id` matches exactly one file's `id`.
- A file's `[start_secs, start_secs + duration_secs)` covers every chapter that
  references it.
- Multi-file: `files.length == chapters.length`, pairwise `start_secs` equal.

## Server — `bookPlaybackRoutes.ts`

The manifest query already loads `chapters` ordered by `index` with
`bookFile { id, sizeBytes, sha256 }`. Build `files[]` by grouping the loaded
chapters by `bookFile.id`, preserving first-seen (index) order:

- `id` = `bookFile.id`
- `start_secs` = first chapter's `startSecs` in the group
- `duration_secs` = last chapter's `endSecs` − first chapter's `startSecs`
- `size_bytes` = `Number(bookFile.sizeBytes)`, `sha256` = `bookFile.sha256`
- `url` = **one** `signGrant` per file (today it signs a grant per chapter —
  the new code signs once per distinct file and reuses it for that file's
  chapters' retained `url` too)

`total_duration_secs` stays `chapters.at(-1)!.endSecs`. Per-chapter
`size_bytes`/`sha256`/`url` remain, sourced from the chapter's `bookFile` /
that file's grant.

## Shared types — `apps/shared/src/types/books.ts`

Add:

```ts
export interface BookManifestFile {
  id: number;
  start_secs: number;
  duration_secs: number;
  size_bytes: number;
  sha256: string | null;
  url: string;
}
```

Add `files: BookManifestFile[]` to `BookManifest`. `BookManifestChapter`
unchanged.

## RawkoonKit — `BookManifest.swift`

Add:

```swift
public struct ManifestFile: Codable, Equatable, Sendable {
    public let id: Int
    public let startSecs: Double
    public let durationSecs: Double
    public let sizeBytes: Int
    public let sha256: String?
    public let url: String
    public var fileExtension: String { /* same rule as ManifestChapter */ }
}
```

Add `public let files: [ManifestFile]` to `BookManifest`.

**On-disk compatibility (hard constraint — downloaded library must survive an
update).** Legacy persisted manifests (written before this change) have no
`files`. `files` decodes as optional; when absent or empty, **synthesize one
file per chapter**: `id = chapter.fileId`, `startSecs = chapter.startSecs`,
`durationSecs = chapter.endSecs − chapter.startSecs`, `sizeBytes/sha256/url`
from the chapter. This exactly reproduces the old multi-file behavior, and
because `FileStore` paths are keyed by `fileId`, already-downloaded files are
still found. Applies in **both** `decodePersisted` decoders (camelCase and
snake_case) and to a live server payload that (transitionally) lacks `files`.

## RawkoonKit — `DownloadPlan.swift`

`init(files: [ManifestFile])` replaces `init(chapters:)`. `states`, `attempts`,
and the internal lookup are keyed by **file id** — no duplicate keys. The
event API (`.requested/.started/.completed(fileId:)`) is already fileId-shaped
and is unchanged. `progressFraction`/`nextToStart` now range over files.
`chapters` property is dropped from the plan (the player owns chapters).

## iOS app — `ChapterDownloader.swift`

- Downloads are driven by `manifest.files`. `chapterByFileId: [Int:
  ManifestChapter]` becomes `fileById: [Int: ManifestFile]`.
- `plan = DownloadPlan(files: manifest.files)`; `refreshChapterURLs` swaps the
  files; `reconcileExistingFiles`, `didFinishDownloading`, `resolvedChapterURL`
  look up `ManifestFile`.
- `FileStore.chapterURL(editionId:fileId:ext:)` unchanged; `ext` from
  `file.fileExtension`.
- Size/hash verification compares against `file.sizeBytes`/`file.sha256`.

## iOS app — `AudiobookPlayer.swift`

Separate the item (file) from the marker (chapter). Keep `chapters` +
`BookTimeline` for the UI and chapter navigation.

- Add `itemFiles: [ObjectIdentifier: ManifestFile]` and a
  `file(forWholeBookPosition:)` lookup over `manifest.files`.
- `buildQueue(at:)`: choose the **file** covering the position; item =
  `playbackURL(for: file)`. `offset = clamp(clamped − file.startSecs, 0,
  file.durationSecs)`. Set the current chapter marker via
  `timeline.chapterIndex(at: clamped)`.
- `wholeBookPosition(fromCurrentItemTime:)` = `file.startSecs + itemTime` (file
  looked up via `itemFiles`).
- `handleItemDidPlayToEnd`: fires at the **physical file** end → advance to the
  next file (`buildQueue(at: file.startSecs + file.durationSecs)`).
- `handleTick`: position from the file; chapter marker from
  `timeline.chapterIndex(at:)` (already the fallback path).
- `playbackURL(for:)`, `recoverFromFailedLocalItem`, `logItemFailure`,
  `recoveredFileIds` key on `file.id`.

Multi-file: `file(forWholeBookPosition:)` == the chapter's file,
`file.startSecs == chapter.startSecs` → identical to today.

## iOS app — `AppModel.swift`

- `persistDownloadedAudiobook`: `DownloadedEdition.fileCount =
  manifest.files.count` (real download units).
- `manifest(_:)` backfill guard: compare `DownloadedStore.downloadedFileCount`
  against `fetched.files.count`, not `fetched.chapters.count`.
- `applyDownloadPlan` completion check counts files.

## Web — `apps/web/src/features/player/`

New pure helper `fileIndex.ts` (mirrors `timeline.ts`):

```ts
export function createFileIndex(files: BookManifestFile[]) {
  return {
    files,
    fileAt(positionSecs): BookManifestFile | null,        // covers [start, start+duration)
    boundaryAfterFile(positionSecs): number | null,       // next file's start_secs
  };
}
```

`PlayerProvider.tsx` — swap the unit from chapter to file only where `audio`
is touched:
- `LoadedBook` gains `fileIndex` beside `timeline`; track `currentFileRef`.
- `applyChapter` → `applyFile(file, offsetSecs, playAfter, force)`: `audio.src
  = file.url`, dedupe/`force` keyed by `file.id`.
- `seekInternal(position)`: `file = fileIndex.fileAt(position)`;
  `applyFile(file, position − file.start_secs)`. Set the UI chapter marker
  separately from `timeline.chapterAt(position)`.
- `onTimeUpdate`: `position = currentFileRef.start_secs + audio.currentTime`.
- `onEnded`: `boundaryAfterFile` → next file, else finish.
- `retryGrantOrError`: refetch manifest, re-resolve the **file**, offset
  `position − file.start_secs`.

Unchanged, still chapter-keyed: next/prev-chapter buttons
(`timeline.boundaryAfter/Before`), `currentChapterIndex`, the chapter list UI.
Multi-file: `fileAt` == `chapterAt`, `file.start_secs == chapter.start_secs`.

## Testing

- **RawkoonKit** (`swift test`, Linux CI — the only path that runs on Linux):
  - `BookManifest` decodes `files[]` (snake + camel).
  - Legacy manifest (no `files`) synthesizes one file per chapter.
  - `DownloadPlan(files:)` with a single-file edition (1 file, many chapters):
    no trap, correct `progressFraction`, `nextToStart` offers the one file
    once.
  - Offset math: single-file mid-book seek maps to the right in-file offset;
    multi-file regression holds (`file.startSecs == chapter.startSecs`).
- **Web** (`bun run test`, run with `env -u NODE_ENV`): `fileIndex` unit tests
  (single- and multi-file); `timeline` tests unchanged.
- **API** (`bun test`): manifest route emits correct `files[]` for a single-file
  and a multi-file fixture (counts, ordering, `start_secs`/`duration_secs`, one
  grant per file, chapter↔file linkage).
- **iOS integration** (the real gate — macbuild, per constraint "Linux builds
  RawkoonKit alone"): `lint` + `kit` + `build` green on push to `main`, then
  drive prod edition 65 on the macbuild simulator (per the sim repro recipe):
  downloads exactly one file, plays, chapter markers advance across the single
  file, and resume lands at the right position.

## Out of scope / follow-ups

- Android-TV: reads retained per-chapter fields, no change.
- Server-side re-modeling of `book_chapters` (e.g. a `book_files`-first schema)
  is not touched; `files[]` is derived at request time.

## Constraints honored

- No behavior change for multi-file books (regression-tested both clients).
- On-device downloaded library survives the update (legacy-manifest synthesis,
  fileId-keyed paths).
- No new third-party dependencies.
- iOS shippability proven by `lint`/`kit`/`build` green on `main`, not by a
  release; no version bump or release is part of this work.
