# iOS Custom Tab Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On iPhone, replace the native five-tab bar with a custom floating bar that holds seven icon tabs, shrinks on scroll, and carries the audiobook mini player.

**Architecture:**
- **Pure logic in RawkoonKit, unit-tested on Linux:** tab order and selection validation, the badge label, the initials, and the shrink state machine.
- **iPhone container:** a keep-alive `ZStack` of seven `NavigationStack`s. Each is mounted on first visit and stays mounted, so history and scroll position survive a tab switch. The custom bar and mini player sit in a bottom `safeAreaInset`, so every list clears them automatically.
- **iPad and Mac:** keep today's `TabView(.sidebarAdaptable)`, including its native mini-player accessory.

**Tech Stack:** SwiftUI, iOS 26.2 deployment target, Swift 6 strict concurrency (default MainActor isolation in the app target), XcodeGen, XCTest (Kit), Swift Testing (app target), SwiftFormat + SwiftLint.

**Spec:** `docs/superpowers/specs/2026-09-25-ios-custom-tab-bar-design.md`

## Global Constraints

- **Scope:** iPhone (compact horizontal size class) only. iPad and Mac keep `TabView(.sidebarAdaptable)`, `tabBarMinimizeBehavior(.onScrollDown)` and `miniPlayerAccessory` unchanged.
- **Tabs:** seven, left to right: Home, Media, Books, Discover, Explore, Notifications, Settings (shown as the avatar).
- **Icons:** icon-only, white. The active tab shows its filled symbol and a grey pill slides behind it. The bar is a floating dark capsule 16 pt from the screen edges.
- **Badge:** a red capsule on the bell with the unread count, capped at "9+".
- **Avatar:** the user's initials, from first and last name, with a small `≡` badge.
- **VoiceOver:** each slot is a selectable button named after its tab, and the unread count is spoken.
- **Hit targets:** at least 44 pt, even on a 375 pt-wide iPhone.
- **Dependencies:** no new third-party dependencies. Build settings change only in `project.yml`.
- **Strings:** every new user-facing literal in a `Text(...)` is added to `Rawkoon/Localizable.xcstrings` with a French translation, or `scripts/check-l10n.py` fails CI.
- **Comments:** one short line, and only where the reason isn't obvious.
- **Verification:** the `macbuild` ssh host is the only real gate. Linux builds `RawkoonKit` only.

## Deviations from the spec (tell the user at handoff)

- **Container.** The spec kept `TabView` on iPhone with its bar hidden. The codebase already records `.toolbar(.hidden, for: .tabBar)` as unreliable across iOS versions (`MediaDetailView.swift:363`). A hidden bar that reappears on a pushed screen would stack two bars. This plan uses a keep-alive `ZStack` instead, which keeps the same guarantee the spec wanted: per-tab navigation and scroll state survive a switch.
- **`.rawkoonTabBarHidden()` is dropped.** No screen hides the tab bar today; the one reference is a comment explaining why `MediaDetailView` does not. YAGNI.

## Review Focus

- **Rubber-band bounce at the bottom of a list** must not flap the bar between shrunk and expanded. Test in Task 3.
- **Expanding, then scrolling a few points down** must not immediately re-collapse the bar. Test in Task 3.
- **A user with no first or last name** (only a display name, or nothing) must get sensible initials or a person icon, never an empty circle. Test in Task 2.
- **A zero, negative or very large unread count** gives no badge, or "9+". Test in Task 2.
- **A stale or unknown tab value** (an old debug value, `notifications` on iPad) falls back to a tab that exists at that width. Test in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/ios/Sources/RawkoonKit/RootTab.swift` (create) | Tab identity, the phone and sidebar orders, and selection validation |
| `apps/ios/Sources/RawkoonKit/UserInitials.swift` (create) | Initials from the user's name fields |
| `apps/ios/Sources/RawkoonKit/NotificationBadge.swift` (modify) | Add `label(forUnread:)` |
| `apps/ios/Sources/RawkoonKit/TabBarScrollState.swift` (create) | The shrink/expand state machine |
| `apps/ios/Tests/RawkoonKitTests/RootTabTests.swift`, `UserInitialsTests.swift`, `TabBarScrollStateTests.swift` (create), `NotificationBadgeTests.swift` (modify) | Kit tests |
| `apps/ios/RawkoonTests/TabSelectionTests.swift` (delete) | Its cases move into `RootTabTests` |
| `apps/ios/Rawkoon/Theme.swift` (modify) | `tabBar`, `tabPill` and `badge` colours |
| `apps/ios/Rawkoon/Views/TabBar/TabBarChrome.swift` (create) | Observable collapse state, the environment entry, and `.reportsTabBarScroll()` |
| `apps/ios/Rawkoon/Views/TabBar/RootTab+Display.swift` (create) | SF Symbols and localized titles per tab |
| `apps/ios/Rawkoon/Views/TabBar/RawkoonTabBar.swift` (create) | The bar view: pill, badge, avatar, collapsed form |
| `apps/ios/Rawkoon/Views/TabBar/PhoneTabsView.swift` (create) | The keep-alive container, bottom inset, mini player placement |
| `apps/ios/Rawkoon/RawkoonApp.swift` (modify) | Route compact width to `PhoneTabsView`, regular width to the existing `TabView`; `RootTabSelection` → `RootTab` |
| `apps/ios/Rawkoon/AppModel.swift`, `AppModel+Auth.swift` (modify) | `userInitials` |
| `apps/ios/Rawkoon/Views/DiscoverView.swift` (modify) | Remove the phone-only "Filter" → Explore sheet |
| `HomeView.swift`, `LibraryView.swift`, `Discover/ExploreView.swift`, `Notifications/NotificationsListView.swift`, `SettingsView.swift` (modify) | Add `.reportsTabBarScroll()` to each root scroll container |
| `apps/ios/Rawkoon/Views/DebugScreens.swift` (modify) | An offline `tabBar` screenshot screen |
| `apps/ios/Rawkoon/Localizable.xcstrings` (modify) | New strings (fr) |

**Worktrees:**
- **Local:** `~/sites/rawkoon-wt/ios-custom-tab-bar`, branch `feat/ios-custom-tab-bar`.
- **macbuild:** a dedicated worktree synced with `git checkout -B feat/ios-custom-tab-bar origin/feat/ios-custom-tab-bar`. Never `git pull` in `macbuild:~/rawkoon`; its `main` has diverged.

**macbuild gate script.** Used by every task from Task 4 on, as `GATE`. Push first, then run:

```bash
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; set -e
  cd ~/rawkoon && git fetch -q origin
  [ -d ~/rawkoon-wt/ios-custom-tab-bar ] || git worktree add -q ~/rawkoon-wt/ios-custom-tab-bar origin/feat/ios-custom-tab-bar
  cd ~/rawkoon-wt/ios-custom-tab-bar && git checkout -q -B feat/ios-custom-tab-bar origin/feat/ios-custom-tab-bar
  git branch --show-current; git rev-parse --short HEAD
  cd apps/ios && xcodegen generate -q
  swift test 2>&1 | grep -E "error:|Executed [0-9]+ tests" | tail -2
  xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon -destination "generic/platform=iOS Simulator" -derivedDataPath /tmp/rawkoon-dd-tabbar CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|\*\* BUILD" | sort -u
  UDID=65E15DB4-E38D-496D-996B-EF7132B09FBC
  xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon -destination "id=$UDID" -only-testing:RawkoonTests -derivedDataPath /tmp/rawkoon-dd-tabbar CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|\*\* TEST" | sort -u
  python3 scripts/check-l10n.py | tail -1; python3 scripts/check-env-inject.py | tail -1
  swiftformat Rawkoon RawkoonTests Sources Tests --lint 2>&1 | tail -1'
