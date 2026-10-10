# iOS Motion: Detail, Release search, Activity (PR 3 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the motion kit to media detail, the book hero, release search (media and book) and Activity, give each its signature moment (stretching heroes whose header lands after the zoom, a celebrated grab, a check burst on a finished download), and close the three carry-ins from PR 2's reviews. This is PR 3 of the expressive motion pass.

**Architecture:** Views consume the kit in `Rawkoon/Motion/`. The kit grows in four backward-compatible ways: the stretchy hero is now driven by its host ScrollView's own geometry (`rawkoonStretchyHeroHost()` measures the pull from `ScrollGeometry`, so a hero under a navigation bar is never pre-stretched at rest) and clips below its own bottom edge; a `rawkoonLanding(step:)` cascade waits out what is left of the zoom push; a `rawkoonSlide(_:)` transition enters from a side and leaves by fading in place; `rawkoonSymbolBounce(_:)` bounces a symbol on a trigger. New pure logic (`HeroStretch.pull`, `HeroLanding.delay`, `RawkoonSlide`, `DownloadMotion`, `AiPickBanner.phase`) is `nonisolated` and covered by Swift Testing in `RawkoonTests`.

**Tech Stack:** SwiftUI (iOS 26.2 floor), Swift 6.2 with `SWIFT_STRICT_CONCURRENCY: complete` and `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`, Swift Testing, SwiftLint, SwiftFormat, the repo's python check scripts, GitHub Actions (`.github/workflows/ios.yml`).

**Spec:** `docs/superpowers/specs/2026-10-09-ios-expressive-motion-design.md`, section "PR 3: Detail, Release search, Activity", plus its global rules, edge cases and acceptance list. PR 2 plan (format and lessons): `docs/superpowers/plans/2026-10-09-ios-motion-home-library-discover.md`.

**Branch:** `feat/ios-motion-detail-search-activity`, stacked on PR 2's branch `feat/ios-motion-home-library-discover`. The PR's base is that branch, not `main`.

## Global Constraints

