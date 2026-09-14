# iOS 27 Native Motion & Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rawkoon read as a native iOS 27 app by anchoring its existing screens to the system's zoom-transition, sheet-detent, haptic, and content-transition APIs.

**Architecture:** A polish pass over existing views — no navigation rewrite, no new dependencies. One app-level `@Namespace` is injected through the environment; the shared `BookCover` self-anchors as a zoom source when given an identity, so movie/TV posters, audiobook/ebook covers, and the mini player all share one continuous cover identity into `MediaDetailView` and the full player. Every animation routes through the existing `RawkoonMotion` tokens, so it is Reduce-Motion safe by construction.

**Tech Stack:** SwiftUI (iOS 27), first-party only — `matchedTransitionSource`/`navigationTransition(.zoom)`, `sensoryFeedback`, `contentTransition(.numericText/.symbolEffect)`, `presentationDetents`, `scrollTransition`. RawkoonKit for the pure keying, XCTest + Swift Testing.

**Spec:** `docs/superpowers/specs/2026-09-14-ios-27-native-motion-design.md`

## Global Constraints

- Minimum iOS **27.0**; build with Xcode **27**, Swift 6 language mode.
- No new third-party dependency.
- No navigation restructuring — `NavigationStack` / `navigationDestination` / existing sheets stay.
- Every animation goes through `RawkoonMotion` tokens / `rawkoonMotion(_:value:)`; never a bare `.animation`. Reduce Motion must degrade to the crossfade fallback.
- `SensoryFeedback` is SwiftUI, so haptics live in the app target; the pure zoom keying lives in RawkoonKit (Linux-tested).
- Build settings change in `project.yml`, never the generated `.xcodeproj`.
- Verify on the iOS 27 simulator (`iPhone 18 Pro` locally, or a runtime-resolved iOS 27 sim on CI). Visual transitions are confirmed on a real iOS 27 device.

---

### Task 1: Zoom identity keying (pure, RawkoonKit)

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/RawkoonZoom.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/RawkoonZoomTests.swift`

**Interfaces:**
- Produces: `enum RawkoonZoom` with `typealias ID = String` and
  `static func media(tmdbId: Int, mediaType: String) -> ID`,
  `static func book(_ bookId: Int) -> ID`,
  `static func audiobook(editionId: Int) -> ID`. Kind-prefixed so the id
  spaces never collide.

- [ ] **Step 1: Write the failing test**

```swift
@testable import RawkoonKit
import XCTest

final class RawkoonZoomTests: XCTestCase {
    func testKindsArePrefixedAndDistinct() {
        XCTAssertEqual(RawkoonZoom.media(tmdbId: 5, mediaType: "movie"), "movie:5")
        XCTAssertEqual(RawkoonZoom.media(tmdbId: 5, mediaType: "tv"), "tv:5")
        XCTAssertEqual(RawkoonZoom.book(5), "book:5")
        XCTAssertEqual(RawkoonZoom.audiobook(editionId: 5), "audiobook:5")
    }

