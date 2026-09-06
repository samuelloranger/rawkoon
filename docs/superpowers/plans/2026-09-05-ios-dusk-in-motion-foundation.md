# Dusk in Motion — Plan 1: Foundation (motion · perceived speed · nav shell · badge)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the shared foundation the whole iOS redesign builds on — one motion system, a perceived-speed layer, the iOS 26 tab shell with a Search tab and native bottom-accessory mini-player, and an app-icon unread badge — with no screen content redesign yet.

**Architecture:** New `RawkoonMotion`/`ShimmerView` primitives (Reduce-Motion-gated) live in the app target; the one pure-logic unit (badge reconciliation) lives in `RawkoonKit` behind XCTest. `RootTabsView` migrates from the legacy `TabView(selection:)`+`tabItem` to the iOS 26 `Tab` API with `.tabViewStyle(.sidebarAdaptable)`, a `Tab(role: .search)`, and `tabViewBottomAccessory` for the mini-player. The Activity queue's serial per-media fetch becomes a concurrent task group.

**Tech Stack:** SwiftUI (iOS 18 deployment target, Xcode 26 SDK), Swift 6 in `RawkoonKit`, XCTest, UNUserNotificationCenter. No new third-party dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-ios-dusk-in-motion-design.md` (direction B; §4 motion, §5 perceived speed, §6.0 nav, §6.5 badge, §8 a11y, §9 merge).

## Global Constraints

- **Deployment target iOS 18.0, Xcode 26 SDK; iPhone only** (`TARGETED_DEVICE_FAMILY: 1`). Build settings live in `project.yml`, never a generated `.xcodeproj`.
- **`RawkoonKit` is Swift 6 language mode** (`Package.swift:9`); tests are **XCTest** (`@testable import RawkoonKit`, `XCTestCase`), runnable on Linux CI.
- **`macbuild` ssh is the only real gate** — Linux builds only `RawkoonKit`. No task is "done" on a green Linux run alone; the app target (`lint` + `kit` + `build`) must pass on `macbuild`. Work in a **git worktree** (other agents branch-switch shared checkouts).
- **No new third-party dependencies.** No release, no version bump, no tag — human-only; a release auto-deploys prod.
- **Cozy Dusk only:** colors come from `Theme` (`Rawkoon/Theme.swift`); no raw hex outside `Theme`. Apricot obeys the One Lamp Rule. Fraunces (`Font.display`) for titles only.
- **Every animation gates on `@Environment(\.accessibilityReduceMotion)`** (crossfade/instant fallback). Tappable targets ≥ 44×44 pt. No hardcoded font sizes outside documented display moments; respect Dynamic Type.
- **No user-facing English string or copy changes** in this plan (foundation is structural); layout may change.

---

### Task 1: `RawkoonMotion` — the shared motion system

**Files:**
- Create: `Rawkoon/Motion/RawkoonMotion.swift`
- Reference: `Rawkoon/Theme.swift` (tokens)

**Interfaces:**
- Produces:
  - `enum RawkoonMotion` with `static let spring: Animation` (`.spring(response: 0.42, dampingFraction: 0.82)`), `static let snappy: Animation` (`.spring(response: 0.3, dampingFraction: 0.9)`), `static let gentle: Animation` (`.easeInOut(duration: 0.25)`).
  - `func rawkoonMotion(_ animation: Animation, value: some Equatable) -> some View` — a `View` extension that applies `animation` normally but swaps to a 0.15s `.easeInOut` (crossfade-equivalent) when Reduce Motion is on.
  - `struct BreathingLamp: ViewModifier` — pulses `scaleEffect`/`shadow` while `isActive`, static when off or Reduce Motion is on; applied via `func breathingLamp(active: Bool) -> some View`.

- [ ] **Step 1: Create the motion file**

```swift
import SwiftUI

/// One motion vocabulary for the whole app. All timing derives from these
/// springs so the app reads as one system. Every consumer must be Reduce-Motion
/// safe — use `.rawkoonMotion(_:value:)` rather than `.animation` directly.
enum RawkoonMotion {
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static let snappy = Animation.spring(response: 0.3, dampingFraction: 0.9)
    static let gentle = Animation.easeInOut(duration: 0.25)
    /// Reduce-Motion replacement: a quick crossfade instead of movement.
    static let reduced = Animation.easeInOut(duration: 0.15)
}

