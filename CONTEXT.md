# Domain model

Ubiquitous language for Rawkoon. Terms here are the names to use in code, commits, and
discussion — if a module is named after a concept, that concept belongs in this file.

## Downloads

### Download outcome

The terminal transition of a `DownloadHistory` row — **complete**, **fail**, or **adopt** —
together with everything that must happen alongside it: the library status change on the
parent `LibraryMedia`/`LibraryEpisode`, the request notification, and the post-process job
it schedules.

Owned by `apps/api/src/services/downloadOutcome.ts`. Every path that finishes a download
goes through it: the reconcile loop, duplicate adoption, rescan, and the admin
retry-post-process endpoint. Nothing else writes a terminal `DownloadHistory` state.

Grab-time failure (a release that was never handed to the client) is **not** a download
outcome — it lives in the grab path.

### Adopt

Attaching an existing torrent already present in the download client to a `DownloadHistory`
row, instead of adding the torrent again. Happens when a grab hits a duplicate: the client
already has the release, possibly already finished. An adopted torrent that is already
complete produces a download outcome immediately.

### Post-process

Placing a completed download into the library: resolving the destination path from the file
template, moving or linking the file, upserting the `MediaFile`, and superseding the file it
upgrades. Runs as a queued job, not inline — a download outcome schedules it.

Distinct from **import**, which is the same act driven manually by an operator against a
file already on disk rather than by a finished download.

### Reconcile

One pass of the polling loop that compares pending `DownloadHistory` rows against the
download client's torrent list and decides, per row, whether it completed, failed, stalled,
or should keep waiting. Owns polling cadence and stall/max-age policy — not the transitions
themselves, which it delegates to the download outcome module.

## Books

### Edition

The grab-able unit of a book: one **ebook** or one **audiobook** row on a
`LibraryBook` (`BookEdition`, unique on `(bookId, kind)`). Status, monitoring,
quality profile, files, chapters, and progress hang off the edition, not the
title. A book can have both editions; each is requested and imported on its
own.

### Chapter

A slice of an audiobook on the **whole-book timeline** (`BookChapter`). Offsets
are the running sum of probed file durations, not the source chapter atoms
(frame-accurate `-c copy` splits drift). The download unit is a chapter, never
an eight-hour file. An edition without chapters is not offline-ready.

### Manifest

The client's whole contract for an edition: title, authors, total duration, and
the ordered chapter list with signed content URLs
(`GET /api/books/editions/:id/manifest`). Playback, download planning, and
resume all read this payload — not the edition row directly.

### Grant

A short-lived HMAC on a content URL (`downloadGrant.ts`). Background
`URLSession` downloads carry no session cookie, so the signature in the query
string is what authenticates the bytes. A 401 means the grant expired: refetch
the manifest, do not fail the chapter.
