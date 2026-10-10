# iOS Motion Kit (PR 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the reusable motion kit in `Rawkoon/Motion/`, wire it into the shared components, fix the broken and ungated animations, and route every haptic through `RawkoonHaptics`. This is PR 1 of the expressive motion pass.

**Architecture:** Each kit piece is a SwiftUI modifier, transition, or button style that reads `accessibilityReduceMotion` itself. Pure math (stagger, hero transform, entrance bookkeeping, haptic mapping) lives in `nonisolated` functions with Swift Testing coverage in `RawkoonTests`. A SwiftLint custom rule keeps future raw `.animation(` / `withAnimation` calls out of view code. A DEBUG-only `motionKit` harness screen exercises every piece for simulator screenshots.

**Tech Stack:** SwiftUI (iOS 26.2 floor), Swift 6 with `SWIFT_STRICT_CONCURRENCY: complete` and `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`, Swift Testing, SwiftLint, SwiftFormat, XcodeGen, the `macbuild` CLI.

**Spec:** `docs/superpowers/specs/2026-10-09-ios-expressive-motion-design.md`. PRs 2–4 get their own plans, written after this PR's API exists.

## Global Constraints

- Deployment floor: iOS 26.2 (`project.yml`). Do not raise it.
- No new third-party dependency.
- No behavior change: same data, same navigation, same actions. Only motion and haptics change.
- No on-device state migration.
- Every motion must be Reduce-Motion safe: movement becomes a crossfade, celebrations become haptic-only, heroes stay static, nothing loops.
- No animation runs longer than about 0.45s. The entrance stagger caps at 8 items. Nothing loops unless its subject is active.
- Animations never delay a tap or a navigation.
- App target code is `@MainActor` by default. Pure helpers called from `visualEffect` or from tests must be `nonisolated`.
- Build settings live in `project.yml`; never edit a generated `.xcodeproj`.
- New user-facing `Text("…")` literals need a `Rawkoon/Localizable.xcstrings` entry (English key plus `fr` translation). Debug-only text uses `Text(verbatim:)`.
- Comments say why, in one line.
- Commits follow Conventional Commits (`feat(ios): …`, `fix(ios): …`). No Co-Authored-By trailer.
- The macbuild run is the only real compile gate. A Linux run builds RawkoonKit only.
- Never merge, tag, bump the version, or cut a release.

## Review Focus

1. **Fast scroll in a lazy grid must never leave a card invisible.** Once the ledger has claimed an id, that view always renders visible, even if its entrance animation was interrupted. Pinned by `EntranceLedger` tests in Task 1 (`isPending` is false after `claim`).
2. **A progress bar at 100% must not overshoot its track.** `DuskProgress` uses a non-bouncy `.smooth` curve, not a spring. Pinned by review of Task 4. A spring overshoot would draw the fill past the groove.
3. **Scrolling down a long grid must not add a growing delay.** Stagger is the position in the current burst of appearances, not the absolute index, so card 200 enters as fast as card 2. Pinned by the burst-reset tests in Task 1.
4. **Hero transform edge cases.** At zero height, at rest, pulled down, and scrolled far past, the transform stays finite and opacity stays in 0.4...1. Pinned by `HeroStretch` tests in Task 1.
5. **Every haptic event maps the same way in both APIs.** `.sensoryFeedback` and the imperative `play(_:)` path must agree, so a toast and a view trigger feel identical. Pinned by the mapping tests in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `Rawkoon/Motion/RawkoonMotion.swift` (modify) | Tokens; add `staggerDelay(position:)`, `progress` token, `withRawkoonMotion` |
| `Rawkoon/Motion/EntranceLedger.swift` (create) | `EntranceLedger` bookkeeping, `.rawkoonEntranceScope()`, `.rawkoonEntrance(id:)` |
| `Rawkoon/Motion/HeroStretch.swift` (create) | `HeroStretch.transform` math, `.rawkoonStretchyHero(height:)` |
| `Rawkoon/Motion/RawkoonTransitions.swift` (create) | `.rawkoonSwap`, `.rawkoonReveal` transitions |
| `Rawkoon/Motion/PressableStyle.swift` (create) | `PressableStyle`, `.rawkoonPressable` |
| `Rawkoon/Motion/RawkoonSymbols.swift` (create) | `.rawkoonNumeric(_:)`, `.rawkoonLivingSymbol(_:)` |
| `Rawkoon/Motion/RawkoonCelebration.swift` (create) | `.rawkoonCelebrate(trigger:ring:haptic:)` |
| `Rawkoon/Motion/ProgressSheen.swift` (create) | Moving sheen used by `DuskProgress` while active |
| `Rawkoon/Motion/RawkoonHaptics.swift` (modify) | New events, imperative mapping, `play(_:)` |
| `Rawkoon/Views/DebugMotionGallery.swift` (create) | DEBUG harness screen `motionKit` |
| `Rawkoon/Views/DebugScreens.swift` (modify) | Register `motionKit` |
| `Rawkoon/Views/Components.swift` (modify) | `DuskProgress`, `StatusBadge`, `SpineRow`, `BookRow`, `DownloadStateIcon` |
| `Rawkoon/Views/Library/BookGridCard.swift` (modify) | Numeric percentage |
| 13 view files (modify) | `.buttonStyle(.plain)` → `.rawkoonPressable` on card and row sites |
| `RawkoonApp.swift`, `Views/TabBar/PhoneTabsView.swift`, `Views/TabBar/RawkoonTabBar.swift`, `Views/TabBar/TabBarChrome.swift`, `Views/MediaDetailView.swift`, `Views/EbookReaderView.swift`, `Views/BookView.swift` (modify) | Gate ungated motion; fix banner and mini-player transitions |
| `AppModel.swift`, `Views/OfflineStrip.swift`, `Views/Discover/SwipeDeck.swift` (modify) | Haptics through `RawkoonHaptics` |
| Every file with `ContentUnavailableView` (modify) | `.rawkoonLivingSymbol(.empty / .error)` |
| `.swiftlint.yml` (modify) | `raw_animation` custom rule |
| `RawkoonTests/RawkoonMotionTests.swift` (create) | Pure-math tests |
| `RawkoonTests/RawkoonHapticsTests.swift` (modify) | Mapping tests |

All paths below are relative to `apps/ios/`. Run every command from `apps/ios/` in the `feat/ios-motion-kit` worktree unless a step says otherwise.

**How to run the app-target tests:** Linux cannot. Use the macbuild CLI from the worktree:

```bash
macbuild sync && macbuild test --only RawkoonTests/RawkoonMotionTests
```

`macbuild` prints the commit it built. Check that it matches `git rev-parse --short HEAD`. `sync` copies uncommitted files too, so a red test can run before its commit.

---

### Task 1: Pure motion math (stagger, entrance ledger, hero transform, imperative motion)

**Files:**
- Modify: `Rawkoon/Motion/RawkoonMotion.swift`
- Create: `Rawkoon/Motion/EntranceLedger.swift` (ledger class only in this task)
- Create: `Rawkoon/Motion/HeroStretch.swift` (math only in this task)
- Test: `RawkoonTests/RawkoonMotionTests.swift`