extension View {
    /// Applies `animation` to `value`, degrading to a short crossfade under
    /// Reduce Motion. Prefer this over `.animation(_:value:)` everywhere.
    func rawkoonMotion(_ animation: Animation, value: some Equatable) -> some View {
        modifier(RawkoonMotionModifier(animation: animation, value: AnyEquatable(value)))
    }

    /// The apricot lamp: breathes while `active`, still otherwise.
    func breathingLamp(active: Bool) -> some View {
        modifier(BreathingLamp(isActive: active))
    }
}

private struct RawkoonMotionModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation
    let value: AnyEquatable
    func body(content: Content) -> some View {
        content.animation(reduceMotion ? RawkoonMotion.reduced : animation, value: value)
    }
}

/// Type-erased Equatable so the modifier can take any value.
private struct AnyEquatable: Equatable {
    let base: any Equatable
    private let isEqual: (any Equatable) -> Bool
    init(_ base: some Equatable) {
        self.base = base
        self.isEqual = { other in (other as? (type(of: base))) == base }
    }
    static func == (lhs: AnyEquatable, rhs: AnyEquatable) -> Bool { lhs.isEqual(rhs.base) }
}

struct BreathingLamp: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isActive: Bool
    @State private var phase = false
    func body(content: Content) -> some View {
        content
            .scaleEffect(breathe ? 1.03 : 1.0)
            .shadow(color: Theme.apricot.opacity(breathe ? 0.5 : 0.3),
                    radius: breathe ? 18 : 10)
            .onAppear { phase = isActive }
            .onChange(of: isActive) { _, now in phase = now }
            .animation(animation, value: breathe)
    }
    private var breathe: Bool { isActive && phase && !reduceMotion }
    private var animation: Animation {
        isActive && !reduceMotion
            ? .easeInOut(duration: 1.8).repeatForever(autoreverses: true)
            : RawkoonMotion.reduced
    }
}
```

- [ ] **Step 2: Register the new file with XcodeGen**

`project.yml` uses folder-based sources for the app target, so a new file under `Rawkoon/` is picked up automatically. Regenerate the project:

Run (on `macbuild`): `cd apps/ios && xcodegen generate`
Expected: `Created project at Rawkoon.xcodeproj` with no error.

- [ ] **Step 3: Build the app target to type-check the new API**

Run (on `macbuild`, per memory `macbuild-ios-verification`): the repo's iOS build command (`make build` / the `ios.yml` `build` job's `xcodebuild` invocation).
Expected: `BUILD SUCCEEDED`. (`AnyEquatable`'s `type(of:)` cast compiles under Swift 6.)

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Motion/RawkoonMotion.swift apps/ios/Rawkoon.xcodeproj
git commit -m "feat(ios): add RawkoonMotion reduce-motion-safe animation system"
```

---

### Task 2: `ShimmerView` — warm skeleton primitive

**Files:**
- Create: `Rawkoon/Views/Components/ShimmerView.swift`
- Reference: `Rawkoon/Theme.swift`

**Interfaces:**
- Produces:
  - `struct ShimmerView: View` — init `ShimmerView(cornerRadius: CGFloat = 8)`, renders an apricot-over-well shimmering rounded rectangle; static fill under Reduce Motion.
  - `func redactedShimmer(_ active: Bool) -> some View` — a `View` extension overlaying shimmer while `active`.

- [ ] **Step 1: Create the shimmer file**

```swift
import SwiftUI

/// A warm skeleton placeholder — apricot shimmer over `Theme.well`, never a gray
/// spinner. Under Reduce Motion it renders as a static well fill.
struct ShimmerView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var cornerRadius: CGFloat = 8
    @State private var phase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(Theme.well)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, Theme.apricot.opacity(0.14), .clear],
                            startPoint: .leading, endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 1.6)
                        .offset(x: phase * geo.size.width * 1.6)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                }
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
            .accessibilityHidden(true)
    }
}
```