- Deployment floor: iOS 26.2 (`project.yml`). Do not raise it.
- No new third-party dependency.
- No behavior change: same data, same navigation, same actions, same strings. Only motion and haptics change. The three "no ghost" loading fixes below change only which placeholder shows before the first load finishes; each is listed under "Decisions taken while planning".
- No on-device state migration.
- Every motion is Reduce-Motion safe. Use the kit, which reads `accessibilityReduceMotion` itself. Movement becomes a crossfade, celebrations become haptic-only, heroes stay static, nothing loops.
- No animation runs longer than about 0.45s plus its stagger or landing delay. Animations never delay a tap or a navigation.
- No raw `.animation(` or `withAnimation` outside `Rawkoon/Motion/`. Use `.rawkoonMotion(_:value:)` or `withRawkoonMotion`. `scripts/check-raw-animation.py` enforces this; a self-gated exception needs `// motion-ok: <reason>` on the line above. This PR needs none.
- App target code is `@MainActor` by default. Pure helpers called from tests or from Sendable closures (`visualEffect`, `keyframeAnimator`, `sensoryFeedback` conditions, `onScrollGeometryChange` transforms) are `nonisolated`. Copy values into locals before such closures. A `Shape` is declared `nonisolated struct` so its `path(in:)` satisfies the protocol.
- Every `.transition` plays only if its state change is animated: either by a value-keyed `.rawkoonMotion` placed **outside** the conditional, keyed on a phase value that mirrors the branch order (never a one-shot flag such as `loading`), or by `withRawkoonMotion` around the write.
- Two states that swap must share **one slot** (a `ZStack`), so the outgoing view never stacks above or beside the incoming one during the transition. A `VStack`/`HStack` keeps the removed view in its layout until the animation ends.
- A number only rolls if its `Text` stays mounted. Put `.rawkoonNumeric` on a `Text` whose identity survives the change.
- Set a loading flag synchronously before (or instead of) showing an empty state, so an empty state never flashes ahead of the skeleton. Every early return from a loader that starts "loading" must clear the flag.
- Zoom ids stay unique per context (`ZoomSourceKey.scoped`). This PR adds no zoom sources.
- New user-facing `Text("…")` literals need a `Rawkoon/Localizable.xcstrings` entry (English key plus `fr`). This PR adds none; keep it that way. Moved literals keep their existing keys.
- Comments say why, in one line.
- Commits follow Conventional Commits. No Co-Authored-By trailer.
- Stage files by explicit path only. Never stage the repo-root `CLAUDE.md`, `docker-compose.yml`, `.glim/` or `testflight_feedback.zip` (the user's uncommitted work). Never `git stash` in any form, never `git checkout` another branch.
- Before every commit, run `git rev-parse --abbrev-ref HEAD` and confirm it prints `feat/ios-motion-detail-search-activity` (other agents switch branches in shared trees).
- **macbuild is offline for this PR.** Do not call `macbuild`. The local gates are the python checks, `swiftformat --lint` and the SwiftLint baseline diff. The compile and app-test gate is GitHub CI on push: the `build` job (`macos-26`) runs `xcodebuild test -only-testing:RawkoonTests` and a simulator build. Tests written in this plan are **written now, executed by CI**; never claim a local test run.
- Never push, merge, tag, bump the version, or cut a release. The controller pushes and opens the PR. A merge to `main` ships to production and TestFlight.

## Review Focus

1. **A hero must sit unstretched and unfaded at rest, and its parallax must never draw over the content below.** The old modifier read `.scrollView`-space `minY`, which at rest equals the top inset under a navigation bar, so the hero sat pre-stretched. The hero now reads `HeroStretch.pull`, computed from the host ScrollView's `contentOffset.y + contentInsets.top` (0 at rest whatever the inset), and the layer clips below its own bottom edge. Pinned by `heroPullIsZeroAtRestWhateverTheTopInset` and `heroAtRestPullIsIdentity` (Task 1) and Task 2 Step 5's review (host on the same ScrollView as each hero, stretch on the backdrop layer only, identity row unclipped).
2. **A grab celebrates only when the server confirmed it, with exactly one haptic.** The interactive token grab replies HTTP 200 even when it fails, so the row's trigger is `isGrabbed`, which `grab(_:)` sets only after `result.grabbed` is true on both the URL and token paths. Rows and the AI banner celebrate with `haptic: nil`; the sheet plays one `.grab` haptic per new entry in `grabbedGuids`. Pinned by the existing `CelebrationGate` tests and Task 5 Step 7's review; the book sheet follows the same rule (Task 6 Step 5).
3. **No empty state flashes ahead of the first load, and no screen spins forever.** Release search now opens as "Searching…" (not "No Results"), detail opens on its skeleton (not an empty hero), Similar on its shimmer, and each Activity lane on its skeleton. Every early return that could leave a flag set clears it (`search()`'s three guards, `loadHistory`'s sign-in guard). Pinned by Task 3 Step 9, Task 5 Step 7 and Task 7 Step 6 reviews.
4. **The header landing never hides content for long and never replays.** The title, action row and tab bar wait at most `HeroLanding.settle` (0.3s) plus three 0.06s beats, minus the time already spent on screen, so content that arrives after a network load lands at once. A view lands once per identity; returning from a pushed screen does not replay it. Pinned by the `HeroLanding` tests (Task 1) and Task 2 Step 5's review.
5. **Tab and lane slides go the right way and never stack.** The entering view slides from the tapped side; the leaving view fades in place (its direction would otherwise be read from a stale render). Both sit in one `ZStack` slot. Pinned by the `RawkoonSlide` tests (Task 1) and the Task 3 Step 9 and Task 7 Step 6 reviews.

---

## File Structure

All paths below are relative to `apps/ios/`. Run every command from `apps/ios/` on branch `feat/ios-motion-detail-search-activity`.

| File | Responsibility |
|---|---|
| `Rawkoon/Motion/HeroStretch.swift` (rewrite) | `HeroStretch.pull`, `HeroScroll`, `rawkoonStretchyHeroHost()`, host-driven clipped `rawkoonStretchyHero`, `HeroLanding`, `rawkoonLanding(step:)` |
| `Rawkoon/Motion/RawkoonTransitions.swift` (modify) | `.rawkoonSlide(_:)`, `RawkoonSlide` |
| `Rawkoon/Motion/RawkoonSymbols.swift` (modify) | `rawkoonSymbolBounce(_:)` |
| `Rawkoon/Views/Components/DownloadMotion.swift` (create) | `DownloadMotion.isRunning` / `isComplete` |
| `Rawkoon/Views/DebugMotionGallery.swift` (modify) | Host for its demo hero |
| `Rawkoon/Views/Detail/DetailHero.swift` (rewrite) | Backdrop stretch, landing, status pill swap and pop |
| `Rawkoon/Views/Detail/BookHero.swift` (rewrite) | Backdrop stretch, landing |
| `Rawkoon/Views/BookView.swift` (modify) | Hero host, lane picker landing |
| `Rawkoon/Views/MediaDetailView.swift` (modify) | Host, landing origin, phases, tab slide, primary action swap, Similar swap and cascade, watchlist bounce |
| `Rawkoon/Views/Detail/MediaDetailView+Actions.swift` (modify) | Watchlist bounce trigger |
| `Rawkoon/Views/Detail/MediaDetailView+Management.swift` (modify) | Management phase swap, notice and error reveal |
| `Rawkoon/Views/Detail/DetailSeasonsSection.swift` (modify) | Chevron rotation, season reveal, count roll |
| `Rawkoon/Views/Detail/DetailDownloadRow.swift` (modify) | Speed and percentage roll, active sheen |
| `Rawkoon/Views/ReleaseSearchView.swift` (modify) | Phases, notices reveal, chips, badge, cascade, grab haptic, no-ghost loading |
| `Rawkoon/Views/ReleaseSearch/ReleaseRow.swift` (modify) | Action swaps, AI-pick morph, grab celebration |
| `Rawkoon/Views/ReleaseSearch/AiPickBanner.swift` (rewrite) | One morphing shell, `AiPickBanner.phase` |
| `Rawkoon/Views/BookReleaseSearchView.swift` (modify) | Phases, cascade, grab celebration and haptic |
| `Rawkoon/Views/ActivityView.swift` (modify) | Lane slide, speed reveal, phases, cascades, rolls, sheen, badge swap, check burst |
| `RawkoonTests/RawkoonMotionTests.swift` (modify) | Hero pull, landing, slide tests |
| `RawkoonTests/SurfaceMotionTests.swift` (modify) | `DownloadMotion`, `AiPickBanner.phase` tests |

New files are picked up by XcodeGen's folder sources (`project.yml` lists `Rawkoon` and `RawkoonTests`); CI runs `xcodegen generate`.

### Per-task local gates

Every task ends with the same gate block, run from `apps/ios/`:

```bash
SDD=/home/samuelloranger/sites/rawkoon/.superpowers/sdd/2026-10-09-ios-motion-detail-search-activity
python3 scripts/check-l10n.py
python3 scripts/check-env-inject.py
python3 scripts/check-raw-animation.py
swiftformat <the task's touched .swift files> --lint
bash "$SDD/rawkoon-pr3-lint.sh" > "$SDD/swiftlint-after.txt"
diff "$SDD/swiftlint-baseline.txt" "$SDD/swiftlint-after.txt"
```

Expected: the three scripts print `ok`; swiftformat reports 0 files (if it names a file, run `swiftformat <that file>` without `--lint`, re-run, and review the diff it made); the lint `diff` shows no new `file rule` pair and no higher count (a lower count is fine). A count that went up is a new warning: fix it before committing. `rawkoon-pr3-lint.sh` and the baseline are written in Task 1 Step 1. `.superpowers/` is git-ignored.

---

### Task 1: Kit — host-driven hero, landing, slide, symbol bounce, download states

**Files:**
- Rewrite: `Rawkoon/Motion/HeroStretch.swift`
- Modify: `Rawkoon/Motion/RawkoonTransitions.swift`
- Modify: `Rawkoon/Motion/RawkoonSymbols.swift`
- Create: `Rawkoon/Views/Components/DownloadMotion.swift`
- Modify: `Rawkoon/Views/DebugMotionGallery.swift`
- Test: `RawkoonTests/RawkoonMotionTests.swift`, `RawkoonTests/SurfaceMotionTests.swift`

**Interfaces:**
- Produces:
  - `HeroStretch.pull(contentOffsetY: CGFloat, insetTop: CGFloat) -> CGFloat` (`nonisolated`), `HeroStretch.trackedDepth: CGFloat` (600). `HeroStretch.transform(minY:height:)` keeps its signature; `minY` now means "top edge relative to rest".
  - `@Observable final class HeroScroll { var pull: CGFloat }`; `EnvironmentValues.rawkoonHeroScroll: HeroScroll?`.
  - `func rawkoonStretchyHeroHost() -> some View` — goes on the ScrollView.
  - `func rawkoonStretchyHero(height: CGFloat, fileID: String = #fileID, line: Int = #line) -> some View` — existing calls compile unchanged; static without a host (DEBUG log once per call site); clips below its bottom edge.
  - `nonisolated enum HeroLanding { static let settle: Double; static let beat: Double; static func delay(step: Int, elapsed: TimeInterval) -> Double }`; `EnvironmentValues.rawkoonLandingOrigin: TimeInterval?`; `func rawkoonLanding(step: Int) -> some View`.
  - `struct RawkoonSlideTransition: Transition`; `static func rawkoonSlide(_ edge: Edge) -> RawkoonSlideTransition`; `nonisolated enum RawkoonSlide { static let distance: CGFloat; static func edge(from: Int, to: Int) -> Edge; static func offset(edge: Edge, appearing: Bool, reduceMotion: Bool) -> CGSize }`.
  - `func rawkoonSymbolBounce(_ trigger: some Equatable) -> some View`.
  - `nonisolated enum DownloadMotion { static func isRunning(state: String) -> Bool; static func isComplete(state: String) -> Bool }`.
- Consumes: `Log.motion`, `RawkoonMotion.spring` / `.reduced`.

- [ ] **Step 1: Record the lint baseline for every file this PR touches**

Run from `apps/ios/`, before any edit:

```bash
SDD=/home/samuelloranger/sites/rawkoon/.superpowers/sdd/2026-10-09-ios-motion-detail-search-activity
mkdir -p "$SDD"
cat > "$SDD/rawkoon-pr3-lint.sh" <<'EOF'
#!/usr/bin/env bash
# Per-file, per-rule SwiftLint warning counts for the files PR 3 touches.
cd /home/samuelloranger/sites/rawkoon/apps/ios || exit 1
files=()
for f in \
  Rawkoon/Motion/HeroStretch.swift Rawkoon/Motion/RawkoonTransitions.swift \
  Rawkoon/Motion/RawkoonSymbols.swift Rawkoon/Views/Components/DownloadMotion.swift \
  Rawkoon/Views/DebugMotionGallery.swift Rawkoon/Views/Detail/DetailHero.swift \
  Rawkoon/Views/Detail/BookHero.swift Rawkoon/Views/BookView.swift \
  Rawkoon/Views/MediaDetailView.swift Rawkoon/Views/Detail/MediaDetailView+Actions.swift \
  Rawkoon/Views/Detail/MediaDetailView+Management.swift Rawkoon/Views/Detail/DetailSeasonsSection.swift \
  Rawkoon/Views/Detail/DetailDownloadRow.swift Rawkoon/Views/ReleaseSearchView.swift \
  Rawkoon/Views/ReleaseSearch/ReleaseRow.swift Rawkoon/Views/ReleaseSearch/AiPickBanner.swift \
  Rawkoon/Views/BookReleaseSearchView.swift Rawkoon/Views/ActivityView.swift \
  RawkoonTests/RawkoonMotionTests.swift RawkoonTests/SurfaceMotionTests.swift
do
  [ -f "$f" ] && files+=("$f")
done
swiftlint lint --quiet "${files[@]}" 2>/dev/null \
  | sed -E 's#^.*/apps/ios/##; s#^([^:]+):[0-9]+(:[0-9]+)?: (warning|error): .*\(([a-z_]+)\)$#\1 \4#' \
  | sort | uniq -c
EOF
bash "$SDD/rawkoon-pr3-lint.sh" > "$SDD/swiftlint-baseline.txt"
wc -l "$SDD/swiftlint-baseline.txt"
```

Expected: a few dozen baseline `file rule` lines (for example `Rawkoon/Views/ReleaseSearchView.swift file_length` and several `identifier_name` / `line_length` lines). `DownloadMotion.swift` does not exist yet and is skipped.

- [ ] **Step 2: Write the tests (written now, executed by CI)**

In `RawkoonTests/RawkoonMotionTests.swift`, insert before the struct's final closing `}` (after `scopedZoomIdsDifferByContextAndRepeatWithinOne`):

```swift

    @Test func heroPullIsZeroAtRestWhateverTheTopInset() {
        #expect(HeroStretch.pull(contentOffsetY: -103, insetTop: 103) == 0)
        #expect(HeroStretch.pull(contentOffsetY: 0, insetTop: 0) == 0)
    }

    @Test func heroPullGrowsWhileOverscrolled() {
        #expect(HeroStretch.pull(contentOffsetY: -143, insetTop: 103) == 40)
    }

    @Test func heroPullGoesNegativeWhenScrolledUp() {
        #expect(HeroStretch.pull(contentOffsetY: 97, insetTop: 103) == -200)
    }

    @Test func heroPullClampsOnceTheHeroIsGone() {
        #expect(HeroStretch.pull(contentOffsetY: 5000, insetTop: 103) == -HeroStretch.trackedDepth)
        #expect(HeroStretch.trackedDepth >= 260)
    }

    @Test func heroAtRestPullIsIdentity() {
        let pull = HeroStretch.pull(contentOffsetY: -103, insetTop: 103)
        #expect(HeroStretch.transform(minY: pull, height: 260) == .init(scale: 1, offsetY: 0, opacity: 1))
    }

    @Test func landingWaitsForTheZoomThenSteps() {
        #expect(abs(HeroLanding.delay(step: 0, elapsed: 0) - HeroLanding.settle) < 1e-9)
        #expect(abs(HeroLanding.delay(step: 1, elapsed: 0) - (HeroLanding.settle + HeroLanding.beat)) < 1e-9)
    }

    @Test func landingCapsItsSteps() {
        #expect(HeroLanding.delay(step: 50, elapsed: 0) == HeroLanding.delay(step: 3, elapsed: 0))
        #expect(HeroLanding.delay(step: -2, elapsed: 0) == HeroLanding.delay(step: 0, elapsed: 0))
    }

    @Test func landingAfterTheZoomSkipsTheWait() {
        #expect(HeroLanding.delay(step: 0, elapsed: 2) == 0)
        #expect(abs(HeroLanding.delay(step: 2, elapsed: 2) - 2 * HeroLanding.beat) < 1e-9)
        #expect(abs(HeroLanding.delay(step: 0, elapsed: 0.1) - (HeroLanding.settle - 0.1)) < 1e-9)
    }

    @Test func landingIgnoresAClockThatRunsBackwards() {
        #expect(HeroLanding.delay(step: 0, elapsed: -5) == HeroLanding.delay(step: 0, elapsed: 0))
    }

    @Test func slideEntersFromTheTappedSide() {
        #expect(RawkoonSlide.edge(from: 0, to: 2) == .trailing)
        #expect(RawkoonSlide.edge(from: 2, to: 1) == .leading)
        #expect(RawkoonSlide.edge(from: 1, to: 1) == .trailing)
    }

    @Test func slideOffsetsOnlyTheEnteringView() {
        let distance = RawkoonSlide.distance
        let trailing = RawkoonSlide.offset(edge: .trailing, appearing: true, reduceMotion: false)
        let leading = RawkoonSlide.offset(edge: .leading, appearing: true, reduceMotion: false)
        let bottom = RawkoonSlide.offset(edge: .bottom, appearing: true, reduceMotion: false)
        #expect(trailing == CGSize(width: distance, height: 0))
        #expect(leading == CGSize(width: -distance, height: 0))
        #expect(bottom == CGSize(width: 0, height: distance))
        #expect(RawkoonSlide.offset(edge: .trailing, appearing: false, reduceMotion: false) == .zero)
    }

    @Test func slideStaysPutUnderReduceMotion() {
        #expect(RawkoonSlide.offset(edge: .leading, appearing: true, reduceMotion: true) == .zero)
    }
```

In `RawkoonTests/SurfaceMotionTests.swift`, insert before the struct's final closing `}` (after `dealTiltAlternatesAndStaysSmall`):

```swift

    @Test func downloadSheenRunsOnlyWhileBytesArrive() {
        #expect(DownloadMotion.isRunning(state: "downloading"))
        #expect(DownloadMotion.isRunning(state: "Downloading"))
        #expect(!DownloadMotion.isRunning(state: "paused"))
        #expect(!DownloadMotion.isRunning(state: "stalled"))
        #expect(!DownloadMotion.isRunning(state: "completed"))
        #expect(!DownloadMotion.isRunning(state: "error"))
    }

    @Test func downloadCompletionMatchesTheSeedingPhase() {
        #expect(DownloadMotion.isComplete(state: "completed"))
        #expect(DownloadMotion.isComplete(state: "seeding"))
        #expect(!DownloadMotion.isComplete(state: "downloading"))
        #expect(!DownloadMotion.isComplete(state: "paused"))
    }
```

- [ ] **Step 3: Host-driven, clipped hero and the landing cascade**

Replace the whole content of `Rawkoon/Motion/HeroStretch.swift` with:

```swift
import Observation
import SwiftUI

/// Scroll-driven geometry for a detail hero: pull down to stretch, scroll up to parallax and fade.
enum HeroStretch {
    nonisolated struct Transform: Equatable, Sendable {
        var scale: CGFloat
        var offsetY: CGFloat
        var opacity: Double
    }

    /// Past any hero's height, so a clamped pull leaves the hero fully clipped and stops scroll updates.
    nonisolated static let trackedDepth: CGFloat = 600

    /// `minY` is the hero's top edge relative to its rest position; positive while overscrolled.
    nonisolated static func transform(minY: CGFloat, height: CGFloat) -> Transform {
        guard height > 0 else { return Transform(scale: 1, offsetY: 0, opacity: 1) }
        if minY > 0 {
            return Transform(scale: 1 + minY / height, offsetY: 0, opacity: 1)
        }
        let progress = min(1, -minY / height)
        return Transform(scale: 1, offsetY: -minY / 2, opacity: 1 - Double(progress) * 0.6)
    }

    /// The host scroll view's distance from rest, from its own geometry, so a top inset never reads as a pull.
    nonisolated static func pull(contentOffsetY: CGFloat, insetTop: CGFloat) -> CGFloat {
        max(-trackedDepth, -(contentOffsetY + insetTop))
    }
}

/// Written by the host on each scroll frame and read only by the hero, so scrolling re-renders the hero alone.
@Observable
final class HeroScroll {
    var pull: CGFloat = 0
}

/// Delays for a detail header's cascade: wait out what is left of the zoom push, then step through the parts.
nonisolated enum HeroLanding {
    /// Roughly how long a zoom push takes to land.
    static let settle = 0.3
    static let beat = 0.06

    static func delay(step: Int, elapsed: TimeInterval) -> Double {
        max(0, settle - max(0, elapsed)) + Double(min(max(step, 0), 3)) * beat
    }
}

extension EnvironmentValues {
    @Entry var rawkoonHeroScroll: HeroScroll?
    /// When the screen hosting a landing cascade first appeared (system uptime); nil reads as "just now".
    @Entry var rawkoonLandingOrigin: TimeInterval?
}

extension View {
    /// Goes on the ScrollView that holds a `rawkoonStretchyHero`; it measures the pull the hero follows.
    func rawkoonStretchyHeroHost() -> some View {
        modifier(StretchyHeroHost())
    }

    /// Stretches on pull-down and parallaxes on scroll, clipped below its bottom edge; static under Reduce Motion.
    /// `fileID` and `line` only name the call site in the DEBUG missing-host log.
    func rawkoonStretchyHero(height: CGFloat, fileID: String = #fileID, line: Int = #line) -> some View {
        StretchyHeroLayer(content: self, height: height, callSite: "\(fileID):\(line)")
    }

    /// Fades and rises this header piece in once, `step` beats after the screen's zoom push lands.
    func rawkoonLanding(step: Int) -> some View {
        modifier(Landing(step: step))
    }
}

private struct StretchyHeroHost: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scroll = HeroScroll()

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                HeroStretch.pull(contentOffsetY: geometry.contentOffset.y, insetTop: geometry.contentInsets.top)
            } action: { _, pull in
                // The hero is static under Reduce Motion, so skip the per-frame writes.
                guard !reduceMotion else { return }
                scroll.pull = pull
            }
            .environment(\.rawkoonHeroScroll, scroll)
    }
}

private struct StretchyHeroLayer<Content: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.rawkoonHeroScroll) private var scroll
    let content: Content
    let height: CGFloat
    let callSite: String

    var body: some View {
        // Reading `pull` here subscribes this layer, and nothing above it, to scrolling.
        let transform = HeroStretch.transform(minY: reduceMotion ? 0 : scroll?.pull ?? 0, height: height)
        content
            .scaleEffect(transform.scale, anchor: .bottom)
            .offset(y: transform.offsetY)
            .opacity(transform.opacity)
            .clipShape(BelowEdgeClip())
            .onAppear {
                #if DEBUG
                    if scroll == nil {
                        MissingHeroHost.report(callSite)
                    }
                #endif
            }
    }
}

/// Clips the sides and the bottom but not the top, so a stretch grows upward while parallax never covers what follows.
private nonisolated struct BelowEdgeClip: Shape {
    func path(in rect: CGRect) -> Path {
        let headroom: CGFloat = 10_000
        return Path(CGRect(x: rect.minX, y: rect.minY - headroom, width: rect.width, height: rect.height + headroom))
    }
}

private struct Landing: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.rawkoonLandingOrigin) private var origin
    let step: Int
    @State private var landed = false

    func body(content: Content) -> some View {
        content
            .opacity(landed ? 1 : 0)
            .offset(y: landed || reduceMotion ? 0 : 10)
            .onAppear {
                guard !landed else { return }
                let now = ProcessInfo.processInfo.systemUptime
                let delay = HeroLanding.delay(step: step, elapsed: origin.map { now - $0 } ?? 0)
                let animation = reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.spring.delay(delay)
                withAnimation(animation) { landed = true }
            }
    }
}

#if DEBUG
    /// Without a host the hero never moves; say so once per call site.
    private enum MissingHeroHost {
        private static var reported: Set<String> = []

        static func report(_ callSite: String) {
            guard reported.insert(callSite).inserted else { return }
            Log.motion.warning(
                """
                rawkoonStretchyHero at \(callSite, privacy: .public) has no rawkoonStretchyHeroHost \
                on its ScrollView; it stays static
                """
            )
        }
    }
#endif
```

- [ ] **Step 4: The slide transition and the symbol bounce**

In `Rawkoon/Motion/RawkoonTransitions.swift`, replace:

```swift
extension Transition where Self == RawkoonEdgeTransition {
    static func rawkoonEdge(_ edge: Edge) -> RawkoonEdgeTransition {
        RawkoonEdgeTransition(edge: edge)
    }
}
```

with:

```swift
extension Transition where Self == RawkoonEdgeTransition {
    static func rawkoonEdge(_ edge: Edge) -> RawkoonEdgeTransition {
        RawkoonEdgeTransition(edge: edge)
    }
}

/// Content that replaces a sibling: slides a short way in from `edge`, and leaves by fading in place.
struct RawkoonSlideTransition: Transition {
    let edge: Edge

    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(SlideEffect(phase: phase, edge: edge))
    }
}

extension Transition where Self == RawkoonSlideTransition {
    static func rawkoonSlide(_ edge: Edge) -> RawkoonSlideTransition {
        RawkoonSlideTransition(edge: edge)
    }
}

/// Geometry for `rawkoonSlide`; only the entering view moves, because a leaving view's edge comes from a stale render.
nonisolated enum RawkoonSlide {
    static let distance: CGFloat = 28

    /// A tab or lane to the right of the current one enters from the trailing side.
    static func edge(from old: Int, to new: Int) -> Edge {
        new >= old ? .trailing : .leading
    }

    static func offset(edge: Edge, appearing: Bool, reduceMotion: Bool) -> CGSize {
        guard appearing, !reduceMotion else { return .zero }
        let sign: CGFloat = edge == .leading || edge == .top ? -1 : 1
        let horizontal = edge == .leading || edge == .trailing
        return horizontal
            ? CGSize(width: sign * distance, height: 0)
            : CGSize(width: 0, height: sign * distance)
    }
}
```

Then append to the end of the same file (after `EdgeEffect`):

```swift

private struct SlideEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let phase: TransitionPhase
    let edge: Edge

    func body(content: Content) -> some View {
        let appearing = switch phase {
        case .willAppear: true
        default: false
        }
        content
            .opacity(phase.isIdentity ? 1 : 0)
            .offset(RawkoonSlide.offset(edge: edge, appearing: appearing, reduceMotion: reduceMotion))
    }
}
```

In `Rawkoon/Motion/RawkoonSymbols.swift`, replace:

```swift
    /// One bounce for an empty state, one wiggle for an error, played once on appear.
    func rawkoonLivingSymbol(_ kind: LivingSymbolKind) -> some View {
        modifier(LivingSymbol(kind: kind))
    }
}
```

with:

```swift
    /// One bounce for an empty state, one wiggle for an error, played once on appear.
    func rawkoonLivingSymbol(_ kind: LivingSymbolKind) -> some View {
        modifier(LivingSymbol(kind: kind))
    }

    /// One bounce each time `trigger` changes; still under Reduce Motion.
    func rawkoonSymbolBounce(_ trigger: some Equatable) -> some View {
        modifier(SymbolBounce(trigger: trigger))
    }
}

private struct SymbolBounce<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger

    func body(content: Content) -> some View {
        // A value that never changes under Reduce Motion, so the effect never fires.
        content.symbolEffect(.bounce, value: reduceMotion ? nil : Optional(trigger))
    }
}
```

- [ ] **Step 5: Download states shared by Detail and Activity**

Create `Rawkoon/Views/Components/DownloadMotion.swift`:

```swift
import Foundation

/// Which live-download states earn motion: the progress sheen while bytes arrive, the check burst once done.
nonisolated enum DownloadMotion {
    static func isRunning(state: String) -> Bool {
        let lower = state.lowercased()
        return lower.contains("download") && !lower.contains("pause")
    }

    /// The same rule as the Activity queue's seeding phase.
    static func isComplete(state: String) -> Bool {
        let lower = state.lowercased()
        return lower.contains("seed") || lower.contains("complete")
    }
}
```

- [ ] **Step 6: Host the debug gallery's demo hero**

In `Rawkoon/Views/DebugMotionGallery.swift`, replace:

```swift
                .padding(16)
            }
            .background(Theme.base)
            .task {
```

with:

```swift
                .padding(16)
            }
            .rawkoonStretchyHeroHost()
            .background(Theme.base)
            .task {
```

- [ ] **Step 7: Review**

Re-read `HeroStretch.swift`: `rawkoonStretchyHero(height:)` still compiles for the gallery call; the hero reads only `scroll?.pull` (no `.scrollView` coordinate space anywhere); the clip keeps width and bottom and opens upward; `Landing` uses `withAnimation` inside `Motion/` only. `grep -rn "rawkoonStretchyHero(" Rawkoon` must list only `DebugMotionGallery.swift` at this point.

- [ ] **Step 8: Local gates**

Run the per-task gate block with: `Rawkoon/Motion/HeroStretch.swift Rawkoon/Motion/RawkoonTransitions.swift Rawkoon/Motion/RawkoonSymbols.swift Rawkoon/Views/Components/DownloadMotion.swift Rawkoon/Views/DebugMotionGallery.swift RawkoonTests/RawkoonMotionTests.swift RawkoonTests/SurfaceMotionTests.swift`.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-detail-search-activity
git add Rawkoon/Motion/HeroStretch.swift Rawkoon/Motion/RawkoonTransitions.swift Rawkoon/Motion/RawkoonSymbols.swift \
  Rawkoon/Views/Components/DownloadMotion.swift Rawkoon/Views/DebugMotionGallery.swift \
  RawkoonTests/RawkoonMotionTests.swift RawkoonTests/SurfaceMotionTests.swift
git commit -m "feat(ios): hero scroll host, landing cascade, slide transition and symbol bounce"
```

---

### Task 2: Signature — heroes stretch, headers land after the zoom

**Files:**
- Rewrite: `Rawkoon/Views/Detail/DetailHero.swift`
- Rewrite: `Rawkoon/Views/Detail/BookHero.swift`
- Modify: `Rawkoon/Views/BookView.swift`
- Modify: `Rawkoon/Views/MediaDetailView.swift`

**Interfaces:**
- Produces: `DetailHero(…, statusEarned: Bool = false)` (new trailing defaulted property; both existing call sites compile unchanged); `MediaDetailView.landingOrigin: TimeInterval?` (`@State`).
- Consumes (Task 1): `rawkoonStretchyHeroHost()`, `rawkoonStretchyHero(height:)`, `rawkoonLanding(step:)`, `\.rawkoonLandingOrigin`.

- [ ] **Step 1: `DetailHero` — the backdrop stretches, the identity lands, the pill swaps and pops**

Replace the whole content of `Rawkoon/Views/Detail/DetailHero.swift` with:

```swift
import SwiftUI

/// Cinematic detail header: a 260pt backdrop wash, the poster, a Fraunces title,
/// a status pill, a mono meta line, and the tagline. The watchlist action lives
/// in the navigation toolbar so the artwork and identity stay the only focus
/// here. The hero is laid out full-width by its container (the scroll VStack has
/// no horizontal padding), so the backdrop reaches the screen edges without any
/// negative-padding trick — inner content keeps the 16pt gutter.
struct DetailHero: View {
    @Environment(AppModel.self) private var model

    let title: String
    let posterPath: String?
    let backdropPath: String?
    let metaLine: String
    let tagline: String?
    let statusText: String
    let statusTint: Color
    /// True once the title is in the library or requested; turning true pops the pill.
    var statusEarned = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            backdrop
                .rawkoonStretchyHero(height: 260)

            HStack(alignment: .bottom, spacing: 16) {
                posterThumb
                VStack(alignment: .leading, spacing: 7) {
                    Text(title)
                        .font(.display(26))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(3)
                    statusPill
                    Text(metaLine)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                    if let tagline, !tagline.isEmpty {
                        Text(tagline)
                            .font(.caption.italic())
                            .foregroundStyle(Theme.text)
                            .lineLimit(2)
                    }
                }
                .padding(.bottom, 2)
                .rawkoonLanding(step: 0)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 260)
    }

    /// The backdrop and its fade to the page, moved as one layer by the stretch and parallax.
    private var backdrop: some View {
        ZStack {
            // The image is an overlay on a fixed-size Rectangle (the same pattern
            // the poster uses), so layout is driven by the Rectangle, never by
            // the image. Loading the backdrop can't resize the hero — no flash.
            Rectangle()
                .fill(Theme.raised)
                .frame(maxWidth: .infinity)
                .frame(height: 260)
                .overlay {
                    CachedAsyncImage(url: model.absoluteURL(backdropPath), targetSize: CGSize(width: 600, height: 320)) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.clear
                    }
                }
                .clipped()

            LinearGradient(
                colors: [.clear, Theme.base.opacity(0.55), Theme.base],
                startPoint: .top, endPoint: .bottom
            )
            .frame(maxWidth: .infinity)
            .frame(height: 260)
        }
    }

    /// One slot keyed by the text, so a status change crossfades instead of cutting.
    private var statusPill: some View {
        ZStack(alignment: .leading) {
            StatusBadge(verbatim: statusText, tint: statusTint)
                .id(statusText)
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: statusText)
        // Visual only: the request and add flows already play their own haptic.
        .rawkoonCelebrate(trigger: statusEarned, ring: .roundedRect(cornerRadius: 12), haptic: nil, when: { !$0 && $1 })
    }

    private var posterThumb: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Theme.raised)
            .frame(width: 96, height: 144)
            .overlay(
                CachedAsyncImage(url: model.absoluteURL(posterPath), targetSize: CGSize(width: 192, height: 288)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    LinearGradient(
                        colors: [Theme.terracottaDeep, Theme.apricot],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                }
                .frame(width: 96, height: 144)
                .clipped()
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
    }
}
```

The two pre-existing `line_length` warnings (the two `CachedAsyncImage` lines) stay at two.

- [ ] **Step 2: `BookHero` — the same split**

Replace the whole content of `Rawkoon/Views/Detail/BookHero.swift` with:

```swift
import SwiftUI

