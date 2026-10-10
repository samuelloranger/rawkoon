# iOS Motion: Home, Library, Discover (PR 2 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the merged motion kit to Home, Library, Watchlist, Discover, Explore, search and book discovery, give Home and Discover their signature moments, put every poster-to-detail push on the shared zoom helpers, and close the four follow-ups from PR 1's final review. This is PR 2 of the expressive motion pass.

**Architecture:** Views only consume the kit from `Rawkoon/Motion/` (`.rawkoonMotion`, `withRawkoonMotion`, `.rawkoonEntranceScope()` / `.rawkoonEntrance(id:)`, `.rawkoonSwap` / `.rawkoonReveal` / `.rawkoonEdge`, `.rawkoonNumeric`, `.rawkoonCelebrate`, the zoom helpers). The kit grows in three small, backward-compatible ways: `rawkoonCelebrate` takes an optional `when:` predicate, `rawkoonEntrance` logs (DEBUG) a call site with no scope, and zoom sources in a hidden kept-alive tab register a distinct id. New pure logic (`CelebrationGate`, `ZoomSourceKey`, `DeckDeal`, `NotificationBell.announcesArrival`, the `.tap` haptic) is `nonisolated` and covered by Swift Testing in `RawkoonTests`.

**Tech Stack:** SwiftUI (iOS 26.2 floor), Swift 6.2 with `SWIFT_STRICT_CONCURRENCY: complete` and `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`, Swift Testing, SwiftLint, SwiftFormat, the repo's python check scripts, GitHub Actions (`.github/workflows/ios.yml`).

