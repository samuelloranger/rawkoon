# Audiobook Player: Server Chapterizing + Native iOS Client

**Date:** 2026-08-29
**Status:** Approved design, ready for implementation planning
**Board:** task 891
**Supersedes:** the in-app player removed in `fb237d5` (2026-08-23)

## Goal

Listen to the rawkoon audiobook library on an iPhone, fully offline, with playback that
survives a locked screen for hours and downloads that survive a bad network. Rawkoon splits
audiobooks into chapters at import so that the download unit is a chapter, never an
eight-hour file.

## Decisions

| Decision | Choice |
|---|---|
| Client | Native SwiftUI iOS app. Not a PWA. |
| App location | `apps/ios` inside the rawkoon repo. |
| Web player | None. The SPA keeps library management and the Audiobookshelf hand-off. |
| Scope | Audiobooks only. No ebook reader. |
| Progress | Per user. Every user may listen. |
| Chapters | Mandatory. An edition without chapters is not offline-ready and is refused. |
| Splitting | Rawkoon splits at import with ffmpeg `-c copy`. |
| Split output | The library directory. The original moves to `.originals-backup/`. |
| Qualities | Two: `original` and `datasaver` (AAC 64 kbps mono, derived cache dir). |
| Playback engine | One `AVMutableComposition` over the chapter files. Not `AVQueuePlayer`. |
| Speed | `AVPlayer.rate` + `audioTimePitchAlgorithm`. No `AVAudioEngine`, no DSP. |
| Eviction | Manual download, automatic eviction once a book is finished. |
| Download auth | Short-lived signed URLs. No `Authorization` header on background transfers. |
| Distribution | TestFlight, signed in CI and uploaded to the existing App Store Connect record. |
| Build | GitHub Actions macOS runners. XcodeGen generates the project from `project.yml`. |
| CarPlay | Out of scope. It needs an entitlement and a template scene. |

### Why native and not a PWA

The previous attempt was a PWA player and it was deleted because it "didn't work well" and
"offline never worked". Its own source comments name the causes, and all of them are
WebKit platform limits rather than bugs in the code:

- The service worker sat in the media byte path. iOS kills the worker while the screen is
  locked, and the media element then reports `MEDIA_ERR_NETWORK` mid-chapter.
- iOS discards a backgrounded media element's resource under memory pressure: `emptied`
  fires, `readyState` returns to 0 and `currentTime` returns to 0, which is indistinguishable
  from a spontaneous rewind. The old code recorded this as a diagnostic and never fixed it.
- Routing playback through `createMediaElementSource` for a volume boost made playback
  permanently silent after a backgrounding or an audio route change.
- `AudioContext.resume()` returns a promise that never settles outside a user gesture on
  iOS, which wedged the transport.

Background audio in an installed iOS PWA is not a supported capability. Each of these has a
first-party native equivalent that Apple documents and supports: `AVAudioSession` with
`UIBackgroundModes: audio`, `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`, and
`URLSession` background configurations. Rebuilding the same feature on the same platform
limits would reproduce the same failure.

The cost is a second codebase and an Apple Developer subscription. The server work below is
identical either way, so this choice swaps the consumer without invalidating the design.

### Why chapters are mandatory

The operator's uplink is slow, so streaming is not viable and every book is listened to
offline. A single 8h10m file is one 719 MB download that must succeed atomically over a bad
link. Split into chapters the same book is 61 units of 3-28 MB, each of which can fail and
be retried on its own. Chapters are therefore a transport decision before they are a
navigation feature, which is why an edition without them is refused rather than degraded.

This reverses the multi-source metadata spec's "Chapters — dropped. `book_file_chapters` no
longer exists." That decision was correct for its own purpose: chapters were being modelled
as a metadata field sourced from providers, and no provider supplied them reliably. Here
chapters are produced locally by ffmpeg from the file's own chapter atoms, and they are load
bearing for downloading. Different origin, different purpose, different table.

