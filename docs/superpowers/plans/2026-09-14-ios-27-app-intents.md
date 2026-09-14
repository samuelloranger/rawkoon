# iOS 27 Audiobook App Intents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated listener play or resume Rawkoon audiobooks through Shortcuts and iOS 27 Siri, with a controlled path to Spotlight discovery.

**Architecture:** App Intents are a thin adapter over `AppModel.openPlayer(editionId:)` and `AudiobookPlayer.play()`. An audiobook AppEntity uses the stable edition ID; an entity query resolves only books in the signed-in user's library. Do not put credentials or private library payloads into intent parameters or Spotlight records.

**Tech Stack:** Xcode 27, App Intents audio schemas, Media Intents, SwiftUI, RawkoonKit tests and app-target Swift Testing.

**Spec:** `docs/superpowers/specs/2026-09-14-ios-27-first-design.md`

## Global Constraints

- Requires the iOS 27 platform plan and minimum iOS **27.0**.
- Do not expose server tokens, signed media URLs, private title lists, or an admin action as intent output.
- Siri AI support varies by device and language. The app must remain fully usable without Siri AI.
- Spotify-style music, remote-speaker control, book acquisition, and server search are outside this first intent slice.

---

### Task 1: Create a testable authenticated playback action

**Files:** Create `apps/ios/Rawkoon/Intents/AudiobookPlaybackAction.swift`; test `apps/ios/RawkoonTests/AudiobookPlaybackActionTests.swift`; use `apps/ios/Rawkoon/AppModel.swift` without changing its public behavior.

**Interfaces:** `AudiobookPlaybackAction` takes a small injected adapter with `isLoggedIn`, `openPlayer(editionId:) async`, `play()`, and `lastError`. It returns a typed logged-out, not-found, or playback-failed result instead of silently claiming success. Keep the adapter app-local; the server API stays unchanged.

- [ ] Write tests for logged-out, unknown edition, manifest failure, and successful resume/play; verify no playback call occurs on failures.
- [ ] Run those tests red, then implement the adapter using the existing `openPlayer` and player methods. Check the loaded edition before calling `play()`; `openPlayer` currently reports errors through `AppModel.errorMessage` rather than throwing.
- [ ] Run the focused tests and the existing `RawkoonKit` suite, then commit as `feat(ios): add authenticated audiobook action`.

### Task 2: Expose audiobook entities and a basic Shortcuts action

**Files:** Create `apps/ios/Rawkoon/Intents/RawkoonAudiobookEntity.swift`, `apps/ios/Rawkoon/Intents/PlayRawkoonAudiobookIntent.swift`; test `apps/ios/RawkoonTests/AudiobookEntityQueryTests.swift`; update `apps/ios/Rawkoon/Localizable.xcstrings` for visible strings.

**Interfaces:** `RawkoonAudiobookEntity.ID` is the numeric audiobook edition ID represented as a stable string in system-facing data. The query resolves identifiers from `AppModel.library` and returns nothing when signed out; it loads the library when needed. `PlayRawkoonAudiobookIntent` accepts one entity and delegates to `AudiobookPlaybackAction`.

- [ ] Add query tests for exact ID resolution, two editions with the same title, signed-out state, and an item removed from the library.
- [ ] Implement the AppEntity and the basic AppIntent, with a user-visible name and failure text; use the generated Xcode 27 conformance template to satisfy the final SDK types. Test it in Shortcuts with one downloaded and one streamed book.
- [ ] Run l10n, formatting, lint, app-target tests, and a simulator build; commit as `feat(ios): expose audiobook shortcut`.

### Task 3: Adopt iOS 27 audio schemas for natural Siri requests

**Files:** Modify both `apps/ios/Rawkoon/Intents/RawkoonAudiobookEntity.swift` and `apps/ios/Rawkoon/Intents/PlayRawkoonAudiobookIntent.swift`; add `apps/ios/Rawkoon/Intents/ResumeRawkoonAudiobookIntent.swift`; test `apps/ios/RawkoonTests/AudiobookIntentTests.swift`.

**Interfaces:** Conform the entity to `@AppEntity(schema: .audio.audiobook)` and the play action to `@AppIntent(schema: .audio.playAudio)` using the final Xcode 27 SDK's required `AudioStartingIntent` and Media Intents parameter types. A separate no-argument Resume action uses `activeEditionId` if present; otherwise it chooses the most recently in-progress audiobook from the existing library/progress ordering. Both routes call the same action service from Task 1.

- [ ] Use Apple's Xcode-generated schema templates, fill the audiobook title/author metadata already available in `BookListItem`, and map Siri's resolved audio entity to an edition ID. Leave unsupported metadata absent rather than inventing it.
- [ ] Add tests for current-player resume, most-recent in-progress resume, no playable book, and failed authentication. Run Apple's App Intents Testing framework through real system pathways where the final SDK and CI runner support it.
- [ ] Test English Siri prompts such as “play [book] in Rawkoon” and “resume my audiobook in Rawkoon” on a supported iOS 27 iPhone. Verify Shortcuts still works when Siri AI is unavailable. Commit as `feat(ios): support Siri audiobook playback`.

### Task 4: Add controlled Spotlight indexing only if needed for discovery

**Files:** Add `apps/ios/Rawkoon/Intents/AudiobookSpotlightIndex.swift` and a user-controlled setting in `apps/ios/Rawkoon/Views/SettingsView.swift` only if the schema/entity query does not already provide the desired Spotlight result. Update `Localizable.xcstrings` and add `apps/ios/RawkoonTests/AudiobookSpotlightIndexTests.swift`.

**Interfaces:** The setting defaults off. If enabled, index only minimal title/author/edition ID for audiobooks in the signed-in library, and delete the app's indexed records on logout or when the setting is disabled. Never index signed media URLs or tokens.

- [ ] Confirm on an iOS 27 device whether the schema alone makes Rawkoon books discoverable in Spotlight. If it does, record that result and close this task without a second index.
- [ ] If it does not, implement the opt-in local index and tests for enable, library refresh, delete, and logout; then verify a Spotlight result opens the correct book without exposing another household member's library after logout.
- [ ] Commit the verified path as `feat(ios): surface opted-in books in Spotlight`.

**Stop condition:** Shortcuts and Siri play/resume an authorized audiobook on iOS 27; unsupported devices and signed-out users get a clear result; no private library information survives logout in system search.

---

## Task 3 outcome — assistant schema rejected (2026-09-14)

Adopting `@AppIntent(schema: .audio.playAudio)` / `@AppEntity(schema: .books.audiobook)`
was attempted and **rejected** after compiling a probe against the iOS 27 SDK.
The schemas demand a data model Rawkoon does not have:

- `books.audiobook` entity requires `genre`, `purchaseDate`, `seriesTitle`, and
  `url`, and requires `title` to be optional. Rawkoon has none of genre,
  purchase date, or series.
- `audio.playAudio` intent requires `audioEntity`, `playbackAttributes`,
  `queueLocation`, and `warmupAudioQueueResult` — Apple's audio-queue playback
  contract, not Rawkoon's single-book server-manifest + `AVQueuePlayer` flow.
- `.books.playAudiobook` is deprecated at 27.0 in favour of `.audio.playAudio`.

Satisfying either schema means inventing metadata, which this plan forbids
("Leave unsupported metadata absent rather than inventing it"). The shipped
approach — custom `AppIntent`s plus an `AppShortcutsProvider` with spoken
phrases — already meets the stop condition (Siri/Shortcuts play and resume an
authorised audiobook on iOS 27) without faking data. Revisit only if Rawkoon's
model gains real genre/series/URL metadata.
