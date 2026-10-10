# iOS Motion: Player, Books, Login, Settings and the rest (PR 4 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the motion kit to the audiobook player, the book screen and ebook reader, Login, Settings, Notifications, Requests and the iPhone tab bar badge, give each its signature moment (the cover that sits back on pause, a celebrated download, a shaking failed sign-in and a celebrated one that crossfades into the tabs), and close the four carry-ins: the `DownloadStateIcon` bounce, the disabled look of `PressableStyle`, the Catalyst sidebar's `isActiveRootTab`, and Activity's cancelled cold queue load. This is PR 4, the last of the expressive motion pass.

**Architecture:** Views consume the kit in `Rawkoon/Motion/`. The kit grows in five backward-compatible ways: `rawkoonShake(trigger:haptic:when:)` (a decaying side-to-side keyframe plus a haptic, gated like `rawkoonCelebrate`), `rawkoonSymbolSpin(_:clockwise:)` (a rotate symbol effect on a trigger), `rawkoonBounceOnInsert(armed:)` (a bounce for a glyph that replaces another), the `.rawkoonPop` transition (scale + fade for dots, badges and checks), and a disabled dim in `PressableStyle` that an ancestor already dimming (`requiresConnection`) switches off through the environment. New pure logic (`RawkoonShake`, `RawkoonPop`, `PressableAppearance`, `PlayerMotion`, `EbookFileAction`, `EbookFilesPhase`, `LoginExit`, `SignInFace`, `TestOutcome.haptic`, `ListLoadPhase`, `RequestRowFace`, `UnreadBadge`) is `nonisolated` where a Sendable closure reads it and is covered by Swift Testing in `RawkoonTests`.

**Tech Stack:** SwiftUI (iOS 26.2 floor), Swift 6.2 with `SWIFT_STRICT_CONCURRENCY: complete` and `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`, Swift Testing, SwiftLint, SwiftFormat, the repo's python check scripts, GitHub Actions (`.github/workflows/ios.yml`).

**Spec:** `docs/superpowers/specs/2026-10-09-ios-expressive-motion-design.md`, section "PR 4: Player, Books, Login, Settings, the rest", plus its global rules, edge cases and acceptance list. PR 3 plan (format and lessons): `docs/superpowers/plans/2026-10-09-ios-motion-detail-search-activity.md`.

**Branch:** `feat/ios-motion-player-books-login-settings`, stacked on PR 3's branch `feat/ios-motion-detail-search-activity`. The PR's base is that branch, not `main`.

## Global Constraints