**Interfaces:**
- Produces:
  - `RawkoonMotion.staggerDelay(position: Int) -> Double` (`nonisolated static`): `min(max(position, 0), 8) * 0.04`.
  - `RawkoonMotion.progress: Animation` = `.smooth(duration: 0.35)`.
  - `withRawkoonMotion<R>(_ animation: Animation, _ body: () throws -> R) rethrows -> R`, a free `@MainActor` function that swaps in `RawkoonMotion.reduced` under Reduce Motion.
  - `final class EntranceLedger` (MainActor) with `func claim(_ id: AnyHashable, now: TimeInterval) -> Int?` (burst position, or `nil` if already entered), `func isPending(_ id: AnyHashable) -> Bool`, and `static let burstGap: TimeInterval = 0.12`.
  - `enum HeroStretch` with `struct Transform: Equatable { scale: CGFloat; offsetY: CGFloat; opacity: Double }` and `nonisolated static func transform(minY: CGFloat, height: CGFloat) -> Transform`.

- [ ] **Step 1: Write the failing tests**

Create `RawkoonTests/RawkoonMotionTests.swift`:

```swift
@testable import Rawkoon
import SwiftUI
import Testing

struct RawkoonMotionTests {
    @Test func staggerGrowsThenClamps() {
        #expect(RawkoonMotion.staggerDelay(position: 0) == 0)
        #expect(RawkoonMotion.staggerDelay(position: 1) == 0.04)
        #expect(RawkoonMotion.staggerDelay(position: 8) == 0.32)
        #expect(RawkoonMotion.staggerDelay(position: 200) == 0.32)
        #expect(RawkoonMotion.staggerDelay(position: -3) == 0)
    }

    @Test func ledgerClaimsOncePerId() {
        let ledger = EntranceLedger()
        #expect(ledger.isPending("a"))
        #expect(ledger.claim("a", now: 0) == 0)
        #expect(!ledger.isPending("a"))
        #expect(ledger.claim("a", now: 0.01) == nil)
    }

    @Test func ledgerStaggersWithinABurst() {
        let ledger = EntranceLedger()
        #expect(ledger.claim("a", now: 10.00) == 0)
        #expect(ledger.claim("b", now: 10.01) == 1)
        #expect(ledger.claim("c", now: 10.02) == 2)
    }

    @Test func ledgerResetsBurstAfterAGap() {
        let ledger = EntranceLedger()
        _ = ledger.claim("a", now: 10.00)
        _ = ledger.claim("b", now: 10.01)
        #expect(ledger.claim("c", now: 10.01 + EntranceLedger.burstGap + 0.01) == 0)
    }

    @Test func ledgerDistinguishesIdTypes() {
        let ledger = EntranceLedger()
        #expect(ledger.claim(AnyHashable(1), now: 0) == 0)
        #expect(ledger.claim(AnyHashable("1"), now: 0) == 1)
    }

    @Test func heroAtRestIsIdentity() {
        let t = HeroStretch.transform(minY: 0, height: 260)
        #expect(t == .init(scale: 1, offsetY: 0, opacity: 1))
    }

    @Test func heroPulledDownStretchesFromBottom() {
        let t = HeroStretch.transform(minY: 130, height: 260)
        #expect(t.scale == 1.5)
        #expect(t.offsetY == 0)
        #expect(t.opacity == 1)
    }

    @Test func heroScrolledUpParallaxesAndFades() {
        let t = HeroStretch.transform(minY: -130, height: 260)
        #expect(t.scale == 1)
        #expect(t.offsetY == 65)
        #expect(abs(t.opacity - 0.7) < 0.0001)
    }

    @Test func heroOpacityFloorsFarPastTheHero() {
        let t = HeroStretch.transform(minY: -5000, height: 260)
        #expect(abs(t.opacity - 0.4) < 0.0001)
    }

    @Test func heroZeroHeightIsIdentity() {
        #expect(HeroStretch.transform(minY: 50, height: 0) == .init(scale: 1, offsetY: 0, opacity: 1))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `macbuild sync && macbuild test --only RawkoonTests/RawkoonMotionTests`
Expected: build fails with `cannot find 'EntranceLedger' in scope` (plus `staggerDelay` and `HeroStretch` errors).

- [ ] **Step 3: Implement**

In `Rawkoon/Motion/RawkoonMotion.swift`, add `import UIKit` under `import SwiftUI`. Inside `enum RawkoonMotion`, after `reduced`, add:

```swift
    /// Progress fills: smooth with no overshoot, so a full bar never pokes past its groove.
    static let progress = Animation.smooth(duration: 0.35)

    /// Entrance delay for the `position`-th item of one appearance burst; capped so long lists stay quick.
    nonisolated static func staggerDelay(position: Int) -> Double {
        Double(min(max(position, 0), 8)) * 0.04
    }
```

After the `enum RawkoonMotion` closing brace, add:

```swift
/// `withAnimation` that degrades to a short crossfade under Reduce Motion. Use it for imperative state changes.
@discardableResult
func withRawkoonMotion<Result>(_ animation: Animation, _ body: () throws -> Result) rethrows -> Result {
    try withAnimation(UIAccessibility.isReduceMotionEnabled ? RawkoonMotion.reduced : animation, body)
}
```

Create `Rawkoon/Motion/EntranceLedger.swift`:

```swift
import SwiftUI

/// Remembers which list items already played their entrance, so a lazy stack
/// re-creating a cell on scroll-back never replays it, and numbers each new
/// item's place in the current burst of appearances for the stagger.
final class EntranceLedger {
    /// Appearances closer together than this belong to one burst.
    static let burstGap: TimeInterval = 0.12

    private var entered: Set<AnyHashable> = []
    private var burstPosition = 0
    private var lastClaim: TimeInterval = -.infinity

    /// The item's position in the current burst the first time `id` appears; nil after that.
    func claim(_ id: AnyHashable, now: TimeInterval) -> Int? {
        guard entered.insert(id).inserted else { return nil }
        burstPosition = now - lastClaim > Self.burstGap ? 0 : burstPosition + 1
        lastClaim = now
        return burstPosition
    }

    func isPending(_ id: AnyHashable) -> Bool {
        !entered.contains(id)
    }
}
```

Create `Rawkoon/Motion/HeroStretch.swift`:

```swift
import SwiftUI

/// Scroll-driven geometry for a detail hero: pull down to stretch, scroll up to parallax and fade.
enum HeroStretch {
    struct Transform: Equatable {
        var scale: CGFloat
        var offsetY: CGFloat
        var opacity: Double
    }