**Spec:** `docs/superpowers/specs/2026-10-09-ios-expressive-motion-design.md`, section "PR 2: Home, Library, Discover", plus its global rules, edge cases and acceptance list. PR 1 plan: `docs/superpowers/plans/2026-10-09-ios-motion-kit.md` (merged as #222).

## Global Constraints

- Deployment floor: iOS 26.2 (`project.yml`). Do not raise it.
- No new third-party dependency.
- No behavior change: same data, same navigation, same actions, same strings. Only motion and haptics change.
- No on-device state migration.
- Every motion is Reduce-Motion safe. Use the kit, which reads `accessibilityReduceMotion` itself. Movement becomes a crossfade, celebrations become haptic-only, nothing loops.
- No animation runs longer than about 0.45s plus its stagger. Animations never delay a tap or a navigation.
- No raw `.animation(` or `withAnimation` outside `Rawkoon/Motion/`. Use `.rawkoonMotion(_:value:)` or `withRawkoonMotion`. `scripts/check-raw-animation.py` enforces this; a self-gated exception needs `// motion-ok: <reason>` on the line above. This PR needs none.
- App target code is `@MainActor` by default. Pure helpers called from tests or from Sendable closures (`visualEffect`, `keyframeAnimator`, `sensoryFeedback` conditions) are `nonisolated`. Copy values into locals before such closures.
- New user-facing `Text("…")` literals need a `Rawkoon/Localizable.xcstrings` entry (English key plus `fr`). This PR adds none; keep it that way.
- Comments say why, in one line.
- Commits follow Conventional Commits. No Co-Authored-By trailer.
- Stage files by explicit path only. Never stage the repo-root `CLAUDE.md`, `docker-compose.yml`, `.glim/` or `testflight_feedback.zip` (the user's uncommitted work). Never `git stash`, never `git checkout` another branch.
- Before every commit, run `git rev-parse --abbrev-ref HEAD` and confirm it prints `feat/ios-motion-home-library-discover` (other agents switch branches in shared trees).
- **macbuild is offline for this PR.** Do not call `macbuild`. The local gates are the python checks, `swiftformat --lint` and `swiftlint lint`. The compile and app-test gate is GitHub CI on push: the `build` job (`macos-26`) runs `xcodebuild test -only-testing:RawkoonTests` and a simulator build. Tests written in this plan are **written now, executed by CI**.
- Never merge, tag, bump the version, or cut a release. A merge to `main` ships to production and TestFlight.

## Review Focus

1. **Continue Listening and Listening Stats must still load on a cold launch.** Both views keep their zero-size `Color.clear` placeholder branches and their `.task(id:)` on the `Group`, so the task that fills them still runs. Only the state writes are wrapped in `withRawkoonMotion` and the visible branches gain `.transition(.rawkoonSwap)`. Pinned by Task 3 Step 6 (review the diff: both placeholder branches and both `.task(id:)` lines unchanged).
2. **A title on screen in two tabs must zoom from the visible poster.** Phone tabs stay alive under `opacity(0)`, and the shared namespace now holds every poster source, so "movie:42" can be registered by both Home and Library. `ZoomSourceKey.id(_:inActiveTab:)` gives hidden-tab sources a distinct id. Pinned by `zoomSourceKeySeparatesBackgroundTabs` (Task 2) and Task 2 Step 5's review of `ZoomSourceModifier`.
3. **Add → Added must celebrate once, with one haptic.** `rawkoonCelebrate(when:)` filters reversals, and book discovery passes `haptic: nil` because its success toast already plays `.success`. Pinned by the `CelebrationGate` tests (Task 1) and Task 6 Step 5's review.
4. **The deck deal never delays a swipe or replays on Back.** The deal is per `SwipeDeck` identity (`@State dealt`), finishes within ~0.12s of stagger plus one spring, and gesture hit-testing is untouched. Pinned by the `DeckDeal` tests (Task 5) and Task 5 Step 5's review.
5. **The bell rings for arrivals only, including the first one.** Reading notifications lowers the count and must not bounce the bell. The dot stays mounted at `opacity(0)` so a 0 → 1 arrival can pulse. Pinned by the `NotificationBell` tests (Task 3) and Task 3 Step 6's review.

---

## File Structure

All paths below are relative to `apps/ios/`. Run every command from `apps/ios/` on branch `feat/ios-motion-home-library-discover`.

| File | Responsibility |
|---|---|
| `Rawkoon/Motion/RawkoonCelebration.swift` (modify) | `CelebrationGate`; `rawkoonCelebrate(… when:)` |
| `Rawkoon/Motion/EntranceLedger.swift` (modify) | DEBUG log for an entrance with no scope |
| `Rawkoon/Motion/RawkoonHaptics.swift` (modify) | `.tap` event |
| `Rawkoon/Motion/RawkoonZoomNamespace.swift` (modify) | `ZoomSourceKey`; active-tab-aware `rawkoonZoomSource` |
| `Rawkoon/Logging.swift` (modify) | `Log.motion` category |
| `Rawkoon/Views/Toast.swift` (modify) | Edge transition; `AsyncButton` haptic through `RawkoonHaptics` |
| `Rawkoon/Views/OfflineStrip.swift` (modify) | Edge transition |
| `Rawkoon/Views/NotificationBell.swift` (create) | Home's bell with the arrival pulse |
| `Rawkoon/Views/HomeView.swift` (modify) | Shared zoom, rail cascade, swaps, rolling figures, bell |
| `Rawkoon/Views/ContinueListeningView.swift` (modify) | Card swaps in |
| `Rawkoon/Views/ListeningStatsCard.swift` (modify) | Card swaps in |
| `Rawkoon/Views/ListeningStatsView.swift` (modify) | `ListeningStatsFigures` roll |
| `Rawkoon/Views/LibraryView.swift` (modify) | Shared zoom, section swap, offline reveal, books cascade, badge and busy swaps |
| `Rawkoon/Views/Library/LibraryMediaRow.swift` (modify) | Busy spinner swap |
| `Rawkoon/Views/WatchlistView.swift` (modify) | Zoom, cascade, state swaps, animated removal |
| `Rawkoon/Views/RequestsView.swift` (modify) | Zoom only |
| `Rawkoon/Views/MediaDetailView.swift` (modify) | Similar zoom source and destination only |
| `Rawkoon/Views/DiscoverView.swift` (modify) | Deck zoom destination, phase swaps |
| `Rawkoon/Views/Discover/SwipeDeck.swift` (modify) | `DeckDeal`; the deal; deck zoom sources |
| `Rawkoon/Views/Discover/ExploreView.swift` (modify) | Zoom, glass chips, count roll, error reveal, swaps, cascade |
| `Rawkoon/Views/Discover/MediaSearch.swift` (modify) | Shared zoom, swaps, cascade |
| `Rawkoon/Views/Discover/BookDiscoveryView.swift` (modify) | Swaps, cascade, Add → Added celebration |
| `RawkoonTests/RawkoonMotionTests.swift` (modify) | `CelebrationGate`, `ZoomSourceKey` tests |
| `RawkoonTests/RawkoonHapticsTests.swift` (modify) | `.tap` mapping |
| `RawkoonTests/SurfaceMotionTests.swift` (create) | `NotificationBell`, `DeckDeal` tests |

New files are picked up by XcodeGen's folder sources (`project.yml` lists `Rawkoon` and `RawkoonTests`); CI runs `xcodegen generate`.

### Per-task local gates

Every task ends with the same gate block, run from `apps/ios/`:

```bash
python3 scripts/check-l10n.py
python3 scripts/check-env-inject.py
python3 scripts/check-raw-animation.py
swiftformat <the task's touched .swift files> --lint
bash "${TMPDIR:-/tmp}/rawkoon-pr2-lint.sh" > "${TMPDIR:-/tmp}/rawkoon-pr2-lint-after.txt"
diff "${TMPDIR:-/tmp}/rawkoon-pr2-lint-before.txt" "${TMPDIR:-/tmp}/rawkoon-pr2-lint-after.txt"
```

Expected: the three scripts print `ok`/pass; swiftformat reports 0 files (if it names a file, run `swiftformat <that file>` without `--lint`, re-run, and review the diff it made); the lint `diff` shows no new `file rule` pair and no higher count. A count that went up is a new warning: fix it before committing. `rawkoon-pr2-lint.sh` is written in Task 1 Step 1.

---

### Task 1: Kit follow-ups from PR 1's review

**Files:**
- Modify: `Rawkoon/Motion/RawkoonCelebration.swift`
- Modify: `Rawkoon/Motion/EntranceLedger.swift`
- Modify: `Rawkoon/Motion/RawkoonHaptics.swift`
- Modify: `Rawkoon/Logging.swift`
- Modify: `Rawkoon/Views/Toast.swift`
- Modify: `Rawkoon/Views/OfflineStrip.swift`
- Test: `RawkoonTests/RawkoonMotionTests.swift`, `RawkoonTests/RawkoonHapticsTests.swift`

**Interfaces:**
- Produces:
  - `nonisolated enum CelebrationGate` with `static func fires<T: Equatable>(from old: T, to new: T, when predicate: ((T, T) -> Bool)?) -> Bool`.
  - `func rawkoonCelebrate<Trigger: Equatable>(trigger: Trigger, ring: CelebrationRing = .circle, tint: Color = Theme.seed, haptic: RawkoonHaptics.Event? = .success, when predicate: ((Trigger, Trigger) -> Bool)? = nil) -> some View`. Existing calls (`rawkoonCelebrate(trigger: tick)`) compile unchanged.
  - `func rawkoonEntrance(id: some Hashable, fileID: String = #fileID, line: Int = #line) -> some View`. Existing calls compile unchanged.
  - `RawkoonHaptics.Event.tap` → `SensoryFeedback.selection` / `Imperative.selection`.
  - `Log.motion` (`Logger`, category `"motion"`).
- Consumes: nothing new.

- [ ] **Step 1: Record the lint baseline for every file this PR touches**

Run from `apps/ios/`:

```bash
cat > "${TMPDIR:-/tmp}/rawkoon-pr2-lint.sh" <<'EOF'
#!/usr/bin/env bash
# Per-file, per-rule SwiftLint warning counts for the files PR 2 touches.
cd "$(git rev-parse --show-toplevel)/apps/ios" || exit 1
files=()
for f in \
  Rawkoon/Motion/RawkoonCelebration.swift Rawkoon/Motion/EntranceLedger.swift \
  Rawkoon/Motion/RawkoonHaptics.swift Rawkoon/Motion/RawkoonZoomNamespace.swift \
  Rawkoon/Logging.swift Rawkoon/Views/Toast.swift Rawkoon/Views/OfflineStrip.swift \
  Rawkoon/Views/NotificationBell.swift Rawkoon/Views/HomeView.swift \
  Rawkoon/Views/ContinueListeningView.swift Rawkoon/Views/ListeningStatsCard.swift \
  Rawkoon/Views/ListeningStatsView.swift Rawkoon/Views/LibraryView.swift \
  Rawkoon/Views/Library/LibraryMediaRow.swift Rawkoon/Views/WatchlistView.swift \
  Rawkoon/Views/RequestsView.swift Rawkoon/Views/MediaDetailView.swift \
  Rawkoon/Views/DiscoverView.swift Rawkoon/Views/Discover/SwipeDeck.swift \
  Rawkoon/Views/Discover/ExploreView.swift Rawkoon/Views/Discover/MediaSearch.swift \
  Rawkoon/Views/Discover/BookDiscoveryView.swift \
  RawkoonTests/RawkoonMotionTests.swift RawkoonTests/RawkoonHapticsTests.swift \
  RawkoonTests/SurfaceMotionTests.swift
do
  [ -f "$f" ] && files+=("$f")
done
swiftlint lint --quiet "${files[@]}" 2>/dev/null \
  | sed -E 's#^.*/apps/ios/##; s#^([^:]+):[0-9]+(:[0-9]+)?: (warning|error): .*\(([a-z_]+)\)$#\1 \4#' \
  | sort | uniq -c
EOF
bash "${TMPDIR:-/tmp}/rawkoon-pr2-lint.sh" > "${TMPDIR:-/tmp}/rawkoon-pr2-lint-before.txt"
wc -l "${TMPDIR:-/tmp}/rawkoon-pr2-lint-before.txt"
```

Expected: a count of baseline `file rule` lines (some pre-existing warnings, e.g. `LibraryView.swift file_length`). Do this before any edit.

- [ ] **Step 2: Write the tests (written now, executed by CI)**

In `RawkoonTests/RawkoonMotionTests.swift`, insert before the struct's final closing `}` (after `heroZeroHeightIsIdentity`):

```swift

    @Test func celebrationFiresOnAnyChangeWithoutAPredicate() {
        #expect(CelebrationGate.fires(from: false, to: true, when: nil))
        #expect(CelebrationGate.fires(from: true, to: false, when: nil))
        #expect(CelebrationGate.fires(from: 1, to: 2, when: nil))
    }

    @Test func celebrationIgnoresANonChange() {
        #expect(!CelebrationGate.fires(from: 3, to: 3, when: nil))
        #expect(!CelebrationGate.fires(from: true, to: true) { _, _ in true })
    }

    @Test func celebrationPredicateBlocksAReversal() {
        let forwardOnly: (Bool, Bool) -> Bool = { old, new in !old && new }
        #expect(CelebrationGate.fires(from: false, to: true, when: forwardOnly))
        #expect(!CelebrationGate.fires(from: true, to: false, when: forwardOnly))
    }
```

In `RawkoonTests/RawkoonHapticsTests.swift`, in `eventsMapToExpectedFeedback()` add after the `.deckCommit` line:

```swift
        #expect(RawkoonHaptics.feedback(for: .tap) == .selection)
```

and in `imperativeMatchesSensoryFeedback()` add after the `.deckCommit` line:

```swift
        #expect(RawkoonHaptics.imperative(for: .tap) == .selection)
```

- [ ] **Step 3: Celebration predicate**

Replace the whole content of `Rawkoon/Motion/RawkoonCelebration.swift` with:

```swift
import SwiftUI

enum CelebrationRing {
    case circle
    case roundedRect(cornerRadius: CGFloat)
}

/// Decides whether one trigger change earns a celebration.
nonisolated enum CelebrationGate {
    /// A real change that passes `predicate`; with no predicate every change counts.
    static func fires<T: Equatable>(from old: T, to new: T, when predicate: ((T, T) -> Bool)?) -> Bool {
        old != new && (predicate?(old, new) ?? true)
    }
}

extension View {
    /// A success moment: the view pops, a ring pulses out, and a haptic fires when `trigger` changes.
    /// Pass `when` to celebrate only some changes, e.g. `{ !$0 && $1 }` for false → true only.
    func rawkoonCelebrate<Trigger: Equatable>(
        trigger: Trigger,
        ring: CelebrationRing = .circle,
        tint: Color = Theme.seed,
        haptic: RawkoonHaptics.Event? = .success,
        when predicate: ((Trigger, Trigger) -> Bool)? = nil
    ) -> some View {
        modifier(Celebration(trigger: trigger, ring: ring, tint: tint, haptic: haptic, predicate: predicate))
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
    let predicate: ((Trigger, Trigger) -> Bool)?
    /// Counts accepted trigger changes; the animator and the haptic key off this, not the raw trigger.
    @State private var fires = 0

    func body(content: Content) -> some View {
        // Copied out so the nonisolated animator closures read no MainActor state.
        let showRing = !reduceMotion
        let tint = tint
        let isCircle = ringIsCircle
        let cornerRadius = ringCornerRadius
        let start = ringStart
        let end = ringEnd
        let haptic = haptic
        return content
            .keyframeAnimator(initialValue: CelebrationFrame(), trigger: fires) { view, frame in
                view
                    .scaleEffect(showRing ? frame.contentScale : 1)
                    .overlay {
                        if showRing {
                            Group {
                                if isCircle {
                                    Circle().strokeBorder(tint, lineWidth: 2)
                                } else {
                                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                                        .strokeBorder(tint, lineWidth: 2)
                                }
                            }
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
                    LinearKeyframe(start, duration: 0.01)
                    CubicKeyframe(end, duration: 0.42)
                }
                KeyframeTrack(\.ringOpacity) {
                    LinearKeyframe(0.9, duration: 0.01)
                    CubicKeyframe(0, duration: 0.42)
                }
            }
            .sensoryFeedback(RawkoonHaptics.feedback(for: haptic ?? .success), trigger: fires) { _, _ in
                haptic != nil
            }
            .onChange(of: trigger) { old, new in
                if CelebrationGate.fires(from: old, to: new, when: predicate) {
                    fires += 1
                }
            }
    }

    private var ringIsCircle: Bool {
        if case .circle = ring {
            true
        } else {
            false
        }
    }

    private var ringCornerRadius: CGFloat {
        if case let .roundedRect(cornerRadius) = ring {
            cornerRadius
        } else {
            0
        }
    }

    /// A row's ring hugs its edge and grows a little; an icon's starts small and grows a lot.
    private var ringStart: CGFloat {
        if case .circle = ring {
            0.6
        } else {
            1
        }
    }

    private var ringEnd: CGFloat {
        if case .circle = ring {
            1.7
        } else {
            1.06
        }
    }
}
```

- [ ] **Step 4: `Log.motion` and the missing-scope log**

In `Rawkoon/Logging.swift`, replace:

```swift
/// - `sync`: library and manifest refresh
```

with:

```swift
/// - `sync`: library and manifest refresh
/// - `motion`: developer warnings from the motion kit (DEBUG builds only)
```

and replace:

```swift
    static let sync = Logger(subsystem: subsystem, category: "sync")
```

with:

```swift
    static let sync = Logger(subsystem: subsystem, category: "sync")
    static let motion = Logger(subsystem: subsystem, category: "motion")
```

In `Rawkoon/Motion/EntranceLedger.swift`, replace:

```swift
    /// Fades and rises this item in the first time it appears, staggered within its burst.
    func rawkoonEntrance(id: some Hashable) -> some View {
        modifier(Entrance(id: AnyHashable(id)))
    }
```

with:

```swift
    /// Fades and rises this item in the first time it appears, staggered within its burst.
    /// `fileID` and `line` only name the call site in the DEBUG missing-scope log.
    func rawkoonEntrance(id: some Hashable, fileID: String = #fileID, line: Int = #line) -> some View {
        modifier(Entrance(id: AnyHashable(id), callSite: "\(fileID):\(line)"))
    }
```

Replace:

```swift
    let id: AnyHashable
    @State private var entered = false
```

with:

```swift
    let id: AnyHashable
    let callSite: String
    @State private var entered = false
```

Replace:

```swift
            .onAppear {
                guard !entered else { return }
```

with:

```swift
            .onAppear {
                #if DEBUG
                    if ledger == nil {
                        MissingEntranceScope.report(callSite)
                    }
                #endif
                guard !entered else { return }
```

Append at the end of the file:

```swift

#if DEBUG
    /// Without a scope the ledger is missing and the entrance replays on every re-creation; say so once per call site.
    private enum MissingEntranceScope {
        private static var reported: Set<String> = []

        static func report(_ callSite: String) {
            guard reported.insert(callSite).inserted else { return }
            Log.motion.warning(
                "rawkoonEntrance at \(callSite, privacy: .public) has no rawkoonEntranceScope above it; it replays whenever the view is re-created"
            )
        }
    }
#endif
```

No `assertionFailure`: previews and the DEBUG harness host single entrances on purpose.

- [ ] **Step 5: `.tap` haptic and the call sites that bypass the kit**

In `Rawkoon/Motion/RawkoonHaptics.swift`, replace:

```swift
        case deckDismiss, deckCommit
    }
```

with:

```swift
        case deckDismiss, deckCommit
        /// A plain control tap that starts work, e.g. `AsyncButton`.
        case tap
    }
```

Replace (in `feedback(for:)`):

```swift
        case .playPause: .selection
        case .chapterSkip: .impact(weight: .light)
```

with:

```swift
        case .playPause, .tap: .selection
        case .chapterSkip: .impact(weight: .light)
```

Replace (in `imperative(for:)`):

```swift
        case .playPause: .selection
        case .chapterSkip: .impact(.light)
```

with:

```swift
        case .playPause, .tap: .selection
        case .chapterSkip: .impact(.light)
```

In `Rawkoon/Views/Toast.swift`, replace:

```swift
                    .transition(.move(edge: .bottom).combined(with: .opacity))
```

with:

```swift
                    .transition(.rawkoonEdge(.bottom))
```

and replace:

```swift
        .sensoryFeedback(.selection, trigger: tapCount)
```

with:

```swift
        .sensoryFeedback(RawkoonHaptics.feedback(for: .tap), trigger: tapCount)
```

In `Rawkoon/Views/OfflineStrip.swift`, replace:

```swift
                    .transition(.move(edge: .top).combined(with: .opacity))
```

with:

```swift
                    .transition(.rawkoonEdge(.top))
```

`rawkoonEdge` already fades, and under Reduce Motion it only fades, which the old `.move` did not.

- [ ] **Step 6: Local gates**

Run the per-task gate block with these files:
`Rawkoon/Motion/RawkoonCelebration.swift Rawkoon/Motion/EntranceLedger.swift Rawkoon/Motion/RawkoonHaptics.swift Rawkoon/Logging.swift Rawkoon/Views/Toast.swift Rawkoon/Views/OfflineStrip.swift RawkoonTests/RawkoonMotionTests.swift RawkoonTests/RawkoonHapticsTests.swift`.

Also run `grep -rn "rawkoonCelebrate(\|rawkoonEntrance(id" Rawkoon` and confirm every existing call (`DebugMotionGallery.swift`) still matches the new signatures without edits.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-home-library-discover
git add Rawkoon/Motion/RawkoonCelebration.swift Rawkoon/Motion/EntranceLedger.swift \
  Rawkoon/Motion/RawkoonHaptics.swift Rawkoon/Logging.swift Rawkoon/Views/Toast.swift \
  Rawkoon/Views/OfflineStrip.swift RawkoonTests/RawkoonMotionTests.swift RawkoonTests/RawkoonHapticsTests.swift
git commit -m "fix(ios): motion kit follow-ups from the kit review"
```

The controller may push now (`git push -u origin HEAD:feat/ios-motion-home-library-discover`) to get CI's compile and test signal early. A feature-branch push runs kit, lint, build and app tests; it never uploads to TestFlight.

---

### Task 2: One zoom namespace for every poster

**Files:**
- Modify: `Rawkoon/Motion/RawkoonZoomNamespace.swift`
- Modify: `Rawkoon/Views/HomeView.swift`, `Rawkoon/Views/LibraryView.swift`, `Rawkoon/Views/Discover/MediaSearch.swift` (local namespace → shared helpers)
- Modify: `Rawkoon/Views/Discover/ExploreView.swift`, `Rawkoon/Views/MediaDetailView.swift`, `Rawkoon/Views/WatchlistView.swift`, `Rawkoon/Views/RequestsView.swift`, `Rawkoon/Views/DiscoverView.swift`, `Rawkoon/Views/Discover/SwipeDeck.swift` (new zoom)
- Test: `RawkoonTests/RawkoonMotionTests.swift`

**Interfaces:**
- Produces: `nonisolated enum ZoomSourceKey` with `static func id(_ id: String, inActiveTab: Bool) -> String`. `rawkoonZoomSource(_:)` keeps its signature; it now reads `\.isActiveRootTab`.
- Consumes: `rawkoonZoomSource(_:)`, `rawkoonZoomDestination(_:)`, `RawkoonZoom.media(tmdbId:mediaType:)` (RawkoonKit), `\.isActiveRootTab` (`Views/TabBar/TabBarChrome.swift`, default `true`, `false` for hidden phone tabs).

The app-level namespace is injected once in `RootTabsView.body` (`RawkoonApp.swift`, `.environment(\.rawkoonZoomNamespace, zoomNamespace)`), so every tab's `NavigationStack`, its pushed destinations and its sheets inherit it. Every destination below gets `.rawkoonZoomDestination(id)` at the push site, next to the source that uses the same id. Destinations with no on-screen source (Home's attention rows, deep links) stay plain pushes.

- [ ] **Step 1: Write the test (written now, executed by CI)**

In `RawkoonTests/RawkoonMotionTests.swift`, insert before the struct's final `}`:

```swift

    @Test func zoomSourceKeyKeepsTheActiveTabsId() {
        #expect(ZoomSourceKey.id("movie:42", inActiveTab: true) == "movie:42")
    }

    @Test func zoomSourceKeySeparatesBackgroundTabs() {
        let hidden = ZoomSourceKey.id("movie:42", inActiveTab: false)
        #expect(hidden != "movie:42")
        #expect(hidden == ZoomSourceKey.id("movie:42", inActiveTab: false))
        #expect(hidden != ZoomSourceKey.id("tv:42", inActiveTab: false))
    }
```

- [ ] **Step 2: Active-tab-aware sources**

In `Rawkoon/Motion/RawkoonZoomNamespace.swift`, replace:

```swift
private struct ZoomSourceModifier: ViewModifier {
    let id: RawkoonZoom.ID?
    @Environment(\.rawkoonZoomNamespace) private var namespace

    func body(content: Content) -> some View {
        if let id, let namespace {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}
```

with:

```swift
/// Zoom source ids as registered in the shared namespace.
nonisolated enum ZoomSourceKey {
    /// Kept-alive phone tabs share the namespace; a hidden tab's poster gets a distinct id so the zoom uses the visible one.
    static func id(_ id: String, inActiveTab: Bool) -> String {
        inActiveTab ? id : id + "#background"
    }
}

private struct ZoomSourceModifier: ViewModifier {
    let id: RawkoonZoom.ID?
    @Environment(\.rawkoonZoomNamespace) private var namespace
    @Environment(\.isActiveRootTab) private var isActiveRootTab

    func body(content: Content) -> some View {
        if let id, let namespace {
            // Same branch either way, so switching tabs never rebuilds the poster.
            content.matchedTransitionSource(id: ZoomSourceKey.id(id, inActiveTab: isActiveRootTab), in: namespace)
        } else {
            content
        }
    }
}
```

- [ ] **Step 3: Home, Library and search move onto the helpers**

`Rawkoon/Views/HomeView.swift`: delete these three lines:

```swift
    /// Local namespace shared directly by each poster source and its detail
    /// destination — the reliable pattern for the zoom transition.
    @Namespace private var zoomNamespace
```

Then replace the whole `railCard(_:)` function:

```swift
    @ViewBuilder
    private func railCard(_ item: RailItem) -> some View {
        switch item {
        case let .library(m):
            let zoomID = RawkoonZoom.media(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie")
            NavigationLink {
                MediaDetailView(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie",
                                title: m.title, posterPath: m.posterUrl, libraryId: m.id)
                    .rawkoonZoomDestination(zoomID)
            } label: {
                MediaPosterCard(title: m.title, posterURL: model.absoluteURL(m.posterUrl),
                                width: RailPoster.width, corner: RailPoster.corner)
                    .rawkoonZoomSource(zoomID)
            }
            .buttonStyle(.rawkoonPressable)
        case let .upcoming(u):
            let zoomID = RawkoonZoom.media(tmdbId: u.tmdbId ?? 0, mediaType: u.mediaType)
            NavigationLink {
                MediaDetailView(tmdbId: u.tmdbId ?? 0, mediaType: u.mediaType,
                                title: u.title, posterPath: u.posterUrl, libraryId: u.libraryId)
                    .rawkoonZoomDestination(zoomID)
            } label: {
                MediaPosterCard(title: u.title, posterURL: model.absoluteURL(u.posterUrl),
                                date: u.displayDate, episode: u.episodeLabel,
                                width: RailPoster.width, corner: RailPoster.corner)
                    .rawkoonZoomSource(zoomID)
            }
            .buttonStyle(.rawkoonPressable)
            .disabled(u.tmdbId == nil && u.libraryId == nil)
        case let .discover(d):
            let zoomID = RawkoonZoom.media(tmdbId: d.tmdbId, mediaType: d.mediaType)
            NavigationLink {
                MediaDetailView(tmdbId: d.tmdbId, mediaType: d.mediaType,
                                title: d.title, posterPath: d.posterUrl, libraryId: nil)
                    .rawkoonZoomDestination(zoomID)
            } label: {
                MediaPosterCard(title: d.title, posterURL: model.absoluteURL(d.posterUrl),
                                width: RailPoster.width, corner: RailPoster.corner)
                    .rawkoonZoomSource(zoomID)
            }
            .buttonStyle(.rawkoonPressable)
        }
    }
```

(Each `.navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))` became `.rawkoonZoomDestination(zoomID)`, each `.matchedTransitionSource(id: zoomID, in: zoomNamespace)` became `.rawkoonZoomSource(zoomID)`; nothing else changed.)

`Rawkoon/Views/LibraryView.swift`: delete these three lines:

```swift
    /// Local namespace shared directly by each poster source and its detail
    /// destination — the reliable pattern for the zoom transition.
    @Namespace private var zoomNamespace
```

In `mediaGrid` and in `mediaList` (two sites each), replace both occurrences of

```swift
                            .navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))