- Deployment floor: iOS 26.2 (`project.yml`). Do not raise it.
- No new third-party dependency.
- No behavior change: same data, same navigation, same actions, same strings. Only motion and haptics change. The few presentation changes this PR does make (a disabled pressable now dims, Requests opens on its spinner instead of "No requests", Login stays on screen 0.45s after a successful sign-in) are listed under "Decisions taken while planning".
- No on-device state migration.
- Every motion is Reduce-Motion safe. Use the kit, which reads `accessibilityReduceMotion` itself. Movement becomes a crossfade, celebrations and shakes become haptic-only, nothing loops.
- No animation runs longer than about 0.45s plus its stagger. Animations never delay a tap or a navigation: a button runs its action first and starts its motion after.
- No raw `.animation(` or `withAnimation` outside `Rawkoon/Motion/`. Use `.rawkoonMotion(_:value:)` or `withRawkoonMotion`. `scripts/check-raw-animation.py` enforces this; a self-gated exception needs `// motion-ok: <reason>` on the line above. This PR needs none, and none of the touched files has one today.
- App target code is `@MainActor` by default. Pure helpers that a Sendable closure reads (`keyframeAnimator`, `sensoryFeedback` conditions, `visualEffect`) are `nonisolated`, and values are copied into locals before such closures. Test structs are annotated `@MainActor`.
- Every `.transition` plays only if its state change is animated: either by a value-keyed `.rawkoonMotion` placed **outside** the conditional, keyed on a phase value that mirrors the branch order (never a one-shot flag), or by `withRawkoonMotion` around the write.
- Two states that swap share **one slot** (a `ZStack`), so the outgoing view never stacks above or beside the incoming one during the transition.
- A number only rolls if its `Text` stays mounted. Put `.rawkoonNumeric` on a `Text` whose identity survives the change.
- Set a loading flag synchronously before (or instead of) showing an empty state, and clear it on every exit from the loader.
- A celebration fires only on a confirmed forward transition: pass `when:`. Exactly one haptic per event: a celebration that shares an event with another haptic passes `haptic: nil`, and nothing here also calls `model.toast(…, style: .success/.error)` (the toast plays its own haptic).
- Player and audio state are never written by motion code. The artwork scale is purely visual, keyed on `model.player.isPlaying`.
- New user-facing `Text("…")` literals need a `Rawkoon/Localizable.xcstrings` entry. This PR adds none; moved literals keep their existing keys.
- Comments say why, in one line.
- Commits follow Conventional Commits. No Co-Authored-By trailer.
- Stage files by explicit path only. Never stage the repo-root `CLAUDE.md`, `docker-compose.yml`, `.glim/` or `testflight_feedback.zip` (the user's uncommitted work). Never `git stash` in any form, never `git checkout` another branch.
- Before every commit, run `git rev-parse --abbrev-ref HEAD` and confirm it prints `feat/ios-motion-player-books-login-settings` (other agents switch branches in shared trees).
- **macbuild is offline for this PR.** Do not call `macbuild`. The local gates are the python checks, `swiftformat --lint` and the SwiftLint baseline diff. The compile and app-test gate is GitHub CI on push: the `build` job (`macos-26`) runs `xcodebuild test -only-testing:RawkoonTests` and a simulator build. Tests written in this plan are **written now, executed by CI**; never claim a local test run.
- Never push, merge, tag, bump the version, or cut a release. The controller pushes and opens the PR. A merge to `main` ships to production and TestFlight.

## Review Focus

1. **A successful sign-in celebrates once, then the tabs appear; a logged-in launch never flashes Login.** The root keeps `LoginView` mounted on top of the freshly mounted tabs until `LoginExit.linger` (0.45s) passes, because a removed view is frozen and could never play its celebration. `loginExitFinished` starts as `AppModel.shared.isLoggedIn`, so a launch with a saved session shows no Login frame; the linger task re-checks `model.isLoggedIn` before finishing, so a logout inside the window cannot strand Login or hide it. The celebration needs a user-initiated attempt, so a session restored after first unlock just crossfades. Pinned by the `LoginExit` and `SignInFace` tests (Task 5) and Task 5 Step 8's review.
2. **Exactly one haptic per event.** Book download complete: the celebration plays `.downloadComplete` and the direct `RawkoonHaptics.play(.downloadComplete)` call is deleted. Test connection: one imperative haptic after the await; none of its callers toasts. Login error: the shake's `.error` only (login never toasts). Login success: the celebration's `.success` only. Tab badge pulse: `haptic: nil`. Pinned by the `TestOutcome.haptic` test (Task 6) and the greps in Task 3 Step 9, Task 5 Step 8 and Task 6 Step 5.
3. **A disabled pressable dims once.** `PressableStyle` now dims a disabled control to 0.5, unless `requiresConnection` (which already dims to 0.45 while offline) sits above it and says so through `\.rawkoonDisabledDimHandled`. Pinned by the `PressableAppearance` tests (Task 1) and Task 1 Step 7's review of every `.rawkoonPressable` site that can be disabled.
4. **The player's motion never touches playback and never delays a control.** The cover scale and the chapter-title slide read state only; skip buttons call `skipBackward`/`skipForward` before bumping the spin counter; the existing `.playPause` and `.chapterSkip` haptics are untouched and no new haptic is added. Pinned by the `PlayerMotion` tests (Task 2) and Task 2 Step 6's review.
5. **State swaps play, mirror their branch order and never stack.** Each swap sits in one `ZStack` slot keyed outside the conditional on a phase that mirrors the branch order (`ChapterListPhase`, `EbookFilesPhase`, `EbookFileAction`, `ReaderPhase`, `SignInFace`, `ListLoadPhase`, `RequestRowFace`). Requests no longer flashes "No requests" before its first load. Pinned by the phase tests (Tasks 4, 5, 7) and the reviews in Task 3 Step 9, Task 4 Step 6 and Task 7 Step 7.

---

## File Structure

All paths below are relative to `apps/ios/`. Run every command from `apps/ios/` on branch `feat/ios-motion-player-books-login-settings`.

| File | Responsibility |
|---|---|
| `Rawkoon/Motion/RawkoonShake.swift` (create) | `RawkoonShake`, `rawkoonShake(trigger:haptic:when:)` |
| `Rawkoon/Motion/RawkoonSymbols.swift` (modify) | `rawkoonSymbolSpin(_:clockwise:)`, `rawkoonBounceOnInsert(armed:)` |
| `Rawkoon/Motion/RawkoonTransitions.swift` (modify) | `.rawkoonPop`, `RawkoonPop` |
| `Rawkoon/Motion/PressableStyle.swift` (modify) | Disabled dim, `PressableAppearance`, `\.rawkoonDisabledDimHandled` |
| `Rawkoon/Views/OfflineStrip.swift` (modify) | `requiresConnection` tells the style it already dims |
| `Rawkoon/Views/PlayerView.swift` (modify) | Cover sits back on pause, chapter title slide, rate and sleep roll, skip spin, `PlayerMotion` |
| `Rawkoon/Views/BookView.swift` (modify) | Lane slide, play-button swap, chapter phases and cascade, one-haptic celebration, ebook file rows |
| `Rawkoon/Views/Book/BookMotion.swift` (create) | `EbookFileAction`, `EbookFilesPhase` |
| `Rawkoon/Views/Components.swift` (modify) | `DownloadStateIcon` bounce on a new glyph |
| `Rawkoon/Views/EbookReaderView.swift` (modify) | Opening/failed/ready swap, rolling percentage |
| `Rawkoon/Views/LoginView.swift` (modify) | Entrance sequence, error shake, sign-in face and celebration, `LoginExit`, `SignInFace` |
| `Rawkoon/RawkoonApp.swift` (modify) | Login → tabs crossfade with linger; sidebar `isActiveRootTab` |
| `Rawkoon/Views/Settings/SettingsComponents.swift` (modify) | Test-connection reveal and haptic, animated checkmarks, rolling counts |
| `Rawkoon/Views/Components/ListLoadPhase.swift` (create) | `ListLoadPhase` |
| `Rawkoon/Views/Notifications/NotificationsListView.swift` (modify) | Phase swap, cascade, animated rows, popping unread dots |
| `Rawkoon/Views/RequestsView.swift` (modify) | Phase swap, no-ghost loading, cascade, rows animate out, trailing slot, note reveal |
| `Rawkoon/Views/TabBar/RawkoonTabBar.swift` (modify) | Unread badge pops, rolls and pulses; `UnreadBadge` |
| `Rawkoon/Views/ActivityView.swift` (modify) | A cancelled cold queue load leaves the skeleton armed |
| `RawkoonTests/RawkoonMotionTests.swift` (modify) | Shake, pop, pressable tests |
| `RawkoonTests/ScreenMotionTests.swift` (create) | Player, book, login, settings and list tests |

New files are picked up by XcodeGen's folder sources (`project.yml` lists `Rawkoon` and `RawkoonTests`); CI runs `xcodegen generate`.

### Per-task local gates

Every task ends with the same gate block, run from `apps/ios/`:

```bash
SDD=/home/samuelloranger/sites/rawkoon/.superpowers/sdd/2026-10-10-ios-motion-player-books-login-settings
python3 scripts/check-l10n.py
python3 scripts/check-env-inject.py
python3 scripts/check-raw-animation.py
swiftformat <the task's touched .swift files> --lint
bash "$SDD/rawkoon-pr4-lint.sh" > "$SDD/swiftlint-after.txt"
diff "$SDD/swiftlint-baseline.txt" "$SDD/swiftlint-after.txt"
```

Expected: the three scripts print `ok`; swiftformat reports 0 files (if it names a file, run `swiftformat <that file>` without `--lint`, re-run, and review the diff it made); the lint `diff` shows no new `file rule` pair and no higher count (a lower count is fine). A count that went up is a new warning: fix it before committing (the usual one is `line_length` over 120; wrap the arguments). `rawkoon-pr4-lint.sh` and the baseline are written in Task 1 Step 1. `.superpowers/` is git-ignored.

---

### Task 1: Kit — shake, spin, bounce on insert, pop, and the disabled pressable

**Files:**
- Create: `Rawkoon/Motion/RawkoonShake.swift`
- Modify: `Rawkoon/Motion/RawkoonSymbols.swift`
- Modify: `Rawkoon/Motion/RawkoonTransitions.swift`
- Modify: `Rawkoon/Motion/PressableStyle.swift`
- Modify: `Rawkoon/Views/OfflineStrip.swift`
- Test: `RawkoonTests/RawkoonMotionTests.swift`

**Interfaces:**
- Produces:
  - `nonisolated enum RawkoonShake { static let offsets: [CGFloat]; static let beat: Double }`
  - `func rawkoonShake<Trigger: Equatable>(trigger: Trigger, haptic: RawkoonHaptics.Event? = .error, when predicate: ((Trigger, Trigger) -> Bool)? = nil) -> some View`
  - `func rawkoonSymbolSpin(_ trigger: some Equatable, clockwise: Bool) -> some View`
  - `func rawkoonBounceOnInsert(armed: Bool) -> some View`
  - `struct RawkoonPopTransition: Transition`; `static var rawkoonPop: RawkoonPopTransition`; `nonisolated enum RawkoonPop { static let hiddenScale: CGFloat; static func scale(isIdentity: Bool, reduceMotion: Bool) -> CGFloat }`
  - `EnvironmentValues.rawkoonDisabledDimHandled: Bool` (default `false`)
  - `nonisolated enum PressableAppearance { static let pressedOpacity: Double; static let disabledOpacity: Double; static func opacity(isPressed: Bool, isEnabled: Bool, dimHandledAbove: Bool) -> Double }`
- Consumes: `CelebrationGate.fires(from:to:when:)`, `RawkoonHaptics.feedback(for:)`, `RawkoonMotion.snappy` / `.reduced`.

- [ ] **Step 1: Record the lint baseline for every file this PR touches**

Run from `apps/ios/`, before any edit:

```bash
SDD=/home/samuelloranger/sites/rawkoon/.superpowers/sdd/2026-10-10-ios-motion-player-books-login-settings
mkdir -p "$SDD"
cat > "$SDD/rawkoon-pr4-lint.sh" <<'EOF'
#!/usr/bin/env bash
# Per-file, per-rule SwiftLint warning counts for the files PR 4 touches.
cd /home/samuelloranger/sites/rawkoon/apps/ios || exit 1
files=()
for f in \
  Rawkoon/Motion/RawkoonShake.swift Rawkoon/Motion/RawkoonSymbols.swift \
  Rawkoon/Motion/RawkoonTransitions.swift Rawkoon/Motion/PressableStyle.swift \
  Rawkoon/Views/OfflineStrip.swift Rawkoon/Views/PlayerView.swift \
  Rawkoon/Views/BookView.swift Rawkoon/Views/Book/BookMotion.swift \
  Rawkoon/Views/Components.swift Rawkoon/Views/EbookReaderView.swift \
  Rawkoon/Views/LoginView.swift Rawkoon/RawkoonApp.swift \
  Rawkoon/Views/Settings/SettingsComponents.swift Rawkoon/Views/Components/ListLoadPhase.swift \
  Rawkoon/Views/Notifications/NotificationsListView.swift Rawkoon/Views/RequestsView.swift \
  Rawkoon/Views/TabBar/RawkoonTabBar.swift Rawkoon/Views/ActivityView.swift \
  RawkoonTests/RawkoonMotionTests.swift RawkoonTests/ScreenMotionTests.swift
do
  [ -f "$f" ] && files+=("$f")
done
swiftlint lint --quiet "${files[@]}" 2>/dev/null \
  | sed -E 's#^.*/apps/ios/##; s#^([^:]+):[0-9]+(:[0-9]+)?: (warning|error): .*\(([a-z_]+)\)$#\1 \4#' \
  | sort | uniq -c
EOF
bash "$SDD/rawkoon-pr4-lint.sh" > "$SDD/swiftlint-baseline.txt"
wc -l "$SDD/swiftlint-baseline.txt"
```

Expected: a few dozen baseline `file rule` lines (for example `Rawkoon/Views/BookView.swift file_length` and `Rawkoon/Views/LoginView.swift function_body_length`). The four files this PR creates do not exist yet and are skipped.

- [ ] **Step 2: Write the tests (written now, executed by CI)**

In `RawkoonTests/RawkoonMotionTests.swift`, insert before the struct's final closing `}` (after `slideStaysPutUnderReduceMotion`):

```swift

    @Test func shakeEndsAtRest() {
        #expect(RawkoonShake.offsets.count == 5)
        #expect(RawkoonShake.offsets.last == 0)
    }

    @Test func shakeDecays() {
        let swings = RawkoonShake.offsets.dropLast().map(abs)
        #expect(zip(swings, swings.dropFirst()).allSatisfy { $0 > $1 })
        #expect((swings.max() ?? 0) <= 12)
    }

    @Test func shakeStaysShort() {
        #expect(Double(RawkoonShake.offsets.count) * RawkoonShake.beat <= 0.45)
    }

    @Test func popStartsSmallAndRestsAtFullSize() {
        #expect(RawkoonPop.scale(isIdentity: false, reduceMotion: false) == RawkoonPop.hiddenScale)
        #expect(RawkoonPop.hiddenScale < 1)
        #expect(RawkoonPop.scale(isIdentity: true, reduceMotion: false) == 1)
    }

    @Test func popOnlyFadesUnderReduceMotion() {
        #expect(RawkoonPop.scale(isIdentity: false, reduceMotion: true) == 1)
    }

    @Test func pressableRestsOpaqueAndDimsWhilePressed() {
        #expect(PressableAppearance.opacity(isPressed: false, isEnabled: true, dimHandledAbove: false) == 1)
        #expect(
            PressableAppearance.opacity(isPressed: true, isEnabled: true, dimHandledAbove: false)
                == PressableAppearance.pressedOpacity
        )
    }

    @Test func pressableDimsADisabledControl() {
        #expect(
            PressableAppearance.opacity(isPressed: false, isEnabled: false, dimHandledAbove: false)
                == PressableAppearance.disabledOpacity
        )
        #expect(PressableAppearance.disabledOpacity < PressableAppearance.pressedOpacity)
    }

    @Test func pressableLeavesAnAncestorsDimAlone() {
        #expect(PressableAppearance.opacity(isPressed: false, isEnabled: false, dimHandledAbove: true) == 1)
    }

    @Test func pressableIgnoresAPressWhileDisabled() {
        #expect(
            PressableAppearance.opacity(isPressed: true, isEnabled: false, dimHandledAbove: false)
                == PressableAppearance.disabledOpacity
        )
    }
```

- [ ] **Step 3: The shake**

Create `Rawkoon/Motion/RawkoonShake.swift`:

```swift
import SwiftUI

/// Keyframe offsets for `rawkoonShake`: a quick side-to-side that decays and ends at rest.
nonisolated enum RawkoonShake {
    static let offsets: [CGFloat] = [-10, 8, -6, 3, 0]
    static let beat = 0.07
}

extension View {
    /// Shakes side to side and plays `haptic` when `trigger` changes; only the haptic under Reduce Motion.
    /// Pass `when` to shake on some changes only, e.g. `{ $1 != nil }` for a new error.
    func rawkoonShake<Trigger: Equatable>(
        trigger: Trigger,
        haptic: RawkoonHaptics.Event? = .error,
        when predicate: ((Trigger, Trigger) -> Bool)? = nil
    ) -> some View {
        modifier(Shake(trigger: trigger, haptic: haptic, predicate: predicate))
    }
}

private struct ShakeFrame {
    var offsetX: CGFloat = 0
}

private struct Shake<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger
    let haptic: RawkoonHaptics.Event?
    let predicate: ((Trigger, Trigger) -> Bool)?
    /// Counts accepted trigger changes; the animator and the haptic key off this, not the raw trigger.
    @State private var fires = 0

    func body(content: Content) -> some View {
        // Copied out so the nonisolated animator closures read no MainActor state.
        let moves = !reduceMotion
        let offsets = RawkoonShake.offsets
        let beat = RawkoonShake.beat
        let haptic = haptic
        return content
            .keyframeAnimator(initialValue: ShakeFrame(), trigger: fires) { view, frame in
                view.offset(x: moves ? frame.offsetX : 0)
            } keyframes: { _ in
                KeyframeTrack(\.offsetX) {
                    CubicKeyframe(offsets[0], duration: beat)
                    CubicKeyframe(offsets[1], duration: beat)
                    CubicKeyframe(offsets[2], duration: beat)
                    CubicKeyframe(offsets[3], duration: beat)
                    CubicKeyframe(offsets[4], duration: beat)
                }
            }
            .sensoryFeedback(RawkoonHaptics.feedback(for: haptic ?? .error), trigger: fires) { _, _ in
                haptic != nil
            }
            .onChange(of: trigger) { old, new in
                if CelebrationGate.fires(from: old, to: new, when: predicate) {
                    fires += 1
                }
            }
    }
}
```

The `shakeEndsAtRest` test pins the five offsets the keyframes read.

- [ ] **Step 4: Spin and bounce on insert**

In `Rawkoon/Motion/RawkoonSymbols.swift`, find:

```swift
    /// One bounce each time `trigger` changes; still under Reduce Motion.
    func rawkoonSymbolBounce(_ trigger: some Equatable) -> some View {
        modifier(SymbolBounce(trigger: trigger))
    }
}
```

Replace with:

```swift
    /// One bounce each time `trigger` changes; still under Reduce Motion.
    func rawkoonSymbolBounce(_ trigger: some Equatable) -> some View {
        modifier(SymbolBounce(trigger: trigger))
    }

    /// One spin of the symbol's arrow each time `trigger` changes; still under Reduce Motion.
    func rawkoonSymbolSpin(_ trigger: some Equatable, clockwise: Bool) -> some View {
        modifier(SymbolSpin(trigger: trigger, clockwise: clockwise))
    }

    /// One bounce when this symbol is inserted while `armed`; for a glyph that replaces another on a state change.
    func rawkoonBounceOnInsert(armed: Bool) -> some View {
        modifier(BounceOnInsert(armed: armed))
    }
}

private struct SymbolSpin<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger
    let clockwise: Bool

    func body(content: Content) -> some View {
        // A value that never changes under Reduce Motion, so the effect never fires.
        let value = reduceMotion ? nil : Optional(trigger)
        return Group {
            if clockwise {
                content.symbolEffect(.rotate.clockwise.byLayer, value: value)
            } else {
                content.symbolEffect(.rotate.counterClockwise.byLayer, value: value)
            }
        }
    }
}

private struct BounceOnInsert: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let armed: Bool
    @State private var bounces = 0

    func body(content: Content) -> some View {
        content
            .symbolEffect(.bounce, value: bounces)
            // A task, not onAppear, so the effect sees the change once the symbol is on screen.
            .task {
                guard armed, !reduceMotion else { return }
                bounces += 1
            }
    }
}
```

`rawkoonSymbolBounce` fires only when a mounted image sees its trigger change. A glyph that lives in its own `switch` branch is new on every state change and never sees a change, so it needs `rawkoonBounceOnInsert` instead; the host passes `armed: false` on its first render so the glyph a screen opens on does not bounce.

- [ ] **Step 5: The pop transition**

In `Rawkoon/Motion/RawkoonTransitions.swift`, find:

```swift
private struct SwapEffect: ViewModifier {
```

Replace with:

```swift
/// Small marks (an unread dot, a badge, a check) that pop in and out.
struct RawkoonPopTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(PopEffect(isIdentity: phase.isIdentity))
    }
}

extension Transition where Self == RawkoonPopTransition {
    static var rawkoonPop: RawkoonPopTransition {
        RawkoonPopTransition()
    }
}

/// Scale for `rawkoonPop`; a plain fade under Reduce Motion.
nonisolated enum RawkoonPop {
    static let hiddenScale: CGFloat = 0.3

    static func scale(isIdentity: Bool, reduceMotion: Bool) -> CGFloat {
        isIdentity || reduceMotion ? 1 : hiddenScale
    }
}

private struct SwapEffect: ViewModifier {
```

Then append at the end of the file:

```swift

private struct PopEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isIdentity: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isIdentity ? 1 : 0)
            .scaleEffect(RawkoonPop.scale(isIdentity: isIdentity, reduceMotion: reduceMotion))
    }
}
```

- [ ] **Step 6: A disabled pressable dims once**

Replace the whole content of `Rawkoon/Motion/PressableStyle.swift` with:

```swift
import SwiftUI

extension EnvironmentValues {
    /// True under a modifier that already dims its disabled content, such as `requiresConnection` while offline.
    @Entry var rawkoonDisabledDimHandled = false
}

/// Opacity for a pressable control, pure so the rules are testable.
nonisolated enum PressableAppearance {
    static let pressedOpacity = 0.88
    static let disabledOpacity = 0.5

    /// A disabled control dims once: here, unless a modifier above it already did.
    static func opacity(isPressed: Bool, isEnabled: Bool, dimHandledAbove: Bool) -> Double {
        guard isEnabled else { return dimHandledAbove ? 1 : disabledOpacity }
        return isPressed ? pressedOpacity : 1
    }
}

/// Press feedback for tappable cards and rows: a quick shrink and dim, sprung back on release.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        PressableBody(configuration: configuration, scale: scale)
    }
}

private struct PressableBody: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.rawkoonDisabledDimHandled) private var dimHandledAbove
    let configuration: ButtonStyleConfiguration
    let scale: CGFloat

    var body: some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(PressableAppearance.opacity(
                isPressed: configuration.isPressed, isEnabled: isEnabled, dimHandledAbove: dimHandledAbove
            ))
            .animation(RawkoonMotion.snappy, value: configuration.isPressed)
            .animation(RawkoonMotion.reduced, value: isEnabled)
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

In `Rawkoon/Views/OfflineStrip.swift`, find:

```swift
private struct RequiresConnection: ViewModifier {
    let isOffline: Bool

    func body(content: Content) -> some View {
        content
            .disabled(isOffline)
            .opacity(isOffline ? 0.45 : 1)
```

Replace with:

```swift
private struct RequiresConnection: ViewModifier {
    @Environment(\.rawkoonDisabledDimHandled) private var dimHandledAbove
    let isOffline: Bool

    func body(content: Content) -> some View {
        content
            // This modifier dims the control itself, so a pressable style inside must not dim it again.
            .environment(\.rawkoonDisabledDimHandled, dimHandledAbove || isOffline)
            .disabled(isOffline)
            .opacity(isOffline ? 0.45 : 1)
```

- [ ] **Step 7: Review**

- `RawkoonShake.swift` mirrors `Celebration`: values copied out before the animator, `fires` counts accepted changes, `when` gates them, the haptic plays only when `haptic != nil`, and nothing moves under Reduce Motion.
- Run `grep -rn -B3 -A4 "rawkoonPressable" Rawkoon --include='*.swift' | grep -v '^Rawkoon/Motion/' | grep -n "disabled\|requiresConnection\|opacity"`. The disabled sites and what they now look like: `ContinueListeningView` rows (all rows dim to 0.5 while one opens; the opening row keeps its own spinner), Library provisional "adding" rows in the grid and the list (dimmed while the add is unconfirmed), Home "upcoming" cards with neither a TMDB nor a library id (dimmed; they never navigate), Home attention rows (dimmed while one resolves; offline, `requiresConnection` dims them once at 0.45 and the style stays at 1). No site applies its own opacity to a pressable, so nothing dims twice.
- `rawkoonDisabledDimHandled` composes: a `requiresConnection(false)` inside an offline one keeps the outer `true`.

- [ ] **Step 8: Local gates**

Run the per-task gate block with: `Rawkoon/Motion/RawkoonShake.swift Rawkoon/Motion/RawkoonSymbols.swift Rawkoon/Motion/RawkoonTransitions.swift Rawkoon/Motion/PressableStyle.swift Rawkoon/Views/OfflineStrip.swift RawkoonTests/RawkoonMotionTests.swift`.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/Motion/RawkoonShake.swift Rawkoon/Motion/RawkoonSymbols.swift Rawkoon/Motion/RawkoonTransitions.swift \
  Rawkoon/Motion/PressableStyle.swift Rawkoon/Views/OfflineStrip.swift RawkoonTests/RawkoonMotionTests.swift
git commit -m "feat(ios): shake, symbol spin, pop transition and a disabled pressable dim"
```

---

### Task 2: Player — the cover sits back on pause, titles and chips roll, skips spin

**Files:**
- Modify: `Rawkoon/Views/PlayerView.swift`
- Test: `RawkoonTests/ScreenMotionTests.swift` (create)

**Interfaces:**
- Produces: `nonisolated enum PlayerMotion { static let pausedArtworkScale: CGFloat; static func artworkScale(isPlaying: Bool, reduceMotion: Bool) -> CGFloat; static func sleepRollValue(isOff: Bool, remaining: Double?) -> Double }`; `private struct SkipControl: View`.
- Consumes (Task 1): `rawkoonSymbolSpin(_:clockwise:)`. Kit: `rawkoonMotion`, `rawkoonNumeric`, `.rawkoonSlide(_:)`.

- [ ] **Step 1: Write the tests (written now, executed by CI)**

Create `RawkoonTests/ScreenMotionTests.swift`:

```swift
@testable import Rawkoon
import SwiftUI
import Testing

@MainActor
struct ScreenMotionTests {
    @Test func artworkRestsAtFullSizeWhilePlaying() {
        #expect(PlayerMotion.artworkScale(isPlaying: true, reduceMotion: false) == 1)
    }

    @Test func artworkSitsBackALittleWhenPaused() {
        let paused = PlayerMotion.artworkScale(isPlaying: false, reduceMotion: false)
        #expect(paused == PlayerMotion.pausedArtworkScale)
        #expect(paused < 1)
        #expect(paused >= 0.85)
    }

    @Test func artworkStaysStillUnderReduceMotion() {
        #expect(PlayerMotion.artworkScale(isPlaying: false, reduceMotion: true) == 1)
    }

    @Test func sleepRollKeysOnTheMode() {
        #expect(PlayerMotion.sleepRollValue(isOff: true, remaining: 300) == 0)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: nil) == -1)
    }

    @Test func sleepRollTicksOncePerDisplayedSecond() {
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 299.6) == 300)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 299.4) == 299)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 0.2) == 1)
    }
}
```

- [ ] **Step 2: Read Reduce Motion**

In `Rawkoon/Views/PlayerView.swift`, find:

```swift
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let summary: LibrarySummary
```

Replace with:

```swift
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let summary: LibrarySummary
```

- [ ] **Step 3: Signature — the cover sits back on pause; the chapter title rolls up**

Find:

```swift
            BookCover(url: summary.coverURL, size: 220, corner: 16)
                .frame(maxWidth: 220)
                .shadow(color: .black.opacity(0.6), radius: 24, y: 14)
                .accessibilityHidden(true)
```

Replace with:

```swift
            BookCover(url: summary.coverURL, size: 220, corner: 16)
                .frame(maxWidth: 220)
                .shadow(color: .black.opacity(0.6), radius: 24, y: 14)
                // Purely visual: the cover sits back while paused and springs forward on play.
                .scaleEffect(PlayerMotion.artworkScale(
                    isPlaying: model.player.isPlaying, reduceMotion: reduceMotion
                ))
                .rawkoonMotion(RawkoonMotion.spring, value: model.player.isPlaying)
                .accessibilityHidden(true)
```

Find:

```swift
                Text(currentChapterTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(hasChapter ? Theme.apricotSoft : Theme.muted)
                    .lineLimit(1)
```

Replace with:

```swift
                // One slot keyed by chapter, so a new chapter's title rolls up as the old one fades.
                ZStack {
                    Text(currentChapterTitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(hasChapter ? Theme.apricotSoft : Theme.muted)
                        .lineLimit(1)
                        .id(model.player.currentChapterIndex)
                        .transition(.rawkoonSlide(.bottom))
                }
                .rawkoonMotion(RawkoonMotion.spring, value: model.player.currentChapterIndex)
```

- [ ] **Step 4: Skip arrows spin; rate and sleep chips roll**

Find:

```swift
            control("gobackward.30", label: "Skip back 30 seconds") { model.player.skipBackward(30) }
```

Replace with:

```swift
            SkipControl(systemImage: "gobackward.30", label: "Skip back 30 seconds", clockwise: false) {
                model.player.skipBackward(30)
            }
```

Find:

```swift
            control("goforward.30", label: "Skip forward 30 seconds") { model.player.skipForward(30) }
```

Replace with:

```swift
            SkipControl(systemImage: "goforward.30", label: "Skip forward 30 seconds", clockwise: true) {
                model.player.skipForward(30)
            }
```

Find:

```swift
        } label: {
            chip(
                verbatim: "\(rateLabel(Double(model.player.rate)))×",
                systemImage: "speedometer",
                emphasized: false
            )
        }
```

Replace with:

```swift
        } label: {
            chip(
                verbatim: "\(rateLabel(Double(model.player.rate)))×",
                systemImage: "speedometer",
                emphasized: false
            )
            .rawkoonNumeric(Double(model.player.rate))
        }
```

Find:

```swift
        } label: {
            switch model.player.sleepMode {
            case .off:
                chip(title: "Sleep", systemImage: "moon.zzz.fill", emphasized: sleepActive)
            case .endOfChapter:
                chip(title: "Chapter", systemImage: "moon.zzz.fill", emphasized: sleepActive)
            case .minutes:
                chip(verbatim: sleepLabel, systemImage: "moon.zzz.fill", emphasized: sleepActive)
            }
        }
```

Replace with:

```swift
        } label: {
            // One label for every mode, so a mode change and each countdown second roll in place.
            chip(verbatim: sleepLabel, systemImage: "moon.zzz.fill", emphasized: sleepActive)
                .rawkoonNumeric(PlayerMotion.sleepRollValue(
                    isOff: model.player.sleepMode == .off, remaining: model.player.sleepRemainingSecs
                ))
        }
```

`sleepLabel` already returns `String(localized: "Sleep")` and `String(localized: "Chapter")` for those modes, the same catalog keys the removed `chip(title:)` calls used, so the text is unchanged. Delete the now-unused helper. Find:

```swift
    private func chip(title: LocalizedStringKey, systemImage: String, emphasized: Bool) -> some View {
        chipLabel(Label(title, systemImage: systemImage), emphasized: emphasized)
    }

```

Replace with nothing (delete those four lines).

- [ ] **Step 5: `PlayerMotion` and `SkipControl`**

Find:

```swift
/// `AVRoutePickerView` has no SwiftUI equivalent.
private struct RoutePicker: UIViewRepresentable {
```

Replace with:

```swift
/// The player's motion rules, pure so they can be tested.
nonisolated enum PlayerMotion {
    /// Far enough to read as "resting", near enough that the cover never looks like it is closing.
    static let pausedArtworkScale: CGFloat = 0.9

    static func artworkScale(isPlaying: Bool, reduceMotion: Bool) -> CGFloat {
        isPlaying || reduceMotion ? 1 : pausedArtworkScale
    }

    /// What the sleep chip rolls on: a mode change, then each displayed second of the countdown.
    static func sleepRollValue(isOff: Bool, remaining: Double?) -> Double {
        if isOff {
            return 0
        }
        guard let remaining, remaining.isFinite else { return -1 }
        return max(1, remaining.rounded())
    }
}

/// A 30-second skip whose arrow spins the way it skips; the skip runs first, the spin alongside.
private struct SkipControl: View {
    let systemImage: String
    let label: LocalizedStringKey
    let clockwise: Bool
    let action: () -> Void
    @State private var spins = 0

    var body: some View {
        Button {
            action()
            spins += 1
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 22))
                .foregroundStyle(Theme.textStrong)
                .rawkoonSymbolSpin(spins, clockwise: clockwise)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// `AVRoutePickerView` has no SwiftUI equivalent.
private struct RoutePicker: UIViewRepresentable {
```

`control(_:label:action:)` stays for the previous/next chapter buttons.

- [ ] **Step 6: Review**

- No motion code writes player state: the scale and the title slot read `isPlaying` and `currentChapterIndex`; `SkipControl` calls the same `skipBackward(30)` / `skipForward(30)` the old buttons did, before bumping `spins`. The two `.sensoryFeedback` lines on the sheet are unchanged; no haptic is added.
- The cover scale is animated by the `.rawkoonMotion` placed after `.scaleEffect`; under Reduce Motion `artworkScale` returns 1, so nothing moves.
- The chapter title keeps its font, color and line limit; the slide always enters from below, because the change comes from the player, not from a tap, so there is no moment to write a direction before it. The leaving title fades in place (`RawkoonSlide` moves only the entering view).
- The sleep chip shows the same text in every mode; `accessibilityValue(sleepLabel)` is unchanged.
- `grep -n "chip(title:" Rawkoon/Views/PlayerView.swift` prints nothing.

- [ ] **Step 7: Local gates**

Run the per-task gate block with: `Rawkoon/Views/PlayerView.swift RawkoonTests/ScreenMotionTests.swift`.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/Views/PlayerView.swift RawkoonTests/ScreenMotionTests.swift
git commit -m "feat(ios): rest the player cover on pause, roll its chips and spin the skip arrows"
```

---

### Task 3: Books — lane slide, play swap, chapters, one-haptic download celebration

**Files:**
- Modify: `Rawkoon/Views/BookView.swift`
- Modify: `Rawkoon/Views/Components.swift`

**Interfaces:**
- Produces: `BookDetailLane.order: Int`; `BookView.laneSlideEdge: Edge` (`@State`); `BookView.chapterRows`, `chapterButton(_:)`, `chaptersFailure(_:)`.
- Consumes (Task 1): `rawkoonBounceOnInsert(armed:)`, `.rawkoonPop`. Kit: `.rawkoonSlide(_:)`, `RawkoonSlide.edge(from:to:)`, `rawkoonEntranceScope()`, `rawkoonEntrance(id:)`, `rawkoonCelebrate(trigger:ring:tint:haptic:when:)`, `.rawkoonSwap`, `rawkoonMotion`. RawkoonKit: `chapterListPhase(loading:fetchAttempted:hasChapters:error:)`, `ChapterListPhase` (Equatable).

- [ ] **Step 1: The lane knows its place**

In `Rawkoon/Views/BookView.swift`, find:

```swift
    var title: LocalizedStringKey {
        switch self {
        case .audiobook: "Audiobook"
        case .ebook: "Ebook"
        }
    }
}

enum ReleaseSearchLane: String, Identifiable {
```

Replace with:

```swift
    var title: LocalizedStringKey {
        switch self {
        case .audiobook: "Audiobook"
        case .ebook: "Ebook"
        }
    }

    /// Position in the picker, so a lane switch slides in from the tapped side.
    var order: Int {
        Self.allCases.firstIndex(of: self) ?? 0
    }
}

enum ReleaseSearchLane: String, Identifiable {
```

Find:

```swift
    @State var activeLane: BookDetailLane

```

Replace with:

```swift
    @State var activeLane: BookDetailLane
    /// The side the next lane slides in from; written just before the lane changes.
    @State var laneSlideEdge: Edge = .trailing

```

- [ ] **Step 2: One entrance ledger for the page; the lane change is animated**

Find:

```swift
                    laneContent
                    metadataCard
                    overviewCard
                }
                .padding(.horizontal, 16)
```

Replace with:

```swift
                    laneContent
                    metadataCard
                    overviewCard
                }
                .padding(.horizontal, 16)
                .rawkoonMotion(RawkoonMotion.spring, value: activeLane)
```

Find:

```swift
        .rawkoonStretchyHeroHost()
        .background(Theme.base)
        .navigationTitle(titleText)
```

Replace with:

```swift
        .rawkoonStretchyHeroHost()
        // One ledger for the whole page, so returning to a lane never replays its rows' entrance.
        .rawkoonEntranceScope()
        .background(Theme.base)
        .navigationTitle(titleText)
```

- [ ] **Step 3: The lane picker sets the edge; the lanes share one slot**

Find:

```swift
    var lanePicker: some View {
        Picker("Edition", selection: $activeLane) {
            ForEach(BookDetailLane.allCases) { lane in
                Text(lane.title).tag(lane)
            }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    var laneContent: some View {
        switch activeLane {
        case .audiobook:
            audiobookSection
        case .ebook:
            ebookSection
        }
    }
```

Replace with:

```swift
    var lanePicker: some View {
        Picker("Edition", selection: Binding(
            get: { activeLane },
            set: { lane in
                laneSlideEdge = RawkoonSlide.edge(from: activeLane.order, to: lane.order)
                activeLane = lane
            }
        )) {
            ForEach(BookDetailLane.allCases) { lane in
                Text(lane.title).tag(lane)
            }
        }
        .pickerStyle(.segmented)
    }

    /// One slot, so the entering lane slides in from the tapped side while the leaving one fades in place.
    var laneContent: some View {
        ZStack(alignment: .top) {
            switch activeLane {
            case .audiobook:
                audiobookSection
                    .transition(.rawkoonSlide(laneSlideEdge))
            case .ebook:
                ebookSection
                    .transition(.rawkoonSlide(laneSlideEdge))
            }
        }
    }
```

- [ ] **Step 4: The download finish has one haptic, from its celebration**

Find:

```swift
    /// The card used to flip to "Downloaded"; a glyph swap alone is easy to miss,
    /// so the finish gets a haptic and a brief green check.
    private func announceDownloadFinished() {
        RawkoonHaptics.play(.downloadComplete)
        withRawkoonMotion(.spring(duration: 0.35)) { showDownloadFinished = true }
```

Replace with:

```swift
    /// The card used to flip to "Downloaded"; a glyph swap alone is easy to miss,
    /// so the finish gets a brief green check, which the button celebrates with the haptic.
    private func announceDownloadFinished() {
        withRawkoonMotion(.spring(duration: 0.35)) { showDownloadFinished = true }
```

- [ ] **Step 5: The play button swaps its faces**

Find:

```swift
        } label: {
            Group {
                if loadingPlayer {
                    ProgressView().tint(Theme.onAccent)
                } else if case let .resume(positionSecs) = audiobookResume {
                    Label(
                        String(localized: "Resume from \(Formatters.durationTimestamp(positionSecs))"),
                        systemImage: "play.fill"
                    )
                } else {
                    Label("Play", systemImage: "play.fill")
                }
            }
        }
        .buttonStyle(BookPlayButtonStyle())
```

Replace with:

```swift
        } label: {
            // One slot, so the spinner and the label crossfade while the player loads.
            ZStack {
                if loadingPlayer {
                    ProgressView().tint(Theme.onAccent)
                        .transition(.rawkoonSwap)
                } else if case let .resume(positionSecs) = audiobookResume {
                    Label(
                        String(localized: "Resume from \(Formatters.durationTimestamp(positionSecs))"),
                        systemImage: "play.fill"
                    )
                    .transition(.rawkoonSwap)
                } else {
                    Label("Play", systemImage: "play.fill")
                        .transition(.rawkoonSwap)
                }
            }
            .rawkoonMotion(RawkoonMotion.snappy, value: loadingPlayer)
            .rawkoonMotion(RawkoonMotion.snappy, value: audiobookResume)
        }
        .buttonStyle(BookPlayButtonStyle())
```

- [ ] **Step 6: The download button keeps one identity and celebrates the finish**

Find:

```swift
    /// One round button beside Play: download, then progress (tap cancels), then
    /// a struck-through download arrow once the book is on the device.
    @ViewBuilder
    var audiobookDownloadButton: some View {
        let state = audiobookDownloadState
        let button = Button {
            handleAudiobookDownloadTap(state)
        } label: {
            DownloadStateIcon(state: state, celebrating: showDownloadFinished)
        }
        .buttonStyle(BookIconButtonStyle())
        .accessibilityLabel(state.accessibilityLabel)
        switch state {
        case .idle, .failed:
            button.requiresConnection(model.isOffline)
        default:
            button
        }
    }
```

Replace with:

```swift
    /// One round button beside Play: download, then progress (tap cancels), then
    /// a struck-through download arrow once the book is on the device.
    var audiobookDownloadButton: some View {
        let state = audiobookDownloadState
        let needsConnection = switch state {
        case .idle, .failed: true
        default: false
        }
        // One view for every state, so the icon and the celebration keep their state across a change.
        return Button {
            handleAudiobookDownloadTap(state)
        } label: {
            DownloadStateIcon(state: state, celebrating: showDownloadFinished)
        }
        .buttonStyle(BookIconButtonStyle())
        .accessibilityLabel(state.accessibilityLabel)
        .rawkoonCelebrate(
            trigger: showDownloadFinished, tint: Theme.seed, haptic: .downloadComplete,
            when: { !$0 && $1 }
        )
        .requiresConnection(model.isOffline && needsConnection)
    }
```

`requiresConnection(false)` applies no disabled state, no opacity and no overlay, so the non-idle states look and behave as before.

- [ ] **Step 7: Chapters crossfade their phases and cascade their rows**

Replace the whole `chaptersList` property: it starts at

```swift
    var chaptersList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chapters")
```

and ends at the `    }` that closes it, just above the blank line and `    // MARK: Ebook` (keep that marker). Replace it with:

```swift
    var chaptersList: some View {
        let phase = chapterListPhase(
            loading: loadingManifest,
            fetchAttempted: fetchAttemptedManifest,
            hasChapters: !(manifest?.chapters.isEmpty ?? true),
            error: manifestError
        )
        return VStack(alignment: .leading, spacing: 10) {
            Text("Chapters")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
            // One slot, so the spinner, the list and the failure crossfade instead of stacking.
            ZStack(alignment: .topLeading) {
                switch phase {
                case .loading:
                    ProgressView().tint(Theme.apricot)
                        .transition(.rawkoonSwap)
                case .ready:
                    chapterRows
                        .transition(.rawkoonSwap)
                case let .failed(message):
                    chaptersFailure(message)
                        .transition(.rawkoonSwap)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .rawkoonMotion(RawkoonMotion.spring, value: phase)
        }
    }

    var chapterRows: some View {
        VStack(alignment: .leading, spacing: 10) {
            if sortedChapters.count > chapterFilterThreshold {
                searchField("Filter chapters", text: $chapterFilter)
            }
            if filteredChapters.isEmpty {
                if !chapterFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("No chapters match.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            } else {
                VStack(spacing: 4) {
                    ForEach(filteredChapters, id: \.index) { chapter in
                        chapterButton(chapter)
                            .rawkoonEntrance(id: "chapter-\(chapter.index)")
                    }
                }
            }
        }
    }

    func chapterButton(_ chapter: ManifestChapter) -> some View {
        Button {
            Task {
                guard let editionId = audiobookEditionId else { return }
                loadingPlayer = true
                await model.openPlayer(
                    editionId: editionId,
                    resumeAt: resumePosition(in: chapter) ?? chapter.startSecs
                )
                loadingPlayer = false
                if model.errorMessage == nil {
                    showingPlayer = true
                }
            }
        } label: {
            SpineRow(
                index: chapter.index,
                title: chapter.title,
                downloaded: isChapterDownloaded(chapter),
                current: isCurrentChapter(chapter),
                downloadFraction: audiobookEditionId.flatMap {
                    model.chapterFractions[$0]?[chapter.fileId]
                },
                resumeText: resumePosition(in: chapter).map {
                    String(localized: "Resume from \(Formatters.durationTimestamp($0))")
                }
            )
        }
        .buttonStyle(.rawkoonPressable(scale: 0.98))
    }

    func chaptersFailure(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
            Text("Pull to refresh, run rescan, or check the server.")
                .font(.caption)
                .foregroundStyle(Theme.faint)
            (Text("Edition status: ") + LocalizedStatus.text(audiobookEdition?.status ?? book.audiobookStatus ?? "wanted"))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
        }
    }
```

Every literal moved here keeps its existing catalog key.

- [ ] **Step 8: `DownloadStateIcon` bounces the glyph that replaces another**

In `Rawkoon/Views/Components.swift`, replace the whole `struct DownloadStateIcon: View { … }` (from `/// The glyph inside the round download button for each state.` to the struct's closing `}`) with:

```swift
/// The glyph inside the round download button for each state.
struct DownloadStateIcon: View {
    let state: AudiobookDownloadState
    /// Just finished: show a green check before settling on the struck-through arrow.
    var celebrating = false
    /// False on the first render, so only a glyph that replaces another bounces, not the one the screen opens on.
    @State private var armed = false

    var body: some View {
        ZStack {
            switch state {
            case .idle:
                Image(systemName: "arrow.down.to.line")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.apricot)
                    .rawkoonBounceOnInsert(armed: armed)
                    .transition(.rawkoonSwap)
            case .preparing:
                ProgressView().tint(Theme.apricot)
                    .transition(.rawkoonSwap)
            case let .downloading(fraction, _, _):
                ZStack {
                    Circle().stroke(Theme.borderStrong, lineWidth: 3)
                    Circle()
                        .trim(from: 0, to: max(0.02, min(1, fraction)))
                        .stroke(Theme.apricot, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .rawkoonMotion(.linear(duration: 0.15), value: fraction)
                    Image(systemName: "stop.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.apricot)
                        .rawkoonBounceOnInsert(armed: armed)
                }
                .padding(10)
                .transition(.rawkoonSwap)
            case .failed:
                Image(systemName: "arrow.clockwise")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.terracotta)
                    .rawkoonBounceOnInsert(armed: armed)
                    .transition(.rawkoonSwap)
            case .downloaded where celebrating:
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(Theme.seed)
                    .rawkoonBounceOnInsert(armed: armed)
                    .transition(.rawkoonPop)
            case .downloaded:
                ZStack {
                    Image(systemName: "arrow.down.to.line")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                    // A slash cut through the arrow: a background-coloured bar knocks out
                    // the glyph behind it, then the visible bar sits on top.
                    Capsule().fill(Theme.raised).frame(width: 6, height: 30)
                        .rotationEffect(.degrees(45))
                    Capsule().fill(Theme.muted).frame(width: 2.5, height: 30)
                        .rotationEffect(.degrees(45))
                }
                .transition(.rawkoonSwap)
            }
        }
        .onAppear { armed = true }
        .rawkoonMotion(RawkoonMotion.snappy, value: state.kind)
        .rawkoonMotion(RawkoonMotion.snappy, value: celebrating)
    }
}
```

The struck-through arrow does not bounce (its slash overlay would sit still over a moving glyph); the check before it already did. The check's old `.symbolEffect(.bounce, value: celebrating)` never fired (the check is inserted with `celebrating` already true) and ignored Reduce Motion; the old scale transition moved under Reduce Motion too.

- [ ] **Step 9: Review**

- One haptic for a finished download: `grep -n "RawkoonHaptics.play(.downloadComplete)" Rawkoon/Views/BookView.swift` prints nothing; `grep -n "downloadComplete" Rawkoon/Views/BookView.swift` prints only the celebration. The celebration keys on `showDownloadFinished` false → true, which `announceDownloadFinished` sets only on a seen `.downloading → .downloaded` change; its 1.8s reset back to false does not fire (`when: { !$0 && $1 }`).
- The download button now has a stable identity across states (one view, `requiresConnection(model.isOffline && needsConnection)`), so the celebration's counter and the icon's `armed` survive `.downloading → .downloaded`. The idle and failed states still answer an offline tap with the offline explanation.
- Lane slide: the edge is written in the binding before `activeLane` changes; the motion key is on the VStack that holds the lane slot and the cards below it, so they move together. Each lane is its own container, so the lane slide and the chapter phase swap never merge.
- The chapter phase mirrors `chapterListPhase`'s order (chapters win, then loading or not yet attempted, then failure); the key sits outside the `switch`. Rows cascade once: the ledger lives on the ScrollView, so filtering, a lane round-trip and a live reload never replay them.
- `loadingPlayer` handling is unchanged: the chapter rows and the play button still set and clear it the same way.

- [ ] **Step 10: Local gates**

Run the per-task gate block with: `Rawkoon/Views/BookView.swift Rawkoon/Views/Components.swift`.

- [ ] **Step 11: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/Views/BookView.swift Rawkoon/Views/Components.swift
git commit -m "feat(ios): slide book lanes, cascade chapters and celebrate a finished download once"
```

---

### Task 4: Ebook — file rows swap their actions; the reader crossfades and rolls its percentage

**Files:**
- Create: `Rawkoon/Views/Book/BookMotion.swift`
- Modify: `Rawkoon/Views/BookView.swift`
- Modify: `Rawkoon/Views/EbookReaderView.swift`
- Test: `RawkoonTests/ScreenMotionTests.swift`

**Interfaces:**
- Produces: `nonisolated enum EbookFileAction: Equatable { case downloading, opening, saved, remote; static func phase(downloading: Bool, opening: Bool, downloaded: Bool) -> Self }`; `nonisolated enum EbookFilesPhase: Equatable { case loading, empty, list; static func resolve(loading: Bool, isEmpty: Bool) -> Self }`; `BookView.ebookFileRow(_:)`, `ebookFileActions(_:downloaded:)`; `private enum ReaderPhase` in `EbookReaderView.swift`.
- Consumes: kit `.rawkoonSwap`, `rawkoonMotion`, `rawkoonNumeric`, `rawkoonEntrance(id:)` (scope from Task 3).

- [ ] **Step 1: Write the tests (written now, executed by CI)**

In `RawkoonTests/ScreenMotionTests.swift`, insert before the struct's final closing `}`:

```swift

    @Test func ebookRowDownloadWinsOverEveryOtherFace() {
        #expect(EbookFileAction.phase(downloading: true, opening: true, downloaded: true) == .downloading)
    }

    @Test func ebookRowOpensBeforeShowingActions() {
        #expect(EbookFileAction.phase(downloading: false, opening: true, downloaded: true) == .opening)
    }

    @Test func ebookRowActionsFollowTheDownload() {
        #expect(EbookFileAction.phase(downloading: false, opening: false, downloaded: true) == .saved)
        #expect(EbookFileAction.phase(downloading: false, opening: false, downloaded: false) == .remote)
    }

    @Test func ebookFilesSpinWhileLoadingEvenOverAList() {
        #expect(EbookFilesPhase.resolve(loading: true, isEmpty: false) == .loading)
        #expect(EbookFilesPhase.resolve(loading: false, isEmpty: true) == .empty)
        #expect(EbookFilesPhase.resolve(loading: false, isEmpty: false) == .list)
    }
```

- [ ] **Step 2: The pure phases**

Create `Rawkoon/Views/Book/BookMotion.swift`:

```swift
import Foundation

/// Which actions an ebook file row shows; mirrors the row's branch order so its swap keys on the visible face.
nonisolated enum EbookFileAction: Equatable {
    case downloading, opening, saved, remote

    static func phase(downloading: Bool, opening: Bool, downloaded: Bool) -> Self {
        if downloading {
            return .downloading
        }
        if opening {
            return .opening
        }
        return downloaded ? .saved : .remote
    }
}

/// What the ebook Files card shows; a reload spins even over a known list, as it always has.
nonisolated enum EbookFilesPhase: Equatable {
    case loading, empty, list

    static func resolve(loading: Bool, isEmpty: Bool) -> Self {
        if loading {
            return .loading
        }
        return isEmpty ? .empty : .list
    }
}
```

- [ ] **Step 3: The Files card crossfades; rows cascade and swap their actions in one slot**

In `Rawkoon/Views/BookView.swift`, replace the whole `var ebookFilesCard: some View { … }` block (from `    var ebookFilesCard: some View {` to its closing `    }`, just above `    /// The in-app reader unpacks EPUB only.`) with:

```swift
    var ebookFilesCard: some View {
        let phase = EbookFilesPhase.resolve(loading: loadingEbookFiles, isEmpty: ebookFiles.isEmpty)
        return VStack(alignment: .leading, spacing: 10) {
            Text("Files")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)

            // One slot, so the spinner, the empty note and the list crossfade instead of stacking.
            ZStack(alignment: .topLeading) {
                switch phase {
                case .loading:
                    ProgressView().tint(Theme.muted)
                        .transition(.rawkoonSwap)
                case .empty:
                    Text("No ebook files imported yet. Search releases or rescan this edition.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .transition(.rawkoonSwap)
                case .list:
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(ebookFiles) { file in
                            ebookFileRow(file)
                                .rawkoonEntrance(id: "ebook-\(file.id)")
                        }
                    }
                    .transition(.rawkoonSwap)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .rawkoonMotion(RawkoonMotion.spring, value: phase)
        }
    }

    func ebookFileRow(_ file: BookEditionFile) -> some View {
        let face = EbookFileAction.phase(
            downloading: downloadingEbookFileIDs.contains(file.id),
            opening: openingEbookFileId == file.id,
            downloaded: isEbookDownloaded(file)
        )
        return HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(file.fileName)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                Text(fileMeta(file))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 8)
            // One slot, so a download, an open or a removal crossfades the actions instead of cutting.
            ZStack(alignment: .topTrailing) {
                switch face {
                case .downloading:
                    HStack(spacing: 7) {
                        ProgressView().tint(Theme.muted)
                        Button("Cancel") {
                            cancelEbookDownload(file)
                        }
                        .buttonStyle(.bordered)
                        .tint(Theme.terracotta)
                        .lineLimit(1)
                    }
                    .fixedSize()
                    .transition(.rawkoonSwap)
                case .opening:
                    ProgressView().tint(Theme.muted)
                        .transition(.rawkoonSwap)
                case .saved:
                    ebookFileActions(file, downloaded: true)
                        .transition(.rawkoonSwap)
                case .remote:
                    ebookFileActions(file, downloaded: false)
                        .transition(.rawkoonSwap)
                }
            }
            .rawkoonMotion(RawkoonMotion.snappy, value: face)
        }
        .padding(11)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    /// Actions hold their intrinsic width; the file name (which wraps to two lines)
    /// yields the remaining space, so labels like "Retirer" never break character-by-character.
    func ebookFileActions(_ file: BookEditionFile, downloaded: Bool) -> some View {
        let canFetchRemote = remoteEbookURL(for: file) != nil
        return HStack(spacing: 7) {
            if downloaded {
                Button("Remove") {
                    model.pendingConfirm = ConfirmRequest(
                        title: String(localized: "Remove downloaded file?"),
                        message: String(localized: "Deletes \(file.fileName) from this iPhone. You can download it again anytime."),
                        confirmTitle: String(localized: "Remove Download")
                    ) { removeEbookDownload(file) }
                }
                .buttonStyle(.bordered)
                .tint(Theme.terracotta)
                .lineLimit(1)
            } else {
                Button("Download") {
                    startEbookDownload(file)
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
                .lineLimit(1)
                .disabled(!canFetchRemote)
                .requiresConnection(model.isOffline)
            }

            if isReadableEbook(file) {
                Button("Read") {
                    Task { await openEbook(file) }
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
                .lineLimit(1)
                .disabled(!downloaded && !canFetchRemote)
            } else {
                StatusBadge(text: "Ebook only", tint: Theme.muted)
            }
        }
        .fixedSize()
    }
```

The `message:` line is copied unchanged from the old row; if the lint diff shows a new `line_length` count for `BookView.swift`, it was already over 120 in the baseline at its old position and only moved (the count must not rise).

- [ ] **Step 4: The reader crossfades its states and rolls its percentage**

In `Rawkoon/Views/EbookReaderView.swift`, find:

```swift
private enum ReaderState {
    case opening
    case ready(ReaderSession)
    case failed(String)
}
```

Replace with:

```swift
private enum ReaderState {
    case opening
    case ready(ReaderSession)
    case failed(String)

    /// The visible state without the session, so a crossfade can key on it.
    var phase: ReaderPhase {
        switch self {
        case .opening: .opening
        case .ready: .ready
        case .failed: .failed
        }
    }
}

private enum ReaderPhase: Equatable {
    case opening, ready, failed
}
```

Find:

```swift
    @ViewBuilder private var content: some View {
        switch state {
        case .opening:
            VStack(spacing: 10) {
```

Replace the whole `content` property (through the closing `}` of the property, just above `    /// The only permanent mark on screen.`) with:

```swift
    /// One slot, so opening, failure and the book crossfade instead of cutting.
    private var content: some View {
        ZStack {
            switch state {
            case .opening:
                VStack(spacing: 10) {
                    ProgressView().tint(Theme.importing)
                    Text("Opening book…")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)

            case let .failed(message):
                VStack(spacing: 12) {
                    Image(systemName: "book.closed")
                        .font(.system(size: 30))
                        .foregroundStyle(Theme.muted)
                    Text("Could not open this ebook")
                        .font(.display(17))
                        .foregroundStyle(Theme.textStrong)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                    Button("Close") { persistAndDismiss() }
                        .frame(minHeight: 44)
                        .padding(.horizontal, 20)
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .foregroundStyle(Theme.textStrong)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)

            case let .ready(session):
                ReaderViewControllerWrapper(viewController: session.host)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: state.phase)
    }
```

Find:

```swift
                Text("\(Int((percent * 100).rounded()))%")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .padding(.bottom, 6)
```

Replace with:

```swift
                Text("\(Int((percent * 100).rounded()))%")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .rawkoonNumeric((percent * 100).rounded())
                    .padding(.bottom, 6)
```

- [ ] **Step 5: Check the row against the old branch chain**

Re-read `ebookFileRow`: its `switch` mirrors the old `if downloading … else if loadingState … else` chain (`loadingState` was `opening || downloading`, and `downloading` already won), which is exactly what `EbookFileAction.phase` returns. `saved` and `remote` are separate cases so Remove ↔ Download crossfade in the slot instead of sitting side by side in the `HStack` mid-transition.

- [ ] **Step 6: Review**

- File rows keep every action, disabled rule and `requiresConnection` they had; only their container changed. The row's motion key sits outside the `switch`. Rows cascade once per file id through the page ledger from Task 3.
- `EbookFilesPhase` keeps the old order: a reload shows the spinner even over a known list (it always did); it now crossfades.
- The reader's phase key sits outside the `switch`; `.ignoresSafeArea()` still applies to `content` in `body`. The ready branch hosts a UIKit view controller: SwiftUI may not render the blur part of `rawkoonSwap` on it, which leaves an opacity crossfade, which is fine.
- The percentage `Text` stays mounted while the book is open, so it rolls; it keys on the displayed whole percent.
- The primary "Download primary file" / "Saved for offline reading" block above the Files card is left as is (see "Observed while planning").

- [ ] **Step 7: Local gates**

Run the per-task gate block with: `Rawkoon/Views/Book/BookMotion.swift Rawkoon/Views/BookView.swift Rawkoon/Views/EbookReaderView.swift RawkoonTests/ScreenMotionTests.swift`.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/Views/Book/BookMotion.swift Rawkoon/Views/BookView.swift Rawkoon/Views/EbookReaderView.swift \
  RawkoonTests/ScreenMotionTests.swift
git commit -m "feat(ios): swap ebook file actions in place and crossfade the reader's states"
```

---

### Task 5: Login — sequenced entrance, a shaking failure, a celebrated success into the tabs

**Files:**
- Modify: `Rawkoon/Views/LoginView.swift`
- Modify: `Rawkoon/RawkoonApp.swift`
- Test: `RawkoonTests/ScreenMotionTests.swift`

**Interfaces:**
- Produces: `nonisolated enum LoginExit { static let linger: Duration; static func showsLogin(isLoggedIn: Bool, exitFinished: Bool) -> Bool }`; `nonisolated enum SignInFace: Equatable { case signedIn, loading, idle; static func face(loading: Bool, signedIn: Bool) -> Self }`; `LoginView.signInAttempted` (`@State`), `signInLabel(_:)`, `signIn(with:)`; `RawkoonApp.loginExitFinished` (`@State`), `RawkoonApp.sessionRoot`.
- Consumes (Task 1): `rawkoonShake(trigger:haptic:when:)`, `.rawkoonPop`. Kit: `rawkoonCelebrate`, `rawkoonEntranceScope()`, `rawkoonEntrance(id:)`, `.rawkoonReveal`, `.rawkoonSwap`, `rawkoonMotion`.

- [ ] **Step 1: Write the tests (written now, executed by CI)**

In `RawkoonTests/ScreenMotionTests.swift`, insert before the struct's final closing `}`:

```swift

    @Test func loginShowsWhileSignedOut() {
        #expect(LoginExit.showsLogin(isLoggedIn: false, exitFinished: false))
        #expect(LoginExit.showsLogin(isLoggedIn: false, exitFinished: true))
    }

    @Test func loginLingersUntilItsExitFinishes() {
        #expect(LoginExit.showsLogin(isLoggedIn: true, exitFinished: false))
        #expect(!LoginExit.showsLogin(isLoggedIn: true, exitFinished: true))
    }

    @Test func loginLingerCoversTheCelebration() {
        #expect(LoginExit.linger >= .milliseconds(440))
        #expect(LoginExit.linger <= .milliseconds(500))
    }

    @Test func signInFaceShowsTheCheckOnceTheSessionOpens() {
        #expect(SignInFace.face(loading: true, signedIn: true) == .signedIn)
        #expect(SignInFace.face(loading: true, signedIn: false) == .loading)
        #expect(SignInFace.face(loading: false, signedIn: false) == .idle)
    }
```

- [ ] **Step 2: State and the attempt flag**

In `Rawkoon/Views/LoginView.swift`, find:

```swift
    @State private var revealPassword = false
```

Replace with:

```swift
    @State private var revealPassword = false
    /// Set on a user's sign-in tap, so a session restored after unlock doesn't celebrate.
    @State private var signInAttempted = false
```

Find:

```swift
    private func submit(_ model: AppModel) {
        guard fieldsReady, !model.loading else { return }
        Task { await model.login(server: model.serverURL, email: email, password: password) }
    }
```

Replace with:

```swift
    private func submit(_ model: AppModel) {
        guard fieldsReady, !model.loading else { return }
        signInAttempted = true
        Task { await model.login(server: model.serverURL, email: email, password: password) }
    }

    private func signIn(with provider: SsoProvider) {
        signInAttempted = true
        Task { await model.signInWithProvider(provider.slug) }
    }
```

Then replace both occurrences of the line content `Task { await model.signInWithProvider(provider.slug) }` (one in `ssoBlock`, one in `phoneForm`; use Edit with `replace_all: true` on that exact text) with `signIn(with: provider)`. Run `grep -n "signInWithProvider" Rawkoon/Views/LoginView.swift`: it prints only the line inside `signIn(with:)`.

- [ ] **Step 3: The form enters in sequence and shakes on a failure**

Find:

```swift
    var body: some View {
        NavigationStack {
            ZStack {
                background
                if isRegularWidth {
                    macLayout(model)
                } else {
                    phoneForm(model)
                }
            }
```

Replace with:

```swift
    var body: some View {
        // Read here so the shake's predicate sees the session state of the render that changed the error.
        let signedIn = model.isLoggedIn
        return NavigationStack {
            ZStack {
                background
                Group {
                    if isRegularWidth {
                        macLayout(model)
                    } else {
                        phoneForm(model)
                    }
                }
                .rawkoonEntranceScope()
                // A failed sign-in shakes the form; an error after the session opened is the library load's.
                .rawkoonShake(trigger: model.errorMessage, when: { _, new in new != nil && !signedIn })
            }
```

- [ ] **Step 4: Regular width — entrances, the error reveals, the sign-in face and celebration**

Find:

```swift
                VStack(spacing: 14) {
                    loginLockup(titleSize: 34, logoSide: 64)
                    Text("Sign in to your library")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }

                VStack(spacing: 16) {
```

Replace with:

```swift
                VStack(spacing: 14) {
                    loginLockup(titleSize: 34, logoSide: 64)
                    Text("Sign in to your library")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                .rawkoonEntrance(id: "lockup")

                VStack(spacing: 16) {
```

Find:

```swift
                    }
                }

                signInButton(model)

                if !model.ssoProviders.isEmpty {
                    ssoBlock(model)
                }

                if let errorMessage = model.errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(Theme.terracotta)
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(width: 380)
```

Replace with:

```swift
                    }
                }
                .rawkoonEntrance(id: "fields")

                signInButton(model)
                    .rawkoonEntrance(id: "signIn")

                if !model.ssoProviders.isEmpty {
                    ssoBlock(model)
                        .rawkoonEntrance(id: "sso")
                }

                if let errorMessage = model.errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(Theme.terracotta)
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .transition(.rawkoonReveal)
                }
            }
            .frame(width: 380)
            .rawkoonMotion(RawkoonMotion.spring, value: model.errorMessage)
```

Find:

```swift
        } label: {
            Group {
                if model.loading {
                    ProgressView().tint(Theme.onAccent)
                } else {
                    Text("Sign In").fontWeight(.semibold)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .foregroundStyle(Theme.onAccent)
            .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(model.loading || !fieldsReady)
        .opacity(fieldsReady ? 1 : 0.6)
    }
```

Replace with:

```swift
        } label: {
            signInLabel(model)
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .foregroundStyle(Theme.onAccent)
                .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(model.loading || !fieldsReady)
        .opacity(fieldsReady ? 1 : 0.6)
        .rawkoonCelebrate(
            trigger: model.isLoggedIn, ring: .roundedRect(cornerRadius: 12), tint: Theme.seed,
            when: { old, new in !old && new && signInAttempted }
        )
    }

    /// Sign In, then a spinner, then a check once the session opens (the static mark Reduce Motion keeps).
    private func signInLabel(_ model: AppModel) -> some View {
        let face = SignInFace.face(loading: model.loading, signedIn: model.isLoggedIn)
        return ZStack {
            switch face {
            case .signedIn:
                Image(systemName: "checkmark")
                    .fontWeight(.bold)
                    .transition(.rawkoonPop)
            case .loading:
                ProgressView().tint(Theme.onAccent)
                    .transition(.rawkoonSwap)
            case .idle:
                Text("Sign In").fontWeight(.semibold)
                    .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: face)
    }
```

- [ ] **Step 5: Compact width — the same, row by row**

Find:

```swift
                loginLockup(titleSize: 40, logoSide: 52)
                    .padding(.vertical, 10)
                    .listRowBackground(Color.clear)
```

Replace with:

```swift
                loginLockup(titleSize: 40, logoSide: 52)
                    .padding(.vertical, 10)
                    .rawkoonEntrance(id: "lockup")
                    .listRowBackground(Color.clear)
```

Find:

```swift
                    .onSubmit { loginFocus = .email }
            }
            .listRowBackground(Theme.raised)

            Section("Credentials") {
```

Replace with:

```swift
                    .onSubmit { loginFocus = .email }
                    .rawkoonEntrance(id: "server")
            }
            .listRowBackground(Theme.raised)

            Section("Credentials") {
```

Find:

```swift
                    .onSubmit { loginFocus = .password }
                HStack {
```

Replace with:

```swift
                    .onSubmit { loginFocus = .password }
                    .rawkoonEntrance(id: "email")
                HStack {
```

Find:

```swift
                    .accessibilityLabel(Text(LocalizedStringKey(revealPassword ? "Hide password" : "Show password")))
                }
            }
            .listRowBackground(Theme.raised)

            Section {
                Button {
                    submit(model)
                } label: {
                    Group {
                        if model.loading {
                            ProgressView().tint(Theme.onAccent)
                        } else {
                            Text("Sign In").fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                    .foregroundStyle(Theme.onAccent)
                    .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(model.loading || !fieldsReady)
                .opacity(fieldsReady ? 1 : 0.6)
                .listRowBackground(Color.clear)
            }
```

Replace with:

```swift
                    .accessibilityLabel(Text(LocalizedStringKey(revealPassword ? "Hide password" : "Show password")))
                }
                .rawkoonEntrance(id: "password")
            }
            .listRowBackground(Theme.raised)

            Section {
                Button {
                    submit(model)
                } label: {
                    signInLabel(model)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                        .foregroundStyle(Theme.onAccent)
                        .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(model.loading || !fieldsReady)
                .opacity(fieldsReady ? 1 : 0.6)
                .rawkoonCelebrate(
                    trigger: model.isLoggedIn, ring: .roundedRect(cornerRadius: 12), tint: Theme.seed,
                    when: { old, new in !old && new && signInAttempted }
                )
                .rawkoonEntrance(id: "signIn")
                .listRowBackground(Color.clear)
            }
```

Find:

```swift
                            .foregroundStyle(Theme.textStrong)
                        }
                        .disabled(model.loading)
                    }
                } header: {
```

Replace with:

```swift
                            .foregroundStyle(Theme.textStrong)
                        }
                        .disabled(model.loading)
                        .rawkoonEntrance(id: "sso-\(provider.slug)")
                    }
                } header: {
```

Find:

```swift
        .scrollContentBackground(.hidden)
        .tint(Theme.apricot)
    }

    /// The provider's configured icon
```

Replace with:

```swift
        .scrollContentBackground(.hidden)
        .tint(Theme.apricot)
        .rawkoonMotion(RawkoonMotion.spring, value: model.errorMessage)
    }

    /// The provider's configured icon
```

- [ ] **Step 6: `LoginExit` and `SignInFace`**

Append at the end of `Rawkoon/Views/LoginView.swift`:

```swift

/// How the root hands over from Login to the tabs: Login stays on top long enough for its success moment.
nonisolated enum LoginExit {
    /// The sign-in celebration's ring runs about 0.44s.
    static let linger: Duration = .milliseconds(450)

    static func showsLogin(isLoggedIn: Bool, exitFinished: Bool) -> Bool {
        !isLoggedIn || !exitFinished
    }
}

/// What the Sign In button shows; an open session wins over the library load still running behind it.
nonisolated enum SignInFace: Equatable {
    case signedIn, loading, idle

    static func face(loading: Bool, signedIn: Bool) -> Self {
        if signedIn {
            return .signedIn
        }
        return loading ? .loading : .idle
    }
}
```

- [ ] **Step 7: The root crossfades from Login into the tabs**

In `Rawkoon/RawkoonApp.swift`, find:

```swift
    @AppStorage(AppLanguage.storageKey) private var appLanguage = AppLanguage.system.rawValue
```

Replace with:

```swift
    @AppStorage(AppLanguage.storageKey) private var appLanguage = AppLanguage.system.rawValue
    /// True once Login has finished leaving; a launch with a saved session starts past it.
    @State private var loginExitFinished = AppModel.shared.isLoggedIn
```

Find:

```swift
            Group {
                #if DEBUG
                    if let screen = DebugScreen.requested, DebugScreen.isOffline(screen) {
                        DebugScreen.offlineView(for: screen)
                    } else if model.isLoggedIn {
                        RootTabsView()
                    } else {
                        LoginView()
                    }
                #else
                    if model.isLoggedIn {
                        RootTabsView()
                    } else {
                        LoginView()
                    }
                #endif
            }
```

Replace with:

```swift
            Group {
                #if DEBUG
                    if let screen = DebugScreen.requested, DebugScreen.isOffline(screen) {
                        DebugScreen.offlineView(for: screen)
                    } else {
                        sessionRoot
                    }
                #else
                    sessionRoot
                #endif
            }
```

Find:

```swift
            .onChange(of: model.isAdmin) { _, isAdmin in
```

Replace with:

```swift
            // Login lingers over the new tabs for its success moment, then the root fades it away.
            .onChange(of: model.isLoggedIn) { _, isLoggedIn in
                guard isLoggedIn else {
                    loginExitFinished = false
                    return
                }
                Task {
                    try? await Task.sleep(for: LoginExit.linger)
                    guard model.isLoggedIn else { return }
                    loginExitFinished = true
                }
            }
            .onChange(of: model.isAdmin) { _, isAdmin in
```

Find:

```swift
    /// On iPhone the tab bar floats over the bottom edge, with the mini player
```

Replace with:

```swift
    /// The tabs mount as soon as the session opens; Login stays on top until its exit finishes, then fades.
    private var sessionRoot: some View {
        let showsLogin = LoginExit.showsLogin(isLoggedIn: model.isLoggedIn, exitFinished: loginExitFinished)
        return ZStack {
            if model.isLoggedIn {
                RootTabsView()
                    .transition(.opacity)
            }
            if showsLogin {
                LoginView()
                    .transition(.opacity)
                    // Keeps the leaving Login above the tabs for its whole fade.
                    .zIndex(1)
            }
        }
        .rawkoonMotion(RawkoonMotion.gentle, value: showsLogin)
        .rawkoonMotion(RawkoonMotion.gentle, value: model.isLoggedIn)
    }

    /// On iPhone the tab bar floats over the bottom edge, with the mini player
```

- [ ] **Step 8: Review**

- Why the linger: when `isLoggedIn` flips, a plain `if/else` removes `LoginView` in the same update, and a removed view is frozen, so its celebration could never start. Keeping it mounted on top lets its body see `isLoggedIn` turn true (the trigger) while the tabs already load underneath; nothing waits on the linger except the fade.
- Launch with a saved session: `AppModel.init` sets `isLoggedIn` from the Keychain before the App's `@State` initializes, so `loginExitFinished` starts true and Login is never drawn. A launch before first unlock shows Login; `reloadCredentialsAfterUnlock` then flips `isLoggedIn` with `signInAttempted` false, so Login just lingers and fades, with no celebration and no haptic.
- Logout: `isLoggedIn` false → `showsLogin` true in the same render (crossfade), then `loginExitFinished` resets. A logout inside the linger window: the task's `guard model.isLoggedIn` stops it from hiding the new Login.
- Haptics: login never calls `model.toast`; `grep -n "toast" Rawkoon/AppModel+Auth.swift` prints nothing. The shake plays `.error` once per new error; the celebration plays `.success` once. The shake's predicate captures `signedIn` from the render, so a `reloadLibrary` error after the session opened does not shake the lingering form.
- Known limit, unchanged behavior: `login()`'s invalid-URL guard sets the same message again without clearing it first, so a second identical invalid-URL submit does not shake.
- `check-env-inject.py` still passes: no `.overlay` or `.sheet` was added after `.environment(model)`.
- Entrances: phone form rows and the regular-width blocks enter once per id through the ledger on the layout `Group`; a recycled Form row never replays. SSO rows enter when the providers arrive.

- [ ] **Step 9: Local gates**

Run the per-task gate block with: `Rawkoon/Views/LoginView.swift Rawkoon/RawkoonApp.swift RawkoonTests/ScreenMotionTests.swift`.

- [ ] **Step 10: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/Views/LoginView.swift Rawkoon/RawkoonApp.swift RawkoonTests/ScreenMotionTests.swift
git commit -m "feat(ios): shake a failed sign-in and celebrate a successful one into the tabs"
```

---

### Task 6: Settings — the test result reveals with a haptic; checkmarks animate

**Files:**
- Modify: `Rawkoon/Views/Settings/SettingsComponents.swift`
- Test: `RawkoonTests/ScreenMotionTests.swift`

**Interfaces:**
- Produces: `TestOutcome.haptic: RawkoonHaptics.Event`; `TestConnectionButton.TestState.init(_ outcome: TestOutcome)`; `private struct SelectionCheck: View`.
- Consumes (Task 1): `rawkoonBounceOnInsert(armed:)`, `.rawkoonPop`. Kit: `withRawkoonMotion`, `.rawkoonReveal`, `.rawkoonSwap`, `rawkoonNumeric`, `RawkoonHaptics.play(_:)`.

- [ ] **Step 1: Write the tests (written now, executed by CI)**

In `RawkoonTests/ScreenMotionTests.swift`, insert before the struct's final closing `}`:

```swift

    @Test func connectionTestPlaysOneHapticPerResult() {
        #expect(TestOutcome.success(nil).haptic == .success)
        #expect(TestOutcome.success("Connected").haptic == .success)
        #expect(TestOutcome.failure("Could not connect.").haptic == .error)
    }

    @Test func connectionTestStateFollowsTheOutcome() {
        #expect(TestConnectionButton.TestState(.success("ok")) == .ok("ok"))
        #expect(TestConnectionButton.TestState(.success(nil)) == .ok(nil))
        #expect(TestConnectionButton.TestState(.failure("no")) == .failed("no"))
    }
```

- [ ] **Step 2: Multi-select checkmarks pop; counts roll**

In `Rawkoon/Views/Settings/SettingsComponents.swift`, find (inside `MultiSelectRow`):

```swift
                    Button {
                        toggle(option.value)
                    } label: {
                        HStack {
                            option.label.foregroundStyle(Theme.text)
                            Spacer()
                            if selected.contains(option.value) {
                                Image(systemName: "checkmark").foregroundStyle(Theme.apricot)
                            }
                        }
                    }
```

Replace with:

```swift
                    Button {
                        withRawkoonMotion(RawkoonMotion.snappy) { toggle(option.value) }
                    } label: {
                        HStack {
                            option.label.foregroundStyle(Theme.text)
                            Spacer()
                            SelectionCheck(isOn: selected.contains(option.value))
                        }
                    }
```

Then replace both occurrences of (in `MultiSelectRow` and `OrderedMultiSelectRow`; use Edit with `replace_all: true` on this exact text):

```swift
                Text("\(selected.count)").foregroundStyle(Theme.muted)
```

with:

```swift
                Text("\(selected.count)").foregroundStyle(Theme.muted)
                    .rawkoonNumeric(Double(selected.count))
```

In `OrderedMultiSelectList`, find:

```swift
                        Button {
                            selected.append(option.value)
                        } label: {
```

Replace with:

```swift
                        Button {
                            withRawkoonMotion(RawkoonMotion.snappy) { selected.append(option.value) }
                        } label: {
```

Find:

```swift
enum TestOutcome: Equatable {
```

Replace with:

```swift
/// A multi-select checkmark that pops in and out; it bounces on a tap, not when the list first shows.
private struct SelectionCheck: View {
    let isOn: Bool
    @State private var armed = false

    var body: some View {
        ZStack {
            if isOn {
                Image(systemName: "checkmark")
                    .foregroundStyle(Theme.apricot)
                    .rawkoonBounceOnInsert(armed: armed)
                    .transition(.rawkoonPop)
            }
        }
        .onAppear { armed = true }
    }
}

enum TestOutcome: Equatable {
```

- [ ] **Step 3: The test result reveals with one haptic**

Find (inside `TestConnectionButton.body`):

```swift
            Button {
                Task {
                    state = .running
                    switch await action() {
                    case let .success(message): state = .ok(message)
                    case let .failure(message): state = .failed(message)
                    }
                }
            } label: {
                HStack {
                    if state == .running {
                        ProgressView().tint(Theme.apricot)
                    }
                    title
                }
            }
            .tint(Theme.apricot)
            .disabled(state == .running)
            .requiresConnection(model.isOffline)

            switch state {
            case let .ok(message):
                if let message {
                    Text(message).font(.footnote).foregroundStyle(Theme.apricot)
                } else {
                    Text("Connected").font(.footnote).foregroundStyle(Theme.apricot)
                }
            case let .failed(message):
                Text(message).font(.footnote).foregroundStyle(Theme.terracotta)
            default:
                EmptyView()
            }
        }
        .listRowBackground(Theme.raised)
```

Replace with:

```swift
            Button {
                Task {
                    withRawkoonMotion(RawkoonMotion.snappy) { state = .running }
                    let outcome = await action()
                    RawkoonHaptics.play(outcome.haptic)
                    withRawkoonMotion(RawkoonMotion.spring) { state = TestState(outcome) }
                }
            } label: {
                HStack {
                    if state == .running {
                        ProgressView().tint(Theme.apricot)
                            .transition(.rawkoonSwap)
                    }
                    title
                }
            }
            .tint(Theme.apricot)
            .disabled(state == .running)
            .requiresConnection(model.isOffline)

            // One slot, so a new result reveals where the last one was.
            ZStack(alignment: .leading) {
                switch state {
                case let .ok(message):
                    Group {
                        if let message {
                            Text(message).font(.footnote).foregroundStyle(Theme.apricot)
                        } else {
                            Text("Connected").font(.footnote).foregroundStyle(Theme.apricot)
                        }
                    }
                    .transition(.rawkoonReveal)
                case let .failed(message):
                    Text(message).font(.footnote).foregroundStyle(Theme.terracotta)
                        .transition(.rawkoonReveal)
                default:
                    EmptyView()
                }
            }
        }
        .listRowBackground(Theme.raised)
```

Append at the end of the file:

```swift

extension TestOutcome {
    /// One haptic per test result; none of the callers toasts, so this is the only one.
    var haptic: RawkoonHaptics.Event {
        switch self {
        case .success: .success
        case .failure: .error
        }
    }
}

extension TestConnectionButton.TestState {
    init(_ outcome: TestOutcome) {
        switch outcome {
        case let .success(message): self = .ok(message)
        case let .failure(message): self = .failed(message)
        }
    }
}
```

- [ ] **Step 4: Line lengths**

The edits above stay under 120 columns; confirm with the lint diff in Step 6.

- [ ] **Step 5: Review**

- One haptic per test: read the five test actions (`testConnection()` in `DownloadClientEditView.swift`, `testAudnexus()` / `testGoogleBooks()` / `testNyt()` in `BooksProviderView.swift`, `testConnection(api:)` in `AiProviderConfigModel.swift`); each returns a `TestOutcome` and none calls `model.toast`, so the button's haptic is the only one. The haptic plays after the await, alongside the reveal; the tap itself is not delayed.
- Both state writes are wrapped in `withRawkoonMotion`, so the List row grows and shrinks with the reveal; `.disabled(state == .running)` and `requiresConnection` are unchanged.
- The `minSelection` rule still blocks removing the last checkmark (nothing changes, nothing animates). A checkmark visible when the list first opens does not bounce (`armed` is false on its first render).
- No new strings: "Connected" and the `"\(selected.count)"` key are unchanged.

- [ ] **Step 6: Local gates**

Run the per-task gate block with: `Rawkoon/Views/Settings/SettingsComponents.swift RawkoonTests/ScreenMotionTests.swift`.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/Views/Settings/SettingsComponents.swift RawkoonTests/ScreenMotionTests.swift
git commit -m "feat(ios): reveal connection test results with a haptic and pop multi-select checks"
```

---

### Task 7: Notifications, Requests and the tab bar badge

**Files:**
- Create: `Rawkoon/Views/Components/ListLoadPhase.swift`
- Modify: `Rawkoon/Views/Notifications/NotificationsListView.swift`
- Modify: `Rawkoon/Views/RequestsView.swift`
- Modify: `Rawkoon/Views/TabBar/RawkoonTabBar.swift`
- Test: `RawkoonTests/ScreenMotionTests.swift`

**Interfaces:**
- Produces: `nonisolated enum ListLoadPhase: Equatable { case loading, offline, failed, empty, list; static func resolve(loading: Bool, offline: Bool, failed: Bool, isEmpty: Bool, showsNothing: Bool) -> Self }`; `nonisolated enum RequestRowFace: Equatable { case busy, moderate, status(String); static func face(busy: Bool, canModerate: Bool, status: String) -> Self }`; `nonisolated enum UnreadBadge { static func rollValue(_ label: String) -> Double }`.
- Consumes (Task 1): `.rawkoonPop`. Kit: `.rawkoonSwap`, `.rawkoonReveal`, `rawkoonMotion`, `rawkoonEntranceScope()`, `rawkoonEntrance(id:)`, `rawkoonCelebrate`, `rawkoonNumeric`.

- [ ] **Step 1: Write the tests (written now, executed by CI)**

In `RawkoonTests/ScreenMotionTests.swift`, insert before the struct's final closing `}`:

```swift

    @Test func listSpinsOnlyWhileNothingIsCached() {
        #expect(listPhase(loading: true, isEmpty: true) == .loading)
        #expect(listPhase(loading: true, isEmpty: false) == .list)
    }

    @Test func listOfflineBeatsAPlainFailure() {
        #expect(listPhase(offline: true, failed: true, isEmpty: true) == .offline)
        #expect(listPhase(failed: true, isEmpty: true) == .failed)
    }

    @Test func listKeepsCachedRowsOverAnError() {
        #expect(listPhase(offline: true, failed: true, isEmpty: false) == .list)
    }

    @Test func listShowsEmptyWhenTheFilterLeavesNothing() {
        let phase = ListLoadPhase.resolve(
            loading: false, offline: false, failed: false, isEmpty: false, showsNothing: true
        )
        #expect(phase == .empty)
    }

    @Test func requestRowBusyWinsThenModerationThenStatus() {
        #expect(RequestRowFace.face(busy: true, canModerate: true, status: "pending") == .busy)
        #expect(RequestRowFace.face(busy: false, canModerate: true, status: "pending") == .moderate)
        #expect(RequestRowFace.face(busy: false, canModerate: false, status: "approved") == .status("approved"))
    }

    @Test func unreadBadgeRollsOnItsNumber() {
        #expect(UnreadBadge.rollValue("3") == 3)
        #expect(UnreadBadge.rollValue("9+") == 9)
        #expect(UnreadBadge.rollValue("") == 0)
    }

    private func listPhase(
        loading: Bool = false, offline: Bool = false, failed: Bool = false, isEmpty: Bool
    ) -> ListLoadPhase {
        ListLoadPhase.resolve(
            loading: loading, offline: offline, failed: failed, isEmpty: isEmpty, showsNothing: isEmpty
        )
    }
```

- [ ] **Step 2: The shared phase**

Create `Rawkoon/Views/Components/ListLoadPhase.swift`:

```swift
import Foundation

/// What a cached list screen shows, in its branch order: a spinner or an error only while nothing is cached.
nonisolated enum ListLoadPhase: Equatable {
    case loading, offline, failed, empty, list

    /// `isEmpty`: nothing is cached; `showsNothing`: the current filter leaves no row to show.
    static func resolve(loading: Bool, offline: Bool, failed: Bool, isEmpty: Bool, showsNothing: Bool) -> Self {
        if loading, isEmpty {
            return .loading
        }
        if offline, failed, isEmpty {
            return .offline
        }
        if failed, isEmpty {
            return .failed
        }
        return showsNothing ? .empty : .list
    }
}
```

- [ ] **Step 3: Notifications — phases, cascade, animated rows, popping dots**

In `Rawkoon/Views/Notifications/NotificationsListView.swift`, replace the whole `@ViewBuilder private var content: some View { … }` property (through its closing `}`, just above `    /// Infinite-scroll sentinel`) with:

```swift
    private var phase: ListLoadPhase {
        ListLoadPhase.resolve(
            loading: loading, offline: model.isOffline, failed: errorMessage != nil,
            isEmpty: notifications.isEmpty, showsNothing: notifications.isEmpty
        )
    }

    /// One slot, so the spinner, the empty and error states and the list crossfade.
    private var content: some View {
        ZStack {
            switch phase {
            case .loading:
                ProgressView().tint(Theme.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.rawkoonSwap)
            case .offline:
                ContentUnavailableView(
                    "You're offline",
                    systemImage: "wifi.slash",
                    description: Text("This will load when you're back online.")
                )
                .rawkoonLivingSymbol(.error)
                .transition(.rawkoonSwap)
            case .failed:
                ContentUnavailableView(
                    "Couldn't load notifications",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage ?? "")
                )
                .rawkoonLivingSymbol(.error)
                .transition(.rawkoonSwap)
            case .empty:
                ContentUnavailableView(
                    "No notifications",
                    systemImage: "bell.slash",
                    description: Text("You're all caught up.")
                )
                .rawkoonLivingSymbol(.empty)
                .transition(.rawkoonSwap)
            case .list:
                notificationList
                    .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: phase)
    }

    private var notificationList: some View {
        List {
            ForEach(notifications) { notification in
                row(notification)
                    .rawkoonEntrance(id: notification.id)
                    .listRowBackground(Theme.raised)
                    .listRowSeparator(.hidden)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive, action: OfflineFeedback.gate(model.isOffline) {
                            pendingDeleteId = notification.id
                        }) {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
            // The sentinel would spin forever offline; it comes back with the connection.
            if hasMore, !model.isOffline {
                loadMoreRow
            }
        }
        .rawkoonEntranceScope()
        // Arrivals, deletions and pages animate in and out of the list.
        .rawkoonMotion(RawkoonMotion.spring, value: notifications.map(\.id))
        .reportsTabBarScroll()
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }
```

Find (inside `row(_:)`):

```swift
                Spacer(minLength: 0)
                if !notification.read {
                    Circle().fill(Theme.apricot).frame(width: 8, height: 8).padding(.top, 4)
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
```

Replace with:

```swift
                Spacer(minLength: 0)
                if !notification.read {
                    Circle().fill(Theme.apricot).frame(width: 8, height: 8).padding(.top, 4)
                        .transition(.rawkoonPop)
                }
            }
            .padding(.vertical, 4)
            .rawkoonMotion(RawkoonMotion.snappy, value: notification.read)
        }
        .buttonStyle(.plain)
```

- [ ] **Step 4: Requests — no ghost, phases, cascade, rows animate out, trailing slot, note reveal**

In `Rawkoon/Views/RequestsView.swift`, find:

```swift
    @State private var loading = false
```

Replace with:

```swift
    /// Starts true so the first frame shows the spinner, not "No requests", before the first load.
    @State private var loading = true
```

Find:

```swift
    private func load() async {
        guard let client = model.api() else { return }
        loading = true
```

Replace with:

```swift
    private func load() async {
        guard let client = model.api() else {
            loading = false
            return
        }
        loading = true
```

Find:

```swift
            if let adminNote {
                Text(adminNote)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
            }

            content
        }
        .readableWidth()
```

Replace with:

```swift
            if let adminNote {
                Text(adminNote)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
                    .transition(.rawkoonReveal)
            }

            content
        }
        .rawkoonMotion(RawkoonMotion.spring, value: adminNote)
        .readableWidth()
```

Replace the whole `@ViewBuilder private var content: some View { … }` property (through its closing `}`, just above `    private func row(_ req: MediaRequest) -> some View {`) with:

```swift
    private var phase: ListLoadPhase {
        ListLoadPhase.resolve(
            loading: loading, offline: model.isOffline, failed: errorMessage != nil,
            isEmpty: requests.isEmpty, showsNothing: visibleRequests.isEmpty
        )
    }

    /// One slot, so the spinner, the empty and error states and the list crossfade.
    private var content: some View {
        ZStack {
            switch phase {
            case .loading:
                ProgressView().tint(Theme.apricot)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.rawkoonSwap)
            case .offline:
                ContentUnavailableView(
                    "You're offline",
                    systemImage: "wifi.slash",
                    description: Text("This will load when you're back online.")
                )
                .rawkoonLivingSymbol(.error)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)
            case .failed:
                ContentUnavailableView(
                    "Couldn't load requests",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage ?? "")
                )
                .rawkoonLivingSymbol(.error)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)
            case .empty:
                ContentUnavailableView(
                    "No requests",
                    systemImage: "tray",
                    description: Text(LocalizedStringKey(filter == .pending ? "No pending requests. Request a title from Discover." : "No requests yet."))
                )
                .rawkoonLivingSymbol(.empty)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)
            case .list:
                requestList
                    .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: phase)
    }

    private var requestList: some View {
        List {
            ForEach(visibleRequests) { req in
                row(req)
                    .rawkoonEntrance(id: req.id)
                    .listRowBackground(Theme.raised)
            }
        }
        .rawkoonEntranceScope()
        // An approved or denied request leaves the Pending list with an animation; so does a filter switch.
        .rawkoonMotion(RawkoonMotion.spring, value: visibleRequests.map(\.id))
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
    }
```

The `description:` line under `"No requests"` is copied unchanged; if it shows in the lint diff, it was already counted in the baseline and only moved.

Find:

```swift
    @ViewBuilder
    private func rowTrailing(_ req: MediaRequest) -> some View {
        if busyRequestId == req.id {
            ProgressView().tint(Theme.apricot)
        } else if model.isAdmin, req.status == "pending" {
            HStack(spacing: 2) {
```

Replace with:

```swift
    /// One slot, so the spinner, the approve/deny buttons and the status badge crossfade.
    private func rowTrailing(_ req: MediaRequest) -> some View {
        let face = RequestRowFace.face(
            busy: busyRequestId == req.id, canModerate: model.isAdmin && req.status == "pending", status: req.status
        )
        return ZStack(alignment: .trailing) {
            switch face {
            case .busy:
                ProgressView().tint(Theme.apricot)
                    .transition(.rawkoonSwap)
            case .moderate:
                moderationButtons(req)
                    .transition(.rawkoonSwap)
            case let .status(status):
                statusBadge(status, tint: badgeTint(status))
                    .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: face)
    }

    private func moderationButtons(_ req: MediaRequest) -> some View {
        HStack(spacing: 2) {
```

Then find the end of the old function:

```swift
                .buttonStyle(.plain)
                .accessibilityLabel("Deny")
                .requiresConnection(model.isOffline)
            }
        } else {
            statusBadge(req.status, tint: badgeTint(req.status))
        }
    }
```

Replace with:

```swift
                .buttonStyle(.plain)
                .accessibilityLabel("Deny")
                .requiresConnection(model.isOffline)
        }
    }
```

After both edits, `moderationButtons(_:)` holds the two buttons exactly as they were (approve `checkmark`, deny `xmark`), one indentation level shallower. Run `swiftformat Rawkoon/Views/RequestsView.swift` (without `--lint`) to fix the indentation of the moved buttons, then review its diff: only whitespace may change.

Append at the end of `Rawkoon/Views/RequestsView.swift`:

```swift

/// What a request row's trailing slot shows; mirrors the slot's branch order.
nonisolated enum RequestRowFace: Equatable {
    case busy, moderate
    case status(String)

    static func face(busy: Bool, canModerate: Bool, status: String) -> Self {
        if busy {
            return .busy
        }
        return canModerate ? .moderate : .status(status)
    }
}
```

- [ ] **Step 5: The tab bar badge pops in, rolls and pulses on a change**

In `Rawkoon/Views/TabBar/RawkoonTabBar.swift`, find:

```swift
                .overlay(alignment: .topTrailing) {
                    if tab == .notifications, let unreadLabel {
                        Text(verbatim: unreadLabel)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Capsule().fill(Theme.badge))
                            .overlay(Capsule().strokeBorder(Theme.tabBar, lineWidth: 2))
                            .offset(x: 9, y: -7)
                    }
                }
```

Replace with:

```swift
                .overlay(alignment: .topTrailing) {
                    // The slot outlives the badge, so it pops in and out; a count change rolls and pulses it.
                    ZStack {
                        if tab == .notifications, let unreadLabel {
                            Text(verbatim: unreadLabel)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .rawkoonNumeric(UnreadBadge.rollValue(unreadLabel))
                                .padding(.horizontal, 4)
                                .frame(minWidth: 16, minHeight: 16)
                                .background(Capsule().fill(Theme.badge))
                                .overlay(Capsule().strokeBorder(Theme.tabBar, lineWidth: 2))
                                .rawkoonCelebrate(trigger: unreadLabel, tint: Theme.badge, haptic: nil)
                                .offset(x: 9, y: -7)
                                .transition(.rawkoonPop)
                        }
                    }
                    .rawkoonMotion(RawkoonMotion.snappy, value: unreadLabel != nil)
                }
```

Find:

```swift
private struct ActiveSlotBounds: PreferenceKey {
```

Replace with:

```swift
/// The value the unread badge rolls on; "9+" rolls as 9.
nonisolated enum UnreadBadge {
    static func rollValue(_ label: String) -> Double {
        Double(String(label.prefix { $0.isNumber })) ?? 0
    }
}

private struct ActiveSlotBounds: PreferenceKey {
```

- [ ] **Step 6: Line lengths**

`rowTrailing`'s `RequestRowFace.face(` call is wrapped to stay under 120 columns; keep it that way after swiftformat.

- [ ] **Step 7: Review**

- Both phases mirror their old `if` chains exactly (Notifications: every check on `notifications.isEmpty`; Requests: the first three on `requests.isEmpty`, the empty state on `visibleRequests.isEmpty`). The phase key sits outside each `switch`. A live reload (`loading = true` with rows on screen) stays on `.list`.
- Requests no longer flashes "No requests" before its first fetch; the signed-out guard clears the flag, so it never spins forever. `hydrateFromCache` rows still win over the flag.
- Rows animate in and out through the id-keyed motion on each `List`, so an approve or deny that reloads the Pending filter removes the row with an animation, and a mark-read pops the dot (`markAllAsRead` pops them all). No haptic was added to approve, deny, mark-read or delete.
- The badge keeps its exact geometry; the pulse is the Home bell's (`rawkoonCelebrate` with `haptic: nil`); a badge that appears or disappears pops, and a changed count rolls and pulses. The sidebar's system `.badge` (iPad, Mac) is unchanged.
- Every moved literal keeps its key; `Text(errorMessage ?? "")` stays verbatim like the old `Text(errorMessage)`.

- [ ] **Step 8: Local gates**

Run the per-task gate block with: `Rawkoon/Views/Components/ListLoadPhase.swift Rawkoon/Views/Notifications/NotificationsListView.swift Rawkoon/Views/RequestsView.swift Rawkoon/Views/TabBar/RawkoonTabBar.swift RawkoonTests/ScreenMotionTests.swift`.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/Views/Components/ListLoadPhase.swift Rawkoon/Views/Notifications/NotificationsListView.swift \
  Rawkoon/Views/RequestsView.swift Rawkoon/Views/TabBar/RawkoonTabBar.swift RawkoonTests/ScreenMotionTests.swift
git commit -m "feat(ios): crossfade notifications and requests, animate their rows and pulse the unread badge"
```

---

### Task 8: Carry-ins — sidebar zoom ids and Activity's cancelled cold load

**Files:**
- Modify: `Rawkoon/RawkoonApp.swift`
- Modify: `Rawkoon/Views/ActivityView.swift`

**Interfaces:**
- Produces: `RootTabsView.shownTab: RootTab` (private computed).
- Consumes: `RootTab.validated(_:compact:isAdmin:)`, `\.isActiveRootTab`.

- [ ] **Step 1: The sidebar marks its shown tab**

In `Rawkoon/RawkoonApp.swift`, find:

```swift
    /// The sidebar floats the mini player over content, so each stack scrolls clear of it.
    private func sidebarRoot(_ tab: RootTab) -> some View {
        tabRoot(tab)
            .background(NavigationBottomInset(
                bottom: model.activeBook() == nil ? 0 : MiniPlayerInset.height,
                mountedTabs: 0
            ))
    }
```

Replace with:

```swift
    /// The sidebar floats the mini player over content, so each stack scrolls clear of it.
    private func sidebarRoot(_ tab: RootTab) -> some View {
        tabRoot(tab)
            .background(NavigationBottomInset(
                bottom: model.activeBook() == nil ? 0 : MiniPlayerInset.height,
                mountedTabs: 0
            ))
            // Kept-alive sidebar tabs share the zoom namespace; only the shown one registers plain ids.
            .environment(\.isActiveRootTab, tab == shownTab)
    }

    /// The selection as shown: a tab absent at this width or role falls back instead of staying selected.
    private var shownTab: RootTab {
        RootTab.validated(selection.rawValue, compact: compact, isAdmin: model.isAdmin)
    }
```

Find:

```swift
        let validSelection = Binding(
            get: { RootTab.validated(selection.rawValue, compact: compact, isAdmin: model.isAdmin) },
            set: { selection = $0 }
        )
```

Replace with:

```swift
        let validSelection = Binding(
            get: { shownTab },
            set: { selection = $0 }
        )
```

- [ ] **Step 2: A cancelled cold queue load leaves the skeleton armed**

In `Rawkoon/Views/ActivityView.swift`, find:

```swift
        defer {
            loadingQueue = false
            didLoadQueue = true
        }
```

Replace with:

```swift
        defer {
            loadingQueue = false
            // A cancelled cold load showed nothing, so the next one still opens on the skeleton.
            if !Task.isCancelled {
                didLoadQueue = true
            }
        }
```

- [ ] **Step 3: Review**

- iPhone is untouched (`PhoneTabsView` already sets `isActiveRootTab`). On iPad and Mac, a hidden sidebar tab now reads `isActiveRootTab == false`, as a hidden phone tab does, so its posters register `#background` zoom ids and zooms use the shown tab's. Three views already react to this value the way they do on iPhone: `LibraryView` and `SettingsView` refresh when their tab becomes shown again, and `ReencodeAdminView` polls only while shown. That is the intended parity, not new behavior.
- `validSelection`'s getter returns the same value as before (`shownTab` is the same expression).
- `loadQueue`: a cancelled load still clears `loadingQueue`; a finished one (success or error) still sets `didLoadQueue`. A load that was not cold is unaffected (`didLoadQueue` was already true).

- [ ] **Step 4: Local gates**

Run the per-task gate block with: `Rawkoon/RawkoonApp.swift Rawkoon/Views/ActivityView.swift`.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-player-books-login-settings
git add Rawkoon/RawkoonApp.swift Rawkoon/Views/ActivityView.swift
git commit -m "fix(ios): mark the shown sidebar tab and keep a cancelled cold queue load on its skeleton"
```

---

### Task 9: Full gates and scope check

**Files:** none beyond fixes the gates demand. The controller pushes and opens the PR; this task does neither.

- [ ] **Step 1: Whole-tree CI lint steps, locally**

Run from `apps/ios/`:

```bash
SDD=/home/samuelloranger/sites/rawkoon/.superpowers/sdd/2026-10-10-ios-motion-player-books-login-settings
python3 scripts/check-l10n.py
python3 scripts/check-env-inject.py
python3 scripts/check-raw-animation.py
swiftformat Rawkoon RawkoonTests RawkoonWidgets WidgetSupport Sources Tests --lint
bash "$SDD/rawkoon-pr4-lint.sh" > "$SDD/swiftlint-after.txt"
diff "$SDD/swiftlint-baseline.txt" "$SDD/swiftlint-after.txt"
```

Expected: all three scripts pass, swiftformat reports 0 files, and the lint diff shows no new or higher `file rule` count. If something fails, fix it in a new `style(ios): …` or `fix(ios): …` commit (never amend).

- [ ] **Step 2: Scope check against the PR 3 branch**

```bash
git fetch origin feat/ios-motion-detail-search-activity
git diff --stat origin/feat/ios-motion-detail-search-activity...HEAD
git diff origin/feat/ios-motion-detail-search-activity...HEAD --name-only | grep -v '^apps/ios/' ; echo "non-ios files above (expect only this plan)"
```

Expected: only the files in the File Structure table plus this plan. No repo-root `CLAUDE.md`, `docker-compose.yml`, `.glim/` or `testflight_feedback.zip`. No file under `Rawkoon/Views/Home*`, `Library*`, `Discover/`, `Detail/`, `ReleaseSearch*`, `MediaDetailView.swift`, `ContinueListeningView.swift` or `MiniPlayerView.swift`.

- [ ] **Step 3: Raw animation, haptic and API spot-checks**

```bash
grep -rn "withAnimation\|\.animation(" Rawkoon --include='*.swift' | grep -v '^Rawkoon/Motion/' | grep -v 'motion-ok'
grep -rn "RawkoonHaptics.play(.downloadComplete)" Rawkoon/Views/BookView.swift
grep -rn "UIImpactFeedbackGenerator\|UINotificationFeedbackGenerator\|UISelectionFeedbackGenerator" Rawkoon --include='*.swift' | grep -v '^Rawkoon/Motion/'
```

Expected: the first prints nothing new compared with the PR 3 branch (`git grep -n "withAnimation\|\.animation(" origin/feat/ios-motion-detail-search-activity -- apps/ios/Rawkoon` if unsure); the second and third print nothing.

- [ ] **Step 4: Report to the controller**

Report the gate output, the commit list (`git log --oneline origin/feat/ios-motion-detail-search-activity..HEAD`), and confirm the branch with `git rev-parse --abbrev-ref HEAD`. Do not push.

Suggested PR text for the controller (base `feat/ios-motion-detail-search-activity`):

- Title: `feat(ios): motion on the player, books, login, settings and lists`
- Body summary: the player cover sits back on pause and springs forward on play, the chapter title rolls up, rate and sleep chips roll, and the 30-second skip arrows spin; book lanes slide, the play button swaps to its spinner, chapters crossfade and cascade, and a finished download celebrates with a single haptic while its glyph bounces; ebook file actions swap in place and the reader crossfades its states and rolls its percentage; Login enters in sequence, shakes a failed sign-in with an error haptic, and celebrates a successful one before crossfading into the tabs; connection tests reveal their result with a haptic and multi-select checks pop; Notifications and Requests crossfade their states, cascade and animate rows in and out (Requests no longer flashes "No requests" first); the tab bar's unread badge pops, rolls and pulses. Kit additions: shake, symbol spin, bounce on insert, pop transition, and a disabled dim in the pressable style that defers to `requiresConnection`. Carry-ins: the sidebar marks its shown tab for zoom ids, and a cancelled cold Activity queue load keeps its skeleton. Verification: CI (kit, lint, build, `RawkoonTests`); simulator recordings and a device pass are still owed because the Mac build host was offline.

---

## Verification

- **Per task:** the local gate block (python checks, swiftformat, swiftlint diff against the Task 1 baseline).
- **Compile and tests:** GitHub CI on push (`build` job: `xcodebuild test -only-testing:RawkoonTests`, then a simulator build). Linux cannot compile the app target. The new tests (`RawkoonMotionTests` shake, pop and pressable; `ScreenMotionTests` player, ebook, login, settings and list phases) are written now and run there.
- **Still owed after the PR opens (operator, when macbuild is back):** simulator recordings of the player (play/pause, a chapter change, rate and sleep changes, both skips), the book screen (lane switch, play from cold, a chapter list load, a download to completion, an ebook download and removal), the ebook reader (open and a failed open), Login (cold launch, a failed and a successful sign-in, logout), a Settings test connection (success and failure) and a multi-select list, Notifications and Requests (cold load, mark read, approve/deny), and the tab badge changing, with Reduce Motion spot-checked on the same screens; a device install for the haptics (one per event), the skip arrows' rotate effect on `gobackward.30`/`goforward.30`, and the sign-in linger timing. No TestFlight build is cut to test.

## Self-review

- **Spec coverage (PR 4 section):**
  - Player chapter title rolls or slides: Task 2 Step 3.
  - Player playback rate rolls: Task 2 Step 4.
  - Player sleep timer rolls (mode change and countdown): Task 2 Steps 4–5.
  - Skip ±30 arrows spin with a symbol effect: Task 1 Step 4 (`rawkoonSymbolSpin`), Task 2 Steps 4–5.
  - Signature: the artwork shrinks slightly on pause and springs back on play: Task 2 Steps 3 and 5.
  - Books lane switch: Task 3 Steps 1–3.
  - Books player-loading swap: Task 3 Step 5.
  - Books chapter list cascade (plus its phase crossfade): Task 3 Step 7.
  - Download complete fires `Celebration` via `RawkoonHaptics.downloadComplete`, exactly one haptic: Task 3 Steps 4 and 6.
  - Ebook file row button states swap smoothly: Task 4 Steps 2–3.
  - Ebook reader opening → failed → ready use `rawkoonSwap`; the reading percentage rolls: Task 4 Step 4.
  - Login logo and form enter in sequence: Task 5 Steps 3–5.
  - Signature: an error shakes the form with an error haptic: Task 1 Step 3 (`rawkoonShake`), Task 5 Step 3.
  - Signature: success fires `Celebration`, then the root crossfades from Login into the tabs: Task 5 Steps 4–7.
  - Settings test-connection result reveals with a success or error haptic: Task 6 Step 3.
  - Settings multi-select checkmarks animate: Task 6 Step 2.
  - Notifications and Requests loading → list uses `rawkoonSwap`: Task 7 Steps 2–4.
  - Unread dots animate: Task 7 Step 3.
  - Approved or denied rows animate out: Task 7 Step 4.
  - Tab bar unread badge bounces when its count changes: Task 7 Step 5.
- **Carry-ins:**
  - (a) `DownloadStateIcon` bounces on a state change where `BookView` hosts it, keeping the celebrating check: Task 1 Step 4 (`rawkoonBounceOnInsert`), Task 3 Steps 6 and 8.
  - (b) `PressableStyle` and disabled controls: Task 1 Steps 2 and 6–7.
  - (c) Catalyst sidebar sets `isActiveRootTab` per tab: Task 8 Step 1.
  - (d) A cancelled cold Activity queue load no longer marks the queue loaded: Task 8 Step 2.
- **Added because the acceptance list requires it and no other PR owns these screens:** Login's sign-in face swap (spinner → check, the static mark Reduce Motion keeps) and error reveal (Task 5); the multi-select count roll and ordered-list add animation (Task 6); the Requests admin-note reveal and trailing-slot crossfade (Task 7); ebook Files card phase crossfade and cascade (Task 4).
- **Decisions taken while planning (ambiguities resolved):**
  - **Disabled pressables (carry-in b):** `PressableStyle` dims a disabled control to 0.5, and `requiresConnection` sets `\.rawkoonDisabledDimHandled` so the style does not dim again while offline (0.45 once). The rule is "a disabled control dims exactly once"; an environment flag is the only way a style can learn that an ancestor already dimmed it. Consequences, accepted: Library rows for an unconfirmed add, and Home upcoming cards with no id, now look disabled; `ContinueListeningView` rows and Home attention rows dim while one of them is opening, because those sites disable every row as a re-entrancy guard.
  - **`DownloadStateIcon` bounce (carry-in a):** `rawkoonSymbolBounce` keys on a value a mounted image sees change, but each download state is its own `switch` branch, so the incoming glyph is always new and would never bounce. The kit gains `rawkoonBounceOnInsert(armed:)`; the icon arms it after its first render. The download button also drops its `idle/failed` vs other branch split (now one view with `requiresConnection(isOffline && needsConnection)`), so the icon and the celebration keep their state across a change.
  - **One download haptic:** the direct `RawkoonHaptics.play(.downloadComplete)` is removed and the button's `rawkoonCelebrate(… haptic: .downloadComplete, when: false → true)` on `showDownloadFinished` plays it.
  - **Login → tabs:** the root keeps Login on top of the freshly mounted tabs for `LoginExit.linger` (0.45s), because a view removed by a plain `if/else` is frozen and could never play its celebration. Loading is not delayed (the tabs mount at once); only Login's fade waits. The celebration needs a user-initiated attempt (`signInAttempted`), so a session restored after first unlock just crossfades.
  - **Login sequence:** the entrance ledger (`rawkoonEntrance` with a scope on the layout), not `rawkoonLanding`, because Form rows are recycled and a landing's state would replay on scroll-back; the ledger plays once per id.
  - **Login shake:** keyed on `errorMessage` becoming non-nil while not signed in; the haptic is the shake's `.error` (login never toasts).
  - **Chapter title direction:** always rolls up from below; the change comes from the player, so no edge can be written before it.
  - **Sleep chip:** one verbatim label for every mode (`sleepLabel`, same catalog keys) so the text stays mounted and rolls; the roll value is 0 off, −1 end of chapter, then whole seconds.
  - **Skip spin:** `.rotate.clockwise/.counterClockwise.byLayer`; the skip runs before the spin counter changes.
  - **Test connection haptic:** imperative `RawkoonHaptics.play(outcome.haptic)` after the await, since the result is an async return value, not view state that a `sensoryFeedback` could key on cleanly.
  - **Requests no-ghost loading:** `loading` starts true, and the signed-out guard clears it. This changes only the placeholder before the first load.
  - **Tab badge "bounce":** the same pulse as Home's bell dot (`rawkoonCelebrate`, `haptic: nil`) plus a numeric roll, on any count change; appearance and disappearance pop.
- **Observed while planning, not changed here:** the ebook lane's primary block ("Download primary file" / "Saved for offline reading") still cuts between its states; the spec names only the file rows. `MiniPlayerView` is not in the spec's PR 4 list and is untouched. `login()`'s invalid-URL guard does not clear `errorMessage` first, so an identical repeated invalid-URL error does not shake again.
- **Type consistency:** these names are identical in every task that uses them: `RawkoonShake.offsets`, `RawkoonShake.beat`, `rawkoonShake(trigger:haptic:when:)`, `rawkoonSymbolSpin(_:clockwise:)`, `rawkoonBounceOnInsert(armed:)`, `.rawkoonPop`, `RawkoonPop.hiddenScale`, `RawkoonPop.scale(isIdentity:reduceMotion:)`, `\.rawkoonDisabledDimHandled`, `PressableAppearance.pressedOpacity`, `PressableAppearance.disabledOpacity`, `PressableAppearance.opacity(isPressed:isEnabled:dimHandledAbove:)`, `PlayerMotion.pausedArtworkScale`, `PlayerMotion.artworkScale(isPlaying:reduceMotion:)`, `PlayerMotion.sleepRollValue(isOff:remaining:)`, `SkipControl`, `BookDetailLane.order`, `laneSlideEdge`, `chapterRows`, `chapterButton(_:)`, `chaptersFailure(_:)`, `EbookFileAction.phase(downloading:opening:downloaded:)`, `EbookFilesPhase.resolve(loading:isEmpty:)`, `ebookFileRow(_:)`, `ebookFileActions(_:downloaded:)`, `ReaderPhase`, `LoginExit.linger`, `LoginExit.showsLogin(isLoggedIn:exitFinished:)`, `SignInFace.face(loading:signedIn:)`, `signInAttempted`, `signInLabel(_:)`, `signIn(with:)`, `loginExitFinished`, `sessionRoot`, `TestOutcome.haptic`, `TestConnectionButton.TestState.init(_:)`, `SelectionCheck`, `ListLoadPhase.resolve(loading:offline:failed:isEmpty:showsNothing:)`, `RequestRowFace.face(busy:canModerate:status:)`, `moderationButtons(_:)`, `UnreadBadge.rollValue(_:)`, `shownTab`.
