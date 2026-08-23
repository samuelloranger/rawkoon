# Audiobook playback: one stream instead of 83

## Why

The player flattens N files into a virtual timeline in JavaScript: it maps an
absolute position to (file, offset), swaps `src` at boundaries, queues seeks on
`loadedmetadata`, and re-derives the position from whichever element currently
holds the resource. Every playback bug reported so far lives in that seam:

- a drag is several async hops (locate → swap `src` → await metadata → seek),
  any of which can be dropped, so scrubbing does not reliably move the audio
- `ended` from a truncated stream is indistinguishable from a real boundary, so
  a short read silently advances a chapter
- the position is only as good as `timeupdate` from an element iOS reclaims
  freely, so the clock and the cursor stall
- resume-after-error has to guess an offset, which is the suspected rewind

A stock `<audio>` element gets none of this wrong. It only needs **one seekable
resource**.

## What makes it possible here

Measured on the reported book (`La prof`, edition 11, 83 files):

- all 83 streams identical: `mp3, 44100 Hz, mono, 192 kbps` **CBR**
- every file carries an ID3v2 header (309 bytes on the first), no ID3v1 trailer

Identical CBR parameters mean the concatenation of the audio payloads is itself
a valid mp3 stream, and byte offset maps linearly to time — so the browser's
own seeking is accurate. The ID3v2 headers are the only thing that must be
stripped, or they land mid-stream as garbage frames between chapters.

Crucially the ID3v2 size is readable from 10 bytes at the head of each file, so
this needs **no migration and no re-scan**. Existing libraries work as-is.

## Design

### Server

`GET /api/books/editions/:id/stream` — a Range-capable virtual concatenation.

1. Build a layout once per edition (cached): for each file in natural name
   order, its path, the ID3v2 header size to skip, and its audio payload length.
   Cumulative sums give a virtual byte space.
2. Answer `Range` by walking the layout and streaming slices across file
   boundaries. `Accept-Ranges: bytes`, real `Content-Length`, `206` with
   `Content-Range` — the same contract the existing byte route already honours.
3. ETag from the layout (file inodes + mtimes + sizes) so a re-import
   invalidates cached bytes and an `If-Range` mismatch falls back to a full
   response rather than stitching new bytes onto an old buffer.

Eligibility, checked from rows already stored (`format`, `audioBitrate`):
a single format across every file and one non-null bitrate shared by all. A
single-file edition needs no concatenation — its own content URL is already one
seekable resource. Anything else keeps the current timeline path.

### Manifest

Add `stream_url` and keep `total_duration_secs`. Chapters stay as absolute marks
on the edition timeline, which is what they already are — they become pure UI
over one resource instead of the thing that drives transport.

### Client

`AudiobookEngine` collapses to a single-source player:

- one `<audio src={stream_url}>`, no timeline, no `locate()`, no `loadFile`
- `seek` is `audio.currentTime = absolute`
- chapters drive labels and prev/next only
- deleted: `buildTimeline` boundary handling, `locate`, `primeNext` /
  `releasePreload`, `lastSeenOffset`, the `ended`-advances-a-file path, and most
  of the network retry/skip logic — a dropped range on one resource is the
  browser's problem to resume, which it does natively

### Offline

The service worker caches one resource per edition instead of 83. Its existing
Range-serving code already answers from a cached full body, so the download flow
gets simpler, not harder.

### Progress

`position_secs` becomes genuinely absolute. `file_id` stops meaning anything for
a concatenated edition; it stays nullable and is left null there.

## Risks

- **Eligibility is inferred** from format + bitrate; sample rate and channel
  count are not stored. A release mixing mono and stereo files would pass the
  check and play wrong. Worth storing those at scan time as a follow-up.
- **ID3 stripping must be exact**, or there are clicks at chapter joins.
- **VBR editions are not eligible** and must keep the old path: byte-to-time is
  not linear there, so the browser would seek to the wrong place.
- The old path cannot be deleted while ineligible editions exist, so both live
  side by side until every library is covered.

## Order of work

1. Layout + range-mapping service, with unit tests on the pure mapping.
2. The stream route.
3. `stream_url` in the manifest, behind the eligibility check.
4. Client: engine collapse, behind `stream_url` being present.
5. Service worker: cache one resource.
6. Delete the dead timeline code once nothing reaches it.

Steps 1–3 are additive and ship safely on their own: nothing consumes
`stream_url` until step 4.
