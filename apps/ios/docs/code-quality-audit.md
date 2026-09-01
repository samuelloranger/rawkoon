# iOS clean-code audit — 2026-09-01

Audit of `apps/ios` against current (2026) iOS/SwiftUI practice. Measured on
commit `602a6e0` (v1.12.6).

## Shape of the code

| | LOC | Files |
|---|---|---|
| `Rawkoon/Views/*` | 9,004 | 22 |
| `Rawkoon/*` (app core) | 4,173 | 10 |
| `Sources/RawkoonKit` (pure logic) | 660 | 11 |
| `Tests/RawkoonKitTests` | 803 | 11 (72 tests) |

Two numbers frame everything below: **68% of the shipped app is view files**, and
**every one of the 72 tests covers RawkoonKit, which is 5% of the Swift in this app.**

## What is good

These are real strengths, not participation trophies.

- **`RawkoonKit` is the right idea.** Pure, dependency-free logic —
  `BookTimeline`, `SyncReconciler`, `DownloadPlan`, `InterruptionPolicy`,
  `SmartRewind` — in an SPM package that builds and tests on Linux CI in
  seconds. This is exactly the "extract the decision, test it without a
  renderer" pattern the 2026 guidance recommends. It is why the interruption
  state machine stopped regressing.
- **`APIClient` is an `actor`.** Network state and the bearer token are
  isolated by the compiler, not by convention. Ephemeral, cookie-less
  `URLSessionConfiguration` with the reason documented inline.
- **No unsafe unwrapping anywhere.** Zero `try!`, zero `as!`, zero force
  unwraps in the whole target. Rare, and worth keeping.
- **Value types are `Sendable`** across the API boundary already, so the Swift 6
  migration below is much smaller than it looks.
- **Keychain done properly** — `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`,
  no iCloud sync of the token, no `UserDefaults` leak.
- **`Theme.swift` is a real token layer** mirroring the web palette, with a font
  fallback path. UI code does not hardcode hexes.
- **Comments explain *why*, at the point of the surprise** (the cookie-less
  session, the XcodeGen `$(MARKETING_VERSION)` wiring, the signing-on-target
  note). Better than most codebases twice this size.
- **Dependencies pinned to an exact version** (`Readium 3.11.0`) with the
  unused products excluded.

## What is wrong

Ranked by cost, not by how easy they are to fix.

### 1. There is no view-model layer at all — HIGH

17 of 22 views call `model.api()` and run their own `Task {}`. `MediaDetailView`
is 1,443 lines with **34 `@State` properties** and 23 `catch` blocks; it fetches
TMDB details, similar titles, episodes, quality profiles, files and download
history, mutates library state, and formats bytes/speed/duration — in the view.
`BookView` is 1,227 lines with the same shape.

Consequences, all of them already visible:

- None of that logic can be tested. The 72 tests cover the 5% of the code that
  was extracted; the request/error/retry logic that actually breaks in the field
  is untestable without a simulator and a server.
- State ownership is unclear — the single most common source of SwiftUI bugs.
- Re-render scope is whole-screen: any of 34 `@State` changes re-evaluates a
  1,400-line body.

2026 consensus (Apple's own `@Observable` guidance, and the MVVM-in-SwiftUI
writeups) is: keep trivial state in the view; the moment there is a network
call, a decision tree, formatting rules or retry logic, it belongs in an
`@Observable` model. Both of these screens are far past that line.

### 2. Swift 6 language mode is not enabled anywhere — HIGH

`project.yml` sets `SWIFT_VERSION: "5.0"`, and `Package.swift` explicitly pins
`.swiftLanguageMode(.v5)` despite `swift-tools-version: 6.0`. The deployment
target is iOS 18, so nothing is holding this back but the work.

This matters here more than in an average app: the audiobook player mixes
`AVAudioSession` notifications, `MPRemoteCommandCenter` handlers on a private
queue, KVO, and `@Published` properties that must be written on the main
thread. The `onMain(_:)` helper and the `Task { @MainActor in }` hops are
hand-maintained versions of what the compiler would check for free. The known
"`currentItem` KVO has no queue, so it can touch `@Published` off main" issue is
exactly what strict concurrency exists to catch.

The migration is small because the value types are already `Sendable` and
`AppModel` is already `@MainActor`. Do it module at a time: `SWIFT_STRICT_CONCURRENCY = targeted`
first, fix `Sendable`, then actor isolation, then flip to `.v6`.

### 3. `@Published` / `ObservableObject` instead of `@Observable` — MEDIUM

Three `ObservableObject`s, 22 `@Published`. On an iOS 18 target this is legacy:
`@Observable` tracks reads per-property, so a view that reads only
`player.isPlaying` stops re-rendering when `positionSecs` ticks every second —
which, in a player app with a mini player on every screen, is a continuous cost.
Mechanical change, real win.