## The test book

`L'intruse` by Freida McFadden — book 3, audiobook edition 61. Every part of this design is
validated against it and nothing else is used as a fixture.

- On disk: 61 files, `01 - Chapter 1.mp3` through `61 - Chapter 61.mp3`, 3-28 MB each,
  about 700 MB total, 8h10m, 190-200 kbps, plus `cover.png` and a `metadata.json` carrying
  whole-book chapter offsets.
- In the database: one row, the original 719 MB file, at a path that now exists only under
  `.originals-backup/`.

The database is stale because the split was done outside rawkoon. The first implementation
step is a rescan, so that nothing downstream is built against a fiction.

## Server

### Schema

```prisma
model BookChapter {
  id         Int    @id @default(autoincrement())
  editionId  Int    @map("edition_id")
  bookFileId Int    @map("book_file_id")
  /// 0-based position in the book.
  index      Int
  title      String
  /// Offsets on the WHOLE-BOOK timeline, measured by accumulating the actual
  /// durations of the split files. NOT copied from the source chapter atoms —
  /// see "Frame quantisation".
  startSecs  Float  @map("start_secs")
  endSecs    Float  @map("end_secs")

  edition  BookEdition @relation(fields: [editionId], references: [id], onDelete: Cascade)
  bookFile BookFile    @relation(fields: [bookFileId], references: [id], onDelete: Cascade)

  @@unique([editionId, index], map: "uq_book_chapters_edition_index")
  @@map("book_chapters")
}

model BookListeningProgress {
  id          Int      @id @default(autoincrement())
  userId      String   @map("user_id")
  editionId   Int      @map("edition_id")
  /// Whole-book seconds. Never a per-file offset.
  positionSecs Float   @map("position_secs")
  finished    Boolean  @default(false)
  /// Client-supplied, and the conflict resolver. Last write wins.
  updatedAt   DateTime @map("updated_at")
  deviceId    String?  @map("device_id")

  @@unique([userId, editionId], map: "uq_book_progress_user_edition")
  @@map("book_listening_progress")
}
```

`BookEdition` gains `offlineReady Boolean @default(false)`, and `BookFile` gains
`sha256 String?` plus `chapterIndex Int?`. `BookListeningProgress` also stores
`totalDurationSecs Float` and carries real relations to `User` and `BookEdition` with
`onDelete: Cascade`, so deleting an edition does not orphan progress rows.

**`rescanBookEdition` must change before anything depends on `BookFile.id`.** Today its
refresh path is `deleteMany({ where: { filePath } })` followed by `create`
(`services/postProcessorBook.ts:765-786`), so an unchanged file gets a **new id on every
rescan**. With `BookChapter.bookFileId` cascading, one routine rescan would delete all 61
chapter rows, leave `offlineReady = true` pointing at nothing, and invalidate every `fileId`
in every client's cached manifest and every outstanding signed URL. Rescan is user-reachable
and phase 1 begins by calling it. The fix is to update in place, keyed by `filePath`,
preserving the id; and when the set of files actually changes, to set `offlineReady = false`
and requeue registration rather than leaving stale chapters behind.

`positionSecs` is always a whole-book offset. The old engine stored a file index plus an
offset within that file, and its own comment records the consequence: a resume that
resolved to an index which did not exist silently loaded nothing, so it "only ever worked
from position 0". One number cannot desynchronise from a file list.

A whole-book offset survives re-chapterizing the same audio, but not a quality upgrade to a
different rip, which has a different total duration. So the progress row stores the
`totalDurationSecs` it was recorded against. When that does not match the current manifest the
position is clamped into range, treated as approximate and surfaced as such, and `finished` is
**never** set from the clamp. Without that rule a position past the new end would mark the book
finished, and since finished books are evicted automatically, an upgrade could silently delete
a download mid-listen.

### A new runtime dependency: ffmpeg