```

Expected output:
- the branch name and HEAD sha, both matching what you pushed;
- `Executed N tests, with 0 failures`;
- `** BUILD SUCCEEDED **`;
- `** TEST SUCCEEDED **`;
- `l10n: ok`;
- `env-inject: ok`;
- `0/… files require formatting`.

If swiftformat reports files, run `swiftformat Rawkoon RawkoonTests Sources Tests` on macbuild, `scp` the changed files back, and commit them.

---

### Task 1: `RootTab` — tab identity, order and validation (Kit)

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/RootTab.swift`
- Create: `apps/ios/Tests/RawkoonKitTests/RootTabTests.swift`
- Delete: `apps/ios/RawkoonTests/TabSelectionTests.swift` (its cases are ported below)

**Interfaces:**
- Produces:
  - `public enum RootTab: String, CaseIterable, Sendable { case home, library, books, discover, explore, notifications, settings }`
  - `RootTab.phone: [RootTab]`
  - `RootTab.sidebar: [RootTab]`
  - `RootTab.validated(_ raw: String, compact: Bool) -> RootTab`
  - Raw values match today's `TabView` tags (`"home"`, `"library"`, `"books"`, `"discover"`, `"explore"`, `"settings"`) plus `"notifications"`.

- [ ] **Step 1: Write the failing tests**

```swift
@testable import RawkoonKit
import XCTest

final class RootTabTests: XCTestCase {
    func testPhoneBarHoldsSevenTabsInOrder() {
        XCTAssertEqual(RootTab.phone, [.home, .library, .books, .discover, .explore, .notifications, .settings])
    }

    func testSidebarIsUnchangedByTheCustomBar() {
        XCTAssertEqual(RootTab.sidebar, [.home, .library, .books, .discover, .explore, .settings])
    }

    func testEveryPhoneTabSurvivesValidationOnPhone() {
        for tab in RootTab.phone {
            XCTAssertEqual(RootTab.validated(tab.rawValue, compact: true), tab)
        }
    }

    /// Notifications is a phone-only tab; a stale pick on iPad must land somewhere visible.
    func testNotificationsFallsBackToHomeInTheSidebar() {
        XCTAssertEqual(RootTab.validated("notifications", compact: false), .home)
    }

    func testUnknownValueFallsBackToLibrary() {
        XCTAssertEqual(RootTab.validated("nope", compact: true), .library)
        XCTAssertEqual(RootTab.validated("", compact: false), .library)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ios && swift test --filter RootTabTests`
Expected: compile failure, "cannot find 'RootTab' in scope".

- [ ] **Step 3: Write the implementation**

```swift
/// The app's top-level destinations. Raw values are the tab tags persisted in
/// selection state, so they must not change.
public enum RootTab: String, CaseIterable, Sendable {
    case home, library, books, discover, explore, notifications, settings

    /// The custom iPhone bar, left to right.
    public static let phone: [RootTab] = [.home, .library, .books, .discover, .explore, .notifications, .settings]

    /// The iPad/Mac sidebar, which the custom bar does not change.
    public static let sidebar: [RootTab] = [.home, .library, .books, .discover, .explore, .settings]

    /// A stale pick must resolve to a tab that exists at this width.
    public static func validated(_ raw: String, compact: Bool) -> RootTab {
        guard let tab = RootTab(rawValue: raw) else { return .library }
        return (compact ? phone : sidebar).contains(tab) ? tab : .home
    }
}
```