/// Cinematic book header, matching `DetailHero`. Books ship no backdrop art, so
/// the cover itself — blurred and dimmed — becomes the ground behind a sharp
/// portrait cover. Mark-as-read lives in the navigation toolbar. Laid out
/// full-width by its container (the scroll VStack has no horizontal padding), so
/// the backdrop reaches the screen edges without any negative-padding trick.
struct BookHero<Badges: View>: View {
    let title: String
    let subtitle: String?
    let author: String
    let coverURL: URL?
    let metaLine: String?
    @ViewBuilder let badges: Badges

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            backdrop
                .rawkoonStretchyHero(height: 260)

            HStack(alignment: .bottom, spacing: 16) {
                posterThumb
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.display(24))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(3)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(2)
                    }
                    if !author.isEmpty {
                        Text(author)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    if let metaLine, !metaLine.isEmpty {
                        Text(metaLine)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.faint)
                            .lineLimit(1)
                    }
                    HStack(spacing: 6) { badges }
                        .padding(.top, 2)
                }
                .padding(.bottom, 2)
                .rawkoonLanding(step: 0)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 260)
    }

    /// The blurred cover and its fade to the page, moved as one layer by the stretch and parallax.
    private var backdrop: some View {
        ZStack {
            // Blurred cover as the ground, overlaid on a fixed-size Rectangle so
            // layout is driven by the Rectangle, never by the image. Loading the
            // cover can't resize the hero — no flash.
            Rectangle()
                .fill(Theme.raised)
                .frame(maxWidth: .infinity)
                .frame(height: 260)
                .overlay {
                    CachedAsyncImage(url: coverURL, targetSize: CGSize(width: 400, height: 400)) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.clear
                    }
                    .blur(radius: 26)
                }
                .clipped()

            LinearGradient(
                colors: [Theme.base.opacity(0.15), Theme.base.opacity(0.6), Theme.base],
                startPoint: .top, endPoint: .bottom
            )
            .frame(maxWidth: .infinity)
            .frame(height: 260)
        }
    }

    /// Portrait cover with the rawkoon book-spine edge, so it reads as a book
    /// even against its own blurred art.
    private var posterThumb: some View {
        ZStack(alignment: .leading) {
            CachedAsyncImage(url: coverURL, targetSize: CGSize(width: 200, height: 300)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                LinearGradient(
                    colors: [Theme.terracottaDeep, Theme.apricot],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            }
            .frame(width: 100, height: 150)
            .clipped()

            Rectangle()
                .fill(.black.opacity(0.28))
                .frame(width: 5)
        }
        .frame(width: 100, height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.08), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
    }
}
```

- [ ] **Step 3: `BookView` hosts its hero and lands its lane picker**

In `Rawkoon/Views/BookView.swift`, replace:

```swift
            VStack(alignment: .leading, spacing: 18) {
                hero
                VStack(alignment: .leading, spacing: 18) {
                    lanePicker
                    if let detailError, detail == nil {
```

with:

```swift
            VStack(alignment: .leading, spacing: 18) {
                hero
                VStack(alignment: .leading, spacing: 18) {
                    lanePicker
                        .rawkoonLanding(step: 1)
                    if let detailError, detail == nil {
```

and replace:

```swift
            .padding(.bottom, 24)
        }
        .background(Theme.base)
        .navigationTitle(titleText)
```

with:

```swift
            .padding(.bottom, 24)
        }
        .rawkoonStretchyHeroHost()
        .background(Theme.base)
        .navigationTitle(titleText)
```

Nothing else in `BookView` changes (its lane switch, player swap and download celebration belong to PR 4).

- [ ] **Step 4: `MediaDetailView` hosts the hero, records the landing origin, lands the action row and tab bar**

In `Rawkoon/Views/MediaDetailView.swift`:

(a) Replace:

```swift
    @State var detailTab: DetailTab = .info
```

with:

```swift
    @State var detailTab: DetailTab = .info
    /// When this screen first appeared; the header cascade waits out what is left of the zoom from here.
    @State var landingOrigin: TimeInterval?
```

(b) Replace:

```swift
            .frame(maxWidth: .infinity)
            .padding(.bottom, 24)
        }
        .onAppear {
            isOnScreen = true
            hydrateFromCache()
        }
```

with:

```swift
            .frame(maxWidth: .infinity)
            .padding(.bottom, 24)
        }
        .rawkoonStretchyHeroHost()
        .environment(\.rawkoonLandingOrigin, landingOrigin)
        .onAppear {
            isOnScreen = true
            // Kept from the first appearance, so returning from a pushed screen never re-delays the header.
            if landingOrigin == nil {
                landingOrigin = ProcessInfo.processInfo.systemUptime
            }
            hydrateFromCache()
        }
```

(c) In the content branch of `mainContent` (the second `DetailHero(` call, the one with `backdropPath: details?.primaryBackdropUrl`), replace:

```swift
                tagline: details?.tagline,
                statusText: detailStatusText,
                statusTint: detailStatusTint
            )
            primaryAction
```

with:

```swift
                tagline: details?.tagline,
                statusText: detailStatusText,
                statusTint: detailStatusTint,
                statusEarned: libraryId != nil || added || requested
            )
            primaryAction
```

The offline `DetailHero(` call (with `backdropPath: nil`) is unchanged and keeps `statusEarned` at its default.

(d) In `primaryAction`, replace:

```swift
                if let requestError {
                    Text(requestError)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }
            .padding(.horizontal, 16)
        }
    }
```

with:

```swift
                if let requestError {
                    Text(requestError)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }
            .padding(.horizontal, 16)
            .rawkoonLanding(step: 1)
        }
    }
```

(e) At the end of `detailTabBar`, replace:

```swift
        .padding(.horizontal, 16)
        .overlay(alignment: .bottom) {
            Divider().overlay(Theme.border)
        }
    }
```

with:

```swift
        .padding(.horizontal, 16)
        .overlay(alignment: .bottom) {
            Divider().overlay(Theme.border)
        }
        .rawkoonLanding(step: 2)
    }
```

- [ ] **Step 5: Review**

- `grep -rn "rawkoonStretchyHero(\|rawkoonStretchyHeroHost()" Rawkoon` lists exactly: `DetailHero.swift`, `BookHero.swift`, `DebugMotionGallery.swift` (heroes) and `MediaDetailView.swift`, `BookView.swift`, `DebugMotionGallery.swift` (hosts). Each hero's host is the ScrollView that directly contains it.
- The stretch is on `backdrop` only. The poster and identity row are not scaled, and the clip is inside the layer, so the poster's shadow is never clipped.
- At rest `pull == 0`, so the backdrop is identity (pinned by `heroAtRestPullIsIdentity`). Scrolling up moves the backdrop down at half speed and fades it; the clip stops it at the hero's bottom edge, so it never covers the primary action or the tab bar.
- Landing: the identity VStack, the action row and the tab bar start hidden for at most 0.3s + 2 beats after the screen's first appearance. A skeleton → content swap that happens after a network load lands at once (`elapsed` exceeds `settle`). `landed` is per view identity, so a tab switch or a return from a pushed Similar title never replays it.
- The pill pops only on a false → true change of `libraryId != nil || added || requested`, which only `submitAdd()` / `submitRequest()` cause.

- [ ] **Step 6: Local gates**

Run the per-task gate block with: `Rawkoon/Views/Detail/DetailHero.swift Rawkoon/Views/Detail/BookHero.swift Rawkoon/Views/BookView.swift Rawkoon/Views/MediaDetailView.swift`.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-detail-search-activity
git add Rawkoon/Views/Detail/DetailHero.swift Rawkoon/Views/Detail/BookHero.swift Rawkoon/Views/BookView.swift Rawkoon/Views/MediaDetailView.swift
git commit -m "feat(ios): stretch the detail and book heroes and land their headers after the zoom"
```

---

### Task 3: Detail states — crossfades, tab slide, primary action swap, Similar, watchlist

**Files:**
- Modify: `Rawkoon/Views/MediaDetailView.swift`
- Modify: `Rawkoon/Views/Detail/MediaDetailView+Actions.swift`
- Modify: `Rawkoon/Views/Detail/MediaDetailView+Management.swift`

**Interfaces:**
- Produces (all on `MediaDetailView`, internal): `enum DetailPhase`, `enum PrimaryActionPhase`, `enum SimilarPhase`, `enum ManagementPhase`, `struct MotionState: Equatable`, `var motionState`, `var showsDetailSkeleton`, `var showsSimilarSkeleton`, `var tabContent`, `@State var tabSlideEdge: Edge`, `@State var watchlistBounce: Int`.
- Consumes: Task 1 `.rawkoonSlide(_:)`, `RawkoonSlide.edge(from:to:)`, `rawkoonSymbolBounce(_:)`; Task 2's `landingOrigin`, host and landings (the "old" snippets below already include Task 2's edits).

- [ ] **Step 1: New state**

In `Rawkoon/Views/MediaDetailView.swift`, replace:

```swift
    /// When this screen first appeared; the header cascade waits out what is left of the zoom from here.
    @State var landingOrigin: TimeInterval?
```

with:

```swift
    /// When this screen first appeared; the header cascade waits out what is left of the zoom from here.
    @State var landingOrigin: TimeInterval?
    /// The side the next tab enters from, set before the tab changes so the insertion reads it fresh.
    @State var tabSlideEdge: Edge = .trailing
    /// Bumped after a user-initiated watchlist change, so loading the saved state never bounces the bookmark.
    @State var watchlistBounce = 0
```

- [ ] **Step 2: Watchlist bookmark bounces and fills**

Replace:

```swift
                    } label: {
                        Image(systemName: inWatchlist ? "bookmark.fill" : "bookmark")
                    }
```

with:

```swift
                    } label: {
                        Image(systemName: inWatchlist ? "bookmark.fill" : "bookmark")
                            .contentTransition(.symbolEffect(.replace))
                            .rawkoonSymbolBounce(watchlistBounce)
                            .rawkoonMotion(RawkoonMotion.snappy, value: inWatchlist)
                    }
```

In `Rawkoon/Views/Detail/MediaDetailView+Actions.swift`, replace:

```swift
                inWatchlist = true
            }
            recordLibraryChangeFeedback()
        } catch APIError.unauthorized {
            requestError = String(localized: "Sign in required.")
        } catch {
            requestError = String(localized: "Could not update watchlist.")
```

with:

```swift
                inWatchlist = true
            }
            recordLibraryChangeFeedback()
            watchlistBounce += 1
        } catch APIError.unauthorized {
            requestError = String(localized: "Sign in required.")
        } catch {
            requestError = String(localized: "Could not update watchlist.")
```

- [ ] **Step 3: One slot and one motion key for the whole page**

In `Rawkoon/Views/MediaDetailView.swift`, replace (the `ScrollView` opening of `scrollBody`, as left by Task 2):

```swift
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                mainContent
            }
            // Cap to a readable measure and center on iPad/Mac; full-bleed on phone.
            .frame(maxWidth: isRegularWidth ? 980 : .infinity)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 24)
        }
        .rawkoonStretchyHeroHost()
```

with:

```swift
        ScrollView {
            // One slot, so a state swap crossfades in place instead of stacking two states.
            ZStack(alignment: .topLeading) {
                mainContent
            }
            // Cap to a readable measure and center on iPad/Mac; full-bleed on phone.
            .frame(maxWidth: isRegularWidth ? 980 : .infinity)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 24)
            .rawkoonMotion(RawkoonMotion.spring, value: motionState)
        }
        .rawkoonStretchyHeroHost()
```

- [ ] **Step 4: `mainContent` crossfades its states and hosts the tab slot**

Replace the whole `mainContent` property (as left by Task 2):