The production image does **not** ship ffmpeg. `Dockerfile` installs `openssl curl mediainfo
mkvtoolnix` and nothing else, and no code in rawkoon shells out to ffmpeg today — file scanning goes
through mediainfo, remuxing through mkvtoolnix. This design adds the dependency, and the addition is
not optional: mkvtoolnix cannot split an MP3, so the one-pass segment muxer below exists only in
ffmpeg. Chapter probing could in principle use mediainfo, which is already present, but it reports
whole milliseconds (504188 ms where ffprobe reports 504.189388 s), and the timeline has to match
what AVFoundation reads from the same files.

So `ffmpeg` joins that apt line, carrying both `ffmpeg` and `ffprobe`. It costs roughly 200MB of
image on a single-user self-hosted deployment. The line carries a comment saying why, because
nothing else in the repo references it and it would otherwise look like a stray package.

### Chapterize worker

`services/jobs/bookChapterizeWorker.ts`, modelled on `libraryRemuxWorker.ts` — `Bun.spawn`,
a temp path, an atomic `mv`. Queued after a successful audiobook import, and available as an
explicit per-edition action for the books already in the library.

1. `ffprobe -show_chapters` the source file.
2. No chapters, or one chapter spanning the whole file: set `offlineReady = false`, emit a
   `book.not_offline_ready` notification, stop. Nothing is guessed and nothing is split.
3. Otherwise, **one pass** with the segment muxer:
   `ffmpeg -i <src> -c copy -map_chapters -1 -f segment -segment_times <t1,t2,...>
   -reset_timestamps 1 <tmp>/%d.mp3`.
4. Rename the muxer's `%d.mp3` outputs to `NN - <title>.mp3`, taking each title from the
   source chapter atom at the same index. The segment muxer emits ordinal filenames only, so
   titles come from the probe in step 1 and are matched by position — which is sound precisely
   because a one-pass partition produces exactly one output per requested boundary.
5. Stage the whole set in a temporary directory beside the edition, then probe and hash every
   file and validate that the durations sum to the source duration within one frame. Only then
   rename the staged directory into place as a single operation, and move the source into the
   shared `.originals-backup/`.
6. In one transaction: replace `book_files` for the edition, insert `book_chapters`, set
   `offlineReady = true`.

Staging matters because Audiobookshelf reads the same directory. Per-file atomic moves do not
make a 61-file transformation atomic, and a crash midway would leave a half-built book visible
to another application and a directory that the next run could mistake for finished. Backup
existence never means "complete"; the database does.

Split outputs are written with `-map_chapters -1`. Without it, `-c copy` copies every chapter
marker that overlaps the cut range into the output: on the real book, `01 - Chapter 1.mp3`
carries both "Chapter 1" and a 25ms sliver of "Chapter 2". A worker that re-probed such a file
would see two chapters, pass the step-2 gate, and split a chapter into a 504s file and a 25ms
file. Stripping the atoms on output is what makes step 2 a reliable gate.

Idempotency is keyed on the **database**, not the filesystem: an edition whose `book_chapters`
rows exist and match the files on disk is already done, and the job returns. The backup
directory cannot serve as the key. It is shared at the library root
(`/mnt/storage/Audiobooks/.originals-backup/`), not per edition, and an edition that arrived
already one-file-per-chapter has no original at all — which is exactly the L'intruse case this
design has to handle.

**Registration is a separate operation from splitting.** Registering means: probe each audio
file in the edition directory, hash it, accumulate the whole-book offsets, and write
`book_files` and `book_chapters`. Splitting means: turn one file into many, then register.
An edition that is already one-file-per-chapter is only registered. This separation is why
phase 1 can deliver a manifest for L'intruse before the splitter exists.

### Why one pass, not 61 seeks

