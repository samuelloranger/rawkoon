# Research Summary — Rawkoon iOS clean-code pass

**Date:** 2026-09-01
**Dimensions researched:** stack/tooling, architecture, pitfalls. The usual
"features" dimension was skipped deliberately — this milestone adds no features,
and `apps/ios/docs/code-quality-audit.md` already did the domain pass.

Read the full files before planning a phase they touch:

| File | Covers | Phases it serves |
|---|---|---|
| `STACK.md` | SwiftLint/SwiftFormat, String Catalogs, `xcodebuild test`, `os.Logger` | 1, 6 |
| `ARCHITECTURE.md` | `@Observable` migration, view-model extraction, actor file split | 3, 5 |
| `PITFALLS.md` | Swift 6 strict concurrency, construct-by-construct for the player | 4 |

## Findings that change the plan

**Tooling (HIGH confidence — versions verified against release APIs and PR diffs)**

- SwiftLint 0.65.1, SwiftFormat 0.63.0, both `brew install` on the `macos-26`
  runner — matches the existing unpinned `brew install xcodegen`.
- Use CI-only invocation, **not** the SwiftLint SPM build-tool plugin. SwiftLint
  pins a prerelease `swift-syntax`, which defeats Xcode 26's prebuilt-cache and
  forces a from-source recompile on every clean build (realm/SwiftLint#6574, open).
- Default length rules would fail CI immediately: `MediaDetailView` (1,443) and
  `BookView` (1,227) already exceed the default *error* thresholds. Warning-only
  config (`warning: N` with no `error:` key) is verified working.
- XcodeGen ≥2.39.0 auto-registers `.xcstrings` and parses locales out of the
  catalog to populate `knownRegions` — adding `fr` needs no `project.yml` edit.
- The test target needs no host application: `Host Application: None` plus a
  target dependency is enough for `@testable import Rawkoon`, and is faster.
  `generic/platform=iOS Simulator` works for `build` but **not** for `test` — the
  destination must be resolved at runtime from `xcrun simctl list devices available`.
- `os.Logger` redacts every interpolation by default in field-collected logs.
  Explicit `privacy: .public` is required on the fields that matter, or the log
  is worth nothing when a user reports a bug.

**Architecture (HIGH on mechanics, MEDIUM-HIGH on codebase specifics)**

- No `$property` publisher survives `@Observable`. In `AppModel.bindPlayer()`,
  delete the `objectWillChange` relay outright (Observation tracks per-property,
  graph-deep) and convert the `$isPlaying` / `$positionSecs` subscriptions to
  explicit push callbacks from `AudiobookPlayer`. Do **not** reach for
  `withObservationTracking` — it is one-shot and render-adjacent, wrong for
  model-to-model wiring.
- `@ObservationIgnored` trap: `AppModel.manifests` is `private` and looks dead to
  SwiftUI, but `activeBook()` reads it and `MiniPlayerView.body` calls that on
  every tab. It must stay tracked. Roughly 15 other private fields genuinely can
  be ignored.
- 26 of `MediaDetailView`'s 34 `@State` properties belong in the view model;
  8 (sheet, navigation, disclosure triggers) stay in the view.
- Prefer narrow per-view-model protocols over one `APIClientProtocol` across ~70
  methods. An actor conforms to an async protocol with no isolation ceremony, and
  the test fake does not need to be an actor.
- Ordering confirmed against this codebase's coupling, not preference:
  `@Observable` before view-model extraction, and the `APIClient` domain split
  immediately before VM-01.

**Pitfalls (MEDIUM-HIGH; the player-specific fixes are analysis, not quotation)**

- Mark `AudiobookPlayer` `@MainActor` — it becomes implicitly `Sendable` under
  SE-0466's global-actor rule, clearing most `[weak self]` capture warnings at
  once.
- `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` on the **app target only**, never
  on `RawkoonKit` — SE-0466's own motivation names "libraries usable from any
  isolation domain" as the wrong case for it. This moves V2-06 into scope for
  Phase 4 as an app-target setting.
- The fix differs per construct, based on whether the SDK actually guarantees
  main-queue delivery:
  - `queue: .main` NotificationCenter observers, and the periodic time observer
    → `MainActor.assumeIsolated`. Safe, adds no latency.
  - `currentItemObserver` KVO (no queue parameter — the audit's own named bug),
    `itemStatusObserver` KVO, and `MPRemoteCommandCenter` handlers → no guarantee
    exists, so these need a real hop. Never `assumeIsolated` here.
- **The trap that would ship a regression:** rewriting a synchronous `queue: .main`
  callback as `Task { @MainActor in }` "to fix the warning" reorders work.
  `PITFALLS.md` carries before/after code for two cases — the interruption handler
  (races `.began`/`.ended` exactly like the bug v1.12.6 shipped to fix) and the
  `onMain` play/pause helper (a double-tap toggle race where two presses cancel
  instead of alternating). This is the evidence behind CONC-05.
- `itemStatusObserver`'s `DispatchQueue.main.async` closure captures a raw
  `AVPlayerItem` (non-`Sendable`) across a `@Sendable` boundary — a real Swift 6
  diagnostic in this file. Snapshot `item.status` synchronously before crossing;
  do not paper over it with `@unchecked Sendable`.
- Readium 3.11.0 predates Readium's own Swift 6 migration by about a month
  (3.11.0: 2026-07-17, no concurrency work; 4.0.0-alpha.1: 2026-08-14, ships
  Swift 6/Sendable). `@preconcurrency import` is expected to be necessary, scoped
  to `BookView` and the ebook-reader delegate code — not `AudiobookPlayer.swift`.
  Bumping Readium is out of scope per PROJECT.md.

## Open questions the phases must resolve, not the roadmap

1. Whether `--strict` gates the lint CI job from day one or after the warning
   count is driven down. Sequencing decision for Phase 1.
2. Whether the iOS 26 SDK marks any AVFoundation/MediaPlayer type `Sendable` —
   needs a grep over the SDK headers on `macbuild`, not resolvable by search.
   Phase 4 opens with this.
3. `BookView` (1,227 lines) was never read by the architecture researcher. VM-02
   needs its own state-classification pass before that half of Phase 5 is planned.
4. Apple's canonical strict-concurrency migration page is JS-rendered and could
   not be fetched. Both the architecture and pitfalls findings that lean on it are
   corroborated from secondary sources; spot-check the primary before Phase 4
   locks its sequence. The reliable route on this box has been
   `developer.apple.com/tutorials/data/...json`.
5. `.xctestplan` authoring is GUI-driven in Xcode. Phase 6 should generate the
   file with Xcode on `macbuild` rather than hand-typing JSON.