### 4. Zero localization — MEDIUM

106 hardcoded `Text("…")` literals, no `.xcstrings` catalog, no
`String(localized:)`. The web app ships `en` and `fr` and the primary user is
francophone. The native app is English-only with no path to change that short of
touching every view.

### 5. No logging — MEDIUM

No `print`, no `os.Logger`, nothing. There are 56 `try?` expressions that
discard their error. When a user reports "the book will not play", there is no
signal to read — which is precisely how the corrupt-cache bug in 1.12.4 got
diagnosed by deleting the app rather than by reading a log. A single
`Logger(subsystem: "cloud.samlo.rawkoon", category: …)` per domain, with the
`try?` sites in the download/playback path downgraded to `catch { logger.error }`,
would pay for itself on the next bug.

### 6. No linter, no formatter, no lint step in CI — MEDIUM

Neither SwiftLint nor SwiftFormat is configured. Every other workspace in
`~/sites` gates on Biome or ESLint; iOS gates on nothing but "it compiles".
`file_length`, `type_body_length` and `function_body_length` rules alone would
have flagged items 1 and 8 before they got this large.

### 7. CI never runs a test against the app target — MEDIUM

`ios.yml` runs `swift test` (RawkoonKit, on Linux) then `xcodebuild build`. There
is no `xcodebuild test`, no simulator test plan, no UI test. Everything in
`Rawkoon/` — the whole app — is verified only by the compiler and by you
tapping through it on the macbuild simulator.

### 8. Duplicated formatting helpers — LOW

`formatSpeed` in three files, `formatDuration` in three, `formatBytes` in two,
all private, all slightly different. These are pure functions over `Double` —
they belong in `RawkoonKit` with tests, next to `BookTimeline`.

### 9. Networking bypasses `APIClient` in three places — LOW

`URLSession.shared.download` is called directly in `ContinueListeningView`,
`BookView` and `DebugScreens` for cover/file downloads. `URLSession.shared`
carries the shared cookie store that `APIClient` deliberately avoids, and these
calls sidestep the auth header and the error mapping.

### 10. `APIClient` is a 982-line god object — LOW

~70 endpoint methods on one type. Not urgent, but splitting it into
`extension APIClient` files per domain (library, books, downloads, admin,
discovery) costs nothing and makes the file navigable.

### 11. Accessibility is thin — LOW

18 accessibility modifiers across 9,004 lines of view code. Icon-only buttons
(the new player close/AirPlay controls among them) are the ones that most need a
label.

## Recommended order

Cheap and mechanical first, so the expensive one lands on a codebase that
already has guardrails.

| # | Work | Effort |
|---|---|---|
| 1 | SwiftLint + SwiftFormat, configs committed, a `lint` job in `ios.yml` | S |
| 2 | `os.Logger` per domain; convert the `try?` sites in download/playback | S |
| 3 | Move the formatters into `RawkoonKit` with tests; delete the 8 copies | S |
| 4 | Route the three raw `URLSession.shared` downloads through `APIClient` | S |
| 5 | `ObservableObject` → `@Observable` (3 classes) | M |
| 6 | `SWIFT_STRICT_CONCURRENCY = targeted`, fix, then Swift 6 language mode | M |
| 7 | Split `APIClient` into per-domain extensions | M |
| 8 | Extract `MediaDetailViewModel` and `BookViewModel`; add unit tests | L |
| 9 | String catalog + `fr` — worth doing right after 8, while views are open | L |
| 10 | `xcodebuild test` job with a simulator test plan | M |

Items 1–4 are a weekend. Item 8 is the one that changes how the app is
maintained; do it after 1 and 6, so the linter and the compiler both hold the
new boundaries.

## Sources

- [iOS App Architecture in 2026: MVVM-C, SwiftUI & Swift 6](https://www.forasoft.com/blog/article/advanced-ios-app-architecture-explained-on-mvvm-977)
- [Clean Architecture for SwiftUI — Alexey Naumov](https://nalexn.github.io/clean-architecture-swiftui/)
- [MVVM in SwiftUI for a Better Architecture](https://matteomanferdini.com/swiftui-mvvm/)
- [Migrating to Swift Strict Concurrency: a practical guide](https://medium.com/@sampath27/migrating-to-swift-strict-concurrency-a-complete-practical-guide-for-ios-developers-716a9423714d)
- [Swift 6.2 Concurrency in Practice: Default to MainActor](https://blakecrosley.com/blog/swift-6-2-concurrency-in-practice)
- [Modernizing existing iOS projects: adopting SwiftLint and SwiftFormat](https://ahmadbrkt.medium.com/modernizing-existing-ios-projects-a-strategy-for-adopting-swiftlint-and-swiftformat-11030b668310)
- [SwiftFormat](https://github.com/nicklockwood/SwiftFormat)