Sixty-one independent `ffmpeg -ss X -to Y -c copy` invocations are the obvious approach and
they are wrong. Input-side `-ss` seeks to a seek point at or before the timestamp, and with
`-c copy` ffmpeg preserves the material before the requested time — so adjacent chapters can
contain the same MP3 packet on both sides, and every chapter runs long.

Measured on the real original, over the first three chapters (target 1452.292s):

| Method | Sum | Drift |
|---|---|---|
| 61 independent `-ss/-to -c copy` | 1452.382s | +0.090s |
| One pass, segment muxer | 1452.304s | +0.012s |

Extrapolated across the book that is roughly 1.8s against 0.24s. The segment muxer performs a
single packet partition, so a packet lands in exactly one output and boundaries cannot
overlap. Note also that the naive method's durations reproduce the files currently on disk
exactly (504.189388, 538.671020, 409.521633), which identifies the external tool that produced
them and explains the drift measured below.

"Lossless" means packets are not re-encoded. It does not mean sample-accurate, and it never
means non-overlapping.

### Frame quantisation

An MP3 can only be cut on a frame boundary, so `-c copy` rounds every chapter up to the next
whole frame. Measured on L'intruse: the 61 split files total **29383.445s** while the original
is **29381.878s** and `metadata.json`'s last chapter ends at **29381.830s**. That is +1.567s
across the book, about 26ms per chapter — one frame of 1152 samples at 44.1kHz each time.

The consequence is load bearing. The player's timeline is the concatenation of the files, so
it is 29383.4s long. Any offset taken from the source chapter atoms is progressively wrong
against it, by up to 1.6s at the end of the book. A position stored under one interpretation
and resumed under the other lands in the wrong place, and a chapter boundary drawn from the
atoms does not fall where the audio actually changes chapter.

Therefore `book_chapters.startSecs`/`endSecs` are computed by ffprobing each **output** file
and accumulating, never by copying the source chapter offsets. `metadata.json` and the source
atoms supply chapter *titles*; the files supply the timeline. Total duration reported in the
manifest is likewise the sum of file durations, not `BookEdition.durationSecs`.

This is also why the timeline cannot be recomputed independently on the client: the client
must use the manifest's numbers, because they describe the exact bytes it downloaded.

### Data-saver variant

A separate job, `-c:a aac -b:a 64k -ac 1`, writing to `/config/audio-cache/<editionId>/`.
Derived, so it is deletable and rebuildable and never pollutes the library that
Audiobookshelf also reads. A chapter drops from about 11 MB to about 3.7 MB, which at
30 KB/s is two minutes rather than six.

Generation is a job with explicit state, not a side effect of a GET. A background download
cannot both trigger a minutes-long ffmpeg run and receive immutable content, and two clients
asking at once must not start two encodes. So the client requests the variant, the manifest
reports it as `pending` until the job finishes, and only then does the manifest carry its
size, hash and signed URL. Generation is deduplicated per edition and variant.

### API

All under `requireUser` **except `content`**, which is authenticated by its signed URL alone.
That exception is the whole point: a background transfer carries no session cookie, so a
`content` route behind `requireUser` would return 401 however valid the HMAC was.

```
GET  /api/books/editions/:id/manifest
GET  /api/books/files/:fileId/content
GET  /api/books/progress
PUT  /api/books/editions/:id/progress
POST /api/books/progress/sync
```

The manifest is the client's whole contract: edition, title, author, narrators, cover URL,
total duration, `offline_ready`, and per chapter its index, title, start and end on the
whole-book timeline, byte size, sha256, and a **pre-signed content URL** per variant.

`content` supports `Range` using `parseByteRange` from `@rawkoon/shared/utils` — which
survived the player's removal, with its tests — over `Bun.file(path).slice(start, end + 1)`.
The `+ 1` is not optional: `parseByteRange` returns an **inclusive** `end` (`end: size - 1`),
as HTTP requires, while `Blob.slice` takes an **exclusive** one. Writing `slice(start, end)`
returns one byte too few, and `Content-Length`, `Content-Range` and the chapter's sha256 then
all disagree with the body. Tests assert the exact body length and bytes for closed,
open-ended and suffix ranges, not just the headers. It returns a real `206` with
`Content-Range` and `Accept-Ranges: bytes`, a strong `ETag`, `Content-Length`, and
`Cache-Control: immutable`. It must never redirect: a background `URLSession` following a
redirect is a documented source of failures.

