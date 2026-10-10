# iOS expressive motion pass

## Decision

Take the iOS app from "correct native motion" to **expressive native motion**:
every state change, list, number, and success moment animates, at the level of
Apple's own apps, without ever slowing the user down. The 2026-09-14 native
motion spec delivered the foundation (zoom transitions, haptics map, numeric
time labels, symbol replace, scroll settle). This pass builds a reusable motion
kit on top of it, wires the kit into the shared components, then sweeps every
surface and gives each one a signature moment.

Not in scope: particles, confetti, 3D tilt, ambient looping backgrounds, any
third-party animation dependency, navigation restructuring, or any behavior
change. The deployment floor is iOS 26.2, so every SwiftUI motion API through
iOS 26 is available (`PhaseAnimator`, `KeyframeAnimator`, `scrollTransition`,
`visualEffect`, `onScrollGeometryChange`, symbol effects, glass morphing).

## Current state (why)

- 66 tappable cards and rows use `.buttonStyle(.plain)` and give no press
  feedback; only two custom button styles exist, with one call site each.
- 152 `ForEach` lists and rails, none with entrance, insert, or remove motion;
  `rawkoonScrollSettle` is used in four places.
- `DuskProgress` and every percentage, speed, count, and size outside the
  player snap to new values.
- Detail and book heroes are a fixed height with no stretch or parallax.
- Grab, add, request, and sign-in success have no visual moment; a grab from
  release search has no haptic either.
- Skeleton → content swaps are hard cuts on most screens (Detail, Explore,
  Search, Book discovery, Notifications, Requests, Ebook reader).
- Two declared transitions never play: the root banner (its animation modifier
  sits inside the `if`, and the coordinator sets it without animation) and the
  mini player (nothing animates `hasActiveBook`).
- Seven animations ignore Reduce Motion (ebook reader controls, two in
  `BookView`, the detail tab switch, two in the tab bar, the linear progress
  fills in `Components`).
- Haptics bypass `RawkoonHaptics` in four places (`SwipeDeck`, `OfflineStrip`,
  `AppModel.toast`, `BookView`), and its `.downloadComplete` event is unused.
- Zoom helpers are used for books and the player only; Home, Library, and
  search use a local namespace, and Explore, Similar, Watchlist, Requests, and
  deck taps have no zoom.

## The motion kit (`Rawkoon/Motion/`)

Every piece reads `accessibilityReduceMotion` itself, so a call site can never
forget it. All timing derives from the existing `RawkoonMotion` tokens.

| Piece | Behavior | Reduce Motion |
|---|---|---|
| `PressableStyle` (`ButtonStyle`) | Scale to ~0.96 and dim slightly while pressed, `snappy` spring back | Dim only |
| `.rawkoonEntrance(index:)` | Fade + 12pt rise on first appearance; delay grows with `index`, capped at 8 items (~0.3s total) | Plain fade |
| `.rawkoonSwap` (`AnyTransition`) | Opacity + slight scale + blur crossfade for skeleton → content and state switches | Opacity only |
| `.rawkoonReveal` (`AnyTransition`) | Spring slide + fade from the top edge for banners, errors, expanding sections | Opacity only |
| `.rawkoonNumeric(_ value:)` | `contentTransition(.numericText(value:))` plus the animation that drives it | Opacity |
| `Celebration` | `KeyframeAnimator` ring pulse + symbol bounce + success haptic, fired by a trigger value | Haptic + static check |
| `.rawkoonStretchyHero(height:)` | Pull-down stretches the hero; scrolling up parallaxes it at half speed and fades it | Static |
| `.rawkoonLivingSymbol(_ kind:)` | Empty-state symbols breathe; error-state symbols wiggle once on appear | Static |

Rules baked into the kit:

- **Entrance plays once per identity.** A lazy stack re-creating a cell on
  scroll-back does not replay it. The kit tracks "already entered" ids in a
  small environment-scoped set owned by the list's container.
- **The stagger delay is a pure function** (`index → delay`, clamped), so it is
  unit-testable.
- **No animation delays input.** Taps and navigation fire immediately; motion
  runs alongside.
- **Durations stay at or under ~0.45s.** Repeating animations run only while
  their subject is active (a download in progress, the lamp while searching).

`RawkoonHaptics` gains an `.error` event and becomes the only source of
haptics: the four direct UIKit call sites move onto it.

## PR 1: kit + shared components + fixes

- Add the kit pieces above with unit tests for the pure parts.
- Wire into shared components:
  - `BookCover` and `MediaPosterCard`: `PressableStyle`.
  - `DuskProgress`: spring-animated fill; a moving sheen when the caller passes
    `isActive: true` (an in-progress download), off by default.
  - `StatusBadge` and `DownloadStateIcon`: `rawkoonSwap` between states,
    symbol bounce on change.
  - A shared empty/error state wrapper over `ContentUnavailableView` that
    applies `rawkoonLivingSymbol`.
  - `SpineRow`, `BookRow`, `BookGridCard`: numeric progress percentage.