```swift
    @ViewBuilder
    var mainContent: some View {
        if loading, details == nil {
            detailSkeleton
        } else if details == nil, detailsUnreachable {
            // Offline with nothing saved: keep the identity the caller passed in.
            DetailHero(
                title: title,
                posterPath: resolvedPosterPath,
                backdropPath: nil,
                metaLine: "",
                tagline: nil,
                statusText: detailStatusText,
                statusTint: detailStatusTint
            )
            Text("Details will load when you're back online.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
        } else if let errorMessage, details == nil {
            ContentUnavailableView(
                "Couldn't load details",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 28)
        } else {
            // Hero + primary action stay pinned above the segmented content, the
            // way the web keeps the title header above its detail tabs.
            DetailHero(
                title: title,
                posterPath: resolvedPosterPath,
                backdropPath: details?.primaryBackdropUrl,
                metaLine: metaLine,
                tagline: details?.tagline,
                statusText: detailStatusText,
                statusTint: detailStatusTint,
                statusEarned: libraryId != nil || added || requested
            )
            primaryAction
            if availableTabs.count > 1 {
                detailTabBar
            }
            switch activeTab {
            case .info:
                infoSections
            case .similar:
                similarSection
            case .manage:
                if showManagement {
                    managementSections
                }
            }
        }
    }
```

with:

```swift
    @ViewBuilder
    var mainContent: some View {
        if showsDetailSkeleton {
            detailSkeleton
                .transition(.rawkoonSwap)
        } else if details == nil, detailsUnreachable {
            // Offline with nothing saved: keep the identity the caller passed in.
            VStack(alignment: .leading, spacing: 18) {
                DetailHero(
                    title: title,
                    posterPath: resolvedPosterPath,
                    backdropPath: nil,
                    metaLine: "",
                    tagline: nil,
                    statusText: detailStatusText,
                    statusTint: detailStatusTint
                )
                Text("Details will load when you're back online.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 16)
            }
            .transition(.rawkoonSwap)
        } else if let errorMessage, details == nil {
            ContentUnavailableView(
                "Couldn't load details",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            // Hero + primary action stay pinned above the segmented content, the
            // way the web keeps the title header above its detail tabs.
            VStack(alignment: .leading, spacing: 18) {
                DetailHero(
                    title: title,
                    posterPath: resolvedPosterPath,
                    backdropPath: details?.primaryBackdropUrl,
                    metaLine: metaLine,
                    tagline: details?.tagline,
                    statusText: detailStatusText,
                    statusTint: detailStatusTint,
                    statusEarned: libraryId != nil || added || requested
                )
                primaryAction
                if availableTabs.count > 1 {
                    detailTabBar
                }
                tabContent
            }
            .transition(.rawkoonSwap)
        }
    }

    /// The selected tab's sections; a tapped tab slides in from its side while the old one fades in place.
    var tabContent: some View {
        ZStack(alignment: .topLeading) {
            switch activeTab {
            case .info:
                VStack(alignment: .leading, spacing: 18) {
                    infoSections
                }
                .transition(.rawkoonSlide(tabSlideEdge))
            case .similar:
                similarSection
                    .transition(.rawkoonSlide(tabSlideEdge))
            case .manage:
                if showManagement {
                    managementSections
                        .transition(.rawkoonSlide(tabSlideEdge))
                }
            }
        }
    }

    /// Mirrors `mainContent`'s branch order, so every swap between states animates.
    enum DetailPhase: Equatable {
        case skeleton, unreachable, failed, content
    }

    /// Mirrors `primaryAction`'s branches.
    enum PrimaryActionPhase: Equatable {
        case lamp, requested, quiet
    }

    /// Mirrors `similarBody`'s branch order.
    enum SimilarPhase: Equatable {
        case loading, failed, empty, grid
    }

    /// Every swappable state on the page; one change animates the whole page's layout together.
    struct MotionState: Equatable {
        var detail: DetailPhase
        var inLibrary: Bool
        var primary: PrimaryActionPhase
        var requestError: String?
        var similar: SimilarPhase
        var management: ManagementPhase
        var managementNotice: String?
        var managementError: String?
    }

    var motionState: MotionState {
        MotionState(
            detail: detailPhase,
            inLibrary: libraryId != nil,
            primary: primaryActionPhase,
            requestError: requestError,
            similar: similarPhase,
            management: managementPhase,
            managementNotice: managementNotice,
            managementError: managementError
        )
    }

    /// Also covers the frames before the first fetch starts, so an empty hero never flashes ahead of the skeleton.
    var showsDetailSkeleton: Bool {
        details == nil && (loading || (!didInitialLoad && errorMessage == nil && !detailsUnreachable))
    }

    var detailPhase: DetailPhase {
        if showsDetailSkeleton {
            return .skeleton
        }
        if details == nil, detailsUnreachable {
            return .unreachable
        }
        if errorMessage != nil, details == nil {
            return .failed
        }
        return .content
    }

    var primaryActionPhase: PrimaryActionPhase {
        if !requested, !added {
            return .lamp
        }
        return requested ? .requested : .quiet
    }

    /// Also covers the frames before the first fetch, so "No similar titles." never flashes ahead of the shimmer.
    var showsSimilarSkeleton: Bool {
        similarItems.isEmpty && (loadingSimilar || !didInitialLoad)
    }

    var similarPhase: SimilarPhase {
        if showsSimilarSkeleton {
            return .loading
        }
        if similarError != nil {
            return .failed
        }
        return similarItems.isEmpty ? .empty : .grid
    }
```

- [ ] **Step 5: The tab bar sets the slide edge before switching**

In `detailTabBar`, replace:

```swift
                Button {
                    withRawkoonMotion(.easeInOut(duration: 0.15)) { detailTab = tab }
                } label: {
```

with:

```swift
                Button {
                    tabSlideEdge = RawkoonSlide.edge(
                        from: DetailTab.allCases.firstIndex(of: activeTab) ?? 0,
                        to: DetailTab.allCases.firstIndex(of: tab) ?? 0
                    )
                    withRawkoonMotion(RawkoonMotion.snappy) { detailTab = tab }
                } label: {
```

- [ ] **Step 6: Primary action → "We'll notify you" swaps in one slot**

Replace the whole `primaryAction` property (as left by Task 2):

```swift
    @ViewBuilder
    var primaryAction: some View {
        if libraryId == nil {
            VStack(alignment: .leading, spacing: 8) {
                if !requested, !added {
                    HStack(spacing: 0) {
                        // On Mac/iPad the lamp sizes to its label and floats right
                        // instead of stretching the whole content width.
                        if isRegularWidth {
                            Spacer(minLength: 0)
                        }
                        lampButton(
                            title: model.isAdmin ? "Add to library" : "Request",
                            systemImage: model.isAdmin ? "plus.circle.fill" : "plus.circle",
                            busy: requesting
                        ) {
                            Task { model.isAdmin ? await submitAdd() : await submitRequest() }
                        }
                        .requiresConnection(model.isOffline)
                    }
                } else if requested {
                    Text("We'll notify you when this is in the library. See Requests in Library.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
                if let requestError {
                    Text(requestError)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }
            .padding(.horizontal, 16)
            .rawkoonLanding(step: 1)
        }
    }
```

with:

```swift
    @ViewBuilder
    var primaryAction: some View {
        if libraryId == nil {
            VStack(alignment: .leading, spacing: 8) {
                // One slot, so the lamp and its "We'll notify you" note crossfade in place.
                ZStack(alignment: .leading) {
                    if !requested, !added {
                        HStack(spacing: 0) {
                            // On Mac/iPad the lamp sizes to its label and floats right
                            // instead of stretching the whole content width.
                            if isRegularWidth {
                                Spacer(minLength: 0)
                            }
                            lampButton(
                                title: model.isAdmin ? "Add to library" : "Request",
                                systemImage: model.isAdmin ? "plus.circle.fill" : "plus.circle",
                                busy: requesting
                            ) {
                                Task { model.isAdmin ? await submitAdd() : await submitRequest() }
                            }
                            .requiresConnection(model.isOffline)
                        }
                        .transition(.rawkoonSwap)
                    } else if requested {
                        Text("We'll notify you when this is in the library. See Requests in Library.")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .transition(.rawkoonSwap)
                    }
                }
                if let requestError {
                    Text(requestError)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                        .transition(.rawkoonReveal)
                }
            }
            .padding(.horizontal, 16)
            .rawkoonLanding(step: 1)
            .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 7: Similar crossfades its states and cascades its grid**

Replace:

```swift
    @ViewBuilder
    var similarSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Similar titles")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 16)
            similarBody
        }
    }

    @ViewBuilder
    var similarBody: some View {
        if loadingSimilar, similarItems.isEmpty {
```

with:

```swift
    @ViewBuilder
    var similarSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Similar titles")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 16)
            // One slot, so the shimmer and the grid crossfade instead of stacking.
            ZStack(alignment: .topLeading) {
                similarBody
            }
        }
    }

    @ViewBuilder
    var similarBody: some View {
        if showsSimilarSkeleton {
```

Then, still in `similarBody`, replace:

```swift
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
        } else if let similarError {
```

with:

```swift
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
            .transition(.rawkoonSwap)
        } else if let similarError {
```

replace:

```swift
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.horizontal, 16)
        } else if similarItems.isEmpty {
            Text("No similar titles.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
        } else {
            LazyVGrid(columns: similarColumns, spacing: 14) {
                ForEach(similarItems) { item in
                    similarCard(item)
                }
            }
            .padding(.horizontal, 16)
        }
    }