Signed URLs carry `fileId`, `variant`, an opaque grant id and an expiry in an HMAC over
`SECRET_KEY` — an opaque id rather than the `userId`, so a URL in a log or a proxy trace names
no user. Query strings are scrubbed from request logs. Validation checks signature, expiry,
variant, and that the grant still confers access,
valid **7 days**. This exists because custom `Authorization` headers on background transfers
are reported to be unreliable once the app is suspended, and a download of a whole book on a
slow link outlives any short-lived session token. 700 MB at 30 KB/s is about 6.8 hours of
continuous transfer, but a background session is discretionary and a book queued off WiFi
routinely spans days — so 24 hours would make expiry the common case rather than the rare one.
The HMAC is per user and stateless, so a longer window costs nothing to issue.

Expiry recovery has to be spelled out, because a background `URLSession` download task **does
not fail on a 401**: it completes successfully and hands the app the 401 response body as the
downloaded file. `DownloadPlan` therefore checks `response.statusCode` on every completion,
and on 401 cancels every queued task whose URL is stale, refetches the manifest, and
re-enqueues. This is also why sha256 verification belongs in phase 2 rather than phase 3 —
without it, a 401 JSON body is indistinguishable from a chapter and would be handed to the
composition.

`POST /api/books/progress/sync` takes an array and is what an app that has been offline for a
week flushes on reconnect. Conflicts resolve by the client-supplied `updatedAt`, with guards: a timestamp in the future
is clamped to server time on receipt, so one device with a bad clock cannot win every future
exchange; the server also stores its own receipt time, which breaks ties deterministically and
is what an audit reads. `finished` is set by an explicit finish action, never inferred from a
position, and unfinishing is likewise explicit.

## iOS app

`apps/ios`, three layers, and the layering is the point.

### RawkoonKit — pure, and tested on Linux

A SwiftPM target with no AVFoundation, no UIKit, and no URLSession. Swift 6.3 is installed on
the homelab, so this target is built and tested here, on Linux, with no Mac and no network.
Bivouac's core fails to build on Linux precisely where it reaches for `URLSession.bytes`;
that is the mistake being avoided, and every I/O dependency is injected behind a protocol
this target defines.

- `BookManifest` — `Codable` models.
- `BookTimeline` — the whole-book timeline. Maps a position in seconds to a chapter and an
  offset and back, finds the chapter containing a position, answers what the next and
  previous chapter boundaries are. Pure arithmetic over the manifest, and the single place
  offset maths is allowed to live.
- `DownloadPlan` — a state machine over the chapters of one edition: queued, downloading,
  verified, failed, evicted. Owns retry and backoff policy, the response-status and expiry
  transitions, and reconciliation of persisted tasks against verified files after a relaunch.
  It decides what state the book is in; it never performs a transfer.
- `PositionJournal` — an append-only write-ahead log of positions, plus the rule for
  recovering the latest valid entry from a truncated log. Termination hooks are unreliable,
  so nothing is saved on quit; positions are appended as they happen.
- `SyncReconciler` — decides, for a local and a remote progress record, which wins.

`BookTimeline`'s fixture is the 61 chapter offsets rawkoon actually registered for L'intruse —
the running sum of the probed file durations, ending at 29383.445s. Explicitly NOT the offsets in
that book's `metadata.json`, which end at 29381.830s: those are the source chapter atoms, and the
1.567s between the two numbers is the frame-quantisation drift this design exists to respect. A
fixture taken from the wrong one would encode the bug into the client.

### Adapters