```

(grid, 28 spaces) and

```swift
                        .navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))
```

(list, 24 spaces) with `.rawkoonZoomDestination(zoomID)` at the same indentation, and replace

```swift
                            .matchedTransitionSource(id: zoomID, in: zoomNamespace)
```

(grid) and

```swift
                        .matchedTransitionSource(id: zoomID, in: zoomNamespace)
```

(list) with `.rawkoonZoomSource(zoomID)` at the same indentation.

Then, in the `menuDetailMedia` destination, replace:

```swift
            if let m = menuDetailMedia {
                MediaDetailView(
                    tmdbId: m.tmdbId,
                    mediaType: m.type == "show" ? "tv" : "movie",
                    title: m.title,
                    posterPath: m.posterUrl,
                    libraryId: m.id
                )
            }
```

with:

```swift
            if let m = menuDetailMedia {
                MediaDetailView(
                    tmdbId: m.tmdbId,
                    mediaType: m.type == "show" ? "tv" : "movie",
                    title: m.title,
                    posterPath: m.posterUrl,
                    libraryId: m.id
                )
                .rawkoonZoomDestination(RawkoonZoom.media(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie"))
            }
```

`Rawkoon/Views/Discover/MediaSearch.swift`: delete these three lines from `MediaSearchResults`:

```swift
    /// Local to this view: the zoom source and its destination both reference
    /// this namespace directly, which is the reliable pattern.
    @Namespace private var zoomNamespace
```

and replace:

```swift
                                .navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))
                            } label: {
                                posterCard(item, fixedWidth: nil)
                                    .matchedTransitionSource(id: zoomID, in: zoomNamespace)
                            }
```

with:

```swift
                                .rawkoonZoomDestination(zoomID)
                            } label: {
                                posterCard(item, fixedWidth: nil)
                                    .rawkoonZoomSource(zoomID)
                            }
```

Verify: `grep -rn "zoomNamespace\|matchedTransitionSource\|navigationTransition" Rawkoon --include='*.swift'` (run in bash) lists only `RawkoonApp.swift` and `Motion/RawkoonZoomNamespace.swift`.

- [ ] **Step 4: New zoom sites (Explore, Similar, Watchlist, Requests, deck)**

`Rawkoon/Views/Discover/ExploreView.swift`: add `import RawkoonKit` above `import SwiftUI`. In `grid`, replace:

```swift
                ForEach(items) { item in
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            title: item.title,
                            posterPath: item.posterUrl,
                            libraryId: item.libraryId
                        )
                    } label: {
                        posterCard(item)
                    }
```

with:

```swift
                ForEach(items) { item in
                    let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            title: item.title,
                            posterPath: item.posterUrl,
                            libraryId: item.libraryId
                        )
                        .rawkoonZoomDestination(zoomID)
                    } label: {
                        posterCard(item)
                            .rawkoonZoomSource(zoomID)
                    }
```

`Rawkoon/Views/MediaDetailView.swift` (already imports RawkoonKit). Replace the whole `similarCard(_:)`:

```swift
    func similarCard(_ item: TmdbSearchItem) -> some View {
        let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
        return NavigationLink {
            MediaDetailView(
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: item.title,
                posterPath: item.posterUrl,
                libraryId: item.libraryId
            )
            .rawkoonZoomDestination(zoomID)
        } label: {
            MediaPosterCard(
                title: item.title,
                posterURL: model.absoluteURL(item.posterUrl),
                menuItems: mediaPosterMenuItems(inLibrary: item.libraryId != nil, isAdmin: model.isAdmin),
                onMenuAction: { handleSimilarMenu($0, item: item) }
            ) {
                if let libraryId = item.libraryId, busySimilarLibraryIds.contains(libraryId) {
                    ProgressView().tint(Theme.apricot)
                } else if item.alreadyExists == true {
                    Circle().fill(Theme.seed).frame(width: 22, height: 22)
                        .overlay(Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: 0x10231A)))
                }
            }
            .rawkoonZoomSource(zoomID)
        }
        .buttonStyle(.rawkoonPressable)
    }