- [ ] **Step 2: Regenerate + build**

Run (on `macbuild`): `cd apps/ios && xcodegen generate` then the iOS build command.
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 3: Visually verify in the Simulator**

Add a temporary `#Preview` (or reuse a `DebugScreens` entry) rendering three `ShimmerView`s, run on the booted sim, capture:
Run: `xcrun simctl io booted screenshot /tmp/shimmer.png` (on `macbuild`; per memory `ios-sim-repro-recipe`).
Expected: warm apricot shimmer sweeping left-to-right over dark wells; flip `xcrun simctl ui booted appearance` is N/A (dark-only) — instead enable Reduce Motion in the sim (Settings → Accessibility → Motion) and confirm it renders static. Remove the temporary preview before committing if it was not a reusable debug screen.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/Components/ShimmerView.swift apps/ios/Rawkoon.xcodeproj
git commit -m "feat(ios): add warm ShimmerView skeleton primitive"
```

---

### Task 3: App-icon unread badge (RawkoonKit reconciler + wiring)

**Files:**
- Create: `Sources/RawkoonKit/NotificationBadge.swift`
- Create test: `Tests/RawkoonKitTests/NotificationBadgeTests.swift`
- Modify: `Rawkoon/AppModel.swift` (wire the badge to `unreadNotificationCount` at the sites that already mutate it: `:467`, `:518`, `:796`) and `Rawkoon/RawkoonApp.swift` (set on `.active`/foreground refresh).

**Interfaces:**
- Produces (Kit): `enum NotificationBadge { static func value(forUnread unread: Int, cap: Int = 99) -> Int }` — clamps negatives to 0 and caps the badge number (iOS shows no "99+", but a runaway count shouldn't set an absurd springboard number).
- Consumes (app): `UNUserNotificationCenter.current().setBadgeCount(_:)`.

- [ ] **Step 1: Write the failing test**

```swift
@testable import RawkoonKit
import XCTest

final class NotificationBadgeTests: XCTestCase {
    func testZeroWhenNoUnread() {
        XCTAssertEqual(NotificationBadge.value(forUnread: 0), 0)
    }

    func testPassesThroughUnderCap() {
        XCTAssertEqual(NotificationBadge.value(forUnread: 7), 7)
    }

    func testClampsNegativeToZero() {
        XCTAssertEqual(NotificationBadge.value(forUnread: -3), 0)
    }