Thin, and each implements a protocol from RawkoonKit: `AVPlayerEngine`,
`BackgroundDownloader`, `FileStore`, `APIClient`. These are the parts a Linux test cannot
reach, so they are kept as close to trivial as possible.

### Playback

One `AVMutableComposition` with the downloaded chapter files inserted in order, played by a
single `AVPlayer`. This yields a native 8h10m timeline: `duration`, `currentTime` and `seek`
are correct across file boundaries without any offset arithmetic at playback time. The
alternative, `AVQueuePlayer` over 61 items, makes the whole-book scrubber hand-rolled
arithmetic — which is the exact class of defect that the deleted `AudiobookEngine` spent 883
lines failing to get right.

**A partially downloaded book still has a whole-book timeline.** The composition is always
built over all 61 chapters using the manifest's durations: downloaded chapters are inserted as
asset segments, and chapters not yet on disk are reserved with `insertEmptyTimeRange`. The
composition is therefore always 29383.4s long, `currentTime` is always a true whole-book
position, and no composition-time to book-time mapping is ever needed. As chapters land the
item is rebuilt and the position is restored by seeking. Playback pauses when it reaches the
start of a chapter that is not present, rather than playing silence.

This matters because a download in progress is always the partial case, and because the phase
2 spike deliberately plays a book whose chapters are still arriving. Without this invariant
that checkpoint would be testing a design that does not exist on paper. The alternative,
mapping composition offsets to book offsets at runtime, is the exact arithmetic the deleted
`AudiobookEngine` spent 883 lines getting wrong.

Accepted risk: Apple only promises playback "as gaplessly as possible", and MP3 encoder
priming and padding can produce a small artefact where two files meet. The boundaries here
are real chapter breaks with natural silence, so this is expected to be inaudible. If it is
not, the fallback is to re-encode chapters to AAC at import.

`AVAudioSession` is configured `.playback` with mode `.spokenAudio`, activated when playback
starts. Interruptions and route changes are handled explicitly, because on iOS 17 and later
route-disconnect behaviour changed for sessions that own Now Playing.
`MPNowPlayingInfoCenter` publishes duration, elapsed time and rate — set on significant
events, not on a timer — and `MPRemoteCommandCenter` wires play, pause, skip forward and
back, next and previous chapter, and `changePlaybackPositionCommand`.

Speed is `AVPlayer.rate` with `audioTimePitchAlgorithm = .spectral`. No `AVAudioEngine` and
no processing graph, because a graph is what silenced the previous attempt.

### Downloads

One `URLSession` with a background configuration and a stable identifier, with **all 61 tasks
registered up front** and the system left to schedule concurrency. Batching them by hand is
the tempting mistake: each batch needs a background wake to start the next, and the relaunch
delays compound. Each task carries `taskDescription = edition/file/variant`, which is what
survives a relaunch — at every launch the app reconciles `getAllTasks()` against the files it
has already verified and restarts whatever is missing.

A background session continues through suspension and system termination; it does **not**
survive a user force-quit, which the UI presents as a resumable download rather than an error.
It also follows redirects unconditionally, which is the second reason `content` must never
redirect, and it waits for connectivity rather than failing fast. Cellular, Low Data Mode and
expensive-network policies are explicit settings, defaulting to WiFi-only for a whole book.

`resumeData` is used when the system provides it and ignored when it does not: a chapter that
cannot be resumed is simply downloaded again. Resilience comes from the unit being 11 MB, not
from resume being reliable. This is the direct answer to "bad-network download" — at 30 KB/s a
failed chapter costs six minutes, a failed book would cost six hours.

Every completion is inspected before it is trusted. A download task reports success for any
response the server sent, including a 401, so the delegate checks `HTTPURLResponse.statusCode`
first, then length, then sha256 — and moves the temporary file before returning, because it is
deleted as soon as the callback returns. On 401 or 403 the transition is explicit: discard the
stale resume data, obtain a fresh grant from the manifest, restart that chapter. Refreshing a
grant always means a new request, so partial bytes for that chapter are lost by definition;
that is affordable per chapter and would not have been per book.