```

with:

```swift
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.horizontal, 16)
            .transition(.rawkoonSwap)
        } else if similarItems.isEmpty {
            Text("No similar titles.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
                .transition(.rawkoonSwap)
        } else {
            LazyVGrid(columns: similarColumns, spacing: 14) {
                ForEach(similarItems) { item in
                    similarCard(item)
                        .rawkoonEntrance(id: item.id)
                }
            }
            .padding(.horizontal, 16)
            .rawkoonEntranceScope()
            .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 8: Management crossfades its states and reveals its notices**

In `Rawkoon/Views/Detail/MediaDetailView+Management.swift`, replace the whole `managementSections` property:

```swift
    @ViewBuilder
    var managementSections: some View {
        if managementLoading, managementItem == nil {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        } else if let managementError, managementItem == nil {
            VStack(spacing: 12) {
                ContentUnavailableView(
                    "Couldn't load management",
                    systemImage: "exclamationmark.triangle",
                    description: Text(managementError)
                )
                .rawkoonLivingSymbol(.error)
                Button {
                    Task { await refreshManagementData() }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.top, 8)
        } else if let managementItem {
            managementControlsCard(managementItem)
                .id("management")
            // TV files fold into the seasons section; only movies keep a card.
            if mediaType != "tv" {
                managementFilesCard
            }
            managementDownloadsCard
            if let managementNotice {
                Text(managementNotice)
                    .font(.caption)
                    .foregroundStyle(Theme.apricotSoft)
                    .padding(.horizontal, 16)
            }
            if let managementError {
                Text(managementError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
                    .padding(.horizontal, 16)
            }
        }
    }
```

with:

```swift
    /// Mirrors `managementSections`' branch order, so its loading, error and ready states crossfade.
    enum ManagementPhase: Equatable {
        case idle, loading, failed, ready
    }

    var managementPhase: ManagementPhase {
        if managementLoading, managementItem == nil {
            return .loading
        }
        if managementError != nil, managementItem == nil {
            return .failed
        }
        return managementItem == nil ? .idle : .ready
    }

    var managementSections: some View {
        // One slot, so the outgoing state never stacks above the incoming one.
        ZStack(alignment: .topLeading) {
            if managementLoading, managementItem == nil {
                ProgressView().tint(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                    .transition(.rawkoonSwap)
            } else if let managementError, managementItem == nil {
                VStack(spacing: 12) {
                    ContentUnavailableView(
                        "Couldn't load management",
                        systemImage: "exclamationmark.triangle",
                        description: Text(managementError)
                    )
                    .rawkoonLivingSymbol(.error)
                    Button {
                        Task { await refreshManagementData() }
                    } label: {
                        Label("Try again", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.apricot)
                }
                .padding(.top, 8)
                .transition(.rawkoonSwap)
            } else if let managementItem {
                VStack(alignment: .leading, spacing: 18) {
                    managementControlsCard(managementItem)
                        .id("management")
                    // TV files fold into the seasons section; only movies keep a card.
                    if mediaType != "tv" {
                        managementFilesCard
                    }
                    managementDownloadsCard
                    if let managementNotice {
                        Text(managementNotice)
                            .font(.caption)
                            .foregroundStyle(Theme.apricotSoft)
                            .padding(.horizontal, 16)
                            .transition(.rawkoonReveal)
                    }
                    if let managementError {
                        Text(managementError)
                            .font(.caption)
                            .foregroundStyle(Theme.terracotta)
                            .padding(.horizontal, 16)
                            .transition(.rawkoonReveal)
                    }
                }
                .transition(.rawkoonSwap)
            }
        }
    }
```

- [ ] **Step 9: Review**

- No-ghost check, by case: no cache → skeleton from the first frame (before `.task` runs) until details land; network failure with nothing saved → unreachable branch (not skeleton); other failure or signed out → error branch; a reconnect refetch with `loading == true` → skeleton, as before. Cached details → content from the first frame. Similar: shimmer until the first `fetchSimilar` finishes; `didInitialLoad` is set in the same synchronous continuation after it, so the error/empty state never loses a frame to the shimmer.
- Every branch of `mainContent`, `primaryAction`'s slot, `similarBody` and `managementSections` carries a transition and sits in a `ZStack`; the motion that drives them is the single `.rawkoonMotion(…, value: motionState)` outside every conditional. `motionState` mirrors each branch order exactly.
- Tab switch: the edge is written before `detailTab` changes, so the inserted tab reads it fresh; the removed tab only fades (`appearing == false`). Programmatic tab changes (`submitAdd` → `.manage`, the deep link) are not wrapped in an animation and keep today's behavior, except that `submitAdd`'s change rides on the `inLibrary` key and slides Manage in from the trailing side.
- `infoSections` and `managementSections` keep their 18pt spacing inside their new `VStack`s; layout at rest is unchanged.
- Watchlist: the fill morphs on any change (including the saved state arriving); the bounce only on a successful user toggle.

- [ ] **Step 10: Local gates**

Run the per-task gate block with: `Rawkoon/Views/MediaDetailView.swift Rawkoon/Views/Detail/MediaDetailView+Actions.swift Rawkoon/Views/Detail/MediaDetailView+Management.swift`.

- [ ] **Step 11: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-detail-search-activity
git add Rawkoon/Views/MediaDetailView.swift Rawkoon/Views/Detail/MediaDetailView+Actions.swift Rawkoon/Views/Detail/MediaDetailView+Management.swift
git commit -m "feat(ios): crossfade detail states and slide its tabs"
```

---

### Task 4: Detail rows — seasons and downloads

**Files:**
- Modify: `Rawkoon/Views/Detail/DetailSeasonsSection.swift`
- Modify: `Rawkoon/Views/Detail/DetailDownloadRow.swift`

**Interfaces:**
- Produces: `DetailSeasonsSection.expandedSeason(_:episodes:canManage:)` (private).
- Consumes: Task 1 `DownloadMotion.isRunning(state:)`; kit `.rawkoonNumeric`, `.rawkoonReveal`, `DuskProgress(value:isActive:)`.

- [ ] **Step 1: The seasons list animates as one**

In `Rawkoon/Views/Detail/DetailSeasonsSection.swift`, replace:

```swift
            VStack(spacing: 8) {
                ForEach(visibleSeasons, id: \.seasonNumber) { season in
                    seasonBlock(season)
                }
            }
```

with:

```swift
            VStack(spacing: 8) {
                ForEach(visibleSeasons, id: \.seasonNumber) { season in
                    seasonBlock(season)
                }
            }
            // Keyed here, not per block, so the seasons below an opening one glide down with it.
            .rawkoonMotion(RawkoonMotion.snappy, value: expanded)
```

- [ ] **Step 2: Chevron rotates, count rolls, body reveals**

Replace the whole `seasonBlock(_:)` function:

```swift
    private func seasonBlock(_ season: SeasonSummary) -> some View {
        let episodes = episodesBySeason[season.seasonNumber] ?? []
        let downloaded = episodes.filter { $0.status == "downloaded" }.count
        let total = episodes.isEmpty ? (season.episodeCount ?? 0) : episodes.count
        let isExpanded = expanded.contains(season.seasonNumber)
        let canManage = inLibrary && isAdmin

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    toggle(season.seasonNumber)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.faint)
                        Text(season.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.textStrong)
                        Spacer(minLength: 0)
                        Text(countLabel(downloaded: downloaded, total: total, season: season))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if canManage {
                    seasonMenu(season, episodes: episodes)
                }
            }

            if inLibrary, total > 0 {
                DuskProgress(value: Double(downloaded) / Double(total))
            }

            if isExpanded {
                let files = filesBySeason[season.seasonNumber] ?? []
                let filesByEp = Dictionary(grouping: files.filter { $0.episode != nil }, by: { $0.episode! })
                mergedEpisodeList(episodes, filesByEp: filesByEp, canManage: canManage)
                let orphans = files.filter { file in
                    guard let ep = file.episode else { return true }
                    return !episodes.contains { $0.episode == ep }
                }
                if !orphans.isEmpty {
                    otherFilesList(orphans)
                }
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        .rawkoonMotion(RawkoonMotion.snappy, value: isExpanded)
    }
```

with:

```swift
    private func seasonBlock(_ season: SeasonSummary) -> some View {
        let episodes = episodesBySeason[season.seasonNumber] ?? []
        let downloaded = episodes.filter { $0.status == "downloaded" }.count
        let total = episodes.isEmpty ? (season.episodeCount ?? 0) : episodes.count
        let isExpanded = expanded.contains(season.seasonNumber)
        let canManage = inLibrary && isAdmin

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    toggle(season.seasonNumber)
                } label: {
                    HStack(spacing: 8) {
                        // One glyph turned a quarter, so opening reads as a rotation rather than a swap.
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.faint)
                            .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        Text(season.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.textStrong)
                        Spacer(minLength: 0)
                        Text(countLabel(downloaded: downloaded, total: total, season: season))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                            .rawkoonNumeric(Double(downloaded))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if canManage {
                    seasonMenu(season, episodes: episodes)
                }
            }

            if inLibrary, total > 0 {
                DuskProgress(value: Double(downloaded) / Double(total))
            }

            if isExpanded {
                expandedSeason(season, episodes: episodes, canManage: canManage)
                    .transition(.rawkoonReveal)
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    /// The season's episodes and stray files as one block, so they reveal together.
    private func expandedSeason(_ season: SeasonSummary, episodes: [Episode], canManage: Bool) -> some View {
        let files = filesBySeason[season.seasonNumber] ?? []
        let filesByEp = Dictionary(grouping: files.filter { $0.episode != nil }, by: { $0.episode! })
        let orphans = files.filter { file in
            guard let ep = file.episode else { return true }
            return !episodes.contains { $0.episode == ep }
        }
        return VStack(alignment: .leading, spacing: 8) {
            mergedEpisodeList(episodes, filesByEp: filesByEp, canManage: canManage)
            if !orphans.isEmpty {
                otherFilesList(orphans)
            }
        }
    }
```

The pre-existing `identifier_name` warning for `ep` moves with the code and stays at one.

- [ ] **Step 3: Download speed and percentage roll; the bar shines while bytes arrive**

In `Rawkoon/Views/Detail/DetailDownloadRow.swift`, replace:

```swift
            if let live = row.live {
                DuskProgress(value: live.progress)
                HStack(spacing: 10) {
                    Text("↓ \(Formatters.speed(live.downloadSpeed, useAll: false))")
                    Text("\(Int(live.progress * 100))%")
                    LocalizedStatus.text(live.state)
                }
```

with:

```swift
            if let live = row.live {
                DuskProgress(value: live.progress, isActive: isActive && DownloadMotion.isRunning(state: live.state))
                HStack(spacing: 10) {
                    Text("↓ \(Formatters.speed(live.downloadSpeed, useAll: false))")
                        .rawkoonNumeric(live.downloadSpeed.isFinite ? live.downloadSpeed : 0)
                    Text("\(Int(live.progress * 100))%")
                        .rawkoonNumeric(Double(Int(live.progress * 100)))
                    LocalizedStatus.text(live.state)
                }
```

- [ ] **Step 4: Review**

- The chevron points right when closed and down when open, as before; the rotation, the reveal and the sibling seasons' movement all ride the one `expanded`-keyed motion.
- The count `Text` is the same view across changes (only its string changes), so `x/y` rolls when an episode downloads.
- Download rows update from the pushed `.downloadProgress` events, so speed and percentage roll live; the percentage key is the displayed integer, so sub-percent changes do not re-trigger it. A non-finite speed keys as 0 so the animation never re-fires on every render.
- The sheen runs only for an active, unpaused, still-downloading row; a stalled, paused, completed or failed row has a still bar.

- [ ] **Step 5: Local gates**

Run the per-task gate block with: `Rawkoon/Views/Detail/DetailSeasonsSection.swift Rawkoon/Views/Detail/DetailDownloadRow.swift`.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-detail-search-activity
git add Rawkoon/Views/Detail/DetailSeasonsSection.swift Rawkoon/Views/Detail/DetailDownloadRow.swift
git commit -m "feat(ios): roll season counts and download figures, reveal season episodes"
```

---

### Task 5: Release search — states, notices, chips, cascade, the celebrated grab

**Files:**
- Modify: `Rawkoon/Views/ReleaseSearchView.swift`
- Modify: `Rawkoon/Views/ReleaseSearch/ReleaseRow.swift`

**Interfaces:**
- Produces: `ReleaseSearchView` private `ContentPhase`, `MotionState`, `contentPhase`, `motionState`, `notices`.
- Consumes: kit `.rawkoonSwap`, `.rawkoonReveal`, `.rawkoonNumeric`, `.rawkoonEntranceScope()` / `.rawkoonEntrance(id:)`, `.rawkoonCelebrate(trigger:ring:tint:haptic:when:)`, `RawkoonHaptics.feedback(for: .grab)`. The `AiPickBanner` call site is unchanged apart from its transition; Task 6 rewrites the banner itself.

- [ ] **Step 1: The sheet opens as searching**

In `Rawkoon/Views/ReleaseSearchView.swift`, replace:

```swift
    @State private var isLoading = false
```

with:

```swift
    /// Starts true so the sheet opens on "Searching…", never a "No Results" flash; `search()` clears it.
    @State private var isLoading = true
```

Replace:

```swift
    private func initialLoad() async {
        await resolveAiGate()
```

with:

```swift
    private func initialLoad() async {
        // Also covers the AI gate and history lookups that run before the search itself.
        isLoading = true
        await resolveAiGate()
```

In `search()`, replace:

```swift
        guard let client = model.api() else {
            errorMessage = String(localized: "Not connected.")
            return
        }
        guard !model.isOffline else { return }
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedQuery.count < 2, selectedSeason == nil, !completeSeries {
            errorMessage = String(localized: "Search query must be at least 2 characters.")
            releases = []
            return
        }
```

with:

```swift
        guard let client = model.api() else {
            errorMessage = String(localized: "Not connected.")
            isLoading = false
            return
        }
        guard !model.isOffline else {
            isLoading = false
            return
        }
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedQuery.count < 2, selectedSeason == nil, !completeSeries {
            errorMessage = String(localized: "Search query must be at least 2 characters.")
            releases = []
            isLoading = false
            return
        }
```

- [ ] **Step 2: Body — notices move out, content gets one slot, one motion key, one grab haptic**

Replace (from `controls` to the end of the `.task` modifier in `body`):

```swift
            controls

            if let adminOnlyNote {
                Text(adminOnlyNote)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.terracotta)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }

            if !indexerWarnings.isEmpty {
                warningStrip
            }

            // A failed refresh keeps the earlier results; say so above them.
            if let errorMessage, !releases.isEmpty {
                Text(errorMessage)
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }

            if let grabError {
                Text(grabError)
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }

            if aiEnabled, !aiPickDismissed {
                AiPickBanner(
                    aiPickLoading: aiPickLoading,
                    aiPickError: aiPickError,
                    aiPickBudgetReached: aiPickBudgetReached,
                    aiPickedRelease: aiPickedRelease,
                    aiPickGrabbed: aiPickGrabbed,
                    aiPick: aiPick,
                    grabbingGuid: grabbingGuid,
                    onRetry: { await runAiPick(force: true) },
                    onGrab: { release in await grabFromBanner(release) },
                    onDismiss: { aiPickDismissed = true }
                )
            }

            content
        }
        .background(Theme.base)
        .task {
            // Offline, the search would only fail; it runs once the connection is back.
            guard !model.isOffline else { return }
            await initialLoad()
        }
```

with:

```swift
            controls

            notices

            // One slot, so the outgoing state never stacks above the incoming one.
            ZStack {
                content
            }
        }
        .background(Theme.base)
        .rawkoonMotion(RawkoonMotion.spring, value: motionState)
        // One success tap per confirmed grab, whether it came from a row or the AI banner.
        .sensoryFeedback(RawkoonHaptics.feedback(for: .grab), trigger: grabbedGuids.count)
        .task {
            // Offline, the search would only fail; it runs once the connection is back.
            guard !model.isOffline else {
                isLoading = false
                return
            }
            await initialLoad()
        }
```

Then insert, directly after the `body` property's closing brace (before `/// An episode target holds until …`):

```swift

    /// Notes that slide in above the results: admin-only, warnings, a failed refresh or grab, the AI pick.
    @ViewBuilder
    private var notices: some View {
        if let adminOnlyNote {
            Text(adminOnlyNote)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.terracotta)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.rawkoonReveal)
        }

        if !indexerWarnings.isEmpty {
            warningStrip
                .transition(.rawkoonReveal)
        }

        // A failed refresh keeps the earlier results; say so above them.
        if let errorMessage, !releases.isEmpty {
            Text(errorMessage)
                .font(.subheadline)
                .foregroundStyle(Theme.terracotta)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.rawkoonReveal)
        }

        if let grabError {
            Text(grabError)
                .font(.subheadline)
                .foregroundStyle(Theme.terracotta)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.rawkoonReveal)
        }

        if aiEnabled, !aiPickDismissed {
            AiPickBanner(
                aiPickLoading: aiPickLoading,
                aiPickError: aiPickError,
                aiPickBudgetReached: aiPickBudgetReached,
                aiPickedRelease: aiPickedRelease,
                aiPickGrabbed: aiPickGrabbed,
                aiPick: aiPick,
                grabbingGuid: grabbingGuid,
                onRetry: { await runAiPick(force: true) },
                onGrab: { release in await grabFromBanner(release) },
                onDismiss: { aiPickDismissed = true }
            )
            .transition(.rawkoonReveal)
        }
    }

    /// Mirrors `content`'s branch order, so every swap between states animates.
    private enum ContentPhase: Equatable {
        case searching, offline, failed, empty, filteredOut, list
    }

    private var contentPhase: ContentPhase {
        if isLoading {
            return .searching
        }
        if model.isOffline, releases.isEmpty {
            return .offline
        }
        if errorMessage != nil, releases.isEmpty {
            return .failed
        }
        if releases.isEmpty {
            return .empty
        }
        return filteredAndSortedReleases.isEmpty ? .filteredOut : .list
    }

    /// Everything that appears above or in place of the list; one change animates the sheet's layout together.
    private struct MotionState: Equatable {
        var content: ContentPhase
        var adminOnlyNote: String?
        var hasWarnings: Bool
        var refreshError: String?
        var grabError: String?
        var showsAiBanner: Bool
    }

    private var motionState: MotionState {
        MotionState(
            content: contentPhase,
            adminOnlyNote: adminOnlyNote,
            hasWarnings: !indexerWarnings.isEmpty,
            refreshError: releases.isEmpty ? nil : errorMessage,
            grabError: grabError,
            showsAiBanner: aiEnabled && !aiPickDismissed
        )
    }
```

- [ ] **Step 3: Content states crossfade; rows cascade**

Replace the whole `content` property:

```swift
    @ViewBuilder
    private var content: some View {
        if isLoading {
            VStack(spacing: 10) {
                ProgressView().tint(Theme.apricot)
                Text("Searching…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.isOffline, releases.isEmpty {
            ContentUnavailableView {
                Label("Offline", systemImage: "wifi.slash")
            } description: {
                Text("Release search needs a connection.")
            }
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, releases.isEmpty {
            ContentUnavailableView {
                Label("Search failed", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            }
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if releases.isEmpty {
            ContentUnavailableView.search
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if filteredAndSortedReleases.isEmpty {
            // Results came back but the active filters (commonly "Hide rejected")
            // hide them all — say so and offer a reset, mirroring the web
            // "No matches" + Reset view empty state instead of a blank sheet.
            ContentUnavailableView {
                Label("No matches", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("\(releases.count) results are hidden by your filters.")
            } actions: {
                Button("Reset view") { resetView() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.terracotta)
            }
            .rawkoonLivingSymbol(.empty)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(filteredAndSortedReleases) { release in
                        ReleaseRow(
                            release: release,
                            isGrabbing: grabbingGuid == release.guid,
                            isGrabbed: grabbedGuids.contains(release.guid),
                            alreadyGrabbed: isAlreadyGrabbed(release),
                            isBlocking: blockingGuid == release.guid,
                            isBlocked: blockedGuids.contains(release.guid),
                            isAiPick: release.guid == aiPickBadgeKey,
                            onGrab: { await grab(release) },
                            onBlock: { await block(release) }
                        )
                    }
                }
                .padding(16)
            }
        }
    }
```

with:

```swift
    @ViewBuilder
    private var content: some View {
        if isLoading {
            VStack(spacing: 10) {
                ProgressView().tint(Theme.apricot)
                Text("Searching…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else if model.isOffline, releases.isEmpty {
            ContentUnavailableView {
                Label("Offline", systemImage: "wifi.slash")
            } description: {
                Text("Release search needs a connection.")
            }
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else if let errorMessage, releases.isEmpty {
            ContentUnavailableView {
                Label("Search failed", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            }
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else if releases.isEmpty {
            ContentUnavailableView.search
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)
        } else if filteredAndSortedReleases.isEmpty {
            // Results came back but the active filters (commonly "Hide rejected")
            // hide them all — say so and offer a reset, mirroring the web
            // "No matches" + Reset view empty state instead of a blank sheet.
            ContentUnavailableView {
                Label("No matches", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("\(releases.count) results are hidden by your filters.")
            } actions: {
                Button("Reset view") { resetView() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.terracotta)
            }
            .rawkoonLivingSymbol(.empty)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(filteredAndSortedReleases) { release in
                        ReleaseRow(
                            release: release,
                            isGrabbing: grabbingGuid == release.guid,
                            isGrabbed: grabbedGuids.contains(release.guid),
                            alreadyGrabbed: isAlreadyGrabbed(release),
                            isBlocking: blockingGuid == release.guid,
                            isBlocked: blockedGuids.contains(release.guid),
                            isAiPick: release.guid == aiPickBadgeKey,
                            onGrab: { await grab(release) },
                            onBlock: { await block(release) }
                        )
                        .rawkoonEntrance(id: release.guid)
                    }
                }
                .padding(16)
                .rawkoonEntranceScope()
            }
            .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 4: Filter count badge, Clear button and season chips animate**

In `filterRow`, replace:

```swift
                        .buttonStyle(.plain)
                        .fixedSize()
                    }
                }
            }
        }
    }
```

with:

```swift
                        .buttonStyle(.plain)
                        .fixedSize()
                        .transition(.rawkoonSwap)
                    }
                }
                .rawkoonMotion(RawkoonMotion.snappy, value: hasActiveFilters)
            }
        }
    }
```

In `filterChipMenu`, replace:

```swift
                if activeCount > 0 {
                    Text("\(activeCount)")
                        .font(.system(.caption2, design: .monospaced).weight(.semibold))
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.terracotta, in: Capsule())
                }
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(activeCount > 0 ? Theme.textStrong : Theme.muted)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(activeCount > 0 ? Theme.apricot.opacity(0.12) : Theme.raised, in: Capsule())
            .overlay(
                Capsule().strokeBorder(activeCount > 0 ? Theme.apricotSoft : Theme.borderStrong, lineWidth: 1)
            )
        }
```

with:

```swift
                if activeCount > 0 {
                    Text("\(activeCount)")
                        .font(.system(.caption2, design: .monospaced).weight(.semibold))
                        .rawkoonNumeric(Double(activeCount))
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.terracotta, in: Capsule())
                        .transition(.rawkoonSwap)
                }
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(activeCount > 0 ? Theme.textStrong : Theme.muted)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(activeCount > 0 ? Theme.apricot.opacity(0.12) : Theme.raised, in: Capsule())
            .overlay(
                Capsule().strokeBorder(activeCount > 0 ? Theme.apricotSoft : Theme.borderStrong, lineWidth: 1)
            )
            .rawkoonMotion(RawkoonMotion.snappy, value: activeCount)
        }