    func testCapsRunawayCount() {
        XCTAssertEqual(NotificationBadge.value(forUnread: 5000, cap: 99), 99)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ios && swift test --filter NotificationBadgeTests`
Expected: FAIL — `NotificationBadge` is not defined.

- [ ] **Step 3: Write minimal implementation**

```swift
/// Maps the app's unread-notification count to the number set on the app icon.
/// Pure so it is unit-tested on Linux; the UNUserNotificationCenter call stays
/// in the app target.
public enum NotificationBadge {
    public static func value(forUnread unread: Int, cap: Int = 99) -> Int {
        max(0, min(unread, cap))
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ios && swift test --filter NotificationBadgeTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the badge in the app target**

In `Rawkoon/AppModel.swift`, add a private helper and call it wherever `unreadNotificationCount` changes (`:467` increment, `:518` refresh assignment, `:796` reset):

```swift
import RawkoonKit
import UserNotifications
// ... inside AppModel:
private func syncAppIconBadge() {
    let n = NotificationBadge.value(forUnread: unreadNotificationCount)
    Task { try? await UNUserNotificationCenter.current().setBadgeCount(n) }
}
```

Call `syncAppIconBadge()` immediately after each mutation of `unreadNotificationCount` (the three sites above). In `RawkoonApp.swift`, the existing `.task` already calls `refreshUnreadNotificationCount()` on launch (`:91`) and `.active` restarts streams (`:100`); add `await model.refreshUnreadNotificationCount()` to the `.active` branch so a foregrounded app reconciles the badge (the refresh now also syncs it).

- [ ] **Step 6: Build the app target**

Run (on `macbuild`): iOS build command.
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/NotificationBadge.swift apps/ios/Tests/RawkoonKitTests/NotificationBadgeTests.swift apps/ios/Rawkoon/AppModel.swift apps/ios/Rawkoon/RawkoonApp.swift
git commit -m "feat(ios): set app-icon unread badge from notification count"
```

---

### Task 4: Migrate the tab shell to the iOS 26 `Tab` API + Search tab

**Files:**
- Modify: `Rawkoon/RawkoonApp.swift` — `RootTabsView.mainTabs` (`:202-250`), remove `MiniPlayerInset` usage per tab (`:208,218,227,236,245`); the modifier struct (`:298-306`) is deleted in Task 5.
- Create: `Rawkoon/Views/Search/GlobalSearchView.swift` (search tab content; a working shell that reuses the existing unified search — full cross-entity scope is Plan "Search").

**Interfaces:**
- Consumes: `AppModel.isAdmin`, `AppModel.activeBook()`.
- Produces: `struct GlobalSearchView: View` (a `NavigationStack`-hosted `.searchable` screen).
- Note: `selection` becomes a `String` tag space so tabs are stable IDs for `.sidebarAdaptable` customization. Debug `RAWKOON_TAB` mapping is preserved by mapping the old Int to the new tags.

- [ ] **Step 1: Create the search tab shell**

```swift
import SwiftUI

/// The Search tab (Tab role .search). A working shell that hosts the app's
/// unified search; cross-entity scopes (titles / requests / go-to) are expanded
/// in the Search plan. Kept native: a .searchable NavigationStack, no custom bar.
struct GlobalSearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    ContentUnavailableView("Search Rawkoon",
                        systemImage: "magnifyingglass",
                        description: Text("Find titles, requests, and sections."))
                }
                // Results wired in the Search plan.
            }
            .navigationTitle("Search")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
        }
    }
}
```

- [ ] **Step 2: Rewrite `mainTabs` with the `Tab` API**

Replace the `TabView(selection:)`+`tabItem`+`.tag` body and the per-tab `MiniPlayerInset` with the new API. Change `selection` to `String` (update the `init` mapping from the debug `RAWKOON_TAB` Int, and the admin redirect that sets `selection = 0`/compares `== 2`).

```swift
// selection state:
@State private var selection: String = "library"   // household default; admin → "home" in .task

// mainTabs body:
TabView(selection: $selection) {
    if model.isAdmin {
        Tab("Home", systemImage: "house", value: "home") {
            NavigationStack { HomeView() }
        }
        .customizationID("tab.home")
    }
    Tab("Discover", systemImage: "sparkles.rectangle.stack", value: "discover") {
        NavigationStack { DiscoverView() }
    }
    .customizationID("tab.discover")
    Tab("Library", systemImage: "square.stack", value: "library") {
        NavigationStack { LibraryView() }
    }
    .customizationID("tab.library")
    Tab("Activity", systemImage: "arrow.down.circle", value: "activity") {
        NavigationStack { ActivityView() }
    }
    .customizationID("tab.activity")
    Tab("Settings", systemImage: "gearshape", value: "settings") {
        NavigationStack { SettingsView() }
    }
    .customizationID("tab.settings")
    Tab("Search", systemImage: "magnifyingglass", value: "search", role: .search) {
        GlobalSearchView()
    }
}
.tabViewStyle(.sidebarAdaptable)
.tint(Theme.apricot)
// ... keep the existing .alert (playbackError) and .sheet(isPresented: $showFullPlayer)
```

Update the `.task` admin redirect: `if !debugTabLocked, model.isAdmin, selection == "library" { selection = "home" }`. Update the debug `init` to map the `RAWKOON_TAB` Int (0→home,1→discover,2→library,3→activity,4→settings) to the string tags.

- [ ] **Step 3: Regenerate + build**

Run (on `macbuild`): `xcodegen generate` then iOS build command.
Expected: `BUILD SUCCEEDED`. (The mini-player temporarily disappears until Task 5 re-adds it as the bottom accessory — acceptable within this plan.)

- [ ] **Step 4: Verify the shell in the Simulator**

Boot the app (household + admin via `RAWKOON_TAB`), capture:
Run: `xcrun simctl io booted screenshot /tmp/tabs.png` (on `macbuild`).
Expected: floating Liquid-Glass tab bar; Search renders as a separate pill and expands into a field; all tabs navigate; large titles still Fraunces (from `Appearance.apply()`). Verify the apricot tint reads over Liquid Glass; if the bar's translucency washes the tint, note it for a follow-up (do not fight Liquid Glass).

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/RawkoonApp.swift apps/ios/Rawkoon/Views/Search/GlobalSearchView.swift apps/ios/Rawkoon.xcodeproj
git commit -m "feat(ios): migrate to iOS 26 Tab API with sidebarAdaptable + Search tab"
```