- [ ] **Step 4: Delete the old app-target test**

Run: `git rm apps/ios/RawkoonTests/TabSelectionTests.swift`

It tests `RootTabSelection`, which Task 7 removes. Its three cases (home always valid, the always-visible tabs survive, unknown → library) are covered by the tests above.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/ios && swift test --filter RootTabTests`
Expected: `Executed 5 tests, with 0 failures`. On Linux, if `swift` is unavailable, run it on macbuild in the Task 4 gate.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/RootTab.swift apps/ios/Tests/RawkoonKitTests/RootTabTests.swift
git commit -m "feat(ios): add RootTab with phone and sidebar orders"
```

---

### Task 2: Badge label and initials (Kit)

**Files:**
- Modify: `apps/ios/Sources/RawkoonKit/NotificationBadge.swift`
- Modify: `apps/ios/Tests/RawkoonKitTests/NotificationBadgeTests.swift`
- Create: `apps/ios/Sources/RawkoonKit/UserInitials.swift`
- Create: `apps/ios/Tests/RawkoonKitTests/UserInitialsTests.swift`

**Interfaces:**
- Produces:
  - `NotificationBadge.label(forUnread: Int) -> String?`: nil for 0 or less, `"1"`…`"9"`, then `"9+"`.
  - `UserInitials.from(firstName: String?, lastName: String?, name: String?) -> String?`: up to two uppercase letters, nil when nothing usable.

- [ ] **Step 1: Write the failing tests**

Append to the `NotificationBadgeTests` class body:

```swift
    func testLabelIsNilWithNothingUnread() {
        XCTAssertNil(NotificationBadge.label(forUnread: 0))
        XCTAssertNil(NotificationBadge.label(forUnread: -2))
    }

    func testLabelShowsSingleDigits() {
        XCTAssertEqual(NotificationBadge.label(forUnread: 1), "1")
        XCTAssertEqual(NotificationBadge.label(forUnread: 9), "9")
    }

    /// The tab-bar badge is a small capsule; two digits and up read "9+".
    func testLabelCapsAtNinePlus() {
        XCTAssertEqual(NotificationBadge.label(forUnread: 10), "9+")
        XCTAssertEqual(NotificationBadge.label(forUnread: 5000), "9+")
    }
```

Create `UserInitialsTests.swift`:

```swift
@testable import RawkoonKit
import XCTest

final class UserInitialsTests: XCTestCase {
    func testFirstAndLastName() {
        XCTAssertEqual(UserInitials.from(firstName: "samuel", lastName: "Loranger", name: nil), "SL")
    }

    func testFirstNameOnly() {
        XCTAssertEqual(UserInitials.from(firstName: "Ana", lastName: nil, name: "ignored"), "A")
    }

    /// No name fields: fall back to the display name's first two words.
    func testDisplayNameFallback() {
        XCTAssertEqual(UserInitials.from(firstName: nil, lastName: "  ", name: "jean paul marc"), "JP")
    }

    /// Nothing usable must yield nil so the avatar shows a person icon, not an empty circle.
    func testNothingUsableIsNil() {
        XCTAssertNil(UserInitials.from(firstName: nil, lastName: nil, name: nil))
        XCTAssertNil(UserInitials.from(firstName: " ", lastName: "", name: "   "))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ios && swift test --filter "NotificationBadgeTests|UserInitialsTests"`
Expected: compile failure, missing `label(forUnread:)` and `UserInitials`.

- [ ] **Step 3: Write the implementation**

In `NotificationBadge.swift`, inside `public enum NotificationBadge`:

```swift
    /// Text for the tab-bar bell badge; nil hides the badge.
    public static func label(forUnread unread: Int) -> String? {
        guard unread > 0 else { return nil }
        return unread > 9 ? "9+" : String(unread)
    }
```

Create `UserInitials.swift`:

