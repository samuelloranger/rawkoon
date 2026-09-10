# iOS clean-code milestone — phase 3 (@Observable + Swift 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the three `ObservableObject`s to `@Observable`, delete the Combine relay, and turn on Swift 6 language mode across both modules — with zero user-visible behavior change and without re-introducing the audiobook interruption race.

**Architecture:** `@Observable` first (mechanical, macbuild-gated), then Swift 6 (compiler-driven, iterative). The `bindPlayer()` Combine relay is replaced by two explicit callback hooks on `AudiobookPlayer` that fire at the exact position-tick and pause-transition sites, so the persist-on-tick / force-persist-on-pause side effects survive the loss of `$property` publishers. Swift 6 lands module-at-a-time: RawkoonKit (pure, clean) first, then the app target under `SWIFT_STRICT_CONCURRENCY = targeted` + `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, fixing the known `AVPlayerItem` Sendable hazard and whatever else the compiler surfaces.

**Tech Stack:** SwiftUI, iOS 18, Swift 6 language mode, `@Observable` (Observation framework), Readium 3.11.0 (`@preconcurrency`), macbuild (Xcode 26.3) as the only real gate.

**Spec:** `docs/superpowers/specs/2026-09-01-ios-clean-code-milestone-design.md`
**Surface map (authoritative line numbers):** `apps/ios/.superpowers/sdd/phase3-surface-map.md`

## Global Constraints

- **No user-visible behavior change.** Re-render scope may narrow (that's the point), but every screen shows the same thing. The two persist side effects (`persistPlaybackProgress(force:false)` on each position tick, `persistPlaybackProgress(force:true)` on play→pause) MUST be preserved exactly.
- **`Task {` in `AudiobookPlayer.swift` stays at exactly 1** (the `artworkTask` at ~line 971). `grep -c 'Task {' apps/ios/Rawkoon/AudiobookPlayer.swift` must return 1 at every commit. Adding a `Task { @MainActor in }` hop to satisfy the compiler is FORBIDDEN — it is how the v1.12.6 interruption race would come back. Use `MainActor.assumeIsolated` where the SDK guarantees main-queue delivery, or let only `Sendable` data cross the boundary.
- **macbuild ssh is the only real gate.** No local Swift. Before every macbuild run: `git fetch -q origin && git checkout -q -B <branch> origin/<branch> && git log --oneline -1`; the printed sha must match the pushed HEAD.
- **No on-device state migration.** The position journal and Keychain entries are untouched.
- **Build settings live in `project.yml`**, never a generated `.xcodeproj`.
- New commits only — never amend/force-push.

## macbuild verify commands (used by every task)

```
# RawkoonKit tests:
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/samuelloranger/rawkoon && git fetch -q origin && git checkout -q -B feat/ios-cleancode-phase-3 origin/feat/ios-cleancode-phase-3 && git log --oneline -1 && cd apps/ios && swift test 2>&1 | tail -20'
# App build:
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/samuelloranger/rawkoon/apps/ios && xcodegen generate >/dev/null 2>&1 && xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon -destination "generic/platform=iOS Simulator" 2>&1 | tail -25'
```

---

## Task 1: `@Observable` for the AppModel ↔ AudiobookPlayer pair

These two migrate together — `AppModel.bindPlayer()` depends on `AudiobookPlayer`'s `$publishers`, so converting one without the other breaks the build. The Combine relay is replaced by two callbacks.

**Files:**
- Modify: `apps/ios/Rawkoon/AudiobookPlayer.swift` (class decl:7; add 2 callback props; fire them; drop `ObservableObject`/`@Published`)
- Modify: `apps/ios/Rawkoon/AppModel.swift` (class decl:30; delete `bindPlayer()` 466-487, `cancellables` 60, `import Combine` 1; wire callbacks in `init()`)
- No unit test (app-target; no test bundle until phase 4). Verify: macbuild build + reasoning.

**Interfaces:**
- Produces on `AudiobookPlayer`: `var onPositionTick: (() -> Void)?` and `var onPlaybackStopped: (() -> Void)?` — fired on every `positionSecs` change and on each `isPlaying` true→false transition respectively.

- [ ] **Step 1: Convert `AudiobookPlayer` to `@Observable`**

Replace `final class AudiobookPlayer: ObservableObject {` (line 7) with:
```swift
@Observable
final class AudiobookPlayer {
```
Delete `@Published` from all eight properties (lines 8-13, 23-24) — they become plain `private(set) var`. `@Observable` tracks them automatically. Add `import Observation` at the top if not already imported (it is part of the standard library; `import Observation` may be required).

- [ ] **Step 2: Add the two callback hooks and fire them at the exact sites**

Add near the other stored properties:
```swift
/// Called on every positionSecs change — AppModel uses it to persist progress
/// (throttled inside persistPlaybackProgress). Replaces the Combine relay's
/// player.$positionSecs sink.
var onPositionTick: (() -> Void)?
/// Called when playback transitions from playing to paused. Replaces the
/// player.$isPlaying.dropFirst().removeDuplicates() sink that force-persisted.
var onPlaybackStopped: (() -> Void)?
```
Fire them via `didSet` on the two properties, preserving the exact Combine semantics (every tick for position; transition-to-false only, deduped, for isPlaying):
```swift
private(set) var positionSecs: Double = 0 {
    didSet { onPositionTick?() }
}
private(set) var isPlaying: Bool = false {
    didSet {
        // Combine sink was .dropFirst().removeDuplicates(), fired on !isPlaying:
        // i.e. only on an actual playing→paused transition.
        if oldValue && !isPlaying { onPlaybackStopped?() }
    }
}
```
(Keep the other six properties as plain `private(set) var`.)

- [ ] **Step 3: Convert `AppModel` to `@Observable`, delete the relay**

Replace `@MainActor final class AppModel: ObservableObject {` (lines 29-30) with `@MainActor @Observable final class AppModel {`. Delete every `@Published` wrapper on its 11 properties (they become plain vars; keep `private(set)` on `isOnline`). Delete `import Combine` (line 1), `private var cancellables = Set<AnyCancellable>()` (line 60), and the whole `bindPlayer()` function (466-487).

- [ ] **Step 4: Wire the callbacks where `bindPlayer()` was called**

In `init()` (where line 93 called `bindPlayer()`), replace that call with:
```swift
player.onPositionTick = { [weak self] in self?.persistPlaybackProgress(force: false) }
player.onPlaybackStopped = { [weak self] in self?.persistPlaybackProgress(force: true) }
```
The old sink #1 (`player.objectWillChange → self.objectWillChange.send()`) has NO replacement and is deleted: under `@Observable`, a view reading `model.player.isPlaying` (etc.) tracks that property directly, so the manual re-broadcast is unnecessary. Verify `player` is stored as a plain `let`/`var` on `AppModel` (not `@ObservedObject`/`@StateObject` — those are view property wrappers and must not appear on a model).

- [ ] **Step 5: Fix any view property-wrapper mismatches**

`@Observable` models are held in views with `@State` (owner) / plain `let` (passed) / `@Bindable` (for bindings), NOT `@StateObject`/`@ObservedObject`/`@EnvironmentObject`. Grep the views for how `AppModel` is held:
```
grep -rn '@StateObject\|@ObservedObject\|@EnvironmentObject\|EnvironmentObject' apps/ios/Rawkoon/Views apps/ios/Rawkoon/RawkoonApp.swift
```
Convert each: `@StateObject var model = AppModel()` → `@State var model = AppModel()`; `@ObservedObject var model` → `var model` (or `@Bindable var model` if it needs `$model.x` bindings); `.environmentObject(model)` → `.environment(model)` and `@EnvironmentObject var model` → `@Environment(AppModel.self) var model`. Apply the same to any view holding `AudiobookPlayer` directly. This is the bulk of the mechanical churn — do it per the compiler's errors.

- [ ] **Step 6: Verify on macbuild**

Run the app-build command. Expected: `** BUILD SUCCEEDED **`, sha matched. Confirm the tripwire: `grep -c 'Task {' apps/ios/Rawkoon/AudiobookPlayer.swift` → `1`.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/Rawkoon/AudiobookPlayer.swift apps/ios/Rawkoon/AppModel.swift apps/ios/Rawkoon/Views apps/ios/Rawkoon/RawkoonApp.swift
git commit -m "refactor(ios): move AppModel + AudiobookPlayer to @Observable, drop the Combine relay"
```

---

## Task 2: `@Observable` for `ReaderChrome`, drop `import Combine`

Small, isolated — `ReaderChrome` is private to `EbookReaderView.swift` with two `@Published` and one consumer.

**Files:**
- Modify: `apps/ios/Rawkoon/Views/EbookReaderView.swift` (class 109-112; `import Combine` line 1; `@StateObject` at line 190)

- [ ] **Step 1: Convert the class**

Replace (lines 108-112):
```swift
@MainActor
private final class ReaderChrome: ObservableObject {
    @Published var currentLocator: Locator?
    @Published var percent: Double?
}
```
with:
```swift
@MainActor
@Observable
private final class ReaderChrome {
    var currentLocator: Locator?
    var percent: Double?
}
```

- [ ] **Step 2: Fix the holder and drop Combine**

Change `@StateObject private var chrome = ReaderChrome()` (line ~190) to `@State private var chrome = ReaderChrome()`. Delete `import Combine` (line 1) — the map confirms it is used for nothing else in this file. The read sites (`chrome.currentLocator` ~226, `chrome.percent` ~303/305) are unchanged.

- [ ] **Step 3: Verify on macbuild**

App-build command → `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/EbookReaderView.swift
git commit -m "refactor(ios): move ReaderChrome to @Observable, drop unused Combine import"
```

---

## Task 3: Swift 6 language mode for RawkoonKit

RawkoonKit is pure, dependency-free, already `Sendable`-clean value types — the low-risk module. Flip it first.

**Files:**
- Modify: `apps/ios/Package.swift` (lines 9 and 13)

- [ ] **Step 1: Flip both targets to Swift 6**

Change `.swiftLanguageMode(.v5)` to `.swiftLanguageMode(.v6)` at Package.swift:9 (RawkoonKit target) and :13 (RawkoonKitTests target).

- [ ] **Step 2: Verify on macbuild**

RawkoonKit-tests command. Expected: `swift test` still green (78 tests: 72 + 6 formatters). If the compiler surfaces a `Sendable`/isolation diagnostic, fix it minimally (these are pure value types + pure functions; expect zero, but if any appears, add the narrowest `Sendable` conformance or isolation the diagnostic asks for — do not broaden).

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Package.swift
git commit -m "build(ios): Swift 6 language mode for RawkoonKit"
```

---

## Task 4: Swift 6 language mode for the app target

The hard, compiler-driven task. Turn on strict concurrency, default the app to `MainActor`, mark Readium `@preconcurrency`, fix the known `AVPlayerItem` Sendable hazard, then iterate against the macbuild compiler until clean — holding the `Task {`==1 tripwire the whole way. **This task may take several fix rounds; the compiler is the oracle.**

**Files:**
- Modify: `apps/ios/project.yml` (line 69 + add two settings)
- Modify: `apps/ios/Rawkoon/Views/EbookReaderView.swift` (lines 3-5, `@preconcurrency`)
- Modify: `apps/ios/Rawkoon/AudiobookPlayer.swift` (the 618-636 Sendable hazard, + whatever else compiles)
- Modify: whatever else the compiler flags (expected: small, localized)

- [ ] **Step 1: Turn on strict concurrency incrementally**

In `project.yml`'s app-target `settings.base` block (where `SWIFT_VERSION: "5.0"` is, line 69):
```yaml
SWIFT_VERSION: "6.0"
SWIFT_STRICT_CONCURRENCY: targeted
SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor
```
`targeted` (not `complete`) first: it checks `Sendable`-annotated types and explicit concurrency, surfacing the real hazards without drowning in false positives. `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor` makes the app default to the main actor (the CONC-07 decision), which matches how this UI app already behaves and removes most manual-hop noise.

- [ ] **Step 2: Mark the Readium imports `@preconcurrency`**

`EbookReaderView.swift` lines 3-5 — prefix each: `@preconcurrency import ReadiumNavigator` / `@preconcurrency import ReadiumShared` / `@preconcurrency import ReadiumStreamer`. Readium 3.11.0 predates its Swift 6 migration, so its types cross the boundary as non-`Sendable`; `@preconcurrency` downgrades those to warnings.

- [ ] **Step 3: Fix the `itemStatusObserver` Sendable hazard (AudiobookPlayer.swift:618-636)**

The KVO closure captures the non-`Sendable` `AVPlayerItem` and carries it across the `DispatchQueue.main.async` boundary. `AVPlayerItem.Status` (the enum) IS `Sendable`; the item itself is not. Restructure so only `Sendable` data crosses, and use `MainActor.assumeIsolated` (NOT a new `Task {`) since KVO for `.status` delivers on the mutating thread and the `.async` already targets main:
```swift
itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
    let status = item.status            // AVPlayerItem.Status is Sendable
    let failedItem: AVPlayerItem? = status == .failed ? item : nil
    DispatchQueue.main.async {
        MainActor.assumeIsolated {
            guard let self, self.seekID == id else { return }
            switch status {
            case .readyToPlay:
                self.itemStatusObserver = nil
                self.seekCurrentItem(to: offset, autoplay: self.isPlaying)
            case .failed:
                if let failedItem { self.logItemFailure(failedItem) }
                self.itemStatusObserver = nil
                if let failedItem, self.recoverFromFailedLocalItem(failedItem) { return }
                self.isSeeking = false
            default:
                break
            }
        }
    }
}
```
(If `logItemFailure`/`recoverFromFailedLocalItem` genuinely need the `AVPlayerItem`, this hands them the same instance via the `Sendable`-guarded `failedItem` captured after the status check — the item reference is only used inside the main-actor body, and `assumeIsolated` is sound because the enclosing dispatch targets main. This keeps `Task {` at 1.) Apply the analogous minimal treatment to the `.AVPlayerItemDidPlayToEndTime` handler (map §3d, ~726) if the compiler flags its `notification.object as? AVPlayerItem` cast.

- [ ] **Step 4: Iterate against the compiler to green**

Run the app-build command. Read every diagnostic. For each:
- **Non-`Sendable` captured by a `@MainActor`-isolated closure that the SDK delivers on main** (the notification `queue: .main` handlers, KVO after the hop): wrap the body in `MainActor.assumeIsolated { }`, never a new `Task`.
- **`MPRemoteCommandCenter` handlers** (§3c, all 9 route through `onMain`): these run on MPRemoteCommandCenter's own queue. Keep `onMain`'s `DispatchQueue.main.async` and add `MainActor.assumeIsolated` inside `onMain`'s dispatched branch so the `self` call is legal — do NOT convert `onMain` to `Task { @MainActor in }`.
- **A genuinely `Sendable` value crossing** (e.g. `finished: Bool` at line 576): usually no change needed; if flagged, the type is already `Sendable` so the fix is isolation, not `Sendable`.
- After each edit, re-run the build. Commit incrementally is fine, but the task's final commit must be green.

Hold the tripwire after every edit: `grep -c 'Task {' apps/ios/Rawkoon/AudiobookPlayer.swift` == 1.

- [ ] **Step 5: Once `targeted` is green, flip to `complete` and re-verify**

Change `SWIFT_STRICT_CONCURRENCY: targeted` → `complete` in `project.yml`, re-run the app build, and fix any remaining diagnostics the same way. If `complete` surfaces a large, non-local cascade that cannot be resolved without behavioral risk, STOP and report — `targeted` + Swift 6 language mode is an acceptable landing point per the spec ("`targeted` first, then flip"), and `complete` can be its own follow-up. Record the decision either way.

- [ ] **Step 6: Final verify on macbuild**

Both commands green: `swift test` (RawkoonKit) and `xcodebuild build`. Tripwire == 1. Push and confirm sha.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/project.yml apps/ios/Rawkoon
git commit -m "build(ios): Swift 6 language mode for the app target, strict concurrency"
```

---

## Self-review

- **Spec coverage:** audit item 5 (@Observable, 3 classes) → Tasks 1-2; item 6 (Swift 6, module-at-a-time `targeted`→fix→`.v6`) → Tasks 3-4. `bindPlayer` deletion + `manifests` note → Task 1. Readium `@preconcurrency` → Task 4 Step 2. The `itemStatusObserver` Sendable hazard → Task 4 Step 3. `Task {`==1 tripwire → global constraint + checked in Tasks 1, 4.
- **Behavior preservation:** the two persist side effects are re-wired as callbacks with the exact Combine semantics (every tick; deduped transition-to-false). Sink #1 (view-invalidation relay) is correctly dropped, not replaced, because `@Observable` makes it unnecessary — argued in Task 1 Step 4.
- **Type consistency:** `onPositionTick` / `onPlaybackStopped` named identically in the interface block, the `didSet` firing sites, and the `init()` wiring. `@State`/`@Bindable`/`@Environment(_.self)` holder conversions are the documented `@Observable` replacements for `@StateObject`/`@ObservedObject`/`@EnvironmentObject`.
- **Honest limits:** Task 4 is compiler-driven and may need multiple fix rounds; the plan says so and names `MainActor.assumeIsolated` (not `Task {`) as the sanctioned fix so the tripwire holds. The `complete` vs `targeted` landing point has an explicit stop-and-decide (Step 5). No app-target unit test exists yet (phase 4 builds it), so verification is macbuild build + the tripwire, stated plainly.