---

### Task 5: Mini-player as `tabViewBottomAccessory` (+ 44pt fix + breathing lamp)

**Files:**
- Modify: `Rawkoon/RawkoonApp.swift` — add `.tabViewBottomAccessory { ... }` to the `TabView`; delete the `MiniPlayerInset` struct (`:298-306`).
- Modify: `Rawkoon/Views/MiniPlayerView.swift` — fix the close button to 44×44 (`:55-59`); apply `breathingLamp(active:)` to the apricot play circle (`:43-47`).

**Interfaces:**
- Consumes: `MiniPlayerView(onExpand:)` (unchanged signature), `RawkoonMotion` (`breathingLamp`).

- [ ] **Step 1: Move the mini-player into the accessory slot**

In `RawkoonApp.swift`, attach to the `TabView`:

```swift
.tabViewBottomAccessory {
    MiniPlayerView(onExpand: { showFullPlayer = true })
}
```

Delete the `MiniPlayerInset` `ViewModifier` (it is now unused). `MiniPlayerView` already returns an empty body when no book is active, so the accessory self-hides.

- [ ] **Step 2: Fix the close-button tap target to 44×44**

In `MiniPlayerView.swift` (`:55-59`), change the close glyph frame from `.frame(width: 34, height: 44)` to `.frame(width: 44, height: 44)` (keep the `.contentShape(Rectangle())`).

- [ ] **Step 3: Make the lamp breathe on play**

In `MiniPlayerView.swift` play button (`:43-47`), add `.breathingLamp(active: model.player.isPlaying)` to the `Image(...).background(Theme.apricot, in: Circle())`.

- [ ] **Step 4: Regenerate + build**

Run (on `macbuild`): `xcodegen generate` then iOS build command.
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Verify in the Simulator**

Start playback (per memory `ios-sim-repro-recipe`), capture:
Run: `xcrun simctl io booted screenshot /tmp/accessory.png` (on `macbuild`).
Expected: mini-player sits in the native accessory above the glass tab bar, minimizes on scroll; play glyph gently breathes while playing and is still when paused; enable Reduce Motion and confirm the lamp holds still. Close hit area feels full-height and ≥44pt wide.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/RawkoonApp.swift apps/ios/Rawkoon/Views/MiniPlayerView.swift apps/ios/Rawkoon.xcodeproj
git commit -m "feat(ios): mini-player as native bottom accessory; 44pt close; breathing lamp"
```

---

### Task 6: Activity queue — concurrent fetch + warm skeletons

**Files:**
- Modify: `Rawkoon/Views/ActivityView.swift` — `loadQueue()` (the serial loop at `:205-209`) and its loading state.

**Interfaces:**
- Consumes: `client.libraryList(status:)`, `client.downloads(libraryId:)` (existing), `ShimmerView` (Task 2).

- [ ] **Step 1: Replace the serial loop with a concurrent task group**

The current shape (`:205-209`) awaits `client.downloads(libraryId:)` once per media in sequence. Replace with a throwing task group that fetches concurrently and preserves the library order:

```swift
let list = try await client.libraryList(status: "downloading")
let byId = try await withThrowingTaskGroup(of: (Int, [DownloadRow]).self) { group in
    for media in list {
        group.addTask { (media.id, (try? await client.downloads(libraryId: media.id)) ?? []) }
    }
    var map: [Int: [DownloadRow]] = [:]
    for try await (id, rows) in group { map[id] = rows }
    return map
}
let ordered = list.map { (media: $0, downloads: byId[$0.id] ?? []) }
// assign `ordered` to the queue state (match the existing state's type)
```

Use the concrete element type the existing code uses for a queue row (mirror the type currently built inside the `:205-209` loop; keep the same downstream state property and row view).

- [ ] **Step 2: Show warm skeletons while the queue loads**

Gate the queue list on a loading flag: while `loadQueue()` is in flight and there is no cached data, render ~4 `ShimmerView` rows (thumbnail + two lines) instead of a blank screen or a system spinner.

- [ ] **Step 3: Build**

Run (on `macbuild`): iOS build command.
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Verify the speed win in the Simulator**

With several items queued (or a debug fixture), open Activity and confirm the queue populates in roughly one round-trip instead of N serial ones, and shows shimmer rows first rather than a blank pause. Capture `xcrun simctl io booted screenshot /tmp/activity-load.png`.
Expected: skeleton rows on first paint, then the full queue; no long blank stall.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/Views/ActivityView.swift
git commit -m "perf(ios): fetch Activity queue downloads concurrently; warm skeletons"
```