```swift
import Foundation

/// Up to two initials for the tab-bar avatar, or nil when no name is usable.
public enum UserInitials {
    public static func from(firstName: String?, lastName: String?, name: String?) -> String? {
        let named = [firstName, lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let words = named.isEmpty
            ? (name ?? "").split(separator: " ").map(String.init)
            : named
        let letters = words.prefix(2).compactMap(\.first).map { String($0).uppercased() }
        return letters.isEmpty ? nil : letters.joined()
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/ios && swift test --filter "NotificationBadgeTests|UserInitialsTests"`
Expected: all pass (4 existing + 3 new badge tests, 4 initials tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/NotificationBadge.swift apps/ios/Sources/RawkoonKit/UserInitials.swift apps/ios/Tests/RawkoonKitTests/NotificationBadgeTests.swift apps/ios/Tests/RawkoonKitTests/UserInitialsTests.swift
git commit -m "feat(ios): add tab-bar badge label and user initials"
```

---

### Task 3: `TabBarScrollState` — shrink/expand decision (Kit)

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/TabBarScrollState.swift`
- Create: `apps/ios/Tests/RawkoonKitTests/TabBarScrollStateTests.swift`

**Interfaces:**
- Produces:
  - `public struct TabBarScrollState: Equatable, Sendable`
  - `init(threshold: Double = 24, topSlop: Double = 8)`
  - `var isCollapsed: Bool { get }`
  - `mutating func update(offset: Double)`: `offset` is the distance scrolled from the top, 0 at rest.
  - `mutating func expand()`

- [ ] **Step 1: Write the failing tests**

```swift
@testable import RawkoonKit
import XCTest

final class TabBarScrollStateTests: XCTestCase {
    private func scrolled(_ offsets: [Double], from start: TabBarScrollState = TabBarScrollState()) -> TabBarScrollState {
        var state = start
        for offset in offsets { state.update(offset: offset) }
        return state
    }

    func testStartsExpanded() {
        XCTAssertFalse(TabBarScrollState().isCollapsed)
    }

    func testScrollingDownPastTheThresholdCollapses() {
        XCTAssertTrue(scrolled([10, 40, 80]).isCollapsed)
    }

    func testSmallDownwardMovesDoNotCollapse() {
        XCTAssertFalse(scrolled([10, 20, 30]).isCollapsed)
    }

    func testScrollingBackUpPastTheThresholdExpands() {
        XCTAssertFalse(scrolled([10, 80, 200, 170]).isCollapsed)
    }

    func testReachingTheTopAlwaysExpands() {
        XCTAssertFalse(scrolled([10, 80, 200, 4]).isCollapsed)
    }

    /// Rubber-banding past the end reverses direction by a few points; the bar must hold still.
    func testBottomBounceDoesNotFlap() {
        let state = scrolled([10, 80, 400, 412, 405, 411, 406])
        XCTAssertTrue(state.isCollapsed)
    }

    /// A tap that expands must not be undone by the next few points of downward drift.
    func testExpandThenSmallDriftStaysExpanded() {
        var state = scrolled([10, 80, 200])
        state.expand()
        state.update(offset: 210)
        state.update(offset: 218)
        XCTAssertFalse(state.isCollapsed)
        state.update(offset: 260)
        XCTAssertTrue(state.isCollapsed)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ios && swift test --filter TabBarScrollStateTests`
Expected: compile failure, "cannot find 'TabBarScrollState'".

- [ ] **Step 3: Write the implementation**

```swift
/// Decides when the custom tab bar collapses: after a sustained scroll down,
/// back on a sustained scroll up or at the top. Distances are measured from the
/// point where the direction last changed, so bounce jitter never flips it.
public struct TabBarScrollState: Equatable, Sendable {
    public private(set) var isCollapsed = false
    private var lastOffset: Double = 0
    private var anchor: Double = 0
    private var movingDown = false
    private let threshold: Double
    private let topSlop: Double

    public init(threshold: Double = 24, topSlop: Double = 8) {
        self.threshold = threshold
        self.topSlop = topSlop
    }

    public mutating func update(offset: Double) {
        defer { lastOffset = offset }
        guard offset > topSlop else {
            isCollapsed = false
            anchor = offset
            movingDown = false
            return
        }
        guard offset != lastOffset else { return }
        let down = offset > lastOffset
        if down != movingDown {
            anchor = lastOffset
            movingDown = down
        }
        if down, offset - anchor > threshold { isCollapsed = true }
        if !down, anchor - offset > threshold { isCollapsed = false }
    }

    public mutating func expand() {
        isCollapsed = false
        anchor = lastOffset
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/ios && swift test --filter TabBarScrollStateTests`
Expected: `Executed 7 tests, with 0 failures`.

Trace `testExpandThenSmallDriftStaysExpanded`: `expand()` sets the anchor to 200 while `movingDown` is still true, so 218 − 200 = 18 < 24 stays expanded, and 260 − 200 = 60 collapses.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/TabBarScrollState.swift apps/ios/Tests/RawkoonKitTests/TabBarScrollStateTests.swift
git commit -m "feat(ios): add tab bar shrink-on-scroll state machine"
```

---

### Task 4: Theme colours, tab display metadata and `TabBarChrome`

**Files:**
- Modify: `apps/ios/Rawkoon/Theme.swift`, beside the other surface colours (after `borderStrong`)
- Create: `apps/ios/Rawkoon/Views/TabBar/RootTab+Display.swift`
- Create: `apps/ios/Rawkoon/Views/TabBar/TabBarChrome.swift`

**Interfaces:**
- Consumes: `RootTab` (Task 1), `TabBarScrollState` (Task 3).
- Produces:
  - Theme colours: `Theme.tabBar`, `Theme.tabPill`, `Theme.badge`.
  - `RootTab.symbol: String`, `RootTab.selectedSymbol: String`, `RootTab.title: LocalizedStringKey`.
  - `final class TabBarChrome` (`@Observable`): `isCollapsed: Bool`, `scrolled(to: Double)`, `expand()`, `reset()`.
  - `EnvironmentValues.tabBarChrome: TabBarChrome?`
  - `View.reportsTabBarScroll() -> some View`

- [ ] **Step 1: Add the colours to `Theme.swift`**

```swift
    static let tabBar = Color(hex: 0x2A2320) // floating tab bar
    static let tabPill = Color(hex: 0xF4ECE4).opacity(0.13) // active tab pill
    static let badge = Color(hex: 0xE5484D) // unread badge
```

- [ ] **Step 2: Create `RootTab+Display.swift`**

```swift
import RawkoonKit
import SwiftUI

extension RootTab {
    var symbol: String {
        switch self {
        case .home: "house"
        case .library: "film.stack"
        case .books: "books.vertical"
        case .discover: "sparkles.rectangle.stack"
        case .explore: "square.grid.2x2"
        case .notifications: "bell"
        case .settings: "gearshape"
        }
    }

    var selectedSymbol: String {
        self == .settings ? symbol : symbol + ".fill"
    }

    var title: LocalizedStringKey {
        switch self {
        case .home: "Home"
        case .library: "Media"
        case .books: "Books"
        case .discover: "Discover"
        case .explore: "Explore"
        case .notifications: "Notifications"
        case .settings: "Settings"
        }
    }
}
```

All seven keys already exist in `Localizable.xcstrings` (checked: Home, Media, Books, Discover, Explore, Notifications, Settings).

- [ ] **Step 3: Create `TabBarChrome.swift`**

```swift
import RawkoonKit
import SwiftUI

/// Collapse state for the custom iPhone tab bar, fed by the active tab's root list.
@Observable
final class TabBarChrome {
    private(set) var isCollapsed = false
    private var scroll = TabBarScrollState()

    func scrolled(to offset: Double) {
        scroll.update(offset: offset)
        sync()
    }

    func expand() {
        scroll.expand()
        sync()
    }

    /// A tab switch starts from the new tab's own list, expanded.
    func reset() {
        scroll = TabBarScrollState()
        sync()
    }

    private func sync() {
        guard scroll.isCollapsed != isCollapsed else { return }
        withAnimation(.spring(duration: 0.35)) { isCollapsed = scroll.isCollapsed }
    }
}

extension EnvironmentValues {
    @Entry var tabBarChrome: TabBarChrome?
}

extension View {
    /// Put on a tab's root scroll container so the custom bar can shrink with it.
    func reportsTabBarScroll() -> some View {
        modifier(TabBarScrollReporter())
    }
}

private struct TabBarScrollReporter: ViewModifier {
    @Environment(\.tabBarChrome) private var chrome

    func body(content: Content) -> some View {
        content.onScrollGeometryChange(for: Double.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top
        } action: { _, offset in
            chrome?.scrolled(to: offset)
        }
    }
}
```

- [ ] **Step 4: Push and run `GATE`** (see File Structure)

Run: `git push -u origin feat/ios-custom-tab-bar`, then the `GATE` script.
Expected: `** BUILD SUCCEEDED **`, Kit tests pass, formatting clean. `** TEST SUCCEEDED **` confirms that deleting `TabSelectionTests.swift` left the app test target compiling; `RawkoonApp.swift` still has `RootTabSelection` until Task 7, which is fine.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/Theme.swift apps/ios/Rawkoon/Views/TabBar/RootTab+Display.swift apps/ios/Rawkoon/Views/TabBar/TabBarChrome.swift
git commit -m "feat(ios): add tab bar chrome, colours and tab symbols"
git push
```

---

### Task 5: `RawkoonTabBar` view

**Files:**
- Create: `apps/ios/Rawkoon/Views/TabBar/RawkoonTabBar.swift`
- Modify: `apps/ios/Rawkoon/Localizable.xcstrings` (append `"%@ unread"` and `"Tab bar"`)

**Interfaces:**
- Consumes: `RootTab`, `RootTab.symbol`/`selectedSymbol`/`title`, and `Theme.tabBar`/`tabPill`/`badge`.
- Produces: `struct RawkoonTabBar: View`, initialised as:
  - `tabs: [RootTab]`
  - `selection: Binding<RootTab>`
  - `isCollapsed: Bool`
  - `unreadLabel: String?`
  - `initials: String?`
  - `onExpand: () -> Void`

- [ ] **Step 1: Create the view**

```swift
import RawkoonKit
import SwiftUI

/// The floating iPhone tab bar: icon-only slots, a grey pill behind the active
/// tab, the bell's unread badge and the avatar. Collapsed, only the active tab
/// remains and a tap expands it.
struct RawkoonTabBar: View {
    let tabs: [RootTab]
    @Binding var selection: RootTab
    let isCollapsed: Bool
    let unreadLabel: String?
    let initials: String?
    let onExpand: () -> Void

    @Namespace private var pill

    var body: some View {
        HStack(spacing: 0) {
            if isCollapsed {
                slot(selection)
            } else {
                ForEach(tabs, id: \.self) { tab in
                    slot(tab)
                }
            }
        }
        .padding(5)
        .background(Capsule().fill(Theme.tabBar))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.07), lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 16, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Tab bar"))
    }

    private func slot(_ tab: RootTab) -> some View {
        let active = tab == selection
        return Button {
            if isCollapsed {
                onExpand()
            } else if !active {
                withAnimation(.spring(duration: 0.3)) { selection = tab }
            }
        } label: {
            ZStack {
                if active {
                    Capsule()
                        .fill(Theme.tabPill)
                        .matchedGeometryEffect(id: "pill", in: pill)
                }
                icon(tab, active: active)
            }
            .frame(height: 44)
            .frame(maxWidth: isCollapsed ? 44 : .infinity)
            .frame(width: isCollapsed ? 44 : nil)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(tab.title))
        .accessibilityValue(tab == .notifications ? unreadValue : Text(verbatim: ""))
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var unreadValue: Text {
        guard let unreadLabel else { return Text(verbatim: "") }
        return Text("\(unreadLabel) unread")
    }

    @ViewBuilder
    private func icon(_ tab: RootTab, active: Bool) -> some View {
        if tab == .settings {
            avatar
        } else {
            Image(systemName: active ? tab.selectedSymbol : tab.symbol)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Theme.textStrong)
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
        }
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Theme.apricot, Theme.terracotta],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
            if let initials {
                Text(verbatim: initials)
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.onAccent)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.onAccent)
            }
        }
        .frame(width: 30, height: 30)
        .overlay(alignment: .bottomTrailing) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 7, weight: .black))
                .foregroundStyle(.white)
                .frame(width: 15, height: 15)
                .background(Circle().fill(Color(hex: 0x5A504A)))
                .overlay(Circle().strokeBorder(Theme.tabBar, lineWidth: 2))
                .offset(x: 5, y: 4)
        }
    }
}
```

- [ ] **Step 2: Add the two strings to `Localizable.xcstrings`**

Append these as raw text, before the closing `}` of the `"strings"` object, adding a comma after the previous entry. Do **not** `json.load` and re-dump the catalog: that reorders about 1800 lines.

```json
    "%@ unread": {
      "extractionState": "manual",
      "localizations": {
        "fr": { "stringUnit": { "state": "translated", "value": "%@ non lues" } }
      }
    },
    "Tab bar": {
      "extractionState": "manual",
      "localizations": {
        "fr": { "stringUnit": { "state": "translated", "value": "Barre d'onglets" } }
      }
    }
```

Verify the file still parses: `python3 -c "import json;json.load(open('apps/ios/Rawkoon/Localizable.xcstrings'))"`.

- [ ] **Step 3: Push and run `GATE`**

Expected: `** BUILD SUCCEEDED **`, `l10n: ok`. If swiftformat reformats the file, sync it back.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/TabBar/RawkoonTabBar.swift apps/ios/Rawkoon/Localizable.xcstrings
git commit -m "feat(ios): add the custom floating tab bar view"
git push
```

---

### Task 6: `PhoneTabsView` — keep-alive container, inset and mini player

**Files:**
- Create: `apps/ios/Rawkoon/Views/TabBar/PhoneTabsView.swift`
- Modify: `apps/ios/Rawkoon/AppModel.swift:23` (add `userInitials` beside `userFirstName`)
- Modify: `apps/ios/Rawkoon/AppModel+Auth.swift`, in `refreshAdmin()` after the `userFirstName` line

**Interfaces:**
- Consumes:
  - `RawkoonTabBar` (Task 5), `TabBarChrome` (Task 4), `RootTab.phone` (Task 1)
  - `NotificationBadge.label(forUnread:)`
  - `MiniPlayerView(model:onExpand:)`
  - `model.unreadNotificationCount`, `model.activeBook()`
- Produces:
  - `struct PhoneTabsView<Root: View>: View`, initialised as `PhoneTabsView(selection: Binding<RootTab>, onExpandPlayer: () -> Void, root: (RootTab) -> Root)`
  - `AppModel.userInitials: String?`

- [ ] **Step 1: Add `userInitials` to `AppModel`**

In `AppModel.swift`, next to `var userFirstName: String?`:

```swift
    var userInitials: String?
```

In `AppModel+Auth.swift` `refreshAdmin()`, directly after the `userFirstName = …` line:

```swift
            userInitials = UserInitials.from(firstName: user.firstName, lastName: user.lastName, name: user.name)
```

`user.name` is `String` or `String?` depending on the DTO; both pass to a `String?` parameter.

- [ ] **Step 2: Create `PhoneTabsView.swift`**

```swift
import RawkoonKit
import SwiftUI

/// iPhone root: each tab's stack is mounted on first visit and kept alive, so
/// switching tabs keeps its navigation history and scroll position. The bar and
/// mini player live in the bottom safe-area inset, so every list clears them.
struct PhoneTabsView<Root: View>: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: RootTab
    let onExpandPlayer: () -> Void
    @ViewBuilder let root: (RootTab) -> Root

    @State private var chrome = TabBarChrome()
    @State private var visited: Set<RootTab> = []

    var body: some View {
        ZStack {
            ForEach(RootTab.phone, id: \.self) { tab in
                if visited.contains(tab) || tab == selection {
                    let shown = tab == selection
                    root(tab)
                        .opacity(shown ? 1 : 0)
                        .allowsHitTesting(shown)
                        .accessibilityHidden(!shown)
                }
            }
        }
        .environment(\.tabBarChrome, chrome)
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomChrome }
        .onAppear { visited.insert(selection) }
        .onChange(of: selection) { _, tab in
            visited.insert(tab)
            chrome.reset()
        }
    }

    private var hasActiveBook: Bool {
        model.activeBook() != nil
    }

    private var bottomChrome: some View {
        VStack(spacing: 8) {
            if hasActiveBook, !chrome.isCollapsed {
                miniPlayer
            }
            HStack(spacing: 8) {
                RawkoonTabBar(
                    tabs: RootTab.phone,
                    selection: $selection,
                    isCollapsed: chrome.isCollapsed,
                    unreadLabel: NotificationBadge.label(forUnread: model.unreadNotificationCount),
                    initials: model.userInitials,
                    onExpand: { chrome.expand() }
                )
                .fixedSize(horizontal: chrome.isCollapsed, vertical: false)
                if hasActiveBook, chrome.isCollapsed {
                    miniPlayer
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private var miniPlayer: some View {
        MiniPlayerView(model: model, onExpand: onExpandPlayer)
            .frame(height: 52)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(Theme.raised))
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 12, y: 6)
    }
}
```

- [ ] **Step 3: Push and run `GATE`**

Expected: `** BUILD SUCCEEDED **`. `PhoneTabsView` isn't referenced yet, so there's no behaviour change.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/TabBar/PhoneTabsView.swift apps/ios/Rawkoon/AppModel.swift apps/ios/Rawkoon/AppModel+Auth.swift
git commit -m "feat(ios): add the keep-alive iPhone tab container"
git push
```

---

### Task 7: Route iPhone to the custom bar; add the Explore and Notifications tabs

**Files:**
- Modify: `apps/ios/Rawkoon/RawkoonApp.swift`: `RootTabSelection` (lines ~179–190), `RootTabsView.init` (debug `RAWKOON_TAB`, ~203–215), and `mainTabs` (~258–354)
- Modify: `apps/ios/Rawkoon/Views/DiscoverView.swift:43` (`showExplore`), `:105-123` (toolbar Filter + sheet)

**Interfaces:**
- Consumes: `PhoneTabsView` (Task 6), `RootTab.validated` / `RootTab.sidebar` (Task 1).
- Produces:
  - Compact width renders `PhoneTabsView`; regular width renders the existing `TabView`.
  - `RootTabSelection` is removed.
  - `selection` becomes `RootTab`.

- [ ] **Step 1: Replace `RootTabSelection` and the selection type**

Delete the whole `enum RootTabSelection { … }` block. In `RootTabsView`, change the selection state and its init:

```swift
    @State private var selection: RootTab

    init() {
        // Home is the landing tab for everyone. Debug `RAWKOON_TAB` still wins.
        var initial = RootTab.home
        #if DEBUG
            if let raw = ProcessInfo.processInfo.environment["RAWKOON_TAB"], let value = Int(raw),
               RootTab.phone.indices.contains(value)
            {
                initial = RootTab.phone[value]
            }
        #endif
        _selection = State(initialValue: initial)
    }
```

- [ ] **Step 2: Extract the tab roots and split by width**

Replace `private var mainTabs: some View { … }` up to the `TabView`'s closing `}` and its trailing modifiers. Keep the `.alert`, `.sheet(isPresented: $showFullPlayer)` and `.task` exactly as they are today, now attached to the `Group`:

```swift
    @ViewBuilder
    private func tabRoot(_ tab: RootTab) -> some View {
        switch tab {
        case .home: NavigationStack { HomeView() }
        case .library: NavigationStack { LibraryView(forcedSection: .media) }
        case .books: NavigationStack { LibraryView(forcedSection: .books) }
        case .discover: NavigationStack { DiscoverView() }
        case .explore: NavigationStack { ExploreView(embedded: true) }
        case .notifications: NavigationStack { NotificationsListView() }
        case .settings: NavigationStack { SettingsView() }
        }
    }

    private var compact: Bool {
        hSizeClass != .regular
    }

    private var mainTabs: some View {
        // Getter validates so a tab absent at this width can't stay selected
        // mid-render; setter stores the raw pick.
        let validSelection = Binding(
            get: { RootTab.validated(selection.rawValue, compact: compact) },
            set: { selection = $0 }
        )
        return Group {
            if compact {
                PhoneTabsView(selection: validSelection, onExpandPlayer: { showFullPlayer = true }) { tab in
                    tabRoot(tab)
                }
            } else {
                sidebarTabs(validSelection)
            }
        }
        // … existing .alert("Couldn't play chapter", …), .sheet(isPresented: $showFullPlayer) { … } and .task { … } unchanged …
    }

    private func sidebarTabs(_ selection: Binding<RootTab>) -> some View {
        TabView(selection: selection) {
            Tab("Home", systemImage: "house", value: RootTab.home) { tabRoot(.home) }
                .customizationID("tab.home")
            Tab("Movies & Shows", systemImage: "film.stack", value: RootTab.library) { tabRoot(.library) }
                .customizationID("tab.library")
            Tab("Books", systemImage: "books.vertical", value: RootTab.books) { tabRoot(.books) }
                .customizationID("tab.books")
            Tab("For You", systemImage: "sparkles.rectangle.stack", value: RootTab.discover) { tabRoot(.discover) }
                .customizationID("tab.discover")
            Tab("Explore", systemImage: "square.grid.2x2", value: RootTab.explore) { tabRoot(.explore) }
                .customizationID("tab.explore")
            Tab("Settings", systemImage: "gearshape", value: RootTab.settings) { tabRoot(.settings) }
                .customizationID("tab.settings")
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewSidebarHeader { RawkoonSidebarHeader() }
        .tint(Theme.apricot)
        .miniPlayerAccessory(model: model, onExpand: { showFullPlayer = true })
    }
```

The sidebar labels are the ones today's code shows at regular width: "Movies & Shows", "For You". The phone-only labels "Media" and "Discover" now appear only as VoiceOver titles on the custom bar.

- [ ] **Step 3: Remove Discover's phone "Filter" → Explore sheet**

In `DiscoverView.swift`, delete `@State private var showExplore = false`, the whole `.toolbar { … if !isRegularWidth { ToolbarItem … showExplore = true … } }` block (or only its `if !isRegularWidth` item if the toolbar holds other items), and the `.sheet(isPresented: $showExplore) { NavigationStack { ExploreView() } }`. Explore is now a tab at every width.

Run: `grep -n "showExplore\|isRegularWidth" apps/ios/Rawkoon/Views/DiscoverView.swift`

If `isRegularWidth` has no remaining use, delete its declaration too, so no dead code is left behind.

- [ ] **Step 4: Push and run `GATE`**

Expected:
- `** BUILD SUCCEEDED **`;
- `** TEST SUCCEEDED **` (the app tests no longer reference `RootTabSelection`);
- `grep -rn "RootTabSelection" apps/ios` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Rawkoon/RawkoonApp.swift apps/ios/Rawkoon/Views/DiscoverView.swift
git commit -m "feat(ios): seven-tab custom bar on iPhone, native sidebar on iPad/Mac"
git push
```

---

### Task 8: Wire shrink-on-scroll into each tab's root list

**Files (modify):**
- `apps/ios/Rawkoon/Views/HomeView.swift:43`: the root vertical `ScrollView {`
- `apps/ios/Rawkoon/Views/LibraryView.swift:420`, `:521`, `:538`: the vertical `ScrollView {` roots. Media and Books both use `LibraryView`.
- `apps/ios/Rawkoon/Views/Discover/ExploreView.swift:138`, `:151`: the vertical `ScrollView {` roots
- `apps/ios/Rawkoon/Views/Notifications/NotificationsListView.swift:77`: `List {`
- `apps/ios/Rawkoon/Views/SettingsView.swift:27`: `Form {`

**Interfaces:**
- Consumes: `View.reportsTabBarScroll()` (Task 4).

- [ ] **Step 1: Add the modifier to each root container**

For each location above, add `.reportsTabBarScroll()` as the first modifier on the vertical container's closing brace. Example (`HomeView`):

```swift
        ScrollView {
            // … existing content …
        }
        .reportsTabBarScroll()
```

Leave the horizontal `ScrollView(.horizontal, …)` carousels alone. Discover's swipe deck has no vertical list, so it never collapses the bar. The modifier is a no-op wherever `tabBarChrome` is nil (iPad and Mac).

- [ ] **Step 2: Push and run `GATE`**

Expected: `** BUILD SUCCEEDED **`, `** TEST SUCCEEDED **`, formatting clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Rawkoon/Views/HomeView.swift apps/ios/Rawkoon/Views/LibraryView.swift apps/ios/Rawkoon/Views/Discover/ExploreView.swift apps/ios/Rawkoon/Views/Notifications/NotificationsListView.swift apps/ios/Rawkoon/Views/SettingsView.swift
git commit -m "feat(ios): shrink the tab bar as tab root lists scroll"
git push
```

---

### Task 9: Offline screenshot harness and visual review

**Files:**
- Modify: `apps/ios/Rawkoon/Views/DebugScreens.swift`: add a `tabBar` offline screen, both to `offlineView(for:)` and to the `isOffline` list

**Interfaces:**
- Consumes: `RawkoonTabBar` (Task 5).

- [ ] **Step 1: Add the offline `tabBar` screen**

In `offlineView(for:)`, add a case. Add `"tabBar"` to the `isOffline` list.

```swift
        case "tabBar":
            DebugTabBarStates()
```

And, in the same file inside `#if DEBUG`:

```swift
    /// `RAWKOON_SCREEN=tabBar`: the custom bar's states for screenshot review.
    private struct DebugTabBarStates: View {
        @State private var home = RootTab.home
        @State private var books = RootTab.books

        var body: some View {
            VStack(spacing: 28) {
                Spacer()
                RawkoonTabBar(tabs: RootTab.phone, selection: $home, isCollapsed: false,
                              unreadLabel: "3", initials: "SL", onExpand: {})
                RawkoonTabBar(tabs: RootTab.phone, selection: $books, isCollapsed: false,
                              unreadLabel: "9+", initials: nil, onExpand: {})
                HStack {
                    RawkoonTabBar(tabs: RootTab.phone, selection: $books, isCollapsed: true,
                                  unreadLabel: nil, initials: "SL", onExpand: {})
                        .fixedSize()
                    Spacer()
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .background(Theme.base)
        }
    }
```

- [ ] **Step 2: Push, run `GATE`, then take screenshots on the simulator**

```bash
ssh macbuild 'set -e; UDID=65E15DB4-E38D-496D-996B-EF7132B09FBC
  APP=/tmp/rawkoon-dd-tabbar/Build/Products/Debug-iphonesimulator/Rawkoon.app
  xcrun simctl boot $UDID 2>/dev/null || true
  xcrun simctl install $UDID "$APP"
  SIMCTL_CHILD_RAWKOON_SCREEN=tabBar xcrun simctl launch --terminate-running-process $UDID cloud.samlo.rawkoon
  sleep 6; xcrun simctl io $UDID screenshot /tmp/tabbar-states.png'
scp macbuild:/tmp/tabbar-states.png /tmp/claude-1000/tabbar-states.png
```

Read the PNG and check it:
- seven evenly spaced slots with no clipping on the iPhone 17 width;
- the grey pill behind Home and behind Books;
- the badge reading "3" and "9+", not overlapping the neighbouring slot;
- the avatar showing "SL" in one bar and a person icon in the other;
- the collapsed bar as a single 44 pt capsule.

Fix spacing issues and re-run until it is right.

- [ ] **Step 3: Take a live-app screenshot of the container (login required)**

Follow the `ios-sim-repro-recipe` memory: `SIMCTL_CHILD_RAWKOON_SERVER` / `SIMCTL_CHILD_RAWKOON_TOKEN` launch env, plus the reverse tunnel. Capture:
- the Home tab at rest;
- the Books list after scrolling down (`xcrun simctl io … screenshot` after a scripted scroll, or a manual scroll through the NoMachine/Xvfb session);
- the Notifications tab.

Confirm three things: the last list row clears the bar; switching tabs keeps each tab's scroll position; the mini player sits above the expanded bar, and beside it when collapsed, while a book is loaded.

- [ ] **Step 4: Commit and show the screenshots to the user**

```bash
git add apps/ios/Rawkoon/Views/DebugScreens.swift
git commit -m "test(ios): offline screenshot screen for the custom tab bar"
git push
```

Present the screenshots to the user through glim before any device install. The device check (scroll feel, pill spring) needs the phone on home Wi-Fi. Follow the `rawkoon-ios-device-install` memory; never cut a release to test.
