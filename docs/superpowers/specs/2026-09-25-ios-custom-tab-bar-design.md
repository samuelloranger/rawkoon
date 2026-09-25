# iOS custom tab bar — design

Date: 2026-09-25 · Status: approved in chat, pending spec review

## Goal

Replace the native iPhone tab bar with a custom floating bar modelled on
Facebook's iOS bar. The reason is capacity: Apple's bar shows at most five tabs
on iPhone and turns the rest into "More", and the app needs seven. Success means
seven icon-only tabs that stay usable one-handed, keep each tab's navigation
state, and keep the shrink-on-scroll behaviour and the audiobook mini player the
native bar gives today.

## Scope

- **iPhone (compact width) only.** iPad and Mac keep the native
  `TabView(.sidebarAdaptable)` sidebar unchanged.
- Out of scope: tab reordering, a real profile photo, any web change.

## Tabs

Seven slots, left to right, icon-only:

| Slot | Destination | Icon |
|---|---|---|
| Home | `HomeView` | `house` / `house.fill` |
| Media | `LibraryView(forcedSection: .media)` | `film.stack` / filled |
| Books | `LibraryView(forcedSection: .books)` | `books.vertical` / filled |
| Discover | `DiscoverView` | `sparkles.rectangle.stack` / filled |
| Explore | `ExploreView(embedded: true)` (new on phone; replaces the sheet opened from Discover) | `square.grid.2x2` / filled |
| Notifications | `NotificationsListView` (Home's bell entry stays) | `bell` / `bell.fill` + unread badge |
| Avatar | `SettingsView` | initials circle + small `≡` badge |

Each tab keeps its own `NavigationStack`, as today.

## Appearance

- A floating dark capsule, 16 pt from the screen edges, above the home indicator.
- Icons are white. A grey pill slides behind the active icon with a spring animation, and the active icon shows filled.
- The notification badge is a red capsule on the bell showing the unread count, capped at "9+".
- The avatar shows the signed-in user's initials, from first and last name.
- VoiceOver reads each slot as a tab ("Home, tab, 1 of 7, selected"), and the badge count is spoken.

## Architecture

- **Container.** Keep `TabView(selection:)` as the container, so each tab keeps its navigation stack and scroll position natively. On compact width, hide the system bar and overlay the custom bar. On regular width nothing changes.
- **Bar component.** The custom bar is a view that takes the selection binding, the tab descriptors, the badge count, the user's initials and the collapsed state. It holds no model state of its own.
- **Content padding.** Tab content gets a bottom safe-area inset equal to the bar's height, so the last row of any list clears it. The inset follows the bar's current height, expanded or shrunk.
- **Hiding on pushed screens.** A `.rawkoonTabBarHidden()` modifier, carried by a preference key, hides the bar on pushed screens that need the full height. It replaces today's `.toolbar(.hidden, for: .tabBar)` in `MediaDetailView` and any other callers.

## Shrink on scroll

- **Collapsing.** Scrolling down collapses the bar to a small capsule at the bottom left that shows only the active icon.
- **Expanding.** Scrolling up, reaching the top of the list, or tapping the capsule expands it.
- **Scroll source.** Each tab's primary scroll view reports scroll offset and direction through a modifier built on `onScrollGeometryChange` (iOS 18).
- **Decision logic.** The expand/collapse decision is a pure RawkoonKit function: direction, distance threshold, and at-top. It is unit-tested on Linux.

## Mini player

- **Container.** `MiniPlayerView` is reused unchanged; only its container moves from `tabViewBottomAccessory` to the custom bar layer on compact width.
- **Position.** With the bar expanded, the mini player is a full-width capsule directly above it. With the bar shrunk, it sits beside the collapsed capsule on the same row.
- **Dependencies.** Model dependencies are passed explicitly, as today.
- **Regular width.** iPad and Mac keep `tabViewBottomAccessory`.

## Testing

- **Kit (Linux and macbuild):**
  - the shrink/expand decision table;
  - the badge label (0, 1–9, "9+");
  - initials from first and last name, including missing names;
  - the tab descriptor order and the selection validation, with `explore` now valid on compact width.
- **macbuild:** app build, the four CI lint steps, and simulator screenshots of each state for review before any device install: expanded, shrunk, shrunk with the mini player, a pushed screen with the bar hidden, and a notification badge.
- **Device (operator):** how the scroll collapse and the pill animation feel, which neither CI nor the simulator can judge.

## Risks

- **Width.** Seven slots on the smallest current iPhone (375 pt) leave about 49 pt each. The icons stay at 26–28 pt, and the hit targets stay 44 pt or more.
- **Scroll wiring.** Every tab root needs the scroll-reporting modifier. A tab without it simply never collapses, which is safe.
- **Deep links.** Deep links and debug tab selection (`RAWKOON_TAB`) must map onto the seven tags.
