# Roadmap: Rawkoon iOS — clean-code pass

## Overview

Seven phases pay down the debt in `apps/ios/docs/code-quality-audit.md` without
changing a single pixel or a single behavior. The order is not preference: the
guardrails (lint, logging) land first so the tooling — not review — holds the
boundaries the later refactors create; `@Observable` lands before Swift 6
because the strict-concurrency question "should `AudiobookPlayer` be
`@MainActor`" must not be entangled with the observation migration; Swift 6
lands before the view-model extraction so the compiler is checking actor
isolation *while* view state moves; and the `APIClient` domain split lands in
the phase immediately before the view models, because the narrow per-view-model
protocols are only obvious once the domains are separated. The milestone ends
with localization, accessibility, and the test suite closing over everything
the earlier phases built.

The finish line is not "the code is nicer." It is: v1.12.6's behavior still
ships, from a repo where the next bug leaves a log line and the next feature
lands in a tested view model.

## Deviation from the proposed grouping

`REQUIREMENTS.md` proposed six phases. This roadmap uses seven, with exactly
one re-cut and one added requirement. Both are stated here so the change is
reviewable:

**Re-cut — TEST-01/TEST-02 moved out of the last phase into a new Phase 5,
alongside API-01/API-02.** VM-03 requires the two new view models to be unit
tested. Those view models live in the app target, so their tests need an
app-target test bundle — which is exactly TEST-01/TEST-02. Under the six-phase
grouping, Phase 5 would have written tests with nowhere to run them and Phase 6
would have retro-fitted a home for them. Splitting the *harness* (TEST-01,
TEST-02) from the *coverage* (TEST-03) and landing the harness with the
`APIClient` split gives the view-model phase a working test target on day one.
It also keeps the milestone's single largest, judgment-heaviest diff (two files
totalling 2,670 lines) unmixed with a mechanical file move and CI plumbing —
which is the same argument that made this a debt-only milestone in the first
place. The research constraint "the `APIClient` split must immediately precede
the view-model work" still holds: Phase 5 is the phase immediately before
Phase 6, and nothing intervenes.

**Added — CONC-07 (`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` on the app
target), pulled from v2 into Phase 4.** `PITFALLS.md` §1 argues this belongs
*inside* the strict-concurrency migration, not after it: with SE-0466 default
isolation on, most of the hand-rolled `onMain`/`Task { @MainActor in }` hops the
audit complains about become redundant, so doing it afterward means auditing
every isolation annotation a second time. The same section is emphatic that it
must go on the `Rawkoon` app target **only** — never on `RawkoonKit`, whose
whole value is being callable from any isolation domain and testable on Linux
with no `MainActor` runtime. V2-06 is retired from the v2 list; CONC-07 replaces
it. `REQUIREMENTS.md` has been updated for both changes.

## Verification reality (applies to every phase)

Linux CI (`kit` job) builds and tests **`RawkoonKit` only**. A green Linux run
proves nothing about the app. Anything touching the app target is verified on
the `macbuild` ssh host:

```bash
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; cd ~/rawkoon \
  && git fetch -q origin && git checkout -q -B <branch> origin/<branch> \
  && git log --oneline -1 \
  && cd apps/ios && swift test 2>&1 | grep -E "Executed [0-9]+ tests, with|error:" \
  && xcodegen generate >/dev/null && xcodebuild build \
       -project Rawkoon.xcodeproj -scheme Rawkoon \
       -destination "generic/platform=iOS Simulator" \
       CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|BUILD"'
```

**Always print and check the HEAD sha** — a stale clone has twice reported
`BUILD SUCCEEDED` for the wrong commit. Haptics, gesture feel, and remote-control
behavior cannot be judged in the Simulator at all; where a phase's criteria say
"on device," they mean a real iPhone running a TestFlight build, not `macbuild`.

**Definition of done, every phase, in addition to that phase's own criteria:**

1. `swift test` green on Linux CI (`kit` job).
2. `xcodebuild build` green on `macbuild` at the verified HEAD sha.
3. `xcodebuild archive` + `-exportArchive` + TestFlight upload succeed (the
   `testflight` job on a `main` push, or the same three steps run by hand).
4. No user-visible change: same screens, same wording, same layout, same
   timing. A refactor the user can feel is a failed refactor.

