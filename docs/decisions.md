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