    func testNoCollisionAcrossSpaces() {
        let ids = Set([
            RawkoonZoom.media(tmdbId: 5, mediaType: "movie"),
            RawkoonZoom.media(tmdbId: 5, mediaType: "tv"),
            RawkoonZoom.book(5),
            RawkoonZoom.audiobook(editionId: 5),
        ])
        XCTAssertEqual(ids.count, 4)
    }
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/ios && swift test --filter RawkoonZoomTests`
Expected: FAIL — `RawkoonZoom` undefined.

- [ ] **Step 3: Write the minimal implementation**

```swift
/// Stable, collision-free identity for zoom transitions across media types.
/// Kind-prefixed so a movie id and an audiobook edition id never clash when
/// they share the one app-level zoom namespace.
public enum RawkoonZoom {
    public typealias ID = String
    public static func media(tmdbId: Int, mediaType: String) -> ID { "\(mediaType):\(tmdbId)" }
    public static func book(_ bookId: Int) -> ID { "book:\(bookId)" }
    public static func audiobook(editionId: Int) -> ID { "audiobook:\(editionId)" }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd apps/ios && swift test --filter RawkoonZoomTests`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/RawkoonZoom.swift apps/ios/Tests/RawkoonKitTests/RawkoonZoomTests.swift
git commit -m "feat(ios): add zoom identity keying"
```

---

### Task 2: App-level zoom namespace + BookCover anchoring

**Files:**
- Create: `apps/ios/Rawkoon/Motion/RawkoonZoomNamespace.swift`
- Modify: `apps/ios/Rawkoon/Views/Components.swift` (the `BookCover` struct)
- Modify: `apps/ios/Rawkoon/RawkoonApp.swift` (own + inject the namespace)

**Interfaces:**
- Consumes: `RawkoonZoom.ID` (Task 1).
- Produces: `EnvironmentValues.rawkoonZoomNamespace: Namespace.ID?`; `BookCover`
  gains `var zoomID: RawkoonZoom.ID? = nil`. When both a namespace and a
  `zoomID` are present, `BookCover` applies `.matchedTransitionSource(id:in:)`;
  otherwise it renders exactly as before.

- [ ] **Step 1: Add the environment key**

Create `RawkoonZoomNamespace.swift`:

```swift
import SwiftUI

private struct RawkoonZoomNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    /// The single app-level namespace zoom sources and destinations share.
    var rawkoonZoomNamespace: Namespace.ID? {
        get { self[RawkoonZoomNamespaceKey.self] }
        set { self[RawkoonZoomNamespaceKey.self] = newValue }
    }
}
```

- [ ] **Step 2: Give `BookCover` an optional zoom source**

In `Components.swift`, add the property and environment read to `BookCover`, and apply the source at the end of `body`:

```swift
struct BookCover: View {
    let url: URL?
    var size: CGFloat
    var corner: CGFloat = 10
    var zoomID: RawkoonZoom.ID? = nil

    @Environment(\.rawkoonZoomNamespace) private var zoomNamespace

    var body: some View {
        ZStack(alignment: .leading) {
            // ... existing content unchanged ...
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner))
        .overlay(
            RoundedRectangle(cornerRadius: corner).strokeBorder(.white.opacity(0.06), lineWidth: 1)
        )
        .modifier(ZoomSource(id: zoomID, namespace: zoomNamespace))
    }
}

/// Applies `.matchedTransitionSource` only when both an id and a namespace are
/// present, so every existing `BookCover` call site is unaffected.
private struct ZoomSource: ViewModifier {
    let id: RawkoonZoom.ID?
    let namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if let id, let namespace {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}
```

Add `import RawkoonKit` to `Components.swift` if it is not already imported.

- [ ] **Step 3: Own and inject the namespace in `RawkoonApp`**

In `RawkoonApp.swift`, add a namespace to `RawkoonApp` and inject it into the `WindowGroup` environment, next to the existing `.environment(model)`:

```swift
@Namespace private var zoomNamespace
```

and on the `WindowGroup`'s root content:

```swift
.environment(\.rawkoonZoomNamespace, zoomNamespace)
```

Place it adjacent to the existing `.environment(model)` line (keep `.environment(model)` last so `check-env-inject.py` still passes — add the zoom line **above** it).

- [ ] **Step 4: Build for the iOS 27 simulator**

Run:
```bash
cd apps/ios && xcodegen generate && \
xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' CODE_SIGNING_ALLOWED=NO
```
Expected: BUILD SUCCEEDED. No call site passes `zoomID` yet, so behavior is unchanged.

- [ ] **Step 5: Run the checks and app-target tests**

Run:
```bash
cd apps/ios && python3 scripts/check-env-inject.py && \
swiftformat Rawkoon RawkoonTests Sources Tests --lint && swiftlint lint --quiet Rawkoon && \
xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' -only-testing:RawkoonTests
```
Expected: env-inject ok, lint clean, tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/Motion/RawkoonZoomNamespace.swift apps/ios/Rawkoon/Views/Components.swift apps/ios/Rawkoon/RawkoonApp.swift
git commit -m "feat(ios): add app-level zoom namespace on BookCover"
```

---

### Task 3: Poster/cover → detail zoom (movies, TV, books)

**Files:**
- Modify: `apps/ios/Rawkoon/Views/LibraryView.swift`
- Modify: `apps/ios/Rawkoon/Views/DiscoverView.swift`
- Modify: `apps/ios/Rawkoon/Views/Library/LibraryMediaRow.swift`
- Modify: `apps/ios/Rawkoon/Views/Components.swift` (shared row cell, if it hosts a `BookCover` into detail)
- Modify: `apps/ios/Rawkoon/Views/MediaDetailView.swift`

**Interfaces:**
- Consumes: `RawkoonZoom` (Task 1), `BookCover.zoomID` (Task 2).
- Produces: no new symbols; each poster/cover that navigates to
  `MediaDetailView` passes a `zoomID`, and `MediaDetailView` declares the
  matching `.navigationTransition(.zoom(sourceID:in:))`.

- [ ] **Step 1: Tag the source covers**

At each grid/row `BookCover` that navigates into `MediaDetailView`, pass the matching id. For a movie/TV poster (Discover and Library media rows) the item carries a `tmdbId` and `mediaType`:

```swift
BookCover(url: posterURL, size: 56, corner: 10, zoomID: RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType))
```

For an audiobook/book cover that opens detail, use `RawkoonZoom.book(item.bookId)`. Add `import RawkoonKit` to any of these files that lacks it. Do not tag covers that do not navigate to detail (e.g. the mini player — that is Task 4).

- [ ] **Step 2: Declare the destination transition**

In `MediaDetailView.swift`, read the namespace and apply the zoom transition on the view's root, keyed by the same id its source used:

```swift
@Environment(\.rawkoonZoomNamespace) private var zoomNamespace
```

and on the outermost view in `body`:

```swift
.modifier(ZoomDestination(id: RawkoonZoom.media(tmdbId: tmdbId, mediaType: mediaType), namespace: zoomNamespace))
```

Add a small reusable modifier (place it in `RawkoonZoomNamespace.swift` so both files share it):

```swift
struct ZoomDestination: ViewModifier {
    let id: RawkoonZoom.ID
    let namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if let namespace {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
    }
}
```

For a book/audiobook detail path, use `RawkoonZoom.book(...)` to match its source.

- [ ] **Step 3: Build for the iOS 27 simulator**

Run:
```bash
cd apps/ios && xcodegen generate && \
xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' CODE_SIGNING_ALLOWED=NO
```
Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Lint + app-target tests**

Run:
```bash
cd apps/ios && swiftformat Rawkoon Sources Tests RawkoonTests --lint && swiftlint lint --quiet Rawkoon && \
xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' -only-testing:RawkoonTests
```
Expected: clean + pass.

- [ ] **Step 5: Device check (record, do not block the commit)**

On a real iOS 27 iPhone: tapping a movie poster, a TV poster, and an audiobook cover each zooms into its detail; Back reverses it; Reduce Motion replaces the zoom with a crossfade. Note results in the PR.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/Views/LibraryView.swift apps/ios/Rawkoon/Views/DiscoverView.swift apps/ios/Rawkoon/Views/Library/LibraryMediaRow.swift apps/ios/Rawkoon/Views/Components.swift apps/ios/Rawkoon/Views/MediaDetailView.swift apps/ios/Rawkoon/Motion/RawkoonZoomNamespace.swift
git commit -m "feat(ios): zoom from poster and cover into detail"
```

---

### Task 4: Mini-player → full-player morph + detents

**Files:**
- Modify: `apps/ios/Rawkoon/Views/MiniPlayerView.swift` (tag the mini cover)
- Modify: `apps/ios/Rawkoon/RawkoonApp.swift` (full-player presentation)
- Modify: `apps/ios/Rawkoon/Views/PlayerView.swift` (detents + destination transition)

**Interfaces:**
- Consumes: `RawkoonZoom.audiobook(editionId:)`, `BookCover.zoomID`,
  `ZoomDestination` (Task 3), the app-level namespace (Task 2).
- Produces: no new symbols; the mini bar's cover is the zoom source and the
  full player is its destination, keyed by the active edition id.

- [ ] **Step 1: Tag the mini-player cover**

In `MiniPlayerView.swift`, give the leading `BookCover` the active edition's zoom id:

```swift
BookCover(url: active.summary.coverURL, size: 38, corner: 9, zoomID: RawkoonZoom.audiobook(editionId: active.summary.editionId))
```

Add `import RawkoonKit` if missing.

- [ ] **Step 2: Make the full player the zoom destination with detents**

In `PlayerView.swift`, read the namespace and apply the destination transition on the root, keyed by the summary's edition id, and widen the detents:

```swift
@Environment(\.rawkoonZoomNamespace) private var zoomNamespace
```

Change the existing `.presentationDetents([.large])` on the player root to:

```swift
.presentationDetents([.medium, .large])
```

and add on the same root:

```swift
.modifier(ZoomDestination(id: RawkoonZoom.audiobook(editionId: summary.editionId), namespace: zoomNamespace))
```

(Leave the chapters sheet's own `.presentationDetents([.medium, .large])` as it is.)

- [ ] **Step 3: Source the presentation from the mini bar**

In `RawkoonApp.swift`, the full player is presented by `.sheet(isPresented: $showFullPlayer)`. Keep the sheet, and anchor its zoom source to the active edition by adding, on the `TabView` (next to `.miniPlayerAccessory`):

```swift
.navigationTransition(.zoom(sourceID: RawkoonZoom.audiobook(editionId: model.activeEditionId ?? -1), in: zoomNamespace))
```

is **not** how a sheet is sourced — instead rely on the mini bar's `matchedTransitionSource` (Step 1) and the player's `ZoomDestination` (Step 2); the system matches them by id across the sheet presentation. No change to the `.sheet` call itself beyond what Steps 1–2 provide. If the morph does not engage on device, fall back to presenting the player with `.fullScreenCover` sourced from the mini bar; record which was used.

- [ ] **Step 4: Build for the iOS 27 simulator**

Run:
```bash
cd apps/ios && xcodegen generate && \
xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' CODE_SIGNING_ALLOWED=NO
```
Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Device check**

On a real iOS 27 iPhone: tapping the mini bar morphs its cover up into the full player; the player drags between medium and large; dismiss reverses; Reduce Motion degrades gracefully. Record in the PR.

- [ ] **Step 6: Lint, test, commit**

```bash
cd apps/ios && swiftformat Rawkoon --lint && swiftlint lint --quiet Rawkoon && \
xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' -only-testing:RawkoonTests
git add apps/ios/Rawkoon/Views/MiniPlayerView.swift apps/ios/Rawkoon/RawkoonApp.swift apps/ios/Rawkoon/Views/PlayerView.swift
git commit -m "feat(ios): morph mini player into full player with detents"
```

---

### Task 5: Haptics

**Files:**
- Create: `apps/ios/Rawkoon/Motion/RawkoonHaptics.swift`
- Test: `apps/ios/RawkoonTests/RawkoonHapticsTests.swift`
- Modify: `apps/ios/Rawkoon/Views/PlayerView.swift`, `apps/ios/Rawkoon/Views/MiniPlayerView.swift` (play/pause, chapter skip), and the grab call site (`apps/ios/Rawkoon/Views/MediaDetailView.swift`).

**Interfaces:**
- Produces: `enum RawkoonHaptics` with `enum Event { case playPause, chapterSkip, grab, downloadComplete }` and `static func feedback(for: Event) -> SensoryFeedback`.

- [ ] **Step 1: Write the failing test**

```swift
@testable import Rawkoon
import SwiftUI
import Testing

struct RawkoonHapticsTests {
    @Test func eventsMapToDistinctFeedback() {
        #expect(RawkoonHaptics.feedback(for: .playPause) == .selection)
        #expect(RawkoonHaptics.feedback(for: .chapterSkip) == .impact(weight: .light))
        #expect(RawkoonHaptics.feedback(for: .grab) == .success)
        #expect(RawkoonHaptics.feedback(for: .downloadComplete) == .success)
    }
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/ios && xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' -only-testing:RawkoonTests/RawkoonHapticsTests`
Expected: FAIL — `RawkoonHaptics` undefined.

- [ ] **Step 3: Write the implementation**

```swift
import SwiftUI

/// Maps app events to system haptics so feedback is consistent everywhere.
enum RawkoonHaptics {
    enum Event { case playPause, chapterSkip, grab, downloadComplete }

    static func feedback(for event: Event) -> SensoryFeedback {
        switch event {
        case .playPause: .selection
        case .chapterSkip: .impact(weight: .light)
        case .grab, .downloadComplete: .success
        }
    }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Wire the triggers**

Attach `.sensoryFeedback` at each site, driven by an existing observable value so it fires on change:
- Play/pause (`PlayerView` and `MiniPlayerView` play button): `.sensoryFeedback(RawkoonHaptics.feedback(for: .playPause), trigger: model.player.isPlaying)`
- Chapter skip (`PlayerView` next/previous): `.sensoryFeedback(RawkoonHaptics.feedback(for: .chapterSkip), trigger: model.player.currentChapterIndex)`
- Grab (`MediaDetailView` grab action): `.sensoryFeedback(RawkoonHaptics.feedback(for: .grab), trigger: <the grab-submitted state on that view>)`

Use the view's existing state for the download-complete trigger if one is observable on a visible screen; if none is, leave `.downloadComplete` mapped but unwired and note it for the notification-surface spec.

- [ ] **Step 6: Build, lint, test, commit**

```bash
cd apps/ios && xcodegen generate && swiftformat Rawkoon RawkoonTests --lint && swiftlint lint --quiet Rawkoon && \
xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' -only-testing:RawkoonTests
git add apps/ios/Rawkoon/Motion/RawkoonHaptics.swift apps/ios/RawkoonTests/RawkoonHapticsTests.swift apps/ios/Rawkoon/Views/PlayerView.swift apps/ios/Rawkoon/Views/MiniPlayerView.swift apps/ios/Rawkoon/Views/MediaDetailView.swift
git commit -m "feat(ios): add haptics for playback and grab"
```

---

### Task 6: Numeric-text and symbol-replace transitions

**Files:**
- Modify: `apps/ios/Rawkoon/Views/PlayerView.swift` (time labels + play/pause glyph)
- Modify: `apps/ios/Rawkoon/Views/MiniPlayerView.swift` (play/pause glyph)

**Interfaces:** none new — modifiers on existing views.

- [ ] **Step 1: Roll the time labels**

In `PlayerView.swift`, on each monospaced time `Text` (the `formatTime(...)` labels around the scrubber — the elapsed/remaining and the "`… of …`" label), add:

```swift
.contentTransition(.numericText())
```

and animate their change through the tokens, e.g. wrap the enclosing container with `.rawkoonMotion(RawkoonMotion.snappy, value: model.player.positionSecs)` if it is not already animated.

- [ ] **Step 2: Morph the play/pause glyph**

On the play/pause `Image(systemName:)` in both `PlayerView.swift` and `MiniPlayerView.swift`, add:

```swift
.contentTransition(.symbolEffect(.replace))
```

- [ ] **Step 3: Build + verify on the iOS 27 simulator**

Run:
```bash
cd apps/ios && xcodegen generate && \
xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' CODE_SIGNING_ALLOWED=NO
```
Expected: BUILD SUCCEEDED. In the simulator, the time digits roll and the glyph morphs on toggle.

- [ ] **Step 4: Lint + commit**

```bash
cd apps/ios && swiftformat Rawkoon --lint && swiftlint lint --quiet Rawkoon
git add apps/ios/Rawkoon/Views/PlayerView.swift apps/ios/Rawkoon/Views/MiniPlayerView.swift
git commit -m "feat(ios): roll player time and morph play glyph"
```

---

### Task 7: Scroll transitions on library and discover rows

**Files:**
- Modify: `apps/ios/Rawkoon/Views/LibraryView.swift`
- Modify: `apps/ios/Rawkoon/Views/DiscoverView.swift`

**Interfaces:** none new — a modifier on existing row/cell views.

- [ ] **Step 1: Add the scroll transition**

On the library and discover row/cell view (the repeating element inside the scroll/grid), add a subtle settle-in keyed off visibility:

```swift
.scrollTransition { content, phase in
    content
        .opacity(phase.isIdentity ? 1 : 0)
        .scaleEffect(phase.isIdentity ? 1 : 0.96)
}
```

Keep it subtle (opacity + small scale only); do not offset large distances.

- [ ] **Step 2: Build + verify on the iOS 27 simulator**

Run:
```bash
cd apps/ios && xcodegen generate && \
xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' CODE_SIGNING_ALLOWED=NO
```
Expected: BUILD SUCCEEDED; rows settle in on scroll.

- [ ] **Step 3: Device check + Reduce Motion**

On a real iOS 27 iPhone with Reduce Motion on, confirm the rows do not visibly scale/fade in a way that violates the setting (SwiftUI honors it for `scrollTransition`; if it does not on this build, gate the effect on `@Environment(\.accessibilityReduceMotion)`). Record the result.

- [ ] **Step 4: Lint + commit**

```bash
cd apps/ios && swiftformat Rawkoon --lint && swiftlint lint --quiet Rawkoon
git add apps/ios/Rawkoon/Views/LibraryView.swift apps/ios/Rawkoon/Views/DiscoverView.swift
git commit -m "feat(ios): settle library and discover rows on scroll"
```

---

## Stop condition

All tasks committed; the app builds and the app-target + RawkoonKit suites pass on iOS 27; the device checklist (Tasks 3, 4, 7) passes on a real iOS 27 iPhone including Reduce Motion. No new dependency; navigation structure unchanged. Ready for human-controlled PR and release; the home-screen surfaces (Control Center, widget, notification) proceed as a separate spec/plan.