**UI hint:** none. No phase in this milestone is a UI phase — `PROJECT.md` puts
*any* visual change out of scope, so `/gsd-ui-phase` does not apply to any phase
here, including the view-model and accessibility phases.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Lint, format, and logging guardrails** - CI rejects style and size regressions, and the download and playback paths say why they failed
- [ ] **Phase 2: Shared formatters and network discipline** - One implementation of each formatter, in RawkoonKit under test; every download authenticated through APIClient
- [ ] **Phase 3: Observation** - `@Observable` replaces `ObservableObject`, the Combine relay in `bindPlayer()` disappears, and views stop re-rendering on every position tick
- [ ] **Phase 4: Swift 6 strict concurrency** - Both modules on Swift 6 language mode with the app target defaulting to MainActor, and every remote command, interruption, and seek still runs when it ran before
- [ ] **Phase 5: Seams — APIClient split and an app-target test bundle** - The two things the view-model extraction needs, landed before it starts
- [ ] **Phase 6: View models** - `MediaDetailView` and `BookView` reduced to rendering, with `@Observable` view models tested without a renderer
- [ ] **Phase 7: Localization, accessibility, and the coverage gate** - Every string from a catalog with Québécois French, every icon-only control labelled, and the suite gating the TestFlight upload

## Phase Details

### Phase 1: Lint, format, and logging guardrails