```

In `seasonButton`, replace:

```swift
        .foregroundStyle(selected ? Theme.textStrong : Theme.muted)
        .font(.system(.caption, design: .monospaced))
    }
```

with:

```swift
        .foregroundStyle(selected ? Theme.textStrong : Theme.muted)
        .font(.system(.caption, design: .monospaced))
        .rawkoonMotion(RawkoonMotion.snappy, value: selected)
    }
```

- [ ] **Step 5: `ReleaseRow` — action slots, AI-pick morph, the celebration**

In `Rawkoon/Views/ReleaseSearch/ReleaseRow.swift`, replace:

```swift
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(cardBorder, lineWidth: 1)
        )
    }
```

with:

```swift
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(cardBorder, lineWidth: 1)
        )
        // The row's own states come from the sheet unanimated, so the row animates them itself.
        .rawkoonMotion(RawkoonMotion.snappy, value: [isAiPick, isBlocking, isBlocked, isGrabbing, isGrabbed])
        // `isGrabbed` turns true only after the server confirms the grab; the sheet plays the haptic.
        .rawkoonCelebrate(trigger: isGrabbed, ring: .roundedRect(cornerRadius: 14), haptic: nil, when: { !$0 && $1 })
    }
```

Replace:

```swift
            if isAiPick {
                Image(systemName: "sparkles")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.apricotSoft)
            }
```

with:

```swift
            if isAiPick {
                Image(systemName: "sparkles")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.apricotSoft)
                    .transition(.rawkoonSwap)
            }
```

Replace:

```swift
        HStack(spacing: 10) {
            blockButton
            Spacer(minLength: 8)
            grabButton
        }
```

with:

```swift
        HStack(spacing: 10) {
            // Each control keeps one slot, so its states crossfade in place.
            ZStack(alignment: .leading) {
                blockButton
            }
            Spacer(minLength: 8)
            ZStack(alignment: .trailing) {
                grabButton
            }
        }
```

Replace the whole `grabButton` and `blockButton` properties:

```swift
    @ViewBuilder
    private var grabButton: some View {
        if isGrabbed {
            Label("Grabbed", systemImage: "checkmark.circle.fill")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.seed)
        } else if isGrabbing {
            ProgressView()
                .tint(Theme.apricot)
                .frame(width: 20, height: 20)
        } else {
            Button {
                Task { await onGrab() }
            } label: {
                Group {
                    if alreadyGrabbed {
                        Label("Re-grab", systemImage: "arrow.triangle.2.circlepath")
                            .labelStyle(.titleAndIcon)
                    } else {
                        Label("Grab", systemImage: "arrow.down.circle")
                            .labelStyle(.titleOnly)
                    }
                }
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.terracotta, in: Capsule())
            }
            .requiresConnection(model.isOffline)
        }
    }

    @ViewBuilder
    private var blockButton: some View {
        if isBlocked {
            Label("Blocked", systemImage: "xmark.octagon.fill")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .frame(minHeight: 44)
        } else if isBlocking {
            ProgressView()
                .tint(Theme.terracotta)
                .frame(width: 20, height: 20)
                .frame(minHeight: 44)
        } else {
            Button {
                Task { await onBlock() }
            } label: {
                Label("Block", systemImage: "xmark.octagon")
                    .font(.system(.caption2, design: .monospaced))
                    .lineLimit(1)
            }
            .buttonStyle(.bordered)
            .tint(Theme.muted)
            .controlSize(.small)
            .frame(minHeight: 44)
            .requiresConnection(model.isOffline)
        }
    }
```

with:

```swift
    @ViewBuilder
    private var grabButton: some View {
        if isGrabbed {
            Label("Grabbed", systemImage: "checkmark.circle.fill")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.seed)
                .transition(.rawkoonSwap)
        } else if isGrabbing {
            ProgressView()
                .tint(Theme.apricot)
                .frame(width: 20, height: 20)
                .transition(.rawkoonSwap)
        } else {
            Button {
                Task { await onGrab() }
            } label: {
                Group {
                    if alreadyGrabbed {
                        Label("Re-grab", systemImage: "arrow.triangle.2.circlepath")
                            .labelStyle(.titleAndIcon)
                    } else {
                        Label("Grab", systemImage: "arrow.down.circle")
                            .labelStyle(.titleOnly)
                    }
                }
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.terracotta, in: Capsule())
            }
            .requiresConnection(model.isOffline)
            .transition(.rawkoonSwap)
        }
    }

    @ViewBuilder
    private var blockButton: some View {
        if isBlocked {
            Label("Blocked", systemImage: "xmark.octagon.fill")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .frame(minHeight: 44)
                .transition(.rawkoonSwap)
        } else if isBlocking {
            ProgressView()
                .tint(Theme.terracotta)
                .frame(width: 20, height: 20)
                .frame(minHeight: 44)
                .transition(.rawkoonSwap)
        } else {
            Button {
                Task { await onBlock() }
            } label: {
                Label("Block", systemImage: "xmark.octagon")
                    .font(.system(.caption2, design: .monospaced))
                    .lineLimit(1)
            }
            .buttonStyle(.bordered)
            .tint(Theme.muted)
            .controlSize(.small)
            .frame(minHeight: 44)
            .requiresConnection(model.isOffline)
            .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 6: Line lengths**

Every new line in this task is at most 120 characters as written. If `swiftformat` reflows one or `swiftlint` reports a new `line_length` anyway, wrap call arguments one per line or shorten the comment; do not change behavior.

- [ ] **Step 7: Review**

- Grab confirmation: in `grab(_:)`, `grabbedGuids.insert` runs only after `result.grabbed` is true on the library-URL path and on the token path (the token endpoint replies 200 even when it fails, so the status code is never trusted), and never in a `catch`. The row's trigger is `isGrabbed`, so a failed grab neither celebrates nor buzzes.
- One haptic: rows pass `haptic: nil`; the sheet's `sensoryFeedback` keys on `grabbedGuids.count`, which only grows, so each confirmed grab buzzes once, even when the grabbed row is scrolled off screen or the grab came from the AI banner.
- A row re-created by the lazy stack after a grab starts with `isGrabbed == true` and does not celebrate again (`CelebrationGate` needs a change).
- No ghost: `isLoading` starts true; the offline `.task` guard, both `search()` guards and the short-query branch clear it; `initialLoad()` sets it before the AI gate and history lookups. A sheet opened offline shows the offline state, then searches when the connection returns (the `onChange(of: model.isOffline)` guard `!isLoading` still passes).
- Every `content` branch carries a transition inside one `ZStack`; `contentPhase` mirrors the branch order. Notices reveal and push the list down with the same spring, because `motionState` is keyed at the sheet's root.
- The filter count badge rolls while it stays above zero and swaps in or out at zero; the Clear button swaps with `hasActiveFilters`; season chips crossfade their selection.

- [ ] **Step 8: Local gates**

Run the per-task gate block with: `Rawkoon/Views/ReleaseSearchView.swift Rawkoon/Views/ReleaseSearch/ReleaseRow.swift`. `ReleaseSearchView.swift`'s pre-existing `file_length` warning stays at one.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-detail-search-activity
git add Rawkoon/Views/ReleaseSearchView.swift Rawkoon/Views/ReleaseSearch/ReleaseRow.swift
git commit -m "feat(ios): cascade release rows and celebrate a confirmed grab"
```

---

### Task 6: AI-pick banner morph and book release search

**Files:**
- Rewrite: `Rawkoon/Views/ReleaseSearch/AiPickBanner.swift`
- Modify: `Rawkoon/Views/BookReleaseSearchView.swift`
- Test: `RawkoonTests/SurfaceMotionTests.swift`

**Interfaces:**
- Produces: `AiPickBanner.Phase` (`nonisolated enum`: `hidden`, `loading`, `budgetReached`, `failed`, `picked`, `grabbed`); `nonisolated static func phase(loading: Bool, budgetReached: Bool, failed: Bool, hasRelease: Bool, grabbed: Bool) -> Phase`. `AiPickBanner`'s memberwise init is unchanged.
- Consumes: kit `.rawkoonSwap`, `.rawkoonReveal`, `.rawkoonCelebrate`, `.rawkoonEntrance`, `withRawkoonMotion`, `RawkoonHaptics.feedback(for: .grab)`.

- [ ] **Step 1: Write the tests (written now, executed by CI)**

In `RawkoonTests/SurfaceMotionTests.swift`, insert before the struct's final closing `}` (after `downloadCompletionMatchesTheSeedingPhase`):

```swift

    @Test func aiBannerLoadingWinsOverEveryOtherFace() {
        let phase = aiPhase(loading: true, budgetReached: true, failed: true, hasRelease: true, grabbed: true)
        #expect(phase == .loading)
    }

    @Test func aiBannerBudgetBeatsAFailure() {
        let phase = aiPhase(loading: false, budgetReached: true, failed: true, hasRelease: false, grabbed: false)
        #expect(phase == .budgetReached)
    }

    @Test func aiBannerFailureShowsWithoutAPick() {
        let phase = aiPhase(loading: false, budgetReached: false, failed: true, hasRelease: false, grabbed: false)
        #expect(phase == .failed)
    }

    @Test func aiBannerHidesWithoutAPickedRelease() {
        let phase = aiPhase(loading: false, budgetReached: false, failed: false, hasRelease: false, grabbed: true)
        #expect(phase == .hidden)
    }

    @Test func aiBannerShowsThePickThenGrabbed() {
        let picked = aiPhase(loading: false, budgetReached: false, failed: false, hasRelease: true, grabbed: false)
        let grabbed = aiPhase(loading: false, budgetReached: false, failed: false, hasRelease: true, grabbed: true)
        #expect(picked == .picked)
        #expect(grabbed == .grabbed)
    }

    private func aiPhase(
        loading: Bool, budgetReached: Bool, failed: Bool, hasRelease: Bool, grabbed: Bool
    ) -> AiPickBanner.Phase {
        AiPickBanner.phase(
            loading: loading, budgetReached: budgetReached, failed: failed, hasRelease: hasRelease, grabbed: grabbed
        )
    }
```

- [ ] **Step 2: One morphing shell for the banner**

Replace the whole content of `Rawkoon/Views/ReleaseSearch/AiPickBanner.swift` with:

```swift
import RawkoonKit
import SwiftUI

/// AI-picks banner: mirrors the web `AiPickBanner`. State lives in
/// `ReleaseSearchView`; this view renders it and reports actions back through
/// the closures (retry, grab, dismiss) so the parent stays the single owner.
/// One shell stays mounted across its faces, so a state change morphs it instead of cutting.
struct AiPickBanner: View {
    @Environment(AppModel.self) private var model

    let aiPickLoading: Bool
    let aiPickError: String?
    let aiPickBudgetReached: Bool
    let aiPickedRelease: ReleaseItem?
    let aiPickGrabbed: Bool
    let aiPick: AiPick?
    let grabbingGuid: String?
    let onRetry: () async -> Void
    let onGrab: (ReleaseItem) async -> Void
    let onDismiss: () -> Void

    /// The banner's faces, in the precedence the parent's state implies.
    nonisolated enum Phase: Equatable {
        case hidden, loading, budgetReached, failed, picked, grabbed
    }

    nonisolated static func phase(
        loading: Bool,
        budgetReached: Bool,
        failed: Bool,
        hasRelease: Bool,
        grabbed: Bool
    ) -> Phase {
        if loading {
            return .loading
        }
        if budgetReached {
            return .budgetReached
        }
        if failed {
            return .failed
        }
        guard hasRelease else { return .hidden }
        return grabbed ? .grabbed : .picked
    }

    private var phase: Phase {
        Self.phase(
            loading: aiPickLoading,
            budgetReached: aiPickBudgetReached,
            failed: aiPickError != nil,
            hasRelease: aiPickedRelease != nil,
            grabbed: aiPickGrabbed
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if phase != .hidden {
                aiPickBannerShell(isError: phase == .failed) {
                    // One slot, so faces crossfade while the shell resizes around them.
                    ZStack(alignment: .topLeading) {
                        face
                    }
                }
                // Visual only: the sheet plays the grab haptic once for every confirmed grab.
                .rawkoonCelebrate(
                    trigger: aiPickGrabbed,
                    ring: .roundedRect(cornerRadius: 12),
                    haptic: nil,
                    when: { !$0 && $1 }
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
                .transition(.rawkoonReveal)
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: phase)
    }

    @ViewBuilder
    private var face: some View {
        switch phase {
        case .hidden:
            EmptyView()
        case .loading:
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.caption)
                    .foregroundStyle(Theme.apricot)
                Text("AI is picking the best release…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .transition(.rawkoonSwap)
        case .budgetReached:
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                Text("AI daily budget reached \u{2014} showing the classic pick")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .transition(.rawkoonSwap)
        case .failed:
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
                Text("Could not get a response from AI")
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                Spacer(minLength: 8)
                Button {
                    Task {
                        await onRetry()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                        Text("Retry")
                    }
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .requiresConnection(model.isOffline)
            }
            .transition(.rawkoonSwap)
        case .picked:
            if let release = aiPickedRelease {
                aiPickBannerContent(release)
                    .transition(.rawkoonSwap)
            }
        case .grabbed:
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.seed)
                Text("Grabbed!")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.seed)
            }
            .transition(.rawkoonSwap)
        }
    }

    private func aiPickBannerContent(_ release: ReleaseItem) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "sparkles")
                .font(.caption)
                .foregroundStyle(Theme.apricot)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text("AI Pick")
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.apricotSoft)
                Text(release.title)
                    .font(.subheadline)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                if let reasoning = aiPick?.reasoning, !reasoning.isEmpty {
                    Text(reasoning)
                        .font(.caption)
                        .italic()
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 8)
                    Button {
                        Task {
                            await onGrab(release)
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                            Text("Grab")
                        }
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(Theme.apricot, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(grabbingGuid != nil)
                    .requiresConnection(model.isOffline)
                    Button {
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                }
            }
        }
    }

    /// The card itself; its outer gutter sits outside, so the celebration ring hugs the card.
    private func aiPickBannerShell(isError: Bool, @ViewBuilder content: () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                (isError ? Theme.terracotta : Theme.apricot).opacity(0.12),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(isError ? Theme.terracotta.opacity(0.4) : Theme.apricotSoft, lineWidth: 1)
            )
    }
}
```

- [ ] **Step 3: Book release search — one slot, phases, notices**

In `Rawkoon/Views/BookReleaseSearchView.swift`, replace:

```swift
            content
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.base)
        .task { await start() }
```

with:

```swift
            // One slot, so the outgoing state never stacks above the incoming one.
            ZStack(alignment: .top) {
                content
            }
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.base)
        .rawkoonMotion(RawkoonMotion.spring, value: phase)
        .rawkoonMotion(RawkoonMotion.spring, value: grabError)
        // One success tap per confirmed grab.
        .sensoryFeedback(RawkoonHaptics.feedback(for: .grab), trigger: grabbed.count)
        .task { await start() }
```

Replace the whole `content` property:

```swift
    @ViewBuilder
    private var content: some View {
        if loading {
            centered { ProgressView().tint(Theme.apricot); Text("Searching…").foregroundStyle(Theme.muted) }
        } else if model.isOffline, releases.isEmpty {
            centered {
                ContentUnavailableView("Offline", systemImage: "wifi.slash",
                                       description: Text("Release search needs a connection."))
                    .rawkoonLivingSymbol(.error)
            }
        } else if let errorMessage, releases.isEmpty {
            centered {
                ContentUnavailableView("Search failed", systemImage: "wifi.slash", description: Text(errorMessage))
                    .rawkoonLivingSymbol(.error)
            }
        } else if visibleReleases.isEmpty {
            centered {
                ContentUnavailableView("No releases", systemImage: "magnifyingglass",
                                       description: Text("Nothing grabbable found for this book."))
                    .rawkoonLivingSymbol(.empty)
            }
        } else {
            if let grabError {
                Text(grabError)
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                    .padding(.bottom, 8)
            }
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(visibleReleases) { release in
                        releaseRow(release)
                    }
                    if hasRejected {
                        Button(LocalizedStringKey(showRejected ? "Hide rejected" : "Show rejected")) { showRejected.toggle() }
                            .font(.subheadline).foregroundStyle(Theme.muted)
                            .padding(.vertical, 8)
                    }
                }
                .padding(.bottom, 24)
            }
        }
    }