- Gate the seven ungated animations behind `rawkoonMotion`.
- Fix the root banner and mini-player transitions so they actually play.
- Move the direct haptic call sites onto `RawkoonHaptics`.
- Add a SwiftLint custom rule (warning) that flags `.animation(` and
  `withAnimation` outside `Rawkoon/Motion/`. Existing call sites that remain
  legitimate (the swipe deck's fling system) get an inline disable with a
  one-line reason.

## PR 2: Home, Library, Discover

- **Home:** rails cascade with `rawkoonEntrance`; Continue Listening and
  Listening Stats cards enter with `rawkoonSwap` instead of growing from zero
  size; stat figures and the "now watching" percentage roll. **Signature: the
  notification bell dot pulses and bounces when a notification arrives.**
- **Library:** section picker and media/books toolbar swap with `rawkoonSwap`;
  the offline banner uses `rawkoonReveal`; the books grid cascades; media badge
  and busy-state swaps animate; Watchlist removals animate out.
- **Discover:** deck shimmer → deck → empty animate with `rawkoonSwap`.
  **Signature: the deck deals its cards up from the bottom, staggered, on
  load.** Explore filter chips morph selection inside a
  `GlassEffectContainer`; the result count rolls; the refresh error banner
  reveals; book discovery Add → Added fires `Celebration`.
- **Zoom:** Explore, Similar, Watchlist, Requests, and deck taps zoom into
  detail; Home, Library, and search move from local namespaces onto the shared
  `rawkoonZoomSource` / `rawkoonZoomDestination` helpers.

## PR 3: Detail, Release search, Activity

- **Detail:** skeleton → content and the Similar grid use `rawkoonSwap`; the
  tab switch slides in the direction of the tapped tab; the primary action →
  "We'll notify you" swap animates; the watchlist bookmark bounces and fills;
  the season chevron rotates and the season body reveals; the `x/y` episode
  count, download percentage, and speed roll. **Signature: the hero stretches
  and parallaxes, and the title and action row cascade in after the zoom
  lands.** Applies to `DetailHero` and `BookHero`.
- **Release search:** rows cascade; admin note, warnings, and errors reveal;
  season chips and the filter count badge animate; the AI-pick banner morphs
  between states. **Signature: a successful grab fires `Celebration` on its
  row with a success haptic** (today it has neither).
- **Activity:** lane switch slides; the speed header reveals; queue
  percentage, speed, and ETA roll; a completed item gets a check burst.

## PR 4: Player, Books, Login, Settings, the rest

- **Player:** chapter title, playback rate, and sleep timer roll or slide;
  skip ±30 arrows spin with a symbol effect. **Signature: the artwork shrinks
  slightly on pause and springs back on play.**
- **Books:** lane switch, player-loading swap, and chapter list cascade;
  download complete fires `Celebration` via `RawkoonHaptics.downloadComplete`;
  ebook file row button states swap smoothly.
- **Ebook reader:** opening → failed → ready use `rawkoonSwap`; the reading
  percentage rolls.
- **Login:** the logo and form enter in sequence. **Signature: an error shakes
  the form with an error haptic; success fires `Celebration`, then the root
  crossfades from Login into the tabs.**
- **Settings:** the test-connection result reveals with a success or error
  haptic; multi-select checkmarks animate.
- **Notifications and Requests:** loading → list uses `rawkoonSwap`; unread
  dots animate; approved or denied rows animate out.
- **Tab bar:** the unread badge bounces when its count changes.

## Error handling and edge cases

- Reduce Motion on: movement becomes crossfade; celebrations become haptic plus
  a static checkmark; heroes stay static; nothing loops.
- A view hosted without the zoom namespace (previews, widgets) renders without
  zoom; the helpers already no-op.
- Rapid repeated triggers (double grab, fast lane switching) restart or
  coalesce the animation; they never queue up.
- Lists that reload in place (pull to refresh) do not replay entrance for items
  that were already on screen; new items enter.
- Low Power Mode does not change behavior; durations are short enough that it
  does not need to.

## Testing and verification

- **Unit:** stagger delay function (monotonic, clamped), entrance "once per
  id" bookkeeping, `RawkoonHaptics` mapping including `.error`.
- **Build gate (per PR):** the app and widget build on macbuild; RawkoonKit and
  app-target tests pass. A Linux run builds RawkoonKit only and does not count.
- **Visual (per PR):** simulator screen recordings of each touched screen,
  before and after, collected on one review page; Reduce Motion spot-checked
  on the same screens.
- **Device (per PR):** installed directly on a physical iPhone for a hands-on
  check. No TestFlight build is cut to test.

## Delivery

Four stacked PRs (kit → Home/Library/Discover → Detail/Release
search/Activity → Player/Books/Login/Settings), each with one independent
review. PR 1 lands the shared pieces every later PR uses, so later PRs only
apply them. No PR merges or releases without explicit approval.

## Acceptance

- Every card and row in the app has press feedback.
- Every list, grid, and rail enters with a capped stagger, once per item.
- Every skeleton → content swap and state switch crossfades instead of cutting.
- Every percentage, speed, count, and size in the app rolls when it changes.
- Grab, add, request, download complete, and sign-in each have a visible
  celebration and a haptic.
- Detail and book heroes stretch and parallax.
- Each surface's signature moment above is present.
- Reduce Motion removes all movement; nothing loops while idle.
- The SwiftLint rule reports no ungated `.animation` / `withAnimation` outside
  `Motion/` (other than documented exceptions).
- No new dependency, no behavior change, no navigation restructuring.