**Goal**: The repo holds the code's boundaries instead of review doing it — a CI job rejects style and size regressions, and when a download or a chapter fails there is a log line saying so.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: LINT-01, LINT-02, LINT-03, LINT-04, LOG-01, LOG-02, LOG-03, LOG-04
**Opens with**: `SUMMARY.md` open question 1 — decide whether `--strict` gates the `lint` job from day one or only after the warning count is driven down. This is a real fork: SwiftLint's default *error* thresholds are `file_length: 1000` / `type_body_length: 350`, and `MediaDetailView` is already 1,443 lines and `BookView` 1,227, so a default config fails CI before any refactor has touched them.
**Success Criteria** (what must be TRUE):

  1. A `lint` job exists in `.github/workflows/ios.yml`, runs `swiftformat --lint` and `swiftlint lint` over `Rawkoon`, `Sources`, and `Tests`, is ordered before the expensive macOS `build` job (`build` gains `needs:` on it), and passes green on a real Actions run against `main` with no Swift source changed other than SwiftFormat's own output.
  2. `.swiftlint.yml` sets `file_length`, `type_body_length`, and `function_body_length` with a `warning:` key and **no** `error:` key; the `file_length` warning is a number between 1443 and 1600 inclusive (above today's worst file, so it can only ratchet down); `swiftlint lint --config apps/ios/.swiftlint.yml Rawkoon` on `macbuild` prints zero `error:`-severity violations; and reading `.swiftlint.yml` top to bottom, every entry under `disabled_rules` has a reason next to it — there is no bare list.
  3. `Logger(subsystem: "cloud.samlo.rawkoon", category:)` exists with the five categories playback, download, network, auth, and sync. `grep -rn 'try?' apps/ios/Rawkoon` over `AudiobookPlayer.swift` and the download path returns no line that is both unlogged and uncommented (today: 56 `try?` across the target, none logged).
  4. The log is worth reading in the field: on the `macbuild` simulator, force a chapter download against a URL that 404s, run `xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"'`, and the failure appears with its book/chapter identifier and status code **readable, not `<private>`** — while no line anywhere in the diff interpolates a bearer token, a password, or a credentialed server URL.
  5. `apps/ios/docs/` gains a page with the exact commands to pull logs off a device (sysdiagnose, `log collect --device-udid`) and off the simulator (`simctl spawn booted log show/stream`), and the phase's TestFlight build plays a downloaded chapter, pauses, and resumes exactly as v1.12.6 does — converting `try?` to `do/catch` in the playback path is the behavior risk in this phase.

**Plans**: 3 plans

Plans:
**Wave 1**

- [ ] 01-01-PLAN.md — SwiftLint/SwiftFormat configs with macbuild-measured size thresholds, a `lint` job on `ubuntu-latest`, `build` gated on it, and one SwiftFormat pass over the tree

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — the five-category `Log` surface and the download-failure line, proven readable end to end via `simctl launch`

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03-PLAN.md — the eight remaining `try?` dispositions, the log-retrieval docs page, and the TestFlight/device parity gate

### Phase 2: Shared formatters and network discipline

**Goal**: Formatting and networking each have exactly one implementation — the byte/duration/speed formatters live in `RawkoonKit` under test, and every download carries the auth header through the cookie-less `APIClient` session.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: KIT-01, KIT-02, KIT-03, NET-01, NET-02, NET-03
**Opens with**: A parity capture, before any deletion — record the exact rendered output of all eight private formatter copies over a fixed input set (0, negative, `.nan`, `.infinity`, 999/1000/1024 bytes, 59/60/3599/3600 s), because KIT-03 is only checkable against a baseline taken first.
**Success Criteria** (what must be TRUE):

  1. `grep -rn 'private func format\(Bytes\|Duration\|Speed\)' apps/ios/Rawkoon` returns zero hits (today: eight, across `MediaDetailView`, `BookView`, `ActivityView`, `DownloadClientView`, `ContinueListeningView`). The three functions exist once in `Sources/RawkoonKit`, and `swift test` passes on Linux CI with new cases covering zero, negative, non-finite, and each unit boundary.
  2. Output parity is documented, not assumed: the phase's verification notes carry a row per deleted call site giving the old and new rendered string for the captured input set, and every row is either identical or flagged as a deliberate change with a reason. Screenshots of `ActivityView`, `MediaDetailView`, and `DownloadClientView` on the `macbuild` simulator show the same strings as the Phase 1 build.
  3. `grep -rn 'URLSession.shared' apps/ios/Rawkoon/Views` returns zero hits (today: three — `ContinueListeningView:329`, `BookView:1047`, `DebugScreens:407`). All three downloads go through `APIClient`, reuse its existing ephemeral cookie-less session, and send the bearer header.
  4. Failures are typed: with the app pointed at a server that 401s the cover/file download, the error surfaces as an `APIError` — visible as a `network`-category log line from Phase 1 naming the status — and not as a raw `URLError`. A cover image and a book file both still download successfully against a healthy server on the `macbuild` simulator.

**Plans**: TBD

### Phase 3: Observation

**Goal**: SwiftUI tracks reads per property — the three `ObservableObject`s become `@Observable`, `AppModel`'s Combine relay over the player is deleted rather than translated, and a view that reads one player property stops re-rendering on every position tick.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04
**Opens with**: The `@ObservationIgnored` classification pass described in `ARCHITECTURE.md` §1 — under `@Observable` *every* stored property is tracked by default, and the trap is `AppModel.manifests`: it is `private` and looks dead to SwiftUI, but `activeBook()` reads it and `MiniPlayerView.body` calls that on every tab, so it must stay tracked. Roughly 15 other private fields genuinely can be ignored. Grep for body-reachable reads before marking anything.
**Success Criteria** (what must be TRUE):

  1. `grep -rn 'ObservableObject\|@Published\|@StateObject\|@EnvironmentObject\|\.environmentObject(' apps/ios/Rawkoon` returns zero hits (today: 3 / 22 / 2 / 28 / 11), and `xcodebuild build` on `macbuild` emits zero observation-related warnings.
  2. The Combine relay is gone, not translated: `grep -n 'objectWillChange\|cancellables' apps/ios/Rawkoon/AppModel.swift` returns zero. It is replaced by explicit push callbacks from `AudiobookPlayer` (not `withObservationTracking`, which is one-shot and render-adjacent — wrong for model-to-model wiring).
  3. Progress persistence fires on the same transitions at the same cadence: playing a chapter for 60 s on the `macbuild` simulator and then pausing produces the same number of `sync`-category persistence log lines, in the same order, as the same 60 s run against the Phase 2 build — and exactly one forced write on pause.
  4. Per-property tracking is real and measurable: with `Self._printChanges()` (or a body-evaluation counter) on `MiniPlayerView`, a 60-second playback re-evaluates the mini player only when a field it actually reads changes, not on all ~120 position ticks. The count is recorded before and after.
  5. Shippable and unchanged: the TestFlight build of this phase passes a device pass covering cold launch into a book (the mini player appears with its title — the concrete regression that untracking `manifests` produces), play/pause, chapter advance, scrubbing, the sleep timer, and the ebook reader chrome, with no difference from v1.12.6.

**Plans**: TBD

### Phase 4: Swift 6 strict concurrency

**Goal**: The compiler, not convention, proves the player's isolation — `RawkoonKit` and the app target both build under Swift 6 language mode with the app target defaulting to `MainActor`, and every remote command, interruption, and seek still runs at the moment it ran before.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: CONC-01, CONC-02, CONC-03, CONC-04, CONC-05, CONC-06, CONC-07
**Opens with**: Two of `SUMMARY.md`'s open questions, both before a line of code changes. (a) Question 2 — `grep -r "Sendable" $(xcrun --sdk iphoneos --show-sdk-path)/System/Library/Frameworks/{AVFoundation,MediaPlayer}.framework` on the `macbuild` host, to settle whether the iOS 26 SDK marks any of these types `Sendable`; the whole per-construct fix table assumes it does not. (b) Question 4 — spot-check Apple's own strict-concurrency migration page, which no researcher could render (the working route on this box is `developer.apple.com/tutorials/data/...json`); both the architecture and pitfalls findings that lean on it are corroborated only from secondary sources.
**Risk note**: This is the phase that can ship a regression. v1.12.4, v1.12.5, and v1.12.6 were three consecutive releases fixing bugs in `AudiobookPlayer.swift`, and each review round found a bug introduced by the previous round's fix. `PITFALLS.md` §3 documents two concrete ways a well-intentioned strict-concurrency fix silently reorders playback work — the interruption handler (racing `.began`/`.ended` exactly like the bug v1.12.6 shipped to fix) and the `onMain` play/pause helper (a double-tap toggle race where two presses cancel instead of alternating). CONC-05 exists because of those two.
**Success Criteria** (what must be TRUE):

  1. Both modules are on Swift 6 with zero warnings, and default isolation is scoped correctly: `Package.swift` no longer pins `.swiftLanguageMode(.v5)` on either target and `swift test` passes on Linux CI with zero warnings; `project.yml` sets `SWIFT_VERSION: "6.0"` and `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor` under the **`Rawkoon` target only** — `grep -n 'DEFAULT_ACTOR_ISOLATION' apps/ios/Package.swift` returns nothing — and `xcodebuild build` on `macbuild` emits zero warnings.
  2. Isolation is proved where the SDK guarantees it and hopped where it does not: in `AudiobookPlayer.swift`, `assumeIsolated` appears only at the `queue: .main` NotificationCenter observers, the periodic time observer, and the `Thread.isMainThread` branch of `onMain`; the `currentItem` KVO, the item-status KVO, and the `MPRemoteCommandCenter` handlers hop for real; the item-status observer reads `item.status` synchronously before crossing the boundary rather than carrying the `AVPlayerItem`. Every `@unchecked Sendable` and `nonisolated(unsafe)` in the diff has a comment naming the synchronization that makes the promise true — and none appears on `isPlaying`, `positionSecs`, `isSeeking`, `seekID`, `pausedAt`, or `wasPlayingBeforeInterruption`.
  3. No hop was added to a latency-critical path — the CONC-05 gate: `grep -c 'Task {' apps/ios/Rawkoon/AudiobookPlayer.swift` still returns **1** (today it is 1, at line 885 in `loadArtwork`, which is already fire-and-forget), or the diff names each addition and shows why no synchronous alternative exists. The phase's verification notes list every remote-command, interruption, and seek path with a yes/no on "did this gain a hop."
  4. The regression the last three releases kept shipping does not come back — **on a real device**, against a TestFlight build of this phase: (a) start a chapter, trigger an Apple Maps spoken direction, and playback ducks and resumes on its own; (b) double-press a headset or steering-wheel toggle rapidly five times and playback alternates play/pause five times, never no-opping; (c) let a chapter run to its end and the next one auto-advances; (d) scrub and the position lands where it was dropped. All four pass. The Simulator cannot judge (a) or (b).
  5. The extracted logic is untouched and still green: `swift test` on Linux runs the `InterruptionPolicy` and `SmartRewind` suites with no test file edited in this phase's diff, and all 72 tests pass.

**Plans**: TBD

### Phase 5: Seams — APIClient split and an app-target test bundle

**Goal**: The two things the view-model extraction needs exist before it starts — a per-domain `APIClient` whose narrow protocol boundaries are self-evident, and a simulator test bundle CI runs on every push.
**Mode:** mvp
**Depends on**: Phase 4
**Opens with**: `SUMMARY.md` open question 5 — `.xctestplan` authoring is GUI-driven, so generate the file with Xcode on `macbuild` and commit the result, rather than hand-typing JSON. Also budget the access-control step up front: the ~8 shared request helpers in `APIClient.swift` are `private`, and Swift's `private` does not cross files even for extensions of the same type, so all of them widen to internal the moment the first endpoint moves.
**Requirements**: API-01, API-02, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):

  1. `wc -l apps/ios/Rawkoon/APIClient.swift` is under 400 (today: 982) and the file holds only the stored properties, `init`, the two `ISO8601DateFormatter`s, and the shared request helpers; `APIClient+Library.swift`, `+Books.swift`, `+Downloads.swift`, `+Discovery.swift`, and `+Admin.swift` exist alongside it.
  2. The split is a move and provably nothing else: the sorted list of `func` signatures extracted from `APIClient.swift` at the previous commit is byte-identical to the sorted union of signatures across the new files, and the diff contains no change to any URL, HTTP method, query construction, or request body — only relocations and `private` → internal widenings.
  3. CI runs `xcodebuild test`: a `RawkoonTests` target (`Host Application: None`, with a target dependency on `Rawkoon`) and a committed `Rawkoon.xctestplan` exist, wired through `project.yml`; a `test` job in `ios.yml` resolves its simulator at runtime from `xcrun simctl list devices available` — `grep -nE 'iPhone [0-9]|OS=[0-9]' .github/workflows/ios.yml` returns nothing — and exits 0 on a real Actions run.
  4. The harness is proved, not just present: at least one test in the bundle does `@testable import Rawkoon`, constructs an app-target type, and asserts on it; deliberately inverting that assertion turns the `test` job red, and reverting it turns it green again.
  5. Shippable and unchanged: `xcodebuild archive` succeeds on `macbuild`, the test bundle is not embedded in the shipped app, and the TestFlight build behaves identically to Phase 4's on library browse, search, a grab, and the admin screens — the endpoints that moved.