Integrity is the manifest's `sha256` per chapter. Hashing 11 MB on a phone is cheap, and it is
what distinguishes a complete file, a truncated one, and a JSON error body before any of them
reaches the composition.

Files live in `Library/Application Support/Books/<editionId>/`, excluded from iCloud backup
via `isExcludedFromBackupKey`. Not `Caches`, which iOS purges — a book taken on a plane must
still be there.

A finished book is evicted automatically. Nothing else is evicted without an explicit tap.

### State

SwiftData holds the catalog: books, editions, chapters, download state. The position journal
is a small dedicated append-only file, not SwiftData, because it is written frequently from
playback and must survive an abrupt termination.

## Build and release

The operator is offsite on a roughly 30 KB/s link with a Mac, so builds run in CI. rawkoon is
a public repository, so GitHub Actions macOS runners are free.

The Xcode project is generated by **XcodeGen** from a committed `project.yml`. No `.pbxproj`
is hand-edited, which is what makes it possible to add Swift files from Linux at all.

- `.github/workflows/ios.yml`: on Ubuntu, install the Swift 6.3 toolchain, then `swift test`
  for RawkoonKit; on `macos-15`,
  `xcodegen generate` then `xcodebuild test` on a simulator.
- A signed TestFlight archive from CI. The release lane is deliberately gated to
  `workflow_dispatch` and `ios-v*` tags so an accidental upload does not consume a permanent
  `(version, build)` pair on the live App Store Connect record.
- Build numbers use `github.run_number` directly (single publishing lane), and CI authenticates
  with `APP_STORE_CONNECT_KEY_P8_BASE64`, `APP_STORE_CONNECT_KEY_ID`,
  `APP_STORE_CONNECT_ISSUER_ID`, and `APPLE_TEAM_ID`.

Operator-visible consequence: builds arrive over the air through TestFlight, there is no weekly
re-signing loop, and push entitlements work because Apple issues them only to properly signed apps.

## Testing

Server, with `bun test`, against L'intruse and nothing invented:

- `rescanBookEdition` on edition 61 produces 61 files where the database had one.
- The chapterize worker is idempotent — a second run on the split edition changes nothing.
- An edition whose source has no chapter atoms is refused and left `offlineReady = false`.
- The manifest's chapter offsets are the running sum of the ffprobe'd durations of the 61
  files, totalling 29383.4s — and are deliberately NOT equal to `metadata.json`, which ends
  at 29381.8s. A test asserts the 1.5s divergence rather than the equality, so that a future
  change that starts trusting source atoms fails loudly.
- `content` returns `206` with a correct `Content-Range` for a mid-file range, `416` for an
  unsatisfiable one, and `200` with `Accept-Ranges` for no range at all.
- An expired signed URL returns 401, and `content` is reachable with a valid signature and
  no session cookie.
- A rescan of a chapterized edition preserves `BookFile.id` and leaves `book_chapters` intact.
- Registering an already-split edition twice is a no-op.
- Split outputs carry no chapter atoms, so re-probing one yields a single chapter.
- Splitting the real original with the segment muxer produces 61 files whose durations sum to
  within one frame of the source, and whose adjacent packets do not overlap — asserted against
  the measured numbers, so a regression to per-chapter `-ss` seeks fails the suite.
- Progress sync resolves conflicts by `updatedAt` in both directions.

RawkoonKit, with `swift test` on Linux:

- `BookTimeline` maps positions to chapters and back across all 61 real boundaries, including
  exactly on a boundary and at the very end of the book.
- `DownloadPlan` recovers correctly from a failure at chapter 30 of 61, and from a relaunch
  mid-download.
- `PositionJournal` recovers the last valid position from a log truncated mid-write.

