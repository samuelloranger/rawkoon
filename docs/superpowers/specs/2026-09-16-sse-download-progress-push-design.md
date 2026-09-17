# SSE download-progress push (Approach B)

Date: 2026-09-16
Board: task 1301

## Problem

The download progress bar on the detail screen is a stale snapshot. SSE
`media`/`book` events are invalidation-only (`{mediaId, ts}`) and fire only at
grab/complete/fail transitions — never per progress tick. The web app hides
this with `useLibraryDownloads`, which polls `/api/library/:id/downloads` every
3s while a row is active; iOS has no equivalent, so its bar sits frozen from 0
to 99% until the completion event lands.

Polling from the client is the wrong shape: each viewer re-hits qBittorrent on
its own timer. The server already polls qBittorrent (reconcile worker, and the
downloads endpoint reads live torrents per request) — it should own the cadence
and push the numbers out.

## Design

A dedicated server-side broadcaster fans live progress out over the existing
library-events SSE stream under a new event kind. Clients merge the payload
straight into their download rows — no refetch, no per-client timer.

### Event contract

New event on `libraryEventBus`, surfaced on `/api/library/events`:

```
{ "kind": "download-progress", "mediaId": <int>, "ts": <ms>,
  "downloads": [ { "id": <download_history id>, "progress": 0..1,
                  "state": <string>, "downloadSpeed": <bytes/s>,
                  "etaSeconds": <int|null> } ] }
```

Fields mirror the iOS `LiveDownload` / web live shape already returned by
`GET /:id/downloads`, so clients reuse existing row types. `id` is the
`download_history` row id, the same identity the rows already carry, so a merge
is a keyed replace.

Older clients ignore an unknown `kind` (web falls through to a media
invalidation only for untagged events; iOS decodes the DTO and drops a shape it
doesn't recognise). Backward compatible.

### Server: broadcaster

New module `apps/api/src/workers/downloadProgressBroadcaster.ts`, started from
`index.ts` alongside `initWorkers()`.

Self-scheduling loop, interval `DOWNLOAD_PROGRESS_INTERVAL_MS` (3000). Each tick:

1. **Gate.** Skip the tick entirely unless BOTH:
   - `libraryEventBus.listenerCount("update") > 0` — at least one SSE client
     connected. No viewers → no qB poll, no work.
   - there is ≥1 active `download_history` row (`completedAt == null && !failed
     && torrentHash != null`).
   Either false → schedule the next tick and return.
2. **Poll once.** Resolve the active download adapter, `listTorrents()` once
   (one call serves every viewer). On failure, skip this tick silently — the
   reconcile worker owns failure/stall semantics; the broadcaster is
   best-effort progress only and must never mutate state.
3. **Map + group.** Match torrents to active rows by hash (reuse the matching
   the downloads endpoint does), build the per-download payload items, group by
   `mediaId`.
4. **Emit.** One `emitDownloadProgress(mediaId, items)` per affected media.

Pure helpers, unit-tested without qB or a socket:

- `selectActiveDownloadHashes(rows)` → lowercased hashes of active rows.
- `buildProgressPayload(rows, torrents)` → `Map<mediaId, ProgressItem[]>`.

The loop's gate predicate (`shouldBroadcast(listenerCount, activeRowCount)`) is
also pure and tested.

The broadcaster **only reads** and emits. It does not touch `completedAt`,
`failed`, stall tracks, or the reconcile poll gate. Completion/stall stays the
reconcile worker's job at its own 20s cadence.

### Server: emit + stream

- `libraryEvents.ts`: add `emitDownloadProgress(mediaId, downloads)` emitting
  `"download-progress"` with `{mediaId, downloads, ts}`.
- `libraryJobWorkerRoutes.ts` `/events`: add an `onDownloadProgress` listener
  that sends `{kind:"download-progress", ...}`; register on connect, `off` on
  abort next to the existing two.

### Shared types

`apps/shared/src/types/library.ts`: add `DownloadProgressItem` and
`DownloadProgressEvent`. Web imports both.

### Web

- `useLibraryEvents.ts`: handle `kind === "download-progress"` — patch the
  `queryKeys.library.downloads(mediaId)` cache in place (`setQueryData`,
  keyed replace of the matching rows' `live`), no invalidation.
- `useLibraryDownloads.ts`: drop `refetchInterval`. Push is now the live
  source; the one-shot fetch on mount still seeds the initial snapshot.

### iOS

- `Models.swift`: add `.downloadProgress(mediaId:items:)` to `LibraryEvent`;
  add the progress fields to `LibraryEventDTO` (`downloads: [LiveDownloadDTO]?`).
- `APIClient.libraryEventsStream()`: yield `.downloadProgress` when the DTO
  carries a `download-progress` kind.
- `AppModel`: on `.downloadProgress`, store the items in a published
  `downloadProgress: [Int: [Int: LiveDownload]]` (mediaId → downloadId →
  live), and `logSSE`. Bump nothing else.
- `MediaDetailView`: derive live rows by overlaying
  `model.downloadProgress[mediaId]` onto `downloads` at render, so the bar
  tracks the pushed value between fetches. No client poll added.

## Testing

- **api**: broadcaster pure-helper tests (hash select, payload build, gate);
  emit test (event fired with right shape); stream test extends
  `sseTestRoutes`/existing events test to cover the new kind.
- **web**: `useLibraryEvents` merges a progress event into the downloads cache;
  `useLibraryDownloads` no longer sets an interval.
- **iOS**: `LibraryEventDTO` decodes a `download-progress` payload into
  `.downloadProgress`; AppModel stores it; a pure overlay helper merges
  pushed progress onto rows.

## Out of scope

- Speeding up completion detection (reconcile stays 20s).
- Notification-stream changes.
- ETA accuracy (endpoint already returns `null`; broadcaster carries whatever
  the adapter gives, may be null).

## Verify

api: `bun run test` + `typecheck` + `lint`. web: same. iOS: `swiftformat
--lint`, `swiftlint`, `kit` build + new tests on macbuild sim. No release — the
push is additive and backward compatible; install to device to see it live.