```

with:

```swift
    @ViewBuilder
    private var content: some View {
        if loading {
            centered { ProgressView().tint(Theme.apricot); Text("Searching…").foregroundStyle(Theme.muted) }
                .transition(.rawkoonSwap)
        } else if model.isOffline, releases.isEmpty {
            centered {
                ContentUnavailableView("Offline", systemImage: "wifi.slash",
                                       description: Text("Release search needs a connection."))
                    .rawkoonLivingSymbol(.error)
            }
            .transition(.rawkoonSwap)
        } else if let errorMessage, releases.isEmpty {
            centered {
                ContentUnavailableView("Search failed", systemImage: "wifi.slash", description: Text(errorMessage))
                    .rawkoonLivingSymbol(.error)
            }
            .transition(.rawkoonSwap)
        } else if visibleReleases.isEmpty {
            centered {
                ContentUnavailableView("No releases", systemImage: "magnifyingglass",
                                       description: Text("Nothing grabbable found for this book."))
                    .rawkoonLivingSymbol(.empty)
            }
            .transition(.rawkoonSwap)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if let grabError {
                    Text(grabError)
                        .font(.subheadline)
                        .foregroundStyle(Theme.terracotta)
                        .padding(.bottom, 8)
                        .transition(.rawkoonReveal)
                }
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(visibleReleases) { release in
                            releaseRow(release)
                                .rawkoonEntrance(id: release.guid)
                        }
                        if hasRejected {
                            Button(LocalizedStringKey(showRejected ? "Hide rejected" : "Show rejected")) {
                                withRawkoonMotion(RawkoonMotion.spring) { showRejected.toggle() }
                            }
                            .font(.subheadline).foregroundStyle(Theme.muted)
                            .padding(.vertical, 8)
                        }
                    }
                    .padding(.bottom, 24)
                    .rawkoonEntranceScope()
                }
            }
            .transition(.rawkoonSwap)
        }
    }

    /// Mirrors `content`'s branch order, so every swap between states animates.
    private enum Phase: Equatable {
        case searching, offline, failed, empty, list
    }

    private var phase: Phase {
        if loading {
            return .searching
        }
        if model.isOffline, releases.isEmpty {
            return .offline
        }
        if errorMessage != nil, releases.isEmpty {
            return .failed
        }
        return visibleReleases.isEmpty ? .empty : .list
    }
```

- [ ] **Step 4: Book rows celebrate a grab; the button slot crossfades**

Replace:

```swift
                Spacer(minLength: 4)
                grabButton(release)
            }
```

with:

```swift
                Spacer(minLength: 4)
                // One slot, so the button, spinner and "Grabbed" crossfade in place.
                ZStack(alignment: .trailing) {
                    grabButton(release)
                }
                .rawkoonMotion(RawkoonMotion.snappy, value: [grabbing == release.guid, grabbed.contains(release.guid)])
            }
```

Replace:

```swift
        .padding(11)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }
```

with:

```swift
        .padding(11)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        // `grabbed` gains a guid only after the grab call succeeds; the sheet plays the haptic.
        .rawkoonCelebrate(
            trigger: grabbed.contains(release.guid),
            ring: .roundedRect(cornerRadius: 12),
            haptic: nil,
            when: { !$0 && $1 }
        )
    }
```

Replace the whole `grabButton(_:)` function:

```swift
    @ViewBuilder
    private func grabButton(_ release: BookRelease) -> some View {
        if grabbed.contains(release.guid) {
            Label("Grabbed", systemImage: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(Theme.seed)
        } else if grabbing == release.guid {
            ProgressView().tint(Theme.apricot)
        } else {
            Button("Grab") { Task { await grab(release) } }
                .font(.caption.weight(.bold)).foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.terracotta, in: Capsule())
                .disabled(release.downloadUrl == nil && release.magnetUrl == nil)
                .requiresConnection(model.isOffline)
        }
    }