```

and in the `similarMenuDetail` destination replace:

```swift
                if let item = similarMenuDetail {
                    MediaDetailView(
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterPath: item.posterUrl,
                        libraryId: item.libraryId
                    )
                }
```

with:

```swift
                if let item = similarMenuDetail {
                    MediaDetailView(
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterPath: item.posterUrl,
                        libraryId: item.libraryId
                    )
                    .rawkoonZoomDestination(RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType))
                }
```

Touch nothing else in `MediaDetailView.swift` (Detail motion is PR 3).

`Rawkoon/Views/WatchlistView.swift`: add `import RawkoonKit` above `import SwiftUI`. In `grid`, replace:

```swift
            ForEach(items) { item in
                NavigationLink {
                    MediaDetailView(
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterPath: item.posterUrl,
                        libraryId: nil
                    )
                } label: {
                    MediaPosterCard(title: item.title, posterURL: model.absoluteURL(item.posterUrl))
                }
```

with:

```swift
            ForEach(items) { item in
                let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
                NavigationLink {
                    MediaDetailView(
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterPath: item.posterUrl,
                        libraryId: nil
                    )
                    .rawkoonZoomDestination(zoomID)
                } label: {
                    MediaPosterCard(title: item.title, posterURL: model.absoluteURL(item.posterUrl))
                        .rawkoonZoomSource(zoomID)
                }
```

`Rawkoon/Views/RequestsView.swift`: add `import RawkoonKit` above `import SwiftUI`. In `row(_:)` replace:

```swift
                NavigationLink {
                    MediaDetailView(
                        tmdbId: tmdbId,
                        mediaType: req.type == "show" ? "tv" : "movie",
                        title: req.title,
                        posterPath: req.posterUrl,
                        libraryId: nil
                    )
                } label: {
```

with:

```swift
                NavigationLink {
                    MediaDetailView(
                        tmdbId: tmdbId,
                        mediaType: req.type == "show" ? "tv" : "movie",
                        title: req.title,
                        posterPath: req.posterUrl,
                        libraryId: nil
                    )
                    .rawkoonZoomDestination(RawkoonZoom.media(tmdbId: tmdbId, mediaType: req.type == "show" ? "tv" : "movie"))
                } label: {
```

and in `rowLabel(_:)` replace:

```swift
            } else {
                MediaThumb(url: model.absoluteURL(req.posterUrl), width: 46)
            }
```

with:

```swift
            } else {
                MediaThumb(url: model.absoluteURL(req.posterUrl), width: 46)
                    .rawkoonZoomSource(req.tmdbId.map { RawkoonZoom.media(tmdbId: $0, mediaType: req.type == "show" ? "tv" : "movie") })
            }
```

`Rawkoon/Views/DiscoverView.swift` (already imports RawkoonKit). Replace:

```swift
            .navigationDestination(item: $openDeckItem) { item in
                MediaDetailView(
                    tmdbId: item.tmdbId,
                    mediaType: item.mediaType,
                    title: item.title,
                    posterPath: item.posterUrl,
                    libraryId: nil
                )
            }
```

with:

```swift
            .navigationDestination(item: $openDeckItem) { item in
                MediaDetailView(
                    tmdbId: item.tmdbId,
                    mediaType: item.mediaType,
                    title: item.title,
                    posterPath: item.posterUrl,
                    libraryId: nil
                )
                .rawkoonZoomDestination(RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType))
            }
```

`Rawkoon/Views/Discover/SwipeDeck.swift`: add `import RawkoonKit` above `import SwiftUI`. In `card(for:stackIndex:)` replace:

```swift
        DeckCardView(item: item, label: label, posterURL: model.absoluteURL(item.posterUrl))
            .overlay {
                if isTop, !reduceMotion {
                    intentOverlay
                }
            }
```

with:

```swift
        DeckCardView(item: item, label: label, posterURL: model.absoluteURL(item.posterUrl))
            .overlay {
                if isTop, !reduceMotion {
                    intentOverlay
                }
            }
            // Every visible card is a source (never nil), so promoting a card never rebuilds it.
            .rawkoonZoomSource(RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType))
```

- [ ] **Step 5: Review**

Re-read `ZoomSourceModifier`: the `if let id, let namespace` branch is chosen per call site and never flips with `isActiveRootTab` (only the id string changes), so switching tabs does not rebuild any poster's subtree (image reloads, lost `@State`). Confirm each new `rawkoonZoomDestination` uses the exact id expression its `rawkoonZoomSource` uses (`"show"` → `"tv"` mapping included for Library and Requests).

- [ ] **Step 6: Local gates**

Run the per-task gate block with: `Rawkoon/Motion/RawkoonZoomNamespace.swift Rawkoon/Views/HomeView.swift Rawkoon/Views/LibraryView.swift Rawkoon/Views/Discover/MediaSearch.swift Rawkoon/Views/Discover/ExploreView.swift Rawkoon/Views/MediaDetailView.swift Rawkoon/Views/WatchlistView.swift Rawkoon/Views/RequestsView.swift Rawkoon/Views/DiscoverView.swift Rawkoon/Views/Discover/SwipeDeck.swift RawkoonTests/RawkoonMotionTests.swift`.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-home-library-discover
git add Rawkoon/Motion/RawkoonZoomNamespace.swift Rawkoon/Views/HomeView.swift Rawkoon/Views/LibraryView.swift \
  Rawkoon/Views/Discover/MediaSearch.swift Rawkoon/Views/Discover/ExploreView.swift Rawkoon/Views/MediaDetailView.swift \
  Rawkoon/Views/WatchlistView.swift Rawkoon/Views/RequestsView.swift Rawkoon/Views/DiscoverView.swift \
  Rawkoon/Views/Discover/SwipeDeck.swift RawkoonTests/RawkoonMotionTests.swift
git commit -m "feat(ios): zoom into detail from every poster on Home, Library and Discover"
```

---

### Task 3: Home — rail cascade, card swaps, rolling figures, bell pulse

**Files:**
- Create: `Rawkoon/Views/NotificationBell.swift`
- Modify: `Rawkoon/Views/HomeView.swift`, `Rawkoon/Views/ContinueListeningView.swift`, `Rawkoon/Views/ListeningStatsCard.swift`, `Rawkoon/Views/ListeningStatsView.swift`
- Test: `RawkoonTests/SurfaceMotionTests.swift` (create)

**Interfaces:**
- Produces: `struct NotificationBell: View` (`init(unread: Int)`), `nonisolated static func announcesArrival(from: Int, to: Int) -> Bool`.
- Consumes: `.rawkoonEntranceScope()`, `.rawkoonEntrance(id:)`, `.rawkoonSwap`, `withRawkoonMotion`, `.rawkoonNumeric(_:)`, `.rawkoonCelebrate(trigger:ring:tint:haptic:when:)`, `.rawkoonMotion(_:value:)`.

- [ ] **Step 1: Write the test (written now, executed by CI)**

Create `RawkoonTests/SurfaceMotionTests.swift`:

```swift
@testable import Rawkoon
import Testing

@MainActor
struct SurfaceMotionTests {
    @Test func bellRingsWhenTheCountRises() {
        #expect(NotificationBell.announcesArrival(from: 0, to: 1))
        #expect(NotificationBell.announcesArrival(from: 3, to: 5))
    }

    @Test func bellStaysStillWhenNotificationsAreRead() {
        #expect(!NotificationBell.announcesArrival(from: 4, to: 0))
        #expect(!NotificationBell.announcesArrival(from: 2, to: 1))
        #expect(!NotificationBell.announcesArrival(from: 2, to: 2))
    }
}
```

- [ ] **Step 2: The bell (signature moment)**

Create `Rawkoon/Views/NotificationBell.swift`:

```swift
import SwiftUI

/// Home's toolbar bell. The unread dot fades in, and each new arrival bounces the bell and pulses the dot.
struct NotificationBell: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let unread: Int
    /// Arrivals seen with Reduce Motion off; drives the bounce and the pulse.
    @State private var arrivals = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: "bell")
                .symbolEffect(.bounce, value: arrivals)
            // Always mounted, so the first arrival (0 → 1) can pulse too.
            Circle()
                .fill(Theme.terracotta)
                .frame(width: 8, height: 8)
                .opacity(unread > 0 ? 1 : 0)
                .rawkoonCelebrate(trigger: arrivals, tint: Theme.terracotta, haptic: nil)
                .offset(x: 3, y: -3)
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: unread > 0)
        .onChange(of: unread) { old, new in
            guard Self.announcesArrival(from: old, to: new), !reduceMotion else { return }
            arrivals += 1
        }
    }

    /// Only a rising count is a new notification; reading them lowers it quietly.
    nonisolated static func announcesArrival(from old: Int, to new: Int) -> Bool {
        new > old
    }
}
```

No haptic: an arriving notification already gets the system banner and sound, and the spec asks for a visual pulse only.

In `Rawkoon/Views/HomeView.swift`, replace:

```swift
                    NavigationLink {
                        NotificationsListView()
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bell")
                            if model.unreadNotificationCount > 0 {
                                Circle()
                                    .fill(Theme.terracotta)
                                    .frame(width: 8, height: 8)
                                    .offset(x: 3, y: -3)
                            }
                        }
                    }
```

with:

```swift
                    NavigationLink {
                        NotificationsListView()
                    } label: {
                        NotificationBell(unread: model.unreadNotificationCount)
                    }
```

- [ ] **Step 3: Skeleton swap and rail cascade**

In `HomeView.body`, replace:

```swift
                if loading, recent.isEmpty {
                    homeSkeleton
                        .transition(.opacity)
                } else {
                    loadedContent
                        .transition(.opacity)
                }
```

with:

```swift
                if loading, recent.isEmpty {
                    homeSkeleton
                        .transition(.rawkoonSwap)
                } else {
                    loadedContent
                        .transition(.rawkoonSwap)
                }
```

In `rail(_:_:)`, replace:

```swift
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in railCard(item) }
                }
                .padding(.horizontal, 16)
            }
```

with:

```swift
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in
                        railCard(item)
                            .rawkoonEntrance(id: item.id)
                    }
                }
                .padding(.horizontal, 16)
            }
            // One ledger per rail, so each rail cascades left to right on its own.
            .rawkoonEntranceScope()
```

- [ ] **Step 4: Rolling figures**

In `nowWatchingWidget(_:)`, replace:

```swift
                                Text("\(Int(p))%").font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.muted)
```

with:

```swift
                                Text("\(Int(p))%").font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.muted)
                                    .rawkoonNumeric(p)
```

In `speedLabel(_:_:_:)`, replace:

```swift
            Text(text).font(.system(.subheadline, design: .monospaced)).foregroundStyle(Theme.text)
```

with:

```swift
            Text(text).font(.system(.subheadline, design: .monospaced)).foregroundStyle(Theme.text)
                .rawkoonNumeric(Double(safeBytes))
```

In `libraryStatsWidget(_:)`, replace:

```swift
                    statFigure("\(s.totalMovies)", "Movies")
                    statFigure("\(s.totalShows)", "Shows")
                    statFigure("\(s.downloaded)", "Downloaded")
                    if s.wanted > 0 {
                        statFigure("\(s.wanted)", "Wanted")
                    }
                    if s.returningSeries > 0 {
                        statFigure("\(s.returningSeries)", "Returning")
                    }
```