On device, once a TestFlight build is installed — the things no test here can prove:

- Download all 61 chapters, play across several boundaries, confirm no audible gap.
- Begin playback while chapters are still downloading, and confirm the whole-book position is
  correct before, during and after the remaining chapters land.
- Lock the screen and play for 30 minutes uninterrupted.
- Confirm lock screen controls, including scrubbing.
- Kill the network mid-download and confirm the download resumes.

## Phases

0. **Delivery and wake-up.** An empty app built by GitHub Actions and delivered through TestFlight,
   phone, plus a probe that starts a background download, force-backgrounds the app, and
   confirms the `handleEventsForBackgroundURLSession` wake fires. Device time and a working
   delivery path are the scarce resources here, and nothing else is worth building until both
   are proven. This phase writes almost no code.
1. **Truth.** Fix `rescanBookEdition` to update files in place. Rescan edition 61.
   `book_chapters`, `book_listening_progress`, `offlineReady`, `sha256`. **Registration** —
   probe, hash, accumulate whole-book offsets, write chapter rows — as its own service, run
   over the already-split L'intruse. Manifest and `content` endpoints with Range and signed
   URLs. Progress endpoints.
2. **Skeleton.** `apps/ios`, `project.yml`, both CI workflows. RawkoonKit with
   `BookTimeline`. Composition with empty time ranges for absent chapters, and sha256
   verification of each download. The spike downloads and plays **all 61 chapters**, not
   three: the entire justification for a composition is 61 segments, so a three-chapter test
   proves nothing about it. Measure construction time, ready-to-play time, peak memory, and
   twenty random seeks including across boundaries, using asynchronous asset loading — Apple
   warns that precise timing for formats without summary timing may require examining the
   media, which is the real cost here, not resident bytes. Then hold the lock screen for 30
   minutes. **This is the checkpoint that decides whether the rest is worth building.**
3. **Whole book.** `DownloadPlan` with all 61 tasks registered up front, relaunch
   reconciliation, status-code and expiry handling,
   progress UI, `PositionJournal` and sync, auto-eviction.
4. **Splitting.** The chapterize worker — splitting only; registration already exists from
   phase 1 — wired into `postProcessBook`, plus the manual action and the not-offline-ready
   notification.
5. **Data saver.** The AAC variant, generated lazily, and a per-download quality choice.

Registration lives in phase 1 and splitting in phase 4 deliberately. L'intruse is already
split on disk, so the client can be built and proven against real data before the splitter
exists — but only if registering already-split editions is not itself deferred, which was a
dependency the earlier phase list hid.

## Out of scope

CarPlay. Ebook reading. A web player. Chapter detection by silence analysis. Android.
Multi-book or author-collection packs. Streaming without downloading.

## Risks

| Risk | Mitigation |
|---|---|
| Audible gap at chapter boundaries | Real chapter breaks have natural silence. Fallback: re-encode to AAC at import. |
| 61 tracks is too many for one composition | No documented limit found. Phase 2 proves it on the real book before phase 3 depends on it. |
| Background downloads stall on iOS | Small units and unconditional retry. A stalled chapter costs six minutes. |
| Nothing is testable on device today | RawkoonKit is tested on Linux; the device checks are listed and deferred, not skipped. |
| A partial composition is the wrong invariant | Decided explicitly: empty time ranges, pause at an absent chapter. The 61-chapter spike in phase 2 is what tests it. |
| A future change recomputes offsets from source atoms and silently reintroduces 1.6s of drift | The divergence is asserted in a test, and the schema comment says why. |
| A rescan silently detaches chapters from files | Rescan updates in place; a test asserts `BookFile.id` survives. |
| A quality upgrade invalidates a stored position | `totalDurationSecs` on the progress row; clamp, and never auto-finish. |
| Splitting corrupts a library file | `-c copy` to a temp path, atomic move, original preserved under `.originals-backup/`. |