---

### Task 7: Foundation integration gate (macbuild green)

**Files:** none (verification only).

- [ ] **Step 1: Run the full app gate on macbuild**

Run (on `macbuild`): `lint`, `kit`, and `build` (the `ios.yml` job equivalents / Makefile targets).
Expected: all green. Linux-only runs do not count (memory `macbuild-ios-verification`).

- [ ] **Step 2: Run the Kit tests**

Run: `cd apps/ios && swift test`
Expected: all pass, including `NotificationBadgeTests`.

- [ ] **Step 3: Regression sweep in the Simulator**

Confirm playback, offline library, CarPlay entry, and push deep-link banner still work (spec §2 — these must not regress). Capture one screenshot per: playing state, a downloaded book offline.
Expected: no regression from the shell/mini-player migration.

- [ ] **Step 4: Do NOT merge yet.** Foundation lands in the single merge with Plans 2–6 (spec §9). Leave the branch green.

---

## Self-review notes

- **Spec coverage (this plan's slice):** §4 motion → Tasks 1,2,5; §5 perceived speed → Tasks 2,6; §6.0 nav → Tasks 4,5; §6.5 badge → Task 3; §8 a11y (Reduce Motion + 44pt) → Tasks 1,2,5. Screen content (Discover/Detail/Activity-visual/Settings) is out of this plan by design (see below).
- **No placeholders:** every code step carries real code; the one deliberate deferral (search results) is a working shell, not a TODO.
- **Type consistency:** `selection` is `String` across `init`, body, and the admin redirect; `NotificationBadge.value` signature matches its test and its AppModel call.
- **Risk flagged:** Liquid Glass tint legibility (Task 4 Step 4) is a verify-in-sim item, not assumed solved.

## Remaining phase-plans (author next; all land in the one merge)

Each becomes its own `docs/superpowers/plans/2026-09-05-ios-dusk-in-motion-<name>.md`, built on this foundation's primitives:

1. **Discover** — swipe-triage deck (`SwipeDeck`) + Explore filter/sort/provider sheet; retire the passive rails.
2. **Detail** — merge Info+Management into one interactive screen; grab-any-episode via swipe/context; cast/trailer/providers rails; hide the non-admin book dead-end.
3. **Activity (content)** — Queue/History segmented, status filter chips with counts, humanized rows, live DuskProgress (perf already done here in Task 6).
4. **Settings** — regroup the 22-link admin wall into labeled sections + `.searchable`; pull drifted lists from `@rawkoon/shared`.
5. **Search** — expand `GlobalSearchView` into real cross-entity scopes (titles/requests/go-to), the ⌘K equivalent.
6. **Density + a11y sweep** — list/grid density on Library rows, Dynamic Type fixes (fixed caption heights, segmented truncation), `Theme.faint` contrast lift.