```

with:

```swift
    @ViewBuilder
    private func grabButton(_ release: BookRelease) -> some View {
        if grabbed.contains(release.guid) {
            Label("Grabbed", systemImage: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(Theme.seed)
                .transition(.rawkoonSwap)
        } else if grabbing == release.guid {
            ProgressView().tint(Theme.apricot)
                .transition(.rawkoonSwap)
        } else {
            Button("Grab") { Task { await grab(release) } }
                .font(.caption.weight(.bold)).foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.terracotta, in: Capsule())
                .disabled(release.downloadUrl == nil && release.magnetUrl == nil)
                .requiresConnection(model.isOffline)
                .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 5: Review**

- `AiPickBanner.phase` reproduces the old `if` chain exactly: loading, then budget, then error, then a picked release (grabbed or not), else nothing. All visible strings are byte-identical to the old file (including `\u{2014}`).
- The shell is mounted for every face but `hidden`, so `aiPickGrabbed` false → true is seen and pops the card; its haptic is `nil` because `ReleaseSearchView` already buzzes on the confirmed grab. The 1.8s auto-dismiss in `grabFromBanner` reveals the banner out through `motionState.showsAiBanner`.
- Book sheet: `loading` already starts true and `start()` clears it on every path, so no ghost. `grab(_:)` inserts into `grabbed` only after `bookGrab` returns without throwing, so a refused grab neither celebrates nor buzzes.

- [ ] **Step 6: Local gates**

Run the per-task gate block with: `Rawkoon/Views/ReleaseSearch/AiPickBanner.swift Rawkoon/Views/BookReleaseSearchView.swift RawkoonTests/SurfaceMotionTests.swift`.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-detail-search-activity
git add Rawkoon/Views/ReleaseSearch/AiPickBanner.swift Rawkoon/Views/BookReleaseSearchView.swift RawkoonTests/SurfaceMotionTests.swift
git commit -m "feat(ios): morph the AI-pick banner and animate book release search"
```

---

### Task 7: Activity — lane slide, speed reveal, rolling queue, check burst

**Files:**
- Modify: `Rawkoon/Views/ActivityView.swift`

**Interfaces:**
- Produces (private to `ActivityView`): `laneEdge`, `laneSelection`, `showsSpeed`, `LaneState`, `laneState(loading:failed:isEmpty:)`.
- Consumes: Task 1 `.rawkoonSlide(_:)`, `RawkoonSlide.edge(from:to:)`, `DownloadMotion.isRunning` / `isComplete`; kit `.rawkoonNumeric`, `.rawkoonCelebrate`, `.rawkoonEntrance`, `RawkoonHaptics.Event.downloadComplete`.

- [ ] **Step 1: State — lanes open on their skeleton, and remember the slide edge**

Replace:

```swift
    @State private var lane: Lane = .queue
```

with:

```swift
    @State private var lane: Lane = .queue
    /// The side the next lane enters from, set before the lane changes so the insertion reads it fresh.
    @State private var laneEdge: Edge = .trailing
```

Replace:

```swift
    @State private var loadingQueue = false
```

with:

```swift
    /// Starts true, like the other lanes, so an empty state never flashes before the first load.
    @State private var loadingQueue = true
```

Replace:

```swift
    @State private var loadingHistory = false
```

with:

```swift
    @State private var loadingHistory = true
```

Replace:

```swift
    @State private var loadingCalendar = false
```

with:

```swift
    @State private var loadingCalendar = true
```

In `loadHistory()`, replace:

```swift
        guard let client = model.api() else {
            historyError = String(localized: "Not signed in.")
            return
        }
        // Skeleton only on a cold load; a live reload keeps the current rows.
```

with:

```swift
        guard let client = model.api() else {
            historyError = String(localized: "Not signed in.")
            loadingHistory = false
            return
        }
        // Skeleton only on a cold load; a live reload keeps the current rows.
```

- [ ] **Step 2: Body — the picker slides lanes, the speed header reveals**

Replace:

```swift
    var body: some View {
        VStack(spacing: 0) {
            Picker("Lane", selection: $lane) {
                ForEach(Lane.allCases) { lane in
                    Text(lane.title).tag(lane)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if let speed, speed.connected, speed.dlSpeed > 0 || speed.ulSpeed > 0 {
                speedHeader(speed)
            }

            ScrollView {
                switch lane {
                case .queue: queueContent
                case .history: historyContent
                case .calendar: calendarContent
                }
            }
        }
        .readableWidth()
        .background(Theme.base)
```

with:

```swift
    var body: some View {
        VStack(spacing: 0) {
            Picker("Lane", selection: laneSelection) {
                ForEach(Lane.allCases) { lane in
                    Text(lane.title).tag(lane)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if let speed, showsSpeed {
                speedHeader(speed)
                    .transition(.rawkoonReveal)
            }

            ScrollView {
                // One slot, so a lane slides in over the one fading out instead of stacking under it.
                ZStack(alignment: .top) {
                    switch lane {
                    case .queue:
                        queueContent
                            .transition(.rawkoonSlide(laneEdge))
                    case .history:
                        historyContent
                            .transition(.rawkoonSlide(laneEdge))
                    case .calendar:
                        calendarContent
                            .transition(.rawkoonSlide(laneEdge))
                    }
                }
            }
        }
        .readableWidth()
        .background(Theme.base)
        .rawkoonMotion(RawkoonMotion.spring, value: showsSpeed)
```

Then insert, directly after the `body` property's closing brace (before `// MARK: Header`):

```swift

    /// Picker writes go through here, so the new lane slides in from the side of the tapped segment.
    private var laneSelection: Binding<Lane> {
        Binding(
            get: { lane },
            set: { newLane in
                laneEdge = RawkoonSlide.edge(
                    from: Lane.allCases.firstIndex(of: lane) ?? 0,
                    to: Lane.allCases.firstIndex(of: newLane) ?? 0
                )
                withRawkoonMotion(RawkoonMotion.snappy) { lane = newLane }
            }
        )
    }

    /// The header shows only while the client is connected and moving bytes.
    private var showsSpeed: Bool {
        guard let speed else { return false }
        return speed.connected && (speed.dlSpeed > 0 || speed.ulSpeed > 0)
    }

    /// Mirrors each lane's branch order, so its skeleton, error, empty and list states crossfade.
    private enum LaneState: Equatable {
        case loading, failed, empty, list
    }

    private static func laneState(loading: Bool, failed: Bool, isEmpty: Bool) -> LaneState {
        guard isEmpty else { return .list }
        if loading {
            return .loading
        }
        return failed ? .failed : .empty
    }
```

- [ ] **Step 3: Queue — one slot, cascade, animated removals**

Replace the whole `queueContent` property:

```swift
    @ViewBuilder
    private var queueContent: some View {
        if loadingQueue, queueRows.isEmpty {
            LazyVStack(spacing: 10) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    queueSkeletonCard
                }
            }
            .padding(16)
        } else if let queueError, queueRows.isEmpty {
            errorView(queueError)
        } else if queueRows.isEmpty {
            ContentUnavailableView(
                "Nothing downloading",
                systemImage: "arrow.down.circle",
                description: Text("The queue is empty right now.")
            )
            .rawkoonLivingSymbol(.empty)
            .frame(maxWidth: .infinity, minHeight: 420)
        } else {
            VStack(spacing: 12) {
                queuePhaseBar
                LazyVStack(spacing: 10) {
                    ForEach(visibleQueueRows) { row in
                        queueCard(row)
                    }
                }
                .rawkoonMotion(RawkoonMotion.snappy, value: queuePhaseFilter)
            }
            .padding(16)
        }
    }
```

with:

```swift
    private var queueContent: some View {
        // A container, not a bare conditional, so the lane slide and the state swaps never share one transition.
        ZStack(alignment: .top) {
            if loadingQueue, queueRows.isEmpty {
                LazyVStack(spacing: 10) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        queueSkeletonCard
                    }
                }
                .padding(16)
                .transition(.rawkoonSwap)
            } else if let queueError, queueRows.isEmpty {
                errorView(queueError)
                    .transition(.rawkoonSwap)
            } else if queueRows.isEmpty {
                ContentUnavailableView(
                    "Nothing downloading",
                    systemImage: "arrow.down.circle",
                    description: Text("The queue is empty right now.")
                )
                .rawkoonLivingSymbol(.empty)
                .frame(maxWidth: .infinity, minHeight: 420)
                .transition(.rawkoonSwap)
            } else {
                VStack(spacing: 12) {
                    queuePhaseBar
                    LazyVStack(spacing: 10) {
                        ForEach(visibleQueueRows) { row in
                            queueCard(row)
                                .rawkoonEntrance(id: row.id)
                                .transition(.rawkoonSwap)
                        }
                    }
                    .rawkoonEntranceScope()
                    .rawkoonMotion(RawkoonMotion.snappy, value: queuePhaseFilter)
                    // A live reload that drops a finished item fades it out instead of cutting.
                    .rawkoonMotion(RawkoonMotion.spring, value: queueRows.map(\.id))
                }
                .padding(16)
                .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(
            RawkoonMotion.spring,
            value: Self.laneState(loading: loadingQueue, failed: queueError != nil, isEmpty: queueRows.isEmpty)
        )
    }
```

- [ ] **Step 4: Queue card — rolling figures, active sheen, badge swap, check burst**

Replace the whole `queueCard(_:)` function:

```swift
    private func queueCard(_ row: QueueRow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.mediaTitle)
                        .font(.display(15))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    Text(row.releaseTitle)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                statusBadge(row.live.state, tint: stateTint(row.live.state))
            }

            DuskProgress(value: row.live.progress)

            HStack(spacing: 10) {
                Text("↓ \(Formatters.speed(row.live.downloadSpeed, useAll: true))")
                    .foregroundStyle(Theme.apricotSoft)
                Text("\(Int(row.live.progress * 100))%")
                    .foregroundStyle(Theme.muted)
                if let eta = Formatters.etaSeconds(row.live.etaSeconds) {
                    Text("ETA \(eta)")
                        .foregroundStyle(Theme.faint)
                }
                Spacer()
            }
            .font(.system(.caption, design: .monospaced))
        }
        .padding(12)
        .activityCard(cornerRadius: 13)
    }
```

with:

```swift
    private func queueCard(_ row: QueueRow) -> some View {
        let complete = DownloadMotion.isComplete(state: row.live.state)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.mediaTitle)
                        .font(.display(15))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    Text(row.releaseTitle)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if complete {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Theme.seed)
                        .accessibilityHidden(true)
                        .transition(.rawkoonSwap)
                }
                // One slot keyed by the state, so a state change crossfades the badge in place.
                ZStack(alignment: .trailing) {
                    statusBadge(row.live.state, tint: stateTint(row.live.state))
                        .id(row.live.state)
                }
            }

            DuskProgress(value: row.live.progress, isActive: DownloadMotion.isRunning(state: row.live.state))

            HStack(spacing: 10) {
                Text("↓ \(Formatters.speed(row.live.downloadSpeed, useAll: true))")
                    .foregroundStyle(Theme.apricotSoft)
                    .rawkoonNumeric(row.live.downloadSpeed.isFinite ? row.live.downloadSpeed : 0)
                Text("\(Int(row.live.progress * 100))%")
                    .foregroundStyle(Theme.muted)
                    .rawkoonNumeric(Double(Int(row.live.progress * 100)))
                if let eta = Formatters.etaSeconds(row.live.etaSeconds) {
                    Text("ETA \(eta)")
                        .foregroundStyle(Theme.faint)
                        .rawkoonNumeric(Double(row.live.etaSeconds ?? 0))
                }
                Spacer()
            }
            .font(.system(.caption, design: .monospaced))
        }
        .padding(12)
        .activityCard(cornerRadius: 13)
        .rawkoonMotion(RawkoonMotion.snappy, value: row.live.state)
        // The check burst: only a finish seen on screen counts, never a card that loads already complete.
        .rawkoonCelebrate(
            trigger: complete,
            ring: .roundedRect(cornerRadius: 13),
            haptic: .downloadComplete,
            when: { !$0 && $1 }
        )
    }
```

- [ ] **Step 5: History and calendar — one slot, phases, cascades**

Replace the whole `historyContent` property:

```swift
    @ViewBuilder
    private var historyContent: some View {
        VStack(spacing: 12) {
            historyFilterBar

            if loadingHistory, activities.isEmpty {
                historySkeleton
            } else if let historyError, activities.isEmpty {
                errorView(historyError)
            } else if activities.isEmpty {
                ContentUnavailableView(
                    "No recent activity",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Nothing has happened yet.")
                )
                .rawkoonLivingSymbol(.empty)
                .frame(maxWidth: .infinity, minHeight: 360)
            } else {
                historyList
            }
        }
        .padding(16)
    }
```

with:

```swift
    private var historyContent: some View {
        VStack(spacing: 12) {
            historyFilterBar

            // One slot, so the outgoing state never stacks above the incoming one.
            ZStack(alignment: .top) {
                if loadingHistory, activities.isEmpty {
                    historySkeleton
                        .transition(.rawkoonSwap)
                } else if let historyError, activities.isEmpty {
                    errorView(historyError)
                        .transition(.rawkoonSwap)
                } else if activities.isEmpty {
                    ContentUnavailableView(
                        "No recent activity",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("Nothing has happened yet.")
                    )
                    .rawkoonLivingSymbol(.empty)
                    .frame(maxWidth: .infinity, minHeight: 360)
                    .transition(.rawkoonSwap)
                } else {
                    historyList
                        .transition(.rawkoonSwap)
                }
            }
            .rawkoonMotion(
                RawkoonMotion.spring,
                value: Self.laneState(loading: loadingHistory, failed: historyError != nil, isEmpty: activities.isEmpty)
            )
        }
        .padding(16)
    }
```

In `historyList`, replace:

```swift
        LazyVStack(spacing: 8) {
            ForEach(Array(activities.enumerated()), id: \.offset) { _, activity in
                historyRow(activity)
                    .onAppear {
```

with:

```swift
        LazyVStack(spacing: 8) {
            ForEach(Array(activities.enumerated()), id: \.offset) { offset, activity in
                historyRow(activity)
                    .rawkoonEntrance(id: activity.id ?? -(offset + 1))
                    .onAppear {
```

and replace:

```swift
            if loadingMoreHistory {
                historySkeletonRow
            }
        }
        .rawkoonMotion(RawkoonMotion.gentle, value: activities.count)
    }
```

with:

```swift
            if loadingMoreHistory {
                historySkeletonRow
            }
        }
        .rawkoonEntranceScope()
        .rawkoonMotion(RawkoonMotion.gentle, value: activities.count)
    }
```

Replace the whole `calendarContent` property:

```swift
    @ViewBuilder
    private var calendarContent: some View {
        if loadingCalendar, upcomingItems.isEmpty {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity, minHeight: 420)
        } else if let calendarError, upcomingItems.isEmpty {
            errorView(calendarError)
        } else if upcomingItems.isEmpty {
            ContentUnavailableView(
                "Nothing upcoming",
                systemImage: "calendar",
                description: Text("No known releases on the horizon.")
            )
            .rawkoonLivingSymbol(.empty)
            .frame(maxWidth: .infinity, minHeight: 420)
        } else {
            LazyVStack(spacing: 8) {
                ForEach(upcomingItems) { item in
                    calendarRow(item)
                }
            }
            .padding(16)
        }
    }
```

with:

```swift
    private var calendarContent: some View {
        // A container, not a bare conditional, so the lane slide and the state swaps never share one transition.
        ZStack(alignment: .top) {
            if loadingCalendar, upcomingItems.isEmpty {
                ProgressView().tint(Theme.apricot)
                    .frame(maxWidth: .infinity, minHeight: 420)
                    .transition(.rawkoonSwap)
            } else if let calendarError, upcomingItems.isEmpty {
                errorView(calendarError)
                    .transition(.rawkoonSwap)
            } else if upcomingItems.isEmpty {
                ContentUnavailableView(
                    "Nothing upcoming",
                    systemImage: "calendar",
                    description: Text("No known releases on the horizon.")
                )
                .rawkoonLivingSymbol(.empty)
                .frame(maxWidth: .infinity, minHeight: 420)
                .transition(.rawkoonSwap)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(upcomingItems) { item in
                        calendarRow(item)
                            .rawkoonEntrance(id: item.id)
                    }
                }
                .padding(16)
                .rawkoonEntranceScope()
                .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(
            RawkoonMotion.spring,
            value: Self.laneState(
                loading: loadingCalendar, failed: calendarError != nil, isEmpty: upcomingItems.isEmpty
            )
        )
    }
```

- [ ] **Step 6: Review**

- Lane slide: the edge is written before `lane` changes, inside the binding; the entering lane slides 28pt from that side, the leaving lane fades in place, both in one `ZStack`. `.task(id: lane)` still restarts the lane load. Each lane is a container (`ZStack` or `VStack`), so the lane transition and the inner state swaps never merge.
- No ghost and no endless skeleton: every lane starts loading; `loadQueue` and `loadCalendar` clear their flag in a `defer` registered before any guard; `loadHistory` now clears it on the signed-out guard too. Cached rows painted in `onAppear` win over the flag (the skeleton needs an empty list). A lane never visited keeps its flag set but is never shown.
- Check burst: `complete` uses the same rule as the seeding chip. The card's `@State` survives reloads (stable `row.id`), so a downloading → completed change seen on screen pops the card, shows the check and plays one `.downloadComplete` haptic; a card created already complete (first load, scroll-back in the lazy stack) does not.
- Figures roll on every live reload: speed, the displayed integer percentage, and the ETA while it is shown. The sheen runs only for a running download.
- The history `ForEach` still keys by offset (its pagination comment explains why); the entrance id is the record id, falling back to a negative offset for a record without one.

- [ ] **Step 7: Local gates**

Run the per-task gate block with: `Rawkoon/Views/ActivityView.swift`.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-detail-search-activity
git add Rawkoon/Views/ActivityView.swift
git commit -m "feat(ios): slide Activity lanes, roll queue figures and burst completed items"
```

---

### Task 8: Full gates and scope check

**Files:** none beyond fixes the gates demand. The controller pushes and opens the PR; this task does neither.

- [ ] **Step 1: Whole-tree CI lint steps, locally**

Run from `apps/ios/`:

```bash
SDD=/home/samuelloranger/sites/rawkoon/.superpowers/sdd/2026-10-09-ios-motion-detail-search-activity
python3 scripts/check-l10n.py
python3 scripts/check-env-inject.py
python3 scripts/check-raw-animation.py
swiftformat Rawkoon RawkoonTests RawkoonWidgets WidgetSupport Sources Tests --lint
bash "$SDD/rawkoon-pr3-lint.sh" > "$SDD/swiftlint-after.txt"
diff "$SDD/swiftlint-baseline.txt" "$SDD/swiftlint-after.txt"
```

Expected: all three scripts pass, swiftformat reports 0 files, and the lint diff shows no new or higher `file rule` count. If something fails, fix it in a new `style(ios): …` or `fix(ios): …` commit (never amend).

- [ ] **Step 2: Scope check against the PR 2 branch**

```bash
git fetch origin feat/ios-motion-home-library-discover
git diff --stat origin/feat/ios-motion-home-library-discover...HEAD
git diff origin/feat/ios-motion-home-library-discover...HEAD --name-only | grep -v '^apps/ios/' ; echo "non-ios files above (expect only this plan)"
```

Expected: only the files in the File Structure table plus this plan. No repo-root `CLAUDE.md`, `docker-compose.yml`, `.glim/` or `testflight_feedback.zip`. No file under `Rawkoon/Views/Home*`, `Library*`, `Discover/`, `PlayerView.swift`, `LoginView.swift` or `Settings/`.

- [ ] **Step 3: Raw animation and API spot-checks**

```bash
grep -rn "withAnimation\|\.animation(" Rawkoon --include='*.swift' | grep -v '^Rawkoon/Motion/' | grep -v 'motion-ok'
grep -rn "frame(in: .scrollView)" Rawkoon
```

Expected: the first prints nothing new compared with the PR 2 branch (run the same grep there with `git grep … origin/feat/ios-motion-home-library-discover` if unsure); the second prints nothing.

- [ ] **Step 4: Report to the controller**

Report the gate output, the commit list (`git log --oneline origin/feat/ios-motion-home-library-discover..HEAD`), and confirm the branch with `git rev-parse --abbrev-ref HEAD`. Do not push.

Suggested PR text for the controller (base `feat/ios-motion-home-library-discover`):

- Title: `feat(ios): motion on detail, release search and Activity`
- Body summary: heroes stretch and parallax from the scroll view's own geometry and clip at their bottom edge; the title, action row and tab bar land after the zoom; detail states crossfade, tabs slide from the tapped side, the request lamp swaps to its note, the bookmark bounces, seasons rotate open and roll their counts, download figures roll with a sheen while active; release search opens as searching, reveals its notices, rolls its filter badge, cascades rows, morphs the AI-pick banner and celebrates a confirmed grab with one haptic; Activity lanes slide, the speed header reveals, queue figures roll and a finished download bursts a check. Verification: CI (kit, lint, build, `RawkoonTests`); simulator recordings and a device pass are still owed because the Mac build host was offline.

---

## Verification

- **Per task:** the local gate block (python checks, swiftformat, swiftlint diff against the Task 1 baseline).
- **Compile and tests:** GitHub CI on push (`build` job: `xcodebuild test -only-testing:RawkoonTests`, then a simulator build). Linux cannot compile the app target. The new tests (`RawkoonMotionTests` hero pull, landing and slide; `SurfaceMotionTests` `DownloadMotion` and `AiPickBanner.phase`) are written now and run there.
- **Still owed after the PR opens (operator, when macbuild is back):** simulator recordings of media detail (cold and cached open, tab switches, request, add, a season open, an active download), book detail, release search (open, filter, grab, AI banner states), book release search and all three Activity lanes, with Reduce Motion spot-checked; a device install for the haptics, the hero at rest under the navigation bar, the stretch and parallax clip, and the landing timing against a real zoom. No TestFlight build is cut to test.

## Self-review

- **Spec coverage (PR 3 section):**
  - Detail skeleton → content uses `rawkoonSwap`: Task 3 Steps 3–4.
  - Similar grid uses `rawkoonSwap` (plus a cascade): Task 3 Step 7.
  - Tab switch slides in the direction of the tapped tab: Task 1 Step 4 (`rawkoonSlide`, `RawkoonSlide.edge`), Task 3 Steps 4–5.
  - Primary action → "We'll notify you" swap animates: Task 3 Step 6.
  - Watchlist bookmark bounces and fills: Task 1 Step 4 (`rawkoonSymbolBounce`), Task 3 Step 2.
  - Season chevron rotates and the season body reveals: Task 4 Steps 1–2.
  - `x/y` episode count, download percentage and speed roll: Task 4 Steps 2–3.
  - Signature: hero stretches and parallaxes (`DetailHero` and `BookHero`): Task 1 Step 3, Task 2 Steps 1–4.
  - Signature: title and action row cascade in after the zoom lands: Task 1 Step 3 (`rawkoonLanding`, `HeroLanding`), Task 2 Steps 1–4.
  - Release search rows cascade: Task 5 Step 3 (book sheet: Task 6 Step 3).
  - Admin note, warnings and errors reveal: Task 5 Step 2.
  - Season chips and the filter count badge animate: Task 5 Step 4.
  - AI-pick banner morphs between states: Task 6 Step 2 (row sparkle morph: Task 5 Step 5).
  - Signature: a successful grab fires `Celebration` on its row with a success haptic, only on a confirmed grab: Task 5 Steps 2 and 5 (book sheet: Task 6 Step 4).
  - Activity lane switch slides: Task 7 Step 2.
  - Speed header reveals: Task 7 Step 2.
  - Queue percentage, speed and ETA roll: Task 7 Step 4.
  - A completed item gets a check burst: Task 7 Step 4.
- **Carry-ins:**
  - (a) StretchyHero rest baseline: the detail and book ScrollViews do not ignore the top safe area and have no content margins, so `.scrollView`-space `minY` at rest is the top inset. The modifier no longer reads coordinate space at all: the host measures `pull = -(contentOffset.y + contentInsets.top)` from `ScrollGeometry` (0 at rest for any inset), tested; a missing host logs in DEBUG and leaves the hero static. The clip lives inside the hero layer (`BelowEdgeClip`: sides and bottom clipped, top open), so every host gets it and the parallax can never draw over the content below. Task 1 Steps 2–3, Task 2 Step 5.
  - (b) Symbol bounce on `StatusBadge` / `DownloadStateIcon` state change: `StatusBadge` has no symbol, so on these surfaces its state change is a crossfade in a slot keyed by the text (detail hero pill, Task 2 Step 1; Activity queue badge, Task 7 Step 4), plus a pop when the title lands in the library or is requested. `DownloadStateIcon` is deliberately skipped: its only host is `BookView`'s audiobook download button, a PR 4 surface, and its celebrating check already bounces.
  - (c) `DuskProgress(value:isActive: true)` for running downloads: detail download rows (Task 4 Step 3) and Activity queue cards (Task 7 Step 4), gated by `DownloadMotion.isRunning` so a paused, stalled or finished bar stays still.
- **Added because the acceptance list requires it and no later PR owns these screens:** management state crossfades and notice reveals (Task 3 Step 8); release search and book release search state crossfades and action-slot swaps (Tasks 5–6); Activity lane state crossfades and history/calendar cascades (Task 7); a celebration for request and add on detail (the hero pill, Task 2 Step 1).
- **Decisions taken while planning:**
  - The hero follows an `@Observable` pull written by its host each scroll frame, read only inside the hero layer, so scrolling re-renders the hero alone; the pull clamps at `trackedDepth` (600) so writes stop once the hero has scrolled away; the host skips writes under Reduce Motion.
  - Only the backdrop layer stretches and parallaxes; the poster and title stay crisp and scroll normally.
  - The landing waits `0.3s - time on screen`, so content that arrives after a network load lands at once; the origin is recorded once per screen (media detail) and defaults to "just now" (book detail, whose hero is always present).
  - Tab and lane slides move only the entering view (28pt) and fade the leaving one in place; a direction-dependent removal would read a stale edge.
  - The grab haptic is played once by the sheet (keyed on the confirmed-grab set), and every celebration on rows and the AI banner passes `haptic: nil`, so a banner grab with its row on screen buzzes once.
  - Activity's check burst plays `.downloadComplete` (its first use); a finish only counts if seen on screen.
  - No-ghost loading: release search starts `isLoading = true` (and clears it on every early exit); detail shows its skeleton until the first fetch settles; Similar shows its shimmer until the first load; every Activity lane starts loading. These change only the placeholder shown before the first load.
  - The season chevron is one glyph rotated a quarter turn; under Reduce Motion the rotation runs in the short crossfade timing like every other kit motion.
- **Observed while planning, not changed here:** PR 2's swaps on Watchlist, Explore, search and book discovery sit in stack containers (a `ScrollView` or `VStack`), so during a swap the outgoing state briefly sits above the incoming one. This PR's rule ("one slot per swap") avoids it; worth checking PR 2's screens on the simulator when the Mac is back.
- **Type consistency:** these names are identical in every task that uses them: `HeroStretch.pull(contentOffsetY:insetTop:)`, `HeroStretch.trackedDepth`, `HeroStretch.transform(minY:height:)`, `HeroScroll`, `rawkoonStretchyHeroHost()`, `rawkoonStretchyHero(height:fileID:line:)`, `HeroLanding.settle`, `HeroLanding.beat`, `HeroLanding.delay(step:elapsed:)`, `\.rawkoonLandingOrigin`, `rawkoonLanding(step:)`, `.rawkoonSlide(_:)`, `RawkoonSlide.distance`, `RawkoonSlide.edge(from:to:)`, `RawkoonSlide.offset(edge:appearing:reduceMotion:)`, `rawkoonSymbolBounce(_:)`, `DownloadMotion.isRunning(state:)`, `DownloadMotion.isComplete(state:)`, `DetailHero(…statusEarned:)`, `MediaDetailView.landingOrigin`, `tabSlideEdge`, `watchlistBounce`, `motionState`, `ManagementPhase`, `managementPhase`, `AiPickBanner.Phase`, `AiPickBanner.phase(loading:budgetReached:failed:hasRelease:grabbed:)`.