    /// `minY` is the hero's top edge in scroll-view space; positive while overscrolled.
    nonisolated static func transform(minY: CGFloat, height: CGFloat) -> Transform {
        guard height > 0 else { return Transform(scale: 1, offsetY: 0, opacity: 1) }
        if minY > 0 {
            return Transform(scale: 1 + minY / height, offsetY: 0, opacity: 1)
        }
        let progress = min(1, -minY / height)
        return Transform(scale: 1, offsetY: -minY / 2, opacity: 1 - Double(progress) * 0.6)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `macbuild sync && macbuild test --only RawkoonTests/RawkoonMotionTests`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add Rawkoon/Motion/RawkoonMotion.swift Rawkoon/Motion/EntranceLedger.swift Rawkoon/Motion/HeroStretch.swift RawkoonTests/RawkoonMotionTests.swift
git commit -m "feat(ios): add motion kit math for stagger, entrance ledger and hero stretch"
```

---

### Task 2: One haptics source

**Files:**
- Modify: `Rawkoon/Motion/RawkoonHaptics.swift`
- Modify: `Rawkoon/AppModel.swift` (`toast(_:style:action:)`, around line 330)
- Modify: `Rawkoon/Views/OfflineStrip.swift` (`OfflineFeedback.explain`, around line 72)
- Modify: `Rawkoon/Views/Discover/SwipeDeck.swift` (`flingAway`, around line 292)
- Modify: `Rawkoon/Views/BookView.swift` (`announceDownloadFinished`, around line 510)
- Test: `RawkoonTests/RawkoonHapticsTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `RawkoonHaptics.Event` gains `.success`, `.error`, `.warning`, `.deckDismiss`, `.deckCommit`.
  - `RawkoonHaptics.Imperative: Equatable` with cases `notification(UINotificationFeedbackGenerator.FeedbackType)`, `selection`, `impact(UIImpactFeedbackGenerator.FeedbackStyle)`.
  - `nonisolated static func imperative(for: Event) -> Imperative`.
  - `static func play(_ event: Event)` (MainActor).

- [ ] **Step 1: Write the failing tests**

Replace the body of `RawkoonTests/RawkoonHapticsTests.swift` with:

```swift
@testable import Rawkoon
import SwiftUI
import Testing
import UIKit

struct RawkoonHapticsTests {
    @Test func eventsMapToExpectedFeedback() {
        #expect(RawkoonHaptics.feedback(for: .playPause) == .selection)
        #expect(RawkoonHaptics.feedback(for: .chapterSkip) == .impact(weight: .light))
        #expect(RawkoonHaptics.feedback(for: .grab) == .success)
        #expect(RawkoonHaptics.feedback(for: .downloadComplete) == .success)
        #expect(RawkoonHaptics.feedback(for: .libraryChanged) == .success)
        #expect(RawkoonHaptics.feedback(for: .success) == .success)
        #expect(RawkoonHaptics.feedback(for: .error) == .error)
        #expect(RawkoonHaptics.feedback(for: .warning) == .warning)
        #expect(RawkoonHaptics.feedback(for: .deckDismiss) == .impact(flexibility: .rigid))
        #expect(RawkoonHaptics.feedback(for: .deckCommit) == .impact(weight: .medium))
    }

    @Test func imperativeMatchesSensoryFeedback() {
        #expect(RawkoonHaptics.imperative(for: .playPause) == .selection)
        #expect(RawkoonHaptics.imperative(for: .chapterSkip) == .impact(.light))
        #expect(RawkoonHaptics.imperative(for: .grab) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .downloadComplete) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .libraryChanged) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .success) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .error) == .notification(.error))
        #expect(RawkoonHaptics.imperative(for: .warning) == .notification(.warning))
        #expect(RawkoonHaptics.imperative(for: .deckDismiss) == .impact(.rigid))
        #expect(RawkoonHaptics.imperative(for: .deckCommit) == .impact(.medium))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `macbuild sync && macbuild test --only RawkoonTests/RawkoonHapticsTests`
Expected: build fails with `type 'RawkoonHaptics.Event' has no member 'success'`.

- [ ] **Step 3: Implement**

Replace `Rawkoon/Motion/RawkoonHaptics.swift` with:

```swift
import SwiftUI
import UIKit

/// Maps app events to system haptics so feedback is consistent everywhere.
enum RawkoonHaptics {
    enum Event {
        case playPause, chapterSkip, grab, downloadComplete, libraryChanged
        case success, error, warning
        case deckDismiss, deckCommit
    }

    /// The UIKit generator call for code paths with no view to hang `.sensoryFeedback` on.
    enum Imperative: Equatable {
        case notification(UINotificationFeedbackGenerator.FeedbackType)
        case selection
        case impact(UIImpactFeedbackGenerator.FeedbackStyle)
    }

    nonisolated static func feedback(for event: Event) -> SensoryFeedback {
        switch event {
        case .playPause: .selection
        case .chapterSkip: .impact(weight: .light)
        case .grab, .downloadComplete, .libraryChanged, .success: .success
        case .error: .error
        case .warning: .warning
        case .deckDismiss: .impact(flexibility: .rigid)
        case .deckCommit: .impact(weight: .medium)
        }
    }

    nonisolated static func imperative(for event: Event) -> Imperative {
        switch event {
        case .playPause: .selection
        case .chapterSkip: .impact(.light)
        case .grab, .downloadComplete, .libraryChanged, .success: .notification(.success)
        case .error: .notification(.error)
        case .warning: .notification(.warning)
        case .deckDismiss: .impact(.rigid)
        case .deckCommit: .impact(.medium)
        }
    }

    static func play(_ event: Event) {
        switch imperative(for: event) {
        case let .notification(type): UINotificationFeedbackGenerator().notificationOccurred(type)
        case .selection: UISelectionFeedbackGenerator().selectionChanged()
        case let .impact(style): UIImpactFeedbackGenerator(style: style).impactOccurred()
        }
    }
}
```

Migrate the four direct call sites:

`Rawkoon/AppModel.swift`, inside `toast(_:style:action:)`. Replace

```swift
        let generator = UINotificationFeedbackGenerator()
        switch style {
        case .success: generator.notificationOccurred(.success)
        case .error: generator.notificationOccurred(.error)
        case .info: break
        }
```

with

```swift
        switch style {
        case .success: RawkoonHaptics.play(.success)
        case .error: RawkoonHaptics.play(.error)
        case .info: break
        }
```

`Rawkoon/Views/OfflineStrip.swift`, inside `OfflineFeedback.explain()`. Replace `UINotificationFeedbackGenerator().notificationOccurred(.warning)` with `RawkoonHaptics.play(.warning)`.

`Rawkoon/Views/Discover/SwipeDeck.swift`, inside `flingAway`. Replace `UIImpactFeedbackGenerator(style: action == .dismiss ? .rigid : .medium).impactOccurred()` with `RawkoonHaptics.play(action == .dismiss ? .deckDismiss : .deckCommit)`.

`Rawkoon/Views/BookView.swift`, inside `announceDownloadFinished()`. Replace `UINotificationFeedbackGenerator().notificationOccurred(.success)` with `RawkoonHaptics.play(.downloadComplete)`.

If a file no longer uses UIKit after the edit, leave its imports alone. SwiftFormat and the compiler decide that, not this task.

- [ ] **Step 4: Verify**

Run: `grep -rn 'FeedbackGenerator' Rawkoon | grep -v 'Rawkoon/Motion/'`
Expected: no output.

Run: `macbuild sync && macbuild test --only RawkoonTests/RawkoonHapticsTests`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add Rawkoon/Motion/RawkoonHaptics.swift Rawkoon/AppModel.swift Rawkoon/Views/OfflineStrip.swift Rawkoon/Views/Discover/SwipeDeck.swift Rawkoon/Views/BookView.swift RawkoonTests/RawkoonHapticsTests.swift
git commit -m "refactor(ios): route every haptic through RawkoonHaptics"
```

---

### Task 3: View-layer kit pieces + motionKit harness screen

**Files:**
- Modify: `Rawkoon/Motion/EntranceLedger.swift` (add the modifiers)
- Modify: `Rawkoon/Motion/HeroStretch.swift` (add the modifier)
- Create: `Rawkoon/Motion/RawkoonTransitions.swift`
- Create: `Rawkoon/Motion/PressableStyle.swift`
- Create: `Rawkoon/Motion/RawkoonSymbols.swift`
- Create: `Rawkoon/Motion/RawkoonCelebration.swift`
- Create: `Rawkoon/Motion/ProgressSheen.swift`
- Create: `Rawkoon/Views/DebugMotionGallery.swift`
- Modify: `Rawkoon/Views/DebugScreens.swift` (register `motionKit`)

**Interfaces:**
- Consumes (Task 1): `EntranceLedger.claim(_:now:)`, `isPending(_:)`, `RawkoonMotion.staggerDelay(position:)`, `HeroStretch.transform(minY:height:)`. Consumes (Task 2): `RawkoonHaptics.Event`, `RawkoonHaptics.feedback(for:)`.
- Produces (later tasks and PRs 2–4 rely on these exact names):
  - `View.rawkoonEntranceScope() -> some View`, applied on the list or grid container.
  - `View.rawkoonEntrance(id: some Hashable) -> some View`, applied on each item.
  - `View.rawkoonStretchyHero(height: CGFloat) -> some View`.
  - `Transition` statics `.rawkoonSwap` and `.rawkoonReveal`, used as `.transition(.rawkoonSwap)`. The parent still needs `.rawkoonMotion(_:value:)` or `withRawkoonMotion` for the transition to play.
  - `ButtonStyle` statics `.rawkoonPressable` and `.rawkoonPressable(scale:)`.
  - `View.rawkoonNumeric(_ value: Double) -> some View`, applied to the `Text` showing the number.
  - `enum LivingSymbolKind { case empty, error }` and `View.rawkoonLivingSymbol(_ kind: LivingSymbolKind) -> some View`.
  - `enum CelebrationRing { case circle, roundedRect(cornerRadius: CGFloat) }` and `View.rawkoonCelebrate(trigger: some Equatable, ring: CelebrationRing = .circle, tint: Color = Theme.seed, haptic: RawkoonHaptics.Event? = .success) -> some View`.
  - `ProgressSheen` view (no arguments).

- [ ] **Step 1: Entrance modifiers**

Append to `Rawkoon/Motion/EntranceLedger.swift`:

```swift
extension EnvironmentValues {
    @Entry var rawkoonEntranceLedger: EntranceLedger?
}

extension View {
    /// Owns the entrance ledger for one list or grid; put it on the container.
    func rawkoonEntranceScope() -> some View {
        modifier(EntranceScope())
    }

    /// Fades and rises this item in the first time it appears, staggered within its burst.
    func rawkoonEntrance(id: some Hashable) -> some View {
        modifier(Entrance(id: AnyHashable(id)))
    }
}

private struct EntranceScope: ViewModifier {
    @State private var ledger = EntranceLedger()

    func body(content: Content) -> some View {
        content.environment(\.rawkoonEntranceLedger, ledger)
    }
}

private struct Entrance: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.rawkoonEntranceLedger) private var ledger
    let id: AnyHashable
    @State private var entered = false

    /// Hidden only before the first claim; a claimed id always renders, even mid-animation.
    private var hidden: Bool {
        !entered && (ledger?.isPending(id) ?? true)
    }

    func body(content: Content) -> some View {
        content
            .opacity(hidden ? 0 : 1)
            .offset(y: hidden && !reduceMotion ? 12 : 0)
            .onAppear {
                guard !entered else { return }
                let position = ledger.map { $0.claim(id, now: ProcessInfo.processInfo.systemUptime) } ?? 0
                guard let position else {
                    entered = true
                    return
                }
                let animation = reduceMotion
                    ? RawkoonMotion.reduced
                    : RawkoonMotion.spring.delay(RawkoonMotion.staggerDelay(position: position))
                withAnimation(animation) { entered = true }
            }
    }
}
```

- [ ] **Step 2: Stretchy hero modifier**

Append to `Rawkoon/Motion/HeroStretch.swift`:

```swift
extension View {
    /// Stretches on pull-down and parallaxes on scroll; static under Reduce Motion.
    func rawkoonStretchyHero(height: CGFloat) -> some View {
        modifier(StretchyHero(height: height))
    }
}

private struct StretchyHero: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let height: CGFloat

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content.visualEffect { view, proxy in
                let t = HeroStretch.transform(minY: proxy.frame(in: .scrollView).minY, height: height)
                return view
                    .scaleEffect(t.scale, anchor: .bottom)
                    .offset(y: t.offsetY)
                    .opacity(t.opacity)
            }
        }
    }
}
```

- [ ] **Step 3: Transitions**

Create `Rawkoon/Motion/RawkoonTransitions.swift`:

```swift
import SwiftUI

/// Skeleton → content and state switches: a soft blur-scale crossfade.
struct RawkoonSwapTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(SwapEffect(isIdentity: phase.isIdentity))
    }
}

/// Banners, errors and expanding sections: a short slide down from above.
struct RawkoonRevealTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(RevealEffect(isIdentity: phase.isIdentity))
    }
}

extension Transition where Self == RawkoonSwapTransition {
    static var rawkoonSwap: RawkoonSwapTransition {
        RawkoonSwapTransition()
    }
}

extension Transition where Self == RawkoonRevealTransition {
    static var rawkoonReveal: RawkoonRevealTransition {
        RawkoonRevealTransition()
    }
}

private struct SwapEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isIdentity: Bool

    func body(content: Content) -> some View {
        let still = isIdentity || reduceMotion
        content
            .opacity(isIdentity ? 1 : 0)
            .scaleEffect(still ? 1 : 0.98)
            .blur(radius: still ? 0 : 6)
    }
}

private struct RevealEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isIdentity: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isIdentity ? 1 : 0)
            .offset(y: isIdentity || reduceMotion ? 0 : -12)
    }
}
```

- [ ] **Step 4: Pressable style**

Create `Rawkoon/Motion/PressableStyle.swift`:

```swift
import SwiftUI

/// Press feedback for tappable cards and rows: a quick shrink and dim, sprung back on release.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        PressableBody(configuration: configuration, scale: scale)
    }
}

private struct PressableBody: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let configuration: ButtonStyleConfiguration
    let scale: CGFloat

    var body: some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(RawkoonMotion.snappy, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var rawkoonPressable: PressableStyle {
        PressableStyle()
    }

    /// Full-width rows use a gentler 0.98 so a wide shrink doesn't read as a jump.
    static func rawkoonPressable(scale: CGFloat) -> PressableStyle {
        PressableStyle(scale: scale)
    }
}
```

- [ ] **Step 5: Numeric text and living symbols**

Create `Rawkoon/Motion/RawkoonSymbols.swift`:

```swift
import SwiftUI

enum LivingSymbolKind {
    case empty, error
}

extension View {
    /// Rolls the digits of the number this text shows when `value` changes.
    func rawkoonNumeric(_ value: Double) -> some View {
        modifier(NumericRoll(value: value))
    }

    /// One bounce for an empty state, one wiggle for an error, played once on appear.
    func rawkoonLivingSymbol(_ kind: LivingSymbolKind) -> some View {
        modifier(LivingSymbol(kind: kind))
    }
}

private struct NumericRoll: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let value: Double

    func body(content: Content) -> some View {
        content
            .contentTransition(reduceMotion ? .opacity : .numericText(value: value))
            .animation(reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.snappy, value: value)
    }
}

private struct LivingSymbol: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let kind: LivingSymbolKind
    @State private var tick = 0

    func body(content: Content) -> some View {
        Group {
            switch kind {
            case .empty: content.symbolEffect(.bounce, value: tick)
            case .error: content.symbolEffect(.wiggle, value: tick)
            }
        }
        .task {
            guard !reduceMotion else { return }
            // Let the screen's own appearance settle before the symbol moves.
            try? await Task.sleep(for: .milliseconds(250))
            tick += 1
        }
    }
}
```

- [ ] **Step 6: Celebration**

Create `Rawkoon/Motion/RawkoonCelebration.swift`:

```swift
import SwiftUI

enum CelebrationRing {
    case circle
    case roundedRect(cornerRadius: CGFloat)
}

extension View {
    /// A success moment: the view pops, a ring pulses out, and a haptic fires each time `trigger` changes.
    func rawkoonCelebrate(
        trigger: some Equatable,
        ring: CelebrationRing = .circle,
        tint: Color = Theme.seed,
        haptic: RawkoonHaptics.Event? = .success
    ) -> some View {
        modifier(Celebration(trigger: trigger, ring: ring, tint: tint, haptic: haptic))
    }
}

private struct CelebrationFrame {
    var contentScale: CGFloat = 1
    var ringScale: CGFloat = 1
    var ringOpacity: Double = 0
}

private struct Celebration<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger
    let ring: CelebrationRing
    let tint: Color
    let haptic: RawkoonHaptics.Event?

    func body(content: Content) -> some View {
        content
            .keyframeAnimator(initialValue: CelebrationFrame(), trigger: trigger) { view, frame in
                view
                    .scaleEffect(reduceMotion ? 1 : frame.contentScale)
                    .overlay {
                        if !reduceMotion {
                            ringShape
                                .scaleEffect(frame.ringScale)
                                .opacity(frame.ringOpacity)
                                .allowsHitTesting(false)
                        }
                    }
            } keyframes: { _ in
                KeyframeTrack(\.contentScale) {
                    SpringKeyframe(1.06, duration: 0.14)
                    SpringKeyframe(1, duration: 0.3)
                }
                KeyframeTrack(\.ringScale) {
                    LinearKeyframe(ringStart, duration: 0.01)
                    CubicKeyframe(ringEnd, duration: 0.42)
                }
                KeyframeTrack(\.ringOpacity) {
                    LinearKeyframe(0.9, duration: 0.01)
                    CubicKeyframe(0, duration: 0.42)
                }
            }
            .sensoryFeedback(RawkoonHaptics.feedback(for: haptic ?? .success), trigger: trigger) { _, _ in
                haptic != nil
            }
    }

    @ViewBuilder private var ringShape: some View {
        switch ring {
        case .circle:
            Circle().strokeBorder(tint, lineWidth: 2)
        case let .roundedRect(cornerRadius):
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).strokeBorder(tint, lineWidth: 2)
        }
    }

    /// A row's ring hugs its edge and grows a little; an icon's starts small and grows a lot.
    private var ringStart: CGFloat {
        if case .circle = ring { 0.6 } else { 1 }
    }

    private var ringEnd: CGFloat {
        if case .circle = ring { 1.7 } else { 1.06 }
    }
}
```

- [ ] **Step 7: Progress sheen**

Create `Rawkoon/Motion/ProgressSheen.swift`:

```swift
import SwiftUI

/// A light band sweeping along an active progress fill. Mount it only while the work is running.
struct ProgressSheen: View {
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            LinearGradient(
                colors: [.clear, .white.opacity(0.35), .clear],
                startPoint: .leading, endPoint: .trailing
            )
            .frame(width: max(24, geo.size.width * 0.4))
            .offset(x: phase * geo.size.width)
        }
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1.2 }
        }
    }
}
```

The caller decides Reduce Motion. `DuskProgress` (Task 4) does not mount this view under Reduce Motion.

- [ ] **Step 8: motionKit harness screen**

Create `Rawkoon/Views/DebugMotionGallery.swift`:

```swift
#if DEBUG
    import SwiftUI

    /// Debug-only gallery that cycles every motion-kit piece on a timer, for simulator screenshots.
    struct DebugMotionGallery: View {
        @State private var tick = 0
        @State private var listIds = Array(0 ..< 12)
        @State private var showContent = false
        @State private var showBanner = false
        @State private var progress = 0.1

        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    LinearGradient(colors: [Theme.terracottaDeep, Theme.apricot], startPoint: .top, endPoint: .bottom)
                        .frame(height: 200)
                        .rawkoonStretchyHero(height: 200)

                    ZStack {
                        if showBanner {
                            Text(verbatim: "Reveal banner")
                                .padding(12)
                                .frame(maxWidth: .infinity)
                                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                                .transition(.rawkoonReveal)
                        }
                    }
                    .frame(minHeight: 48)
                    .rawkoonMotion(RawkoonMotion.spring, value: showBanner)

                    ZStack {
                        if showContent {
                            Text(verbatim: "Loaded content")
                                .font(.title3.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 60)
                                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                                .transition(.rawkoonSwap)
                        } else {
                            ShimmerView(cornerRadius: 12).frame(height: 60)
                                .transition(.rawkoonSwap)
                        }
                    }
                    .rawkoonMotion(RawkoonMotion.spring, value: showContent)

                    HStack {
                        Text(verbatim: "\(Int(progress * 100))%")
                            .font(.system(.title2, design: .monospaced))
                            .rawkoonNumeric(progress)
                        DuskProgress(value: progress, isActive: true)
                    }

                    Image(systemName: "checkmark.circle.fill")
                        .font(.largeTitle)
                        .foregroundStyle(Theme.seed)
                        .rawkoonCelebrate(trigger: tick)

                    Button {} label: {
                        Text(verbatim: "Press me")
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.rawkoonPressable)

                    ContentUnavailableView("Nothing here", systemImage: "tray")
                        .rawkoonLivingSymbol(.empty)
                    ContentUnavailableView("Failed", systemImage: "exclamationmark.triangle")
                        .rawkoonLivingSymbol(.error)

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))], spacing: 12) {
                        ForEach(listIds, id: \.self) { id in
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Theme.raised)
                                .frame(height: 120)
                                .overlay(Text(verbatim: "\(id)"))
                                .rawkoonEntrance(id: id)
                        }
                    }
                    .rawkoonEntranceScope()
                }
                .padding(16)
            }
            .background(Theme.background)
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1.5))
                    tick += 1
                    showContent.toggle()
                    showBanner.toggle()
                    progress = progress >= 0.95 ? 0.1 : progress + 0.17
                    // New ids enter; existing ids must not replay.
                    if tick.isMultiple(of: 4) { listIds.append(listIds.count) }
                }
            }
        }
    }
#endif
```

Check that `Theme.background` exists before using it: `grep -n 'static let background' Rawkoon/Theme*.swift Rawkoon/**/Theme*.swift`. If it doesn't, use the background token `RootTabsView` uses (find it with `grep -rn 'Theme\.' Rawkoon/Views/TabBar/PhoneTabsView.swift | head`).

In `Rawkoon/Views/DebugScreens.swift`, add a case to `offlineView(for:)` just before `default:`:

```swift
            case "motionKit":
                DebugMotionGallery()
```

and add `"motionKit"` to the array in `isOffline(_:)`.

- [ ] **Step 9: Build and screenshot**

Run: `macbuild sync && macbuild build`
Expected: `BUILD SUCCEEDED`, with the printed commit matching HEAD (uncommitted files included via sync).

Run: `macbuild shots --name motionkit-a --wait 2 --env RAWKOON_SCREEN=motionKit` and `macbuild shots --name motionkit-b --wait 4 --env RAWKOON_SCREEN=motionKit`
Expected: two PNG paths. Read both. Banner, content and progress differ between them; the grid is fully visible (no card stuck at opacity 0).

- [ ] **Step 10: Commit**

```bash
git add Rawkoon/Motion Rawkoon/Views/DebugMotionGallery.swift Rawkoon/Views/DebugScreens.swift
git commit -m "feat(ios): add motion kit modifiers, transitions, pressable style and celebration"
```

---

### Task 4: Shared components use the kit

**Files:**
- Modify: `Rawkoon/Views/Components.swift`, covering `StatusBadge` (~line 80), `DuskProgress` (~line 110), `SpineRow.spine` (~line 346), `BookRow` percentage (~line 398), and `DownloadStateIcon` (~line 751)
- Modify: `Rawkoon/Views/Library/BookGridCard.swift` (percentage, ~line 33)

**Interfaces:**
- Consumes: `.rawkoonSwap`, `.rawkoonNumeric(_:)`, `ProgressSheen`, `RawkoonMotion.progress`, `.rawkoonMotion(_:value:)`.
- Produces: `DuskProgress(value: Double, isActive: Bool = false)`. Existing call sites stay valid. PRs 2–4 pass `isActive: true` for running downloads.

- [ ] **Step 1: DuskProgress**

Replace the `DuskProgress` struct with:

```swift
/// The Cozy Dusk progress bar: a well groove with a terracotta→apricot fill.
struct DuskProgress: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 0...1
    let value: Double
    /// True while the work behind the bar is running; adds a moving sheen.
    var isActive = false

    private var clamped: Double {
        max(0, min(1, value))
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.well)
                Capsule()
                    .fill(Theme.progress)
                    .overlay {
                        if isActive, !reduceMotion {
                            ProgressSheen()
                        }
                    }
                    .clipShape(Capsule())
                    .frame(width: clamped * geo.size.width)
            }
        }
        .frame(height: 5)
        .rawkoonMotion(RawkoonMotion.progress, value: clamped)
    }
}
```

- [ ] **Step 2: StatusBadge enters and leaves with the swap transition**

In `StatusBadge.body`, append `.transition(.rawkoonSwap)` after the final `.overlay(Capsule()…)` line. This only takes effect where a caller inserts or removes a badge inside an animated transaction; elsewhere it does nothing.

- [ ] **Step 3: SpineRow and DownloadStateIcon fills go through the gate**

In `SpineRow.spine`, replace `.animation(.linear(duration: 0.15), value: clamped)` with `.rawkoonMotion(.linear(duration: 0.15), value: clamped)`.

In `DownloadStateIcon`, replace `.animation(.linear(duration: 0.15), value: fraction)` with `.rawkoonMotion(.linear(duration: 0.15), value: fraction)`.

Then wrap the whole `switch state { … }` in `DownloadStateIcon.body` so each state crossfades into the next:

```swift
    var body: some View {
        ZStack {
            switch state {
            // … existing cases unchanged, each followed by `.transition(.rawkoonSwap)` …
            }
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: state.kind)
        .rawkoonMotion(RawkoonMotion.snappy, value: celebrating)
    }
```

Add `.transition(.rawkoonSwap)` to the outermost view of every case **except** `.downloaded where celebrating`, which keeps its existing `.transition(.scale.combined(with: .opacity))`. `AudiobookDownloadState.Kind` is a payload-free enum, so it is already `Equatable`.

- [ ] **Step 4: Percentages roll**

In `BookRow` (Components.swift) and `BookGridCard`, add `.rawkoonNumeric(progress)` to the percentage text:

```swift
                        Text(verbatim: "\(Int(progress * 100))%")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Theme.apricot)
                            .rawkoonNumeric(progress)
```

- [ ] **Step 5: Build, test, screenshot**

Run: `macbuild sync && macbuild build && macbuild test`
Expected: `BUILD SUCCEEDED`; the full RawkoonTests suite passes (compare any failure with a `main` run before blaming this change; see the memory note on order-dependent tests).

Run: `macbuild shots --name motionkit-c --wait 3 --env RAWKOON_SCREEN=motionKit`
Expected: the progress row shows a filled bar that never extends past the groove.

- [ ] **Step 6: Commit**

```bash
git add Rawkoon/Views/Components.swift Rawkoon/Views/Library/BookGridCard.swift
git commit -m "feat(ios): animate shared progress, badge and download-state components"
```

---

### Task 5: Press feedback on every card and row

**Files (modify; locate each site by content, since line numbers drift):**
- `Rawkoon/Views/HomeView.swift`: three rail `NavigationLink`s wrapping `MediaPosterCard` (in the `.library`, `.upcoming`, `.discover` cases), plus the `attentionRow` button
- `Rawkoon/Views/LibraryView.swift`: the media grid `NavigationLink` wrapping `MediaPosterCard`, the list `NavigationLink` wrapping `LibraryMediaRow`, and the book row/grid link (followed by `.rawkoonScrollSettle()`)
- `Rawkoon/Views/ContinueListeningView.swift`: the row button inside `ForEach(items.prefix(limit))`
- `Rawkoon/Views/ListeningStatsCard.swift`: the `NavigationLink` around `card(stats)`
- `Rawkoon/Views/Reencode/ReencodeHomeCard.swift`: the `NavigationLink` around `card`
- `Rawkoon/Views/BookView.swift`: the chapter button wrapping `SpineRow`
- `Rawkoon/Views/Discover/BookDiscoveryView.swift`: the link wrapping `posterCard`
- `Rawkoon/Views/Discover/ExploreView.swift`: the link wrapping `posterCard`
- `Rawkoon/Views/Discover/MediaSearch.swift`: the link wrapping `posterCard` and the link wrapping `bookSearchRow`
- `Rawkoon/Views/MediaDetailView.swift`: the Similar link wrapping `MediaPosterCard`
- `Rawkoon/Views/WatchlistView.swift`: the link wrapping `MediaPosterCard`

**Interfaces:**
- Consumes: `.rawkoonPressable`, `.rawkoonPressable(scale:)`.

- [ ] **Step 1: Swap the styles**

At each **poster or card** site (Home rails ×3, Library media grid, BookDiscovery, Explore, MediaSearch poster, MediaDetail Similar, Watchlist), replace `.buttonStyle(.plain)` with `.buttonStyle(.rawkoonPressable)`.

At each **full-width row** site (Home attention row, Library `LibraryMediaRow`, the Library book row/grid link, ContinueListening row, ListeningStatsCard, ReencodeHomeCard, BookView `SpineRow`, MediaSearch `bookSearchRow`), replace `.buttonStyle(.plain)` with `.buttonStyle(.rawkoonPressable(scale: 0.98))`.

Leave every other `.buttonStyle(.plain)` alone. Player controls, login, detail actions and the tab bar belong to later PRs.

- [ ] **Step 2: Verify the count**

Run: `grep -rn 'rawkoonPressable' Rawkoon/Views | grep -v DebugMotionGallery | wc -l`
Expected: `17`.

Run: `grep -rn 'buttonStyle(.plain)' Rawkoon | wc -l`
Expected: `49` (66 before, minus 17).

- [ ] **Step 3: Build**

Run: `macbuild sync && macbuild build`
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Commit**

```bash
git add Rawkoon/Views
git commit -m "feat(ios): give every card and row press feedback"
```

---

### Task 6: Gate ungated motion; make the banner and mini player animate

**Files:**
- Modify: `Rawkoon/Views/EbookReaderView.swift` (~line 223)
- Modify: `Rawkoon/Views/BookView.swift` (`announceDownloadFinished`, ~lines 511–514)
- Modify: `Rawkoon/Views/MediaDetailView.swift` (`detailTabBar`, ~line 429)
- Modify: `Rawkoon/Views/TabBar/RawkoonTabBar.swift` (~line 63)
- Modify: `Rawkoon/Views/TabBar/TabBarChrome.swift` (`sync()`, ~line 28)
- Modify: `Rawkoon/RawkoonApp.swift` (banner overlay, ~lines 61–68)
- Modify: `Rawkoon/Views/TabBar/PhoneTabsView.swift` (`bottomChrome`)

**Interfaces:**
- Consumes: `withRawkoonMotion(_:_:)`, `.rawkoonMotion(_:value:)`, `RawkoonMotion.spring`.

- [ ] **Step 1: Gate the five ungated sites**

- `EbookReaderView.swift`: `.animation(.easeInOut(duration: 0.2), value: controlsVisible)` → `.rawkoonMotion(.easeInOut(duration: 0.2), value: controlsVisible)`.
- `BookView.swift`: `withAnimation(.spring(duration: 0.35)) { showDownloadFinished = true }` → `withRawkoonMotion(.spring(duration: 0.35)) { showDownloadFinished = true }`, and `withAnimation(.easeOut(duration: 0.3)) { showDownloadFinished = false }` → `withRawkoonMotion(.easeOut(duration: 0.3)) { showDownloadFinished = false }`.
- `MediaDetailView.swift`: `withAnimation(.easeInOut(duration: 0.15)) { detailTab = tab }` → `withRawkoonMotion(.easeInOut(duration: 0.15)) { detailTab = tab }`.
- `RawkoonTabBar.swift`: `withAnimation(.spring(duration: 0.35, bounce: 0.2)) { selection = tab }` → `withRawkoonMotion(.spring(duration: 0.35, bounce: 0.2)) { selection = tab }`.
- `TabBarChrome.swift`: `withAnimation(.spring(duration: 0.35)) { isCollapsed = scroll.isCollapsed }` → `withRawkoonMotion(.spring(duration: 0.35)) { isCollapsed = scroll.isCollapsed }`.

(The two `Components.swift` sites were gated in Task 4.)

- [ ] **Step 2: Banner transition plays**

In `RawkoonApp.swift`, replace the banner overlay:

```swift
            .overlay(alignment: .top) {
                if let notification = model.bannerNotification {
                    NotificationBannerView(notification: notification)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .rawkoonMotion(RawkoonMotion.spring, value: model.bannerNotification?.id)
                }
            }
```

with:

```swift
            .overlay(alignment: .top) {
                // The animation sits outside the `if` so insertion and removal both animate.
                ZStack {
                    if let notification = model.bannerNotification {
                        NotificationBannerView(notification: notification)
                            .padding(.top, 8)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
                .rawkoonMotion(RawkoonMotion.spring, value: model.bannerNotification?.id)
            }
```

- [ ] **Step 3: Mini player transition plays**

In `PhoneTabsView.swift`, inside `bottomChrome`, after `.padding(.bottom, 4)`, add:

```swift
        .rawkoonMotion(RawkoonMotion.spring, value: hasActiveBook)
```

- [ ] **Step 4: Verify**

Run: `grep -rnE '\.animation\(|\bwithAnimation\s*[({]' Rawkoon | grep -v 'Rawkoon/Motion/'`
Expected: only these remaining sites, all already Reduce-Motion aware: `LibraryView.swift` (2, `listMotion`), `CachedAsyncImage.swift` (1), `ShimmerView.swift` (1), `NotificationBannerView.swift` (3), `SwipeDeck.swift` (4), `DebugScreens.swift` (3).

Run: `macbuild sync && macbuild build`
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Commit**

```bash
git add Rawkoon/Views/EbookReaderView.swift Rawkoon/Views/BookView.swift Rawkoon/Views/MediaDetailView.swift Rawkoon/Views/TabBar Rawkoon/RawkoonApp.swift
git commit -m "fix(ios): honor Reduce Motion everywhere and animate the banner and mini player"
```

---

### Task 7: Living empty and error states

**Files:**
- Modify: every file under `Rawkoon/` containing `ContentUnavailableView(` (79 sites at plan time; list them with `grep -rln 'ContentUnavailableView(' Rawkoon`)

**Interfaces:**
- Consumes: `.rawkoonLivingSymbol(_:)`, `LivingSymbolKind`.

- [ ] **Step 1: Classify and apply**

For each `ContentUnavailableView(...)` initializer call, append one modifier directly after its closing parenthesis or trailing closure:

- `.rawkoonLivingSymbol(.error)` when the view shows a failure. Signs: it sits in a branch on an error value (`errorMessage`, `error`, `loadError`, `case .failed`, `catch`), or its symbol is a warning or failure glyph (`exclamationmark…`, `xmark…`, `wifi.slash`, `bolt.horizontal…`, `icloud.slash`).
- `.rawkoonLivingSymbol(.empty)` for everything else (no results, nothing yet, not configured).

Skip `ContentUnavailableView.search` and `ContentUnavailableView.search(text:)`. They draw their own glyph and should stay system-standard.

Skip `Rawkoon/Views/DebugMotionGallery.swift`, which already has both.

- [ ] **Step 2: Verify coverage**

Run:

```bash
python3 - <<'EOF'
import glob, re
missing = []
for f in glob.glob('Rawkoon/**/*.swift', recursive=True):
    src = open(f).read()
    for m in re.finditer(r'ContentUnavailableView\(', src):
        tail = src[m.end():m.end() + 1200]
        if 'rawkoonLivingSymbol' not in tail.split('ContentUnavailableView')[0]:
            missing.append(f"{f}:{src[:m.start()].count(chr(10)) + 1}")
print("\n".join(missing) or "all covered")
EOF
```

Expected: `all covered`. For any line it flags, open the file and confirm the site either got the modifier or is a skipped `.search` form.

Run: `macbuild sync && macbuild build`
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 3: Commit**

```bash
git add Rawkoon
git commit -m "feat(ios): animate empty and error state symbols"
```

---

### Task 8: Lint rule, full gates, PR

**Files:**
- Modify: `.swiftlint.yml`
- Modify: the 6 files still holding gated raw-animation sites (add disable comments)

- [ ] **Step 1: Add the custom rule**

Append to `.swiftlint.yml`:

```yaml

# Keeps view code on the Reduce-Motion-safe helpers in Rawkoon/Motion/
# (`.rawkoonMotion(_:value:)`, `withRawkoonMotion`). A site that already
# gates on Reduce Motion itself carries a `disable:next` with its reason.
custom_rules:
  raw_animation:
    name: "Raw animation outside Motion/"
    regex: '(\.animation\(|\bwithAnimation\s*[({])'
    excluded: "Rawkoon/Motion/"
    message: "Use .rawkoonMotion(_:value:) or withRawkoonMotion so Reduce Motion is honored."
    severity: warning
```

- [ ] **Step 2: Annotate the legitimate remaining sites**

Put this line directly above each remaining site that Task 6 Step 4 listed (`LibraryView` ×2, `CachedAsyncImage` ×1, `ShimmerView` ×1, `NotificationBannerView` ×3, `SwipeDeck` ×4):

```swift
// swiftlint:disable:next raw_animation - already gates on Reduce Motion here
```

Use a more precise reason where one fits. For example, the `SwipeDeck` sites read `// swiftlint:disable:next raw_animation - gesture-driven fling, gated by reduceMotion above`.

In `Rawkoon/Views/DebugScreens.swift`, add `// swiftlint:disable raw_animation - debug-only harness` as the first line inside `#if DEBUG`.

- [ ] **Step 3: Run the four CI lint steps locally**

Run from `apps/ios/`:

```bash
python3 scripts/check-l10n.py
python3 scripts/check-env-inject.py
swiftformat Rawkoon RawkoonTests RawkoonWidgets WidgetSupport Sources Tests --lint
swiftlint lint 2>&1 | grep -E 'raw_animation|error:' ; echo "exit=$?"
```

Expected: both scripts pass; swiftformat reports 0 files needing formatting (if it reports any, run it without `--lint` on those files and re-run); swiftlint prints no `raw_animation` and no `error:` lines. For every other warning, compare against `main` by linting a throwaway checkout (`git worktree add --detach /tmp/rk-main origin/main`, lint there, then `git worktree remove /tmp/rk-main`). This PR must not add warnings in files it touched.

- [ ] **Step 4: Full macbuild gate**

Run: `macbuild sync && macbuild build && macbuild test`
Expected: `BUILD SUCCEEDED`, all tests pass, printed commit equals `git rev-parse --short HEAD`.

Run: `macbuild shots --name motionkit-final --wait 4 --env RAWKOON_SCREEN=motionKit`
Then capture a few real screens the PR touched (Home and Library need a logged-in sim; follow the `rawkoon-ios-sim-screenshot-review` memory recipe).

- [ ] **Step 5: Commit and push**

```bash
git add .swiftlint.yml Rawkoon
git commit -m "chore(ios): lint raw animations outside the motion kit"
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-kit
git push -u origin HEAD:feat/ios-motion-kit
```

- [ ] **Step 6: Open the PR (do not merge)**

```bash
gh pr create --base main --head feat/ios-motion-kit \
  --title "feat(ios): motion kit and shared-component motion" \
  --body-file - <<'EOF'
## Summary

First of four PRs in the expressive motion pass (spec: `docs/superpowers/specs/2026-10-09-ios-expressive-motion-design.md`).

- Motion kit in `Rawkoon/Motion/`: staggered entrances (once per item), swap and reveal transitions, pressable button style, rolling numbers, living empty/error symbols, celebration burst, stretchy hero, progress sheen. Every piece handles Reduce Motion itself.
- Shared components use it: `DuskProgress`, `StatusBadge`, `DownloadStateIcon`, book progress percentages, and press feedback on every card and row.
- Fixes: seven animations that ignored Reduce Motion, the notification banner and mini-player transitions that never played, and four haptic call sites that bypassed `RawkoonHaptics`.
- SwiftLint rule `raw_animation` keeps raw `.animation(` / `withAnimation` out of view code.
- DEBUG harness screen `RAWKOON_SCREEN=motionKit` cycles every kit piece.

## Verification

- macbuild: build + full RawkoonTests suite (new `RawkoonMotionTests`, extended `RawkoonHapticsTests`).
- CI lint steps run locally: l10n, env-inject, swiftformat, swiftlint.
- Simulator screenshots of the motionKit harness.
- Not verifiable on CI or the simulator: haptics, press feel, and motion timing. Those need a device pass.
EOF
```

Expected: a PR URL. Do not merge.

---

## Self-review

- **Spec coverage (PR 1 section):**
  - Kit pieces: Tasks 1 and 3.
  - Shared-component wiring: Tasks 4 and 5. `BookCover` and `MediaPosterCard` get press feedback through their wrapping links (Task 5) because they are not buttons themselves.
  - Empty/error wrapper: Task 7, as a modifier on `ContentUnavailableView`.
  - Gating and banner/mini-player fixes: Tasks 4 and 6.
  - Haptics: Task 2.
  - Lint rule: Task 8.
  - Unit tests for stagger, ledger and haptic mapping: Tasks 1 and 2.
  - Simulator screenshots: Tasks 3, 4 and 8.
  - Device pass: after the PR opens, by the operator.
- **Deviations from the spec text, chosen deliberately:**
  - Empty states bounce once instead of breathing, so nothing loops while idle (the spec's own "nothing loops" rule wins).
  - Stagger uses the position in the current appearance burst rather than the list index, so deep scrolls never wait.
  - Under Reduce Motion, celebrations are haptic-only; the caller's own state change (e.g. "Added") is the static confirmation.
- **Type consistency:** these names are identical in every task that uses them: `rawkoonEntrance(id:)`, `rawkoonEntranceScope()`, `rawkoonPressable(scale:)`, `rawkoonNumeric(_:)`, `rawkoonLivingSymbol(_:)`, `rawkoonCelebrate(trigger:ring:tint:haptic:)`, `rawkoonStretchyHero(height:)`, `withRawkoonMotion`, `DuskProgress(value:isActive:)`, `RawkoonHaptics.play(_:)`.
