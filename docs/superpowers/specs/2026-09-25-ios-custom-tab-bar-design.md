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

- **iPhone container.** A keep-alive `ZStack` of seven `NavigationStack`s. Each is mounted on first visit and stays mounted, so a tab switch keeps its navigation history and scroll position.
  - This replaces the first draft, which kept `TabView` with its bar hidden. The codebase already records `.toolbar(.hidden, for: .tabBar)` as unreliable across iOS versions, and a bar reappearing on a pushed screen would stack two bars.
- **iPad and Mac:** unchanged `TabView(.sidebarAdaptable)`.
- **Bar component.** The custom bar is a view that takes the selection binding, the tab descriptors, the badge count, the user's initials and the collapsed state. It holds no model state.
- **Content padding.** The bar and mini player live in the container's bottom `safeAreaInset`, so every list clears them and the inset tracks the expanded or shrunk height.
- **No hiding modifier.** No screen hides the tab bar today (the one reference is a comment explaining why `MediaDetailView` does not), so the planned `.rawkoonTabBarHidden()` modifier is dropped.

## Shrink on scroll

- **Collapsing.** Scrolling down collapses the bar to a small capsule at the bottom left that shows only the active icon.
- **Expanding.** Scrolling up, reaching the top of the list, or tapping the capsule expands it.
- **Scroll source.** Each tab's primary scroll view reports scroll offset and direction through a modifier built on `onScrollGeometryChange` (the deployment target is iOS 26.2).
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
- **macbuild:** app build, the four CI lint steps, and simulator screenshots of each state for review before any device install: expanded, shrunk, shrunk with the mini player, and a notification badge.
- **Device (operator):** how the scroll collapse and the pill animation feel, which neither CI nor the simulator can judge.

## Risks

- **Width.** Seven slots on the smallest current iPhone (375 pt) leave about 49 pt each. The icons stay at 26–28 pt, and the hit targets stay 44 pt or more.
- **Scroll wiring.** Every tab root needs the scroll-reporting modifier. A tab without it simply never collapses, which is safe.
- **Deep links.** Deep links and debug tab selection (`RAWKOON_TAB`) must map onto the seven tags.
