# Decisions

## ADR-001: A built-in media library instead of Radarr and Sonarr

**Status:** accepted.

Rawkoon implements movie and TV library workflows natively instead of wrapping
Radarr and Sonarr as upstream runtime services.

### Context

Movies and TV share most of the same lifecycle: discovery, quality selection,
indexer search, grab, import, and notification. Keeping separate Radarr and
Sonarr instances would create two configuration surfaces and two sources of
truth, while still forcing Rawkoon to translate its own product features
through third-party APIs.

### Decision

Rawkoon owns one media model and one quality and release pipeline. TMDB
provides discovery, Prowlarr or Jackett provide release results, the selected
download client handles grabs, and Rawkoon post-processes files into the library.

The existing Radarr and Sonarr integrations remain only for a one-time library
import and for recognizing familiar filename conventions during file scanning.

### Consequences

This gives Rawkoon a unified UI and direct control over release scoring,
upgrades, alerts, and post-processing. It also means Rawkoon owns the
maintenance of its indexer adapters and post-processing behavior, and users
with highly customized *arr configurations may need to recreate some quality
rules.

## ADR-002: In-app web player and reader instead of Audiobookshelf

**Status:** accepted (shipped in [#70](https://github.com/samuelloranger/rawkoon/pull/70), 2026-09-02).

### Context

An Audiobookshelf integration was built, then removed. Keeping a second
server for listening/reading split the product: settings, tokens, and
playback lived outside Rawkoon, and the web app could not play what it
had just imported.

### Decision

The SPA plays audiobooks with a single HTML audio element and reads EPUBs
with Readium, sharing the same progress endpoints as the iOS app. Positions
are last-write-wins. Playback is foreground-only on the web (locking the
phone or leaving the tab typically pauses audio in Mobile Safari). Offline
listening remains an iOS concern.

Audiobookshelf is not a runtime dependency.

### Consequences

One progress model for web and iOS. Mobile Safari will not keep audio
alive in the background — that is accepted; the native app is the
lock-screen player.

## ADR-003: Native iOS app rather than a PWA

**Status:** accepted (board task 891; shipped with the iOS companion, #48).

### Context

An earlier in-browser / PWA player was deleted because background audio and
offline files did not work. The failures were WebKit platform limits: iOS
kills the service worker while the screen is locked (`MEDIA_ERR_NETWORK`),
discards a backgrounded media element's resource, and will not settle
`AudioContext.resume()` outside a user gesture.

### Decision

The phone client is a native SwiftUI app in `apps/ios`, distributed on
TestFlight. Background audio uses `AVAudioSession` + `UIBackgroundModes:
audio`, lock-screen controls use `MPNowPlayingInfoCenter` /
`MPRemoteCommandCenter`, and chapter downloads use `URLSession` background
configurations. The web app remains the admin and library surface (and,
after #70, a foreground player/reader).

### Consequences

A second codebase and an Apple Developer account. Linux CI can only build
`RawkoonKit`; the real app gate is macOS (`macbuild` / `ios.yml`). A PWA
cannot be revived for lock-screen listening without hitting the same
platform limits.

## ADR-004: Hand-written audiobook player, not Readium AudioNavigator

**Status:** accepted (board task 930, recorded 2026-08-31).

### Context

v1.12.0 added `readium/swift-toolkit` for the EPUB reader. That package
already contains `AudioNavigator` — adopting it needs no new dependency and
would unify reading and listening on Readium's Locator model.

### Decision

Keep the existing `AVMutableComposition` player. It already provides a
whole-book chapter timeline from server-probed durations, a sleep timer
with fade / end-of-chapter, per-chapter offline downloads (`DownloadPlan`),
the mini-player, and Now Playing / remote-command wiring that CarPlay
builds on. The server manifest is Rawkoon's own shape, not a Readium Web
Publication Manifest.

Readium earned its place in the **reader**: it saved a hand-written
Range-capable `WKURLSchemeHandler`. There is no equivalent saving for
audio.

### Consequences

Two position models (seconds on a book timeline vs spine + locator).
Revisit only if sharing one model is worth rewriting the player, or if
the player's own maintenance becomes the burden.
## ADR-005: macbuild is the authoritative iOS app-test environment

**Status:** accepted (2026-09-16).

### Context

The iOS app depends on Xcode, an iPhone simulator, generated project files,
and Swift packages that are unavailable in the Linux development environment.
The existing macOS machine already has the Rawkoon checkout at
`~/Sites/projets_perso/rawkoon`; using a temporary clone there risks losing
the local simulator and package state that makes the gate representative.

### Decision

Run iOS app tests through `scripts/test-ios-macbuild.sh` from that existing
checkout. The script ensures XcodeGen is available, regenerates the project,
selects an available iPhone simulator dynamically, and accepts an
`-only-testing` selector (or `--build`).

### Consequences

Every iOS change has a repeatable macOS verification command without baking a
simulator UUID into the repository. Work in that checkout preserves its
untracked `HANDOFF.md` and `apps/ios/.swiftpm/` state; implementation commits
must stage only intended files.

## ADR-006: One download history for every grab target

**Status:** accepted (recorded 2026-10-27, describing the shipped design).

### Context

A grab can target a movie, a single episode, a season pack, or a book
edition. Giving each its own history table would have meant four copies of the
same completion, failure, seeding and notification logic, and four places for
the poll that finds active downloads to look. At the same time, two scheduled
searches firing on the same tick, or a manual grab racing an automatic one,
could add the same release twice to the download client.

### Decision

All grabs share one download-history table. The target is a nullable media
reference, an optional episode, an optional season for packs, or a nullable
book-edition reference; a check constraint forbids a row naming both a media
item and a book edition. "At most one active download per target" is enforced
by the database, not only by the application: a partial unique index on the
media target and a second, disjoint one on the book edition, each applying only
while the row is neither completed nor failed. The grab path pre-checks for a
clear rejection reason and then treats the unique-violation error as the
race-closing fallback.

### Consequences

Completion, adoption, seeding and attention logic are written once and every
target kind gets them. The cost is nullable target columns and indexes that
Prisma cannot express, which live only in hand-written migrations and are
invisible in the schema file, so a fresh reader must look there. The two
unique indexes are deliberately disjoint so the media rule and its error
handling were not changed when books arrived. A row may end up with no target
at all when its title is deleted, because the references are nulled rather than
cascaded, so history survives deletion; the check forbids two targets, not zero.

## ADR-007: Summary columns on the library item, kept by database triggers

**Status:** accepted (recorded 2026-10-27, describing the shipped design).

### Context

The library list sorts and filters thousands of titles and needs, for each,
the episode and downloaded-episode counts, season count, total file size, time
of the last grab, and the display title and year after overrides. Computing
these per request from episodes, files and download history made the list
slow, and every write path (grab, completion, rescan, delete, metadata sync,
manual edits) would otherwise have to remember to refresh them.

### Decision

These values are stored as columns on the library item and maintained by
Postgres triggers on the tables they summarise, not by application code. Counts
are null rather than zero for items with no episodes. The library status itself
is not a trigger product: it is written by the application at grab, outcome and
catalog-refresh time. Book editions follow the same pattern for totals, last
grab and the cached author line.

### Consequences

Lists and sorts are index-friendly and stay correct whatever code path changes
the underlying rows, including scripts and manual SQL. The logic lives in
migrations, so changing a rule means a new migration that redefines the
function, and tests that mock the database cannot see it. Bulk writes pay a
per-row trigger cost. Anyone adding a new way to change episodes, files or
history must not also update these columns by hand.

## ADR-008: One request per title, reopened rather than recorded again

**Status:** accepted (recorded 2026-10-27, describing the shipped design).

### Context

Rawkoon is a single shared household library. Two members asking for the same
title would each expect to be told when it arrives, but a second request would
add nothing for the administrator to decide, and a title removed and asked for
again should not leave a trail of stale rows.

### Decision

A title has at most one request, unique on the catalog identity for movies and
shows and on the volume for books. A new ask for a title that is not in the
library, whose request is not pending, reopens the existing request: it goes
back to pending under the new requester with its decision, reason and creation
time reset, and administrators are notified again. A pending request refuses a
second ask. A title in the library cannot be requested. When an administrator
reopens a movie or show request and a default quality profile is set, it is
approved on the spot; otherwise it stays pending and administrators are
notified. Book requests never approve themselves.

### Consequences

There is no request history: the previous requester, decision and reason are
overwritten, and only the current asker is notified when the title becomes
available. The list of requests stays one row per title and the uniqueness rule
closes duplicate-request races. If per-user histories or multiple concurrent
requesters are ever wanted, this needs a second table and a data migration.

## ADR-009: Library status is acquisition-only; airing is a derived field

**Status:** accepted (2026-10-27).

### Context

`LibraryMedia.status` held two state machines. Acquisition (`wanted`,
`downloading`, `downloaded`, `upgrading`, `skipped`) and, for a show that had
finished acquiring, its airing state (`returning`, `in_production`,
`planned`), copied from the separately stored `tmdbStatus`. Every check for
`"downloaded"` therefore silently excluded airing shows, and a few call sites
had to list all four values. The TMDB refresh also had to rewrite the status to
keep the copy current.

### Decision

The stored status is acquisition-only: a finished show is `downloaded`, and
whether it is airing is read from `tmdbStatus` through one module,
`utils/medias/libraryAiring.ts`. A migration rewrites the three airing values
to `downloaded`, filling a missing `tmdb_status` with the raw value the old
status stood for so the change can be reversed from `tmdb_status`.

The API contract changes, with no compatibility layer. A library item's
`status` is the stored acquisition status everywhere it is emitted, and the
airing label is a separate `airing_state` field (`returning`, `in_production`,
`planned`, `ended`, or null for a movie or an unrecognised TMDB status). It sits
beside `status` on library items, the request status `library` object, quick
search results and library stats rows, and as `library_airing_state` beside the
TMDB search `library_status` badge. The library list `status` filter takes
acquisition values only, `sort_by=status` orders on the stored column, and a
separate `airing` query parameter filters shows by airing state. The web app and
the iOS app are updated together to render the airing label for a downloaded
show from `airing_state`; a build that predates this change shows such a show
as plain "Downloaded".

Internal reads that compared to `"downloaded"` alone first kept that meaning by
excluding airing shows explicitly. Those exclusions were later removed: an
airing show that is downloaded is counted, listed and checked like any other
downloaded show.

### Consequences

New code can ask "is it acquired" and "is it airing" separately, and the API no
longer folds two concepts into one string for clients. A show request no longer
depends on the airing state: it becomes Available when every episode that has
already aired is downloaded (specials, episodes without an air date and
unmonitored episodes are ignored), and the rule is re-checked whenever episodes
are imported or the TMDB refresh updates air dates.