**Plans**: TBD

### Phase 6: View models

**Goal**: The two largest screens render and nothing else — their network calls, error handling, retry logic, and derived state live in `@Observable` view models that can be tested without a renderer.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: VM-01, VM-02, VM-03, VM-04
**Opens with**: `SUMMARY.md` open question 3 — a state-classification pass over `BookView` (1,227 lines, 23 `@State` declarations), which no researcher has read. `MediaDetailView`'s classification already exists in `ARCHITECTURE.md` §2 (26 of 34 properties to the model; 8 sheet/disclosure/navigation triggers stay in the view, with `activeTab` staying `@State` while its "is it already loaded" guard moves into the model). Do not assume that table transfers to `BookView`; produce its own before planning that half.
**Success Criteria** (what must be TRUE):

  1. Both files are under 800 lines (today: `MediaDetailView` 1,443, `BookView` 1,227), and `.swiftlint.yml`'s `file_length` warning is lowered from the Phase 1 value to the larger of the two new counts rounded up to the next 50 — with the `lint` job still green afterward.
  2. Neither view talks to the network: `grep -n 'model.api()' apps/ios/Rawkoon/Views/MediaDetailView.swift apps/ios/Rawkoon/Views/BookView.swift` returns zero (today: 14 and 5). `MediaDetailViewModel` and `BookViewModel` are `@Observable`, each depends on a narrow protocol covering only the endpoints it calls (not the concrete `APIClient`, and not one 70-method `APIClientProtocol`), and `APIClient` conforms via a one-line extension per protocol.
  3. Both view models are tested without a renderer: the `RawkoonTests` bundle covers the loading, empty, error, and success path of each fetch on each view model against a plain non-actor fake, `xcodebuild test` on `macbuild` exits 0, and the reported test count is at least 16 higher than at the end of Phase 5.
  4. State that stayed in the view actually stayed: sheets, disclosure triangles, and navigation triggers are still `@State` in the view files, and `activeTab`'s `.onChange` still calls into the view model rather than the view deciding whether to fetch.
  5. Behavior parity, screen by screen: a TestFlight build of this phase walked through the full `MediaDetailView` flow (details, similar titles, episodes by season, request, watchlist toggle, monitored change, quality-profile change, rescan, clear-failed-downloads, remove) and the full `BookView` flow (metadata, chapter list, download, read, cover) shows the same screens, the same error text, and the same wording as the Phase 5 build. Anything different is a bug introduced here.

