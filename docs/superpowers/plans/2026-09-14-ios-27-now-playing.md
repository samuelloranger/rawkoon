# iOS 27 Now Playing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rawkoon's MediaPlayer-based local Now Playing publishing with iOS 27 `NowPlaying.MediaSession` while preserving all audiobook transport behavior.

**Architecture:** `AudiobookPlayer` remains the sole playback engine. A focused `RawkoonMediaSession` adapter exposes its observable metadata, elapsed time, state, and commands through `MediaSessionRepresentable`. Remove the MediaPlayer publisher/remote command registration in the same switchover; Apple says mixing it with Now Playing for local playback is undefined behavior.

**Tech Stack:** Xcode 27, Now Playing framework, AVFoundation, Swift Observation, CarPlay.

**Spec:** `docs/superpowers/specs/2026-09-14-ios-27-first-design.md`

## Global Constraints

- Requires the iOS 27 platform plan and minimum iOS **27.0**.
- Local audiobook playback only. Do not add `RemoteMediaSession` or a media-sharing extension for server-held playback.
- Preserve current spoken-audio session category, long-form AirPlay policy, interruption handling, smart rewind, chapter semantics, and progress persistence.
- No `MPNowPlayingInfoCenter` or `MPRemoteCommandCenter` may remain active in the final local-playback path.

---

### Task 1: Capture current system-control behavior

**Files:** Add `apps/ios/docs/now-playing-parity.md`; test pure command mappings in `apps/ios/RawkoonTests/NowPlayingCommandTests.swift` if extracted below.

**Interfaces:** Record current `AudiobookPlayer` behavior for play, pause, toggle, ±30 seconds, next/previous chapter, absolute seek, speed changes at 0.8/1/1.25/1.5/2.0×, artwork, elapsed time, and unload. Use `AudiobookPlayer.swift` lines around `updateNowPlayingInfo` and `configureRemoteCommands` as the baseline.

- [ ] Capture a dated Lock Screen, Control Center, AirPlay, and CarPlay device matrix before changing the integration. Include paused and closed-player states; a closed player must disappear from system Now Playing.
- [ ] Write down each current command's exact target method and the expected result of interruption, route loss, and rapid seek. Commit as `test(ios): capture now-playing parity`.

### Task 2: Add the iOS 27 media-session adapter

**Files:** Create `apps/ios/Rawkoon/NowPlaying/RawkoonMediaSession.swift`; modify `apps/ios/Rawkoon/AudiobookPlayer.swift`; test `apps/ios/RawkoonTests/NowPlayingCommandTests.swift`.

**Interfaces:** The adapter conforms to `MediaSessionRepresentable`, has one stable session ID, and publishes a finite-duration `BookContent` item with title, author, chapter, artwork, elapsed position, playing/paused state, and supported commands. It uses the final SDK's `MediaSession` and `MediaPlaybackSnapshot` types; command closures dispatch to existing `AudiobookPlayer` methods on the main actor. If the Siri plan is already shipped, associate the content with its audiobook AppEntity identifier.

- [ ] Add tests that each command maps to the correct player operation and that a nil manifest/unloaded player publishes no content. Run red before implementation.
- [ ] Implement the adapter using Apple's [publishing media sessions](https://developer.apple.com/documentation/NowPlaying/publishing-media-sessions) pattern and [BookContent](https://developer.apple.com/documentation/nowplaying/bookcontent). Keep artwork loading asynchronous and off the UI thread. Create/retain a single `MediaSession` for the player lifetime.
- [ ] Remove the old `updateNowPlayingInfo`, `configureRemoteCommands`, MediaPlayer artwork object, and command target bookkeeping in the same edit that activates the new session; do not ship an intermediate dual publisher.
- [ ] Run focused tests, all iOS lint gates, and the Xcode 27 simulator build; commit as `feat(ios): publish audiobook MediaSession`.

### Task 3: Prove system and car parity on iOS 27

**Files:** Update `apps/ios/docs/now-playing-parity.md`; change `apps/ios/Rawkoon/CarPlay/CarPlaySceneDelegate.swift` only if a verified incompatibility requires it.

**Interfaces:** The existing CarPlay browse templates stay; the new media session owns system playback state. iOS 27 adds an automatic CarPlay MiniPlayer for apps showing Now Playing.

- [ ] Test all baseline commands from Task 1 from Lock Screen, Control Center, headset, steering wheel, and CarPlay. Verify chapter and elapsed-position metadata after chapter transitions and seeking.
- [ ] Test streamed and downloaded files, backgrounding, incoming calls/Siri/navigation prompts, AirPlay route changes, Bluetooth reconnection, app termination/relaunch, and paused versus closed player state.
- [ ] Confirm there is exactly one active system Now Playing entry and no duplicate handlers; record screenshots or logs and device/OS/build. Fix only parity failures, rerun affected tests, and commit as `docs(ios): verify Now Playing parity`.

**Stop condition:** All previous controls and route behavior pass on a real iOS 27 phone and CarPlay, with one media session and no simultaneous MediaPlayer publisher.