with:

```swift
                    statFigure(s.totalMovies, "Movies")
                    statFigure(s.totalShows, "Shows")
                    statFigure(s.downloaded, "Downloaded")
                    if s.wanted > 0 {
                        statFigure(s.wanted, "Wanted")
                    }
                    if s.returningSeries > 0 {
                        statFigure(s.returningSeries, "Returning")
                    }
```

and replace:

```swift
                    Text(byteString(s.storageUsedBytes))
                        .font(.system(.subheadline, design: .monospaced)).foregroundStyle(Theme.text)
```

with:

```swift
                    Text(byteString(s.storageUsedBytes))
                        .font(.system(.subheadline, design: .monospaced)).foregroundStyle(Theme.text)
                        .rawkoonNumeric(Double(s.storageUsedBytes))
```

Replace `statFigure(_:_:)`:

```swift
    private func statFigure(_ value: String, _ label: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(.title3, design: .rounded).weight(.semibold)).foregroundStyle(Theme.textStrong)
            Text(label).font(.caption2).foregroundStyle(Theme.faint)
        }
    }
```

with:

```swift
    private func statFigure(_ value: Int, _ label: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(String(value)).font(.system(.title3, design: .rounded).weight(.semibold)).foregroundStyle(Theme.textStrong)
                .rawkoonNumeric(Double(value))
            Text(label).font(.caption2).foregroundStyle(Theme.faint)
        }
    }
```

(`Text(String(value))` renders the same digits as the old `Text("\(…)")`-built `String`, verbatim, with no new catalog key.)

In `Rawkoon/Views/ListeningStatsView.swift`, replace the body and `figure` of `ListeningStatsFigures`:

```swift
        HStack(alignment: .top, spacing: 16) {
            figure(
                value: "\(stats.streakDays)",
                label: String(localized: "\(stats.streakDays) day streak"),
                monospaced: false
            )
            figure(
                value: Formatters.listeningHours(stats.weekSecs),
                label: String(localized: "This week"),
                monospaced: true
            )
        }
    }

    private func figure(value: String, label: String, monospaced: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(monospaced ? .system(.title2, design: .monospaced).weight(.semibold) : .display(24))
                .foregroundStyle(Theme.textStrong)
```

with:

```swift
        HStack(alignment: .top, spacing: 16) {
            figure(
                value: "\(stats.streakDays)",
                numeric: Double(stats.streakDays),
                label: String(localized: "\(stats.streakDays) day streak"),
                monospaced: false
            )
            figure(
                value: Formatters.listeningHours(stats.weekSecs),
                numeric: stats.weekSecs,
                label: String(localized: "This week"),
                monospaced: true
            )
        }
    }

    private func figure(value: String, numeric: Double, label: String, monospaced: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(monospaced ? .system(.title2, design: .monospaced).weight(.semibold) : .display(24))
                .foregroundStyle(Theme.textStrong)
                .rawkoonNumeric(numeric)
```

- [ ] **Step 5: Continue Listening and Listening Stats swap in instead of popping**

The zero-size `Color.clear` placeholders and the `.task(id:)` on each `Group` stay exactly as they are: without them the task that fills the card never runs.

`Rawkoon/Views/ContinueListeningView.swift`, replace:

```swift
            if errorMessage != nil || !items.isEmpty {
                card
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            } else {
```

with:

```swift
            if errorMessage != nil || !items.isEmpty {
                card
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .transition(.rawkoonSwap)
            } else {
```

In `load()`, replace:

```swift
            if cachedAudio != nil || cachedEbook != nil {
                items = buildItems(audiobookProgress: cachedAudio ?? [], ebookProgress: cachedEbook ?? [])
            }
```

with:

```swift
            if cachedAudio != nil || cachedEbook != nil {
                // Animated so the card swaps in and Home's rails glide down instead of jumping.
                withRawkoonMotion(RawkoonMotion.spring) {
                    items = buildItems(audiobookProgress: cachedAudio ?? [], ebookProgress: cachedEbook ?? [])
                }
            }
```

replace:

```swift
            if items.isEmpty {
                errorMessage = model.isOffline
                    ? String(localized: "This will load when you're back online.")
                    : String(localized: "Could not load continue progress.")
            }
            return
        }
        items = buildItems(
            audiobookProgress: audiobookProgress ?? client.cachedProgress()?.value ?? [],
            ebookProgress: ebookProgress ?? client.cachedReadingProgress()?.value ?? []
        )
        errorMessage = nil
    }
```

with:

```swift
            if items.isEmpty {
                withRawkoonMotion(RawkoonMotion.spring) {
                    errorMessage = model.isOffline
                        ? String(localized: "This will load when you're back online.")
                        : String(localized: "Could not load continue progress.")
                }
            }
            return
        }
        withRawkoonMotion(RawkoonMotion.spring) {
            items = buildItems(
                audiobookProgress: audiobookProgress ?? client.cachedProgress()?.value ?? [],
                ebookProgress: ebookProgress ?? client.cachedReadingProgress()?.value ?? []
            )
            errorMessage = nil
        }
    }
```

`Rawkoon/Views/ListeningStatsCard.swift`, replace:

```swift
                if let stats {
                    NavigationLink {
                        ListeningStatsView(stats: stats)
                    } label: {
                        card(stats)
                    }
                    .buttonStyle(.rawkoonPressable(scale: 0.98))
                } else {
                    errorCard
                }
```

with:

```swift
                if let stats {
                    NavigationLink {
                        ListeningStatsView(stats: stats)
                    } label: {
                        card(stats)
                    }
                    .buttonStyle(.rawkoonPressable(scale: 0.98))
                    .transition(.rawkoonSwap)
                } else {
                    errorCard
                        .transition(.rawkoonSwap)
                }
```

Replace the body of `load()` from `do {` to the end of the function:

```swift
        do {
            let features = try await client.systemFeatures()
            guard features.booksEnabled else {
                booksEnabled = false
                stats = nil
                errorMessage = nil
                WidgetSnapshotWriter.shared.updateListening(nil)
                return
            }
            booksEnabled = true
            stats = try await client.listeningStats()
            WidgetSnapshotWriter.shared.updateListening(stats)
            errorMessage = nil
        } catch {
            // A failed refresh keeps the last stats on the card.
            guard stats == nil else { return }
            errorMessage = model.isOffline
                ? String(localized: "This will load when you're back online.")
                : String(localized: "Couldn't load listening stats.")
        }
    }
```

with:

```swift
        do {
            let features = try await client.systemFeatures()
            guard features.booksEnabled else {
                withRawkoonMotion(RawkoonMotion.spring) {
                    booksEnabled = false
                    stats = nil
                    errorMessage = nil
                }
                WidgetSnapshotWriter.shared.updateListening(nil)
                return
            }
            booksEnabled = true
            let fresh = try await client.listeningStats()
            // Animated so the card swaps in and the rails below glide down instead of jumping.
            withRawkoonMotion(RawkoonMotion.spring) {
                stats = fresh
                errorMessage = nil
            }
            WidgetSnapshotWriter.shared.updateListening(fresh)
        } catch {
            // A failed refresh keeps the last stats on the card.
            guard stats == nil else { return }
            withRawkoonMotion(RawkoonMotion.spring) {
                errorMessage = model.isOffline
                    ? String(localized: "This will load when you're back online.")
                    : String(localized: "Couldn't load listening stats.")
            }
        }
    }
```

and replace the end of `hydrateFromCache(client:)`:

```swift
        booksEnabled = features.booksEnabled
        if features.booksEnabled, let cached = client.cached(Endpoints.listeningStats) {
            stats = cached.value
        }
    }
```

with:

```swift
        withRawkoonMotion(RawkoonMotion.spring) {
            booksEnabled = features.booksEnabled
            if features.booksEnabled, let cached = client.cached(Endpoints.listeningStats) {
                stats = cached.value
            }
        }
    }
```

(The only ordering change: the widget snapshot is written after the stats land instead of between the two writes. It receives the same value.)

- [ ] **Step 6: Review**

In `git diff Rawkoon/Views/ContinueListeningView.swift Rawkoon/Views/ListeningStatsCard.swift`, confirm both `Color.clear.frame(width: 0, height: 0)` branches and both `.task(id: refreshToken)` lines are untouched. In `NotificationBell`, confirm the dot is not inside an `if` (a 0 → 1 arrival must find it mounted) and that `arrivals` only increments on a rising count.

- [ ] **Step 7: Local gates**

Run the per-task gate block with: `Rawkoon/Views/NotificationBell.swift Rawkoon/Views/HomeView.swift Rawkoon/Views/ContinueListeningView.swift Rawkoon/Views/ListeningStatsCard.swift Rawkoon/Views/ListeningStatsView.swift RawkoonTests/SurfaceMotionTests.swift`.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-home-library-discover
git add Rawkoon/Views/NotificationBell.swift Rawkoon/Views/HomeView.swift Rawkoon/Views/ContinueListeningView.swift \
  Rawkoon/Views/ListeningStatsCard.swift Rawkoon/Views/ListeningStatsView.swift RawkoonTests/SurfaceMotionTests.swift
git commit -m "feat(ios): Home rail cascade, card swaps, rolling figures and bell pulse"
```

---

### Task 4: Library and Watchlist

**Files:**
- Modify: `Rawkoon/Views/LibraryView.swift`, `Rawkoon/Views/Library/LibraryMediaRow.swift`, `Rawkoon/Views/WatchlistView.swift`

**Interfaces:**
- Consumes: `.rawkoonSwap`, `.rawkoonReveal`, `.rawkoonMotion(_:value:)`, `withRawkoonMotion`, `.rawkoonEntranceScope()`, `.rawkoonEntrance(id:)`.

- [ ] **Step 1: Section swap and offline reveal**

In `LibraryView.body`, replace:

```swift
            if model.isOfflineLibrary {
                offlineBanner
            }

            if section == .media {
                mediaToolbar
            } else {
                booksToolbar
            }

            content
        }
        .background(Theme.base)
```

with:

```swift
            if model.isOfflineLibrary {
                offlineBanner
                    .transition(.rawkoonReveal)
            }

            if section == .media {
                mediaToolbar
                    .transition(.rawkoonSwap)
            } else {
                booksToolbar
                    .transition(.rawkoonSwap)
            }

            content
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: section)
        .rawkoonMotion(RawkoonMotion.spring, value: model.isOfflineLibrary)
        .background(Theme.base)
```

- [ ] **Step 2: Media badge and busy swaps**

Replace `mediaAnimationToken`:

```swift
    /// Changes worth animating: rows appearing or leaving, and the monitored
    /// badge flipping. Cheap enough to recompute per body pass at page size.
    private var mediaAnimationToken: Int {
        var hasher = Hasher()
        for item in media {
            hasher.combine(item.id)
            hasher.combine(item.monitored)
            hasher.combine(item.isProvisional)
        }
        return hasher.finalize()
    }
```

with:

```swift
    /// Changes worth animating: rows appearing or leaving, the monitored badge
    /// flipping, and status or busy badges swapping. Cheap at page size.
    private var mediaAnimationToken: Int {
        var hasher = Hasher()
        for item in media {
            hasher.combine(item.id)
            hasher.combine(item.monitored)
            hasher.combine(item.isProvisional)
            hasher.combine(item.status)
            hasher.combine(busyMediaIds.contains(item.id))
        }
        return hasher.finalize()
    }