**Plans**: TBD

### Phase 7: Localization, accessibility, and the coverage gate

**Goal**: Every user-facing string comes from a catalog that has a real Québécois French translation, every icon-only control announces itself to VoiceOver, and the app-target suite covers what this milestone built and blocks a bad upload.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: I18N-01, I18N-02, I18N-03, I18N-04, A11Y-01, A11Y-02, A11Y-03, TEST-03
**Opens with**: An audit of the silent-failure sites `STACK.md` §2 names — a literal interpolated into a `let` before it reaches `Text` infers `String`, not `LocalizedStringKey`, so it compiles, looks correct in English, never extracts into the catalog, and is never translated, with no warning. Enumerate every `Text(someVariable)` / `Button(someVariable)` site first; the check is not "count catalog entries against 106."
**Success Criteria** (what must be TRUE):

  1. The catalog is the source: `Rawkoon/Localizable.xcstrings` exists and is picked up by the target; after `xcodegen generate` on `macbuild`, the generated project's `knownRegions` contains `fr` with no `project.yml` edit; and the enumerated list of user-facing literals — `Text`, `Button`, alert titles and messages, `navigationTitle`, and accessibility labels (today: 106 `Text("` sites alone) — has zero entries left outside the catalog.
  2. `fr` is complete and human: a `jq` pass over `Localizable.xcstrings` shows every key has an `fr` localization in state `translated` — no missing keys, no `needs_review` — and the French reads as Québécois French to a francophone reader, not machine-default France French. Interpolated and pluralized strings use the catalog's plural rules; `grep -rn 'String(format:' apps/ios/Rawkoon` shows no user-facing string still assembled by concatenation.
  3. English did not change: running the app in `en` on the `macbuild` simulator and comparing screenshots of every screen against the Phase 6 build shows no text difference anywhere. This phase changes the mechanism, not the copy.
  4. Every icon-only control announces itself, and the announcement makes sense: with VoiceOver on **a real device**, swiping through the player (play/pause, skip forward/back, speed, sleep timer, AirPlay, close) and the library reads a distinct label for every control, the scrubber and the download progress bars expose a value and are adjustable with the VoiceOver rotor, and the read-out is sensible rather than merely present. `grep -rc accessibilityLabel` rises from today's 17 to cover every icon-only button in the target.
  5. The suite covers the milestone and gates the upload: `xcodebuild test` includes cases for the Phase 6 view models, the Phase 1 logger surface, and the Phase 2 shared formatters as consumed by the app; the `testflight` job declares `needs:` on the `test` job, so a red test blocks the TestFlight upload rather than shipping past it. Deliberately breaking one test and pushing to a branch shows the `test` job red.

**Plans**: TBD

## Requirement Coverage

| Phase | Requirements | Count |
|-------|--------------|-------|
| 1 - Lint, format, and logging guardrails | LINT-01, LINT-02, LINT-03, LINT-04, LOG-01, LOG-02, LOG-03, LOG-04 | 8 |
| 2 - Shared formatters and network discipline | KIT-01, KIT-02, KIT-03, NET-01, NET-02, NET-03 | 6 |
| 3 - Observation | OBS-01, OBS-02, OBS-03, OBS-04 | 4 |
| 4 - Swift 6 strict concurrency | CONC-01, CONC-02, CONC-03, CONC-04, CONC-05, CONC-06, CONC-07 | 7 |
| 5 - Seams | API-01, API-02, TEST-01, TEST-02 | 4 |
| 6 - View models | VM-01, VM-02, VM-03, VM-04 | 4 |
| 7 - Localization, accessibility, coverage gate | I18N-01, I18N-02, I18N-03, I18N-04, A11Y-01, A11Y-02, A11Y-03, TEST-03 | 8 |

**Total: 41/41 mapped. No requirement appears in two phases. No orphans.**
(40 from the original v1 set, plus CONC-07 pulled in from v2 per the deviation
note above.)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Lint, format, and logging guardrails | 0/3 | Planned | - |
| 2. Shared formatters and network discipline | 0/TBD | Not started | - |
| 3. Observation | 0/TBD | Not started | - |
| 4. Swift 6 strict concurrency | 0/TBD | Not started | - |
| 5. Seams — APIClient split and test bundle | 0/TBD | Not started | - |
| 6. View models | 0/TBD | Not started | - |
| 7. Localization, accessibility, coverage gate | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-01*