```

In `mediaGrid`, replace:

```swift
                                if busyMediaIds.contains(m.id) {
                                    ProgressView().tint(Theme.apricot)
                                } else {
                                    mediaBadge(for: m)
                                }
```

with:

```swift
                                if busyMediaIds.contains(m.id) {
                                    ProgressView().tint(Theme.apricot)
                                        .transition(.rawkoonSwap)
                                } else {
                                    mediaBadge(for: m)
                                }
```

Replace `mediaBadge(for:)`:

```swift
    @ViewBuilder
    private func mediaBadge(for m: LibraryMedia) -> some View {
        if case .adding = LibraryRowPresentation(media: m).status {
            StatusBadge(text: "Adding…", tint: Theme.apricot)
        } else if m.status == "downloading" {
            Circle().fill(Theme.importing).frame(width: 22, height: 22)
                .overlay(Image(systemName: "arrow.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.onAccent))
        } else if m.status == "wanted" || m.status == "missing" {
            Circle().fill(Theme.muted.opacity(0.9)).frame(width: 22, height: 22)
                .overlay(Image(systemName: "questionmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.base))
        }
    }
```

with:

```swift
    /// Each branch carries its own transition so a status change crossfades between badges.
    @ViewBuilder
    private func mediaBadge(for m: LibraryMedia) -> some View {
        if case .adding = LibraryRowPresentation(media: m).status {
            StatusBadge(text: "Adding…", tint: Theme.apricot)
                .transition(.rawkoonSwap)
        } else if m.status == "downloading" {
            Circle().fill(Theme.importing).frame(width: 22, height: 22)
                .overlay(Image(systemName: "arrow.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.onAccent))
                .transition(.rawkoonSwap)
        } else if m.status == "wanted" || m.status == "missing" {
            Circle().fill(Theme.muted.opacity(0.9)).frame(width: 22, height: 22)
                .overlay(Image(systemName: "questionmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.base))
                .transition(.rawkoonSwap)
        }
    }
```

In `Rawkoon/Views/Library/LibraryMediaRow.swift`, replace:

```swift
            if presentation.showsSpinner {
                ProgressView().tint(Theme.apricot)
            }
```

with:

```swift
            if presentation.showsSpinner {
                ProgressView().tint(Theme.apricot)
                    .transition(.rawkoonSwap)
            }
```

Both the grid and the list already animate on `mediaAnimationToken` through `listMotion` (a `motion-ok` site that resolves Reduce Motion), so the busy and status changes now ride that.

- [ ] **Step 3: Books grid cascade and busy swap**

In `bookLink(_:grid:)`, replace:

```swift
                if busyBookIds.contains(book.bookId) {
                    ProgressView().tint(Theme.muted).padding(grid ? 14 : 0).padding(.trailing, grid ? 0 : 10)
                }
```

with:

```swift
                if busyBookIds.contains(book.bookId) {
                    ProgressView().tint(Theme.muted).padding(grid ? 14 : 0).padding(.trailing, grid ? 0 : 10)
                        .transition(.rawkoonSwap)
                }
```

In `booksGrid`, replace:

```swift
                if isRegularWidth {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 230), spacing: 12)], spacing: 12) {
                        ForEach(filteredBooks) { book in bookLink(book, grid: true) }
                    }
                } else {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredBooks) { book in bookLink(book, grid: false) }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .reportsTabBarScroll()
```

with:

```swift
                if isRegularWidth {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 230), spacing: 12)], spacing: 12) {
                        ForEach(filteredBooks) { book in
                            bookLink(book, grid: true)
                                .rawkoonEntrance(id: book.bookId)
                        }
                    }
                } else {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredBooks) { book in
                            bookLink(book, grid: false)
                                .rawkoonEntrance(id: book.bookId)
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        // On the scroll view, which outlives search and filter changes, so seen books never replay.
        .rawkoonEntranceScope()
        .rawkoonMotion(RawkoonMotion.snappy, value: busyBookIds)
        .reportsTabBarScroll()
```

- [ ] **Step 4: Watchlist — cascade, state swaps, animated removal**

In `Rawkoon/Views/WatchlistView.swift`, replace in `body`:

```swift
        ScrollView {
            content
                .padding(.top, 12)
                .padding(.bottom, 32)
        }
```

with:

```swift
        ScrollView {
            content
                .padding(.top, 12)
                .padding(.bottom, 32)
                .rawkoonMotion(RawkoonMotion.spring, value: loading)
        }
```

Replace the whole `content` property:

```swift
    @ViewBuilder private var content: some View {
        if loading, items.isEmpty {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(0 ..< 12, id: \.self) { _ in
                    ShimmerView(cornerRadius: 10)
                        .aspectRatio(2.0 / 3.0, contentMode: .fit)
                }
            }
            .padding(.horizontal, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty, error != nil, model.isOffline {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty, let error {
            ContentUnavailableView(
                "Couldn't load your watchlist",
                systemImage: "wifi.slash",
                description: Text(error)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty {
            ContentUnavailableView(
                "Nothing on your watchlist",
                systemImage: "bookmark",
                description: Text("Bookmark a movie or show and it will wait here.")
            )
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            grid
                .transition(.rawkoonSwap)
        }
    }
```

Replace the whole `grid` property (the version Task 2 produced):

```swift
    private var grid: some View {
        LazyVGrid(columns: gridColumns, spacing: 14) {
            ForEach(items) { item in
                let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
                NavigationLink {
                    MediaDetailView(
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterPath: item.posterUrl,
                        libraryId: nil
                    )
                    .rawkoonZoomDestination(zoomID)
                } label: {
                    MediaPosterCard(title: item.title, posterURL: model.absoluteURL(item.posterUrl))
                        .rawkoonZoomSource(zoomID)
                }
                .buttonStyle(.rawkoonPressable)
                .contextMenu {
                    Button(role: .destructive) {
                        Task { await remove(item) }
                    } label: {
                        Label("Remove from watchlist", systemImage: "bookmark.slash")
                    }
                    .requiresConnection(model.isOffline)
                }
                .rawkoonEntrance(id: item.id)
                .transition(.rawkoonSwap)
            }
        }
        .padding(.horizontal, 16)
        .rawkoonEntranceScope()
    }
```

In `remove(_:)`, replace:

```swift
            try await client.removeFromWatchlist(tmdbId: item.tmdbId, mediaType: item.mediaType)
            items.removeAll { $0.id == item.id }
```

with:

```swift
            try await client.removeFromWatchlist(tmdbId: item.tmdbId, mediaType: item.mediaType)
            // The card fades out and its neighbours reflow instead of snapping.
            withRawkoonMotion(RawkoonMotion.spring) {
                items.removeAll { $0.id == item.id }
            }
```

- [ ] **Step 5: Local gates**

Run the per-task gate block with: `Rawkoon/Views/LibraryView.swift Rawkoon/Views/Library/LibraryMediaRow.swift Rawkoon/Views/WatchlistView.swift`.

`LibraryView.swift` already exceeds `file_length`; the diff of the lint counts must show that pair at the same count (it is one warning per file, not per line).

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-home-library-discover
git add Rawkoon/Views/LibraryView.swift Rawkoon/Views/Library/LibraryMediaRow.swift Rawkoon/Views/WatchlistView.swift
git commit -m "feat(ios): Library and Watchlist swaps, books cascade and animated removal"
```

---

### Task 5: Discover — deck states swap and the deal

**Files:**
- Modify: `Rawkoon/Views/Discover/SwipeDeck.swift`, `Rawkoon/Views/DiscoverView.swift`
- Test: `RawkoonTests/SurfaceMotionTests.swift`

**Interfaces:**
- Produces: `nonisolated enum DeckDeal` with `static let rise: CGFloat` (360), `static let step: Double` (0.06), `static func delay(stackIndex: Int, visibleCount: Int) -> Double`, `static func startAngle(stackIndex: Int) -> Double`.
- Consumes: `.rawkoonMotion(_:value:)`, `.rawkoonSwap`, `RawkoonMotion.spring`.

- [ ] **Step 1: Write the tests (written now, executed by CI)**

In `RawkoonTests/SurfaceMotionTests.swift`, insert before the struct's final `}`:

```swift

    @Test func dealLandsTheBackCardFirst() {
        #expect(DeckDeal.delay(stackIndex: 2, visibleCount: 3) == 0)
        #expect(abs(DeckDeal.delay(stackIndex: 1, visibleCount: 3) - DeckDeal.step) < 1e-9)
        #expect(abs(DeckDeal.delay(stackIndex: 0, visibleCount: 3) - 2 * DeckDeal.step) < 1e-9)
    }

    @Test func aLoneCardDealsAtOnce() {
        #expect(DeckDeal.delay(stackIndex: 0, visibleCount: 1) == 0)
    }

    @Test func dealStaggerStaysShort() {
        for count in 0 ... 12 {
            for index in -1 ... 12 {
                let delay = DeckDeal.delay(stackIndex: index, visibleCount: count)
                #expect(delay >= 0)
                #expect(delay <= 2 * DeckDeal.step + 1e-9)
            }
        }
    }

    @Test func dealTiltAlternatesAndStaysSmall() {
        #expect(DeckDeal.startAngle(stackIndex: 0) == -DeckDeal.startAngle(stackIndex: 1))
        #expect(abs(DeckDeal.startAngle(stackIndex: 2)) <= 6)
    }
```

- [ ] **Step 2: `DeckDeal` and the deal (signature moment)**

In `Rawkoon/Views/Discover/SwipeDeck.swift`, append at the end of the file:

```swift

/// The deck's opening deal: each card rises from below its slot, back card first, so the top card lands last.
nonisolated enum DeckDeal {
    /// How far below its slot a card starts.
    static let rise: CGFloat = 360
    /// The gap between two cards landing.
    static let step: Double = 0.06

    /// Back card first; capped at the three visible cards so the deal never drags.
    static func delay(stackIndex: Int, visibleCount: Int) -> Double {
        let fromBack = min(max(visibleCount - 1 - stackIndex, 0), 2)
        return Double(fromBack) * step
    }

    /// A small alternating tilt that settles flat, so the cards read as dealt by hand.
    static func startAngle(stackIndex: Int) -> Double {
        stackIndex.isMultiple(of: 2) ? -5 : 5
    }
}
```

In `SwipeDeck`, after the `isFlinging` declaration:

```swift
    @State private var isFlinging = false
```

add:

```swift
    /// False until this batch's opening deal; `.id(deckBatch)` gives each batch a fresh deck, so it deals once.
    @State private var dealt = false
```

In `body`, replace:

```swift
        .onAppear { deckFocused = true }
```

with:

```swift
        .onAppear { deckFocused = true }
        // After the first frame, so the cards start below their slots; a return from detail finds `dealt` already true.
        .task { dealt = true }
```

In `card(for:stackIndex:)` (the version Task 2 produced), replace:

```swift
        // Cap so a fast fling doesn't over-rotate; a drag never reaches the cap.
        let angle = max(-40, min(40, live.width / 18))
```

with:

```swift
        // Cap so a fast fling doesn't over-rotate; a drag never reaches the cap.
        let angle = max(-40, min(40, live.width / 18))
        // Before the deal a card waits below its slot, tilted; under Reduce Motion it only fades in.
        let undealt = !dealt && !reduceMotion
        let dealTilt = undealt ? DeckDeal.startAngle(stackIndex: stackIndex) : 0
        let dealDelay = DeckDeal.delay(stackIndex: stackIndex, visibleCount: visibleItems.count)
```

and replace:

```swift
            .offset(live)
            .rotationEffect(.degrees(Double(angle)))
            .zIndex(isTop ? 1 : 0)
```

with:

```swift
            .offset(live)
            .rotationEffect(.degrees(Double(angle) + dealTilt))
            .offset(y: undealt ? DeckDeal.rise : 0)
            .opacity(dealt ? 1 : 0)
            .rawkoonMotion(RawkoonMotion.spring.delay(dealDelay), value: dealt)
            .zIndex(isTop ? 1 : 0)
```

`rawkoonMotion` only animates changes of `dealt`; the drag, fling and promotion code keeps its own animations untouched. A card revealed later at the back of the stack is created with `dealt == true`, so it does not deal (the existing `.transition(.identity)` still governs it).

- [ ] **Step 3: Shimmer → deck → empty swap**

In `Rawkoon/Views/DiscoverView.swift`, after `private let prefetchThreshold = 5` add:

```swift

    /// Which of `deckContent`'s branches shows, so switching between them crossfades.
    private enum DeckPhase {
        case deck, loading, offline, failed, empty
    }

    private var deckPhase: DeckPhase {
        if !deckItems.isEmpty { return .deck }
        if deckLoading { return .loading }
        if deckError != nil { return model.isOffline ? .offline : .failed }
        return .empty
    }
```

Replace `deckColumn`:

```swift
    private var deckColumn: some View {
        VStack(alignment: .leading, spacing: 20) {
            deckContent
        }
        .padding(.top, 12)
    }
```

with:

```swift
    private var deckColumn: some View {
        VStack(alignment: .leading, spacing: 20) {
            deckContent
        }
        .padding(.top, 12)
        .rawkoonMotion(RawkoonMotion.spring, value: deckPhase)
    }
```

Replace the whole `deckContent`:

```swift
    @ViewBuilder
    private var deckContent: some View {
        if !deckItems.isEmpty {
            SwipeDeck(
                items: deckItems,
                label: deckSource.map(deckLabel(for:)) ?? "",
                primaryActionTitle: model.isAdmin ? String(localized: "Add") : String(localized: "Request"),
                onDismiss: handleDismiss,
                onWatchlist: handleWatchlist,
                onPrimary: handlePrimary,
                onExhausted: handleExhausted,
                onOpen: { openDeckItem = $0 }
            )
            .id(deckBatch)
            .transition(.rawkoonSwap)
        } else if deckLoading {
            ShimmerView(cornerRadius: 16)
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .frame(maxWidth: 260)
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
                .allowsHitTesting(false)
                .transition(.rawkoonSwap)
        } else if model.isOffline, deckError != nil {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if let deckError {
            ContentUnavailableView(
                "Couldn't load Discover",
                systemImage: "wifi.slash",
                description: Text(deckError)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "sparkles.rectangle.stack",
                description: Text("Check back soon for new releases.")
            )
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 4: Local gates**

Run the per-task gate block with: `Rawkoon/Views/Discover/SwipeDeck.swift Rawkoon/Views/DiscoverView.swift RawkoonTests/SurfaceMotionTests.swift`.

- [ ] **Step 5: Review**

In the `SwipeDeck` diff, confirm: `allowsHitTesting(isTop && !isFlinging)` and the gesture are unchanged (a tap or swipe mid-deal still works); `dealt` is only ever set to `true`; the deal stagger is at most `2 * DeckDeal.step` (0.12s); nothing in `springBack`, `flingAway` or `performRemoval` changed. Batch swaps (`deckBatch += 1`) re-create the deck, so a cache-painted deck followed by a different network batch deals twice: that is a new batch arriving, and it is intended.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-home-library-discover
git add Rawkoon/Views/Discover/SwipeDeck.swift Rawkoon/Views/DiscoverView.swift RawkoonTests/SurfaceMotionTests.swift
git commit -m "feat(ios): deal the Discover deck and crossfade its states"
```

---

### Task 6: Explore, search and book discovery

**Files:**
- Modify: `Rawkoon/Views/Discover/ExploreView.swift`, `Rawkoon/Views/Discover/MediaSearch.swift`, `Rawkoon/Views/Discover/BookDiscoveryView.swift`

**Interfaces:**
- Consumes: `.rawkoonSwap`, `.rawkoonReveal`, `.rawkoonNumeric(_:)`, `.rawkoonMotion(_:value:)`, `.rawkoonEntranceScope()`, `.rawkoonEntrance(id:)`, `.rawkoonCelebrate(trigger:ring:tint:haptic:when:)`, SwiftUI `GlassEffectContainer`, `glassEffect(_:in:)`, `glassEffectID(_:in:)`.

The spec's "Explore filter chips" are the active-filter chips in `ExploreView.filterBar` (the row that also carries the result count), not the genre chips inside the filter sheet.

- [ ] **Step 1: Explore — glass chips that morph, count roll, error reveal**

In `ExploreView`, after `@State private var loadGeneration = 0` add:

```swift
    /// Ties each active chip to its glass shape, so adding or clearing one morphs inside the container.
    @Namespace private var chipNamespace
```

Replace the whole `filterBar`:

```swift
    @ViewBuilder
    private var filterBar: some View {
        if !filters.isDefault {
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        if let provider = filters.provider {
                            activeChip(Text(provider.name), id: "provider") { filters.provider = nil }
                        }
                        if let genre = filters.genre {
                            activeChip(Text(genre.name), id: "genre") { filters.genre = nil }
                        }
                        if filters.sort != .popularityDesc {
                            activeChip(Text(filters.sort.label), id: "sort") { filters.sort = .popularityDesc }
                        }
                        if filters.originalLanguageOnly {
                            activeChip(Text("Original language"), id: "language") {
                                filters.originalLanguageOnly = false
                            }
                        }
                        if !loading, error == nil {
                            Text("\(totalResults) results")
                                .font(.caption)
                                .foregroundStyle(Theme.muted)
                                .padding(.leading, 4)
                                .rawkoonNumeric(Double(totalResults))
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
            .transition(.rawkoonReveal)
        }
    }
```

Replace `activeChip(_:onClear:)`:

```swift
    private func activeChip(_ label: Text, onClear: @escaping () -> Void) -> some View {
```

with:

```swift
    private func activeChip(_ label: Text, id: String, onClear: @escaping () -> Void) -> some View {
```

and in its body replace:

```swift
        .foregroundStyle(Theme.onAccent)
        .padding(.leading, 10)
        .frame(minHeight: 44)
        .background(Theme.apricot, in: Capsule())
    }
```

with:

```swift
        .foregroundStyle(Theme.onAccent)
        .padding(.leading, 10)
        .frame(minHeight: 44)
        .glassEffect(.regular.tint(Theme.apricot).interactive(), in: .capsule)
        .glassEffectID(id, in: chipNamespace)
    }
```

In `refreshErrorBanner(_:)`, replace:

```swift
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
    }
```

with:

```swift
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
        .transition(.rawkoonReveal)
    }
```

In `gridScroll`, replace:

```swift
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .reportsTabBarScroll()
        .refreshable {
            await loadFirstPage()
        }
```

with:

```swift
            .padding(.top, 12)
            .padding(.bottom, 32)
            // Chips morph on a filter change; banner, skeleton and grid swap when a load settles.
            .rawkoonMotion(RawkoonMotion.snappy, value: filters)
            .rawkoonMotion(RawkoonMotion.spring, value: loading)
        }
        .reportsTabBarScroll()
        .refreshable {
            await loadFirstPage()
        }
```

- [ ] **Step 2: Explore — state swaps and grid cascade**

Replace the whole `content` property:

```swift
    @ViewBuilder
    private var content: some View {
        if loading, items.isEmpty {
            skeletonGrid
                .transition(.rawkoonSwap)
        } else if items.isEmpty, error != nil, model.isOffline {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty, error != nil {
            ContentUnavailableView(
                "Couldn't load Explore",
                systemImage: "wifi.slash",
                description: Text(error ?? "")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty {
            ContentUnavailableView {
                Label("No results for these filters", systemImage: "sparkles.rectangle.stack")
            } description: {
                Text("Try a different provider, genre, or sort order.")
            } actions: {
                if !filters.isDefault {
                    Button("Clear filters") {
                        filters = ExploreFilters(kind: filters.kind)
                    }
                }
            }
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            grid
                .transition(.rawkoonSwap)
        }
    }
```

Replace the whole `grid` property (the version Task 2 produced):

```swift
    private var grid: some View {
        VStack(spacing: 0) {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(items) { item in
                    let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            title: item.title,
                            posterPath: item.posterUrl,
                            libraryId: item.libraryId
                        )
                        .rawkoonZoomDestination(zoomID)
                    } label: {
                        posterCard(item)
                            .rawkoonZoomSource(zoomID)
                    }
                    .buttonStyle(.rawkoonPressable)
                    .onAppear {
                        guard item.id == items.last?.id else { return }
                        Task { await loadMore() }
                    }
                    .rawkoonEntrance(id: item.id)
                }
            }
            .padding(.horizontal, 16)
            // Lives with the grid: a new filter set rebuilds it and cascades; a refresh in place does not replay.
            .rawkoonEntranceScope()

            paginationFooter
        }
    }
```

- [ ] **Step 3: Search — state swaps and grid cascade**

In `MediaSearchResults.body`, replace:

```swift
        VStack(alignment: .leading, spacing: 20) {
            kindPicker
            searchContent
        }
```

with:

```swift
        VStack(alignment: .leading, spacing: 20) {
            kindPicker
            searchContent
        }
        .rawkoonMotion(RawkoonMotion.spring, value: loadingSearch)
```

Replace the whole `searchContent` property (the version Task 2 produced):

```swift
    @ViewBuilder
    private var searchContent: some View {
        if loadingSearch {
            LazyVGrid(columns: searchGridColumns, spacing: 14) {
                ForEach(0 ..< 9, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        ShimmerView(cornerRadius: 10)
                            .aspectRatio(2.0 / 3.0, contentMode: .fit)
                        ShimmerView(cornerRadius: 4).frame(height: 12)
                    }
                }
            }
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
            .transition(.rawkoonSwap)
        } else if model.isOffline, searchResults.isEmpty, bookResults.isEmpty {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("Search needs a connection.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if let searchError {
            ContentUnavailableView(
                "Search failed",
                systemImage: "wifi.slash",
                description: Text(searchError)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if searchResults.isEmpty, bookResults.isEmpty {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "magnifyingglass",
                description: Text("Try a different title.")
            )
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            VStack(alignment: .leading, spacing: 20) {
                if !bookResults.isEmpty {
                    Text("Books")
                        .font(.sectionTitle)
                        .foregroundStyle(Theme.textStrong)
                        .padding(.horizontal, 16)
                    ForEach(bookResults) { hit in
                        bookSearchRow(hit)
                            .padding(.horizontal, 16)
                    }
                }
                if !searchResults.isEmpty {
                    if !bookResults.isEmpty {
                        Text("Movies & TV")
                            .font(.sectionTitle)
                            .foregroundStyle(Theme.textStrong)
                            .padding(.horizontal, 16)
                    }
                    LazyVGrid(columns: searchGridColumns, spacing: 14) {
                        ForEach(searchResults) { item in
                            let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
                            NavigationLink {
                                MediaDetailView(
                                    tmdbId: item.tmdbId,
                                    mediaType: item.mediaType,
                                    title: item.title,
                                    posterPath: item.posterUrl,
                                    libraryId: item.libraryId
                                )
                                .rawkoonZoomDestination(zoomID)
                            } label: {
                                posterCard(item, fixedWidth: nil)
                                    .rawkoonZoomSource(zoomID)
                            }
                            .buttonStyle(.rawkoonPressable)
                            .rawkoonScrollSettle()
                            .rawkoonEntrance(id: item.id)
                        }
                    }
                    .padding(.horizontal, 16)
                    .rawkoonEntranceScope()
                }
            }
            .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 4: Book discovery — state swaps and grid cascade**

In `BookDiscoveryView.body`, replace:

```swift
                content
            }
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .background(Theme.base)
        .navigationTitle("Explore books")
```

with:

```swift
                content
            }
            .padding(.top, 12)
            .padding(.bottom, 32)
            .rawkoonMotion(RawkoonMotion.spring, value: loading)
        }
        .background(Theme.base)
        .navigationTitle("Explore books")
```

Replace the whole `content` property:

```swift
    @ViewBuilder
    private var content: some View {
        if loading, items.isEmpty {
            skeletonGrid
                .transition(.rawkoonSwap)
        } else if items.isEmpty, error != nil, model.isOffline {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty, let error {
            ContentUnavailableView(
                "Couldn't load this list",
                systemImage: "wifi.slash",
                description: Text(error)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty {
            ContentUnavailableView(
                "No books to show right now",
                systemImage: "books.vertical"
            )
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(items) { book in
                    NavigationLink {
                        DiscoveryBookDetailView(book: book)
                    } label: {
                        posterCard(book)
                    }
                    .buttonStyle(.rawkoonPressable)
                    .rawkoonEntrance(id: book.id)
                }
            }
            .padding(.horizontal, 16)
            .rawkoonEntranceScope()
            .transition(.rawkoonSwap)
        }
    }
```

- [ ] **Step 5: Book discovery — Add → Added celebration**

In `DiscoveryBookDetailView.actions`, replace:

```swift
                Button {
                    Task { await add() }
                } label: {
                    HStack(spacing: 8) {
                        if adding {
                            ProgressView().tint(Theme.onAccent)
                        } else {
                            Image(systemName: added ? "checkmark" : "plus")
                        }
                        Text(added ? LocalizedStringKey("Added") : LocalizedStringKey("Add to library"))
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.apricot, in: Capsule())
                }
                .disabled(adding || added)
                .requiresConnection(model.isOffline)
```

with:

```swift
                Button {
                    Task { await add() }
                } label: {
                    HStack(spacing: 8) {
                        if adding {
                            ProgressView().tint(Theme.onAccent)
                        } else {
                            Image(systemName: added ? "checkmark" : "plus")
                                .contentTransition(.symbolEffect(.replace))
                        }
                        Text(added ? LocalizedStringKey("Added") : LocalizedStringKey("Add to library"))
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.apricot, in: Capsule())
                    .rawkoonMotion(RawkoonMotion.snappy, value: added)
                }
                // Forward only; the success toast already plays the haptic.
                .rawkoonCelebrate(trigger: added, ring: .roundedRect(cornerRadius: 24), haptic: nil, when: { !$0 && $1 })
                .disabled(adding || added)
                .requiresConnection(model.isOffline)
```

Review: `add()` sets `added = true` then calls `model.toast(…, style: .success)`, which plays `RawkoonHaptics.play(.success)`. With `haptic: nil` the user feels one success tap, not two. `added` never returns to `false` today; the `when:` predicate keeps a future reversal from celebrating.

- [ ] **Step 6: Local gates**

Run the per-task gate block with: `Rawkoon/Views/Discover/ExploreView.swift Rawkoon/Views/Discover/MediaSearch.swift Rawkoon/Views/Discover/BookDiscoveryView.swift`.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-home-library-discover
git add Rawkoon/Views/Discover/ExploreView.swift Rawkoon/Views/Discover/MediaSearch.swift Rawkoon/Views/Discover/BookDiscoveryView.swift
git commit -m "feat(ios): Explore chips, search and book discovery motion"
```

---

### Task 7: Full gates, push, PR

**Files:** none beyond fixes the gates demand.

- [ ] **Step 1: Whole-tree CI lint steps, locally**

Run from `apps/ios/`:

```bash
python3 scripts/check-l10n.py
python3 scripts/check-env-inject.py
python3 scripts/check-raw-animation.py
swiftformat Rawkoon RawkoonTests RawkoonWidgets WidgetSupport Sources Tests --lint
bash "${TMPDIR:-/tmp}/rawkoon-pr2-lint.sh" > "${TMPDIR:-/tmp}/rawkoon-pr2-lint-after.txt"
diff "${TMPDIR:-/tmp}/rawkoon-pr2-lint-before.txt" "${TMPDIR:-/tmp}/rawkoon-pr2-lint-after.txt"
```

Expected: all three scripts pass, swiftformat reports 0 files, and the lint diff shows no new or higher `file rule` count. Fix and amend into a new `style(ios): …` commit if needed (never `--amend` a pushed commit).

- [ ] **Step 2: Scope check**

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD --name-only | grep -v '^apps/ios/' ; echo "non-ios files above (expect only this plan)"
```

Expected: only the files in the File Structure table plus this plan. No repo-root `CLAUDE.md`, `docker-compose.yml`, `.glim/` or `testflight_feedback.zip`.

- [ ] **Step 3: Push**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/ios-motion-home-library-discover
git push -u origin HEAD:feat/ios-motion-home-library-discover
```

- [ ] **Step 4: Open the PR (do not merge)**

```bash
gh pr create --base main --head feat/ios-motion-home-library-discover \
  --title "feat(ios): motion on Home, Library and Discover" \
  --body-file - <<'EOF'
## Summary

Second of four PRs in the expressive motion pass (spec: `docs/superpowers/specs/2026-10-09-ios-expressive-motion-design.md`, plan: `docs/superpowers/plans/2026-10-09-ios-motion-home-library-discover.md`).

- **Home:** rails cascade in, Continue and Listening cards swap in instead of popping, library, listening, speed and "now watching" figures roll. Signature: the bell bounces and its dot pulses when a notification arrives.
- **Library and Watchlist:** section and toolbar swap, offline banner reveals, books cascade, status and busy badges crossfade, watchlist removals animate out.
- **Discover:** shimmer, deck and empty states crossfade. Signature: each new deck is dealt up from the bottom, back card first. Explore's active-filter chips morph as glass, the result count rolls, the refresh error reveals, search and book discovery swap and cascade, and book discovery's Add → Added celebrates.
- **Zoom:** Explore, Similar, Watchlist, Requests and deck taps zoom into detail; Home, Library and search use the shared zoom helpers. Posters in a hidden tab register a separate id, so a title shown in two tabs zooms from the visible one.
- **Kit follow-ups:** `rawkoonCelebrate(when:)` for forward-only celebrations, a DEBUG log for an entrance with no scope, toast and offline strip honor Reduce Motion, `AsyncButton` haptics go through `RawkoonHaptics`.

## Verification

- CI: kit, lint (l10n, env-inject, raw-animation, swiftformat, swiftlint), build, and `RawkoonTests` on an iOS 26 simulator (new `SurfaceMotionTests`, extended `RawkoonMotionTests` and `RawkoonHapticsTests`).
- Not verified yet: simulator screen recordings and a device pass (the Mac build host was offline). Motion timing, haptics and the zoom origin need a hands-on check before merge.
EOF
```

Expected: a PR URL. Do not merge.

- [ ] **Step 5: Watch CI to green**

```bash
gh pr checks --watch
```

Expected: every check passes. On a red `build` job, read the failing step with `gh run view <run-id> --log-failed`, fix in a new commit on this branch, push, and watch again. A Swift concurrency error in a closure usually means a value must be copied into a local first or a helper must be `nonisolated` (see Global Constraints).

---

## Verification

- **Per task:** the local gate block (python checks, swiftformat, swiftlint diff against the Task 1 baseline).
- **Compile and tests:** GitHub CI on push (`build` job: `xcodebuild test -only-testing:RawkoonTests`, then a simulator build). Linux cannot compile the app target.
- **Still owed after this PR opens (operator, when macbuild is back):** simulator recordings of Home, Library, Watchlist, Discover, Explore, search and book discovery, with Reduce Motion spot-checked, and a device install for haptics, the deck deal and zoom origins. No TestFlight build is cut to test.

## Self-review

- **Spec coverage (PR 2 section):**
  - Home rails cascade (`rawkoonEntrance` in a scope): Task 3 Step 3.
  - Continue Listening and Listening Stats enter with `rawkoonSwap`, placeholder kept: Task 3 Step 5.
  - Stat figures and "now watching" percentage roll: Task 3 Step 4.
  - Signature: bell dot pulses and bell bounces on arrival: Task 3 Steps 1–2.
  - Library section picker and media/books toolbar swap: Task 4 Step 1.
  - Offline banner uses `rawkoonReveal`: Task 4 Step 1.
  - Books grid cascades: Task 4 Step 3.
  - Media badge and busy-state swaps animate: Task 4 Steps 2–3.
  - Watchlist removals animate out: Task 4 Step 4.
  - Deck shimmer → deck → empty with `rawkoonSwap`: Task 5 Step 3.
  - Signature: the deck deals up from the bottom, staggered: Task 5 Step 2.
  - Explore chips morph in a `GlassEffectContainer`: Task 6 Step 1.
  - Result count rolls; refresh error banner reveals: Task 6 Step 1.
  - Book discovery Add → Added celebrates: Task 6 Step 5.
  - Zoom from Explore, Similar, Watchlist, Requests and deck taps: Task 2 Step 4.
  - Home, Library and search onto the shared helpers: Task 2 Step 3.
- **Carry-overs from PR 1's review:**
  - (a) Toast and offline strip slide under Reduce Motion → `rawkoonEdge`: Task 1 Step 5.
  - (b) `rawkoonCelebrate` celebrates reversals → `when:` predicate, source-compatible; book discovery uses it: Task 1 Step 3, Task 6 Step 5.
  - (c) `rawkoonEntrance` without a scope → DEBUG `Log.motion` warning once per call site, no assertion: Task 1 Step 4.
  - (d) `AsyncButton` bypasses `RawkoonHaptics` → `.tap` event plus mapping tests: Task 1 Steps 2 and 5.
- **Added because the acceptance list requires it and no later PR owns these screens:** skeleton → content swaps and grid cascades on Watchlist, Explore, search and book discovery (Tasks 4 and 6); Home's storage figure and download speeds roll (Task 3).
- **Decisions taken while planning:**
  - "Explore filter chips" means the active-filter row in `ExploreView`, which also holds the result count; the filter sheet's genre chips are unchanged.
  - One shared zoom namespace across kept-alive tabs needs `ZoomSourceKey` so a hidden tab's poster cannot be picked as the zoom origin.
  - The bell gets no haptic; the deck deal uses its own 0.06s step (three cards at most) rather than the list stagger.
  - Book discovery's celebration passes `haptic: nil` because its success toast already plays one.
  - The offline banner uses `rawkoonReveal`, as the spec says, not `rawkoonEdge`.
- **Type consistency:** these names are identical in every task that uses them: `CelebrationGate.fires(from:to:when:)`, `rawkoonCelebrate(trigger:ring:tint:haptic:when:)`, `rawkoonEntrance(id:fileID:line:)`, `ZoomSourceKey.id(_:inActiveTab:)`, `NotificationBell(unread:)`, `NotificationBell.announcesArrival(from:to:)`, `DeckDeal.delay(stackIndex:visibleCount:)`, `DeckDeal.startAngle(stackIndex:)`, `DeckDeal.rise`, `DeckDeal.step`, `RawkoonHaptics.Event.tap`, `Log.motion`.
