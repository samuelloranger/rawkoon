# iOS 27 native motion & transitions

## Decision

Make Rawkoon read as a native iOS 27 app by anchoring its existing screens to
the system's zoom-transition, sheet, haptic, and content-transition APIs — all
first-party SwiftUI, all unlocked by the iOS 27 deployment floor. This is a
polish pass over existing views, not new surfaces and not a navigation rewrite.
Every motion routes through the existing `RawkoonMotion` tokens and the
`rawkoonMotion(_:value:)` modifier, so it stays Reduce-Motion safe by
construction.

The three new home-screen surfaces (Control Center resume, Continue-listening
widget, interactive grab notification) are a **separate** spec — different
territory (app extensions, entitlements) — and are not covered here.

## Scope

In scope, seven pieces:

1. **Poster/cover → detail zoom.** Any grid or row `BookCover` is the zoom
   source — movie and TV posters in Discover and Library, and audiobook/ebook
   covers — and `MediaDetailView` is the shared zoom destination. `BookCover` is
   already the one component behind every poster and cover, so a single anchor
   covers all media types.
2. **Mini-player → full-player morph.** The mini bar's cover morphs up into the
   full player.
3. **Full-player sheet detents.** `[.medium, .large]` instead of `.large` only.
4. **Haptics.** A `RawkoonHaptics` helper over `.sensoryFeedback`, wired to
   play/pause, chapter skip, grab, and download-complete. Advances board #966.
5. **Numeric text transitions.** `.contentTransition(.numericText())` on the
   player's elapsed/remaining time labels.
6. **Symbol replace transitions.** `.contentTransition(.symbolEffect(.replace))`
   on the play↔pause glyphs in `PlayerView` and `MiniPlayerView`.
7. **Scroll transitions.** A subtle fade/scale as library and discover rows
   scroll into view.

Out of scope: a custom transition engine, any third-party animation dependency,
restructuring navigation (`NavigationStack`/`navigationDestination` stay as-is),
and the home-screen surfaces spec.

## Architecture

**One app-level zoom namespace.** A single `@Namespace` is injected through the
environment (a `NamespaceID` value). `BookCover` reads it and, when given a
stable identity, anchors itself with `.matchedTransitionSource(id:in:)`. This is
the only approach that lets the mini→full morph and the cover→detail zoom share
one continuous cover identity, and it keeps per-call-site wiring to a single
optional identity argument.

- **Zoom identity** is the media identity already in the model, keyed by kind so
  the id spaces never collide: the audiobook edition id where a player is
  involved (mini/full share it), and the library/discover item id (book or
  movie/TV) for a poster/cover into detail. The keying is a pure function
  (kind-prefixed), so it is unit-testable and collision-free across audiobook,
  book, and movie/TV ids.
- **`BookCover`** gains an optional `zoomID` argument. When present and a
  namespace is in the environment, it applies `.matchedTransitionSource`;
  otherwise it renders exactly as today. Existing call sites that pass nothing
  are unchanged.
- **Destinations** apply `.navigationTransition(.zoom(sourceID:in:))`
  (`MediaDetailView`) and the equivalent zoom presentation for the full player.
  The full player moves from a plain `.sheet(isPresented:)` to a
  zoom-sourced presentation anchored on the mini bar's cover, keeping its
  existing content and dismissal.
- **`RawkoonHaptics`** is a small enum mapping app events to
  `SensoryFeedback` values; views attach `.sensoryFeedback(trigger:)`. The
  event→feedback mapping is pure and unit-tested.

## Components and data flow

- `RawkoonMotion.swift` — unchanged tokens; every new animation uses them.
- `BookCover` (Components) — gains `zoomID`; self-anchors when a namespace is
  present. No behavior change when `zoomID` is nil.
- `RawkoonApp` — owns the app-level `@Namespace`, injects it into the
  environment; full-player presentation becomes zoom-sourced.
- `MediaDetailView` (shared movie/TV/book detail), `PlayerView`,
  `MiniPlayerView`, `LibraryView`, `DiscoverView`, `LibraryMediaRow`, and the
  poster/row components — apply the relevant modifier at their one
  anchor/destination point.
- `RawkoonHaptics` (new, small) — event→`SensoryFeedback` mapping.

## Error handling and edge cases

- No namespace in the environment (previews, isolated hosting) → `BookCover`
  renders without a transition source; nothing traps.
- Reduce Motion on → `rawkoonMotion` already substitutes a crossfade; zoom
  presentations fall back to the system's reduced behavior.
- A missing/failed cover image still anchors (the frame is the source), so a
  slow image never breaks the morph.
- Mixed navigation (`NavigationLink` + `navigationDestination`) both accept the
  zoom transition on the destination; no navigation restructuring.

## Testing

- **Unit (RawkoonKit or app target):** the zoom-identity keying function
  (stable per id, no collision across edition/book id spaces) and the
  `RawkoonHaptics` event→feedback mapping.
- **Simulator (iOS 27):** every touched screen builds and the app-target suite
  stays green.
- **Device (iOS 27):** the zoom morphs, detents, haptics, and content
  transitions are verified by eye and touch; motion is view-layer and cannot be
  asserted in a unit test.

## Acceptance

- Tapping any library/discover poster or cover — movie, TV show, audiobook, or
  ebook — zooms into its detail; back reverses it.
- The mini player morphs into the full player (cover continuous), and the full
  player is draggable between medium and large detents.
- Play/pause, chapter skip, grab, and download-complete produce haptic feedback.
- Player time labels roll with numericText; play↔pause glyphs morph.
- Library/discover rows settle in on scroll.
- All motion is absent/replaced under Reduce Motion, and no screen regresses
  when a cover has no `zoomID`.
- No new third-party dependency; navigation structure unchanged.

## Evidence

- [Zoom navigation transitions](https://developer.apple.com/documentation/swiftui/navigationtransition): `.navigationTransition(.zoom(sourceID:in:))` + `.matchedTransitionSource(id:in:)`.
- [SensoryFeedback](https://developer.apple.com/documentation/swiftui/sensoryfeedback): `.sensoryFeedback(_:trigger:)`.
- [contentTransition](https://developer.apple.com/documentation/swiftui/contenttransition): `.numericText()` and `.symbolEffect(.replace)`.
- [presentationDetents](https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:)): resizable sheets.
- Board #966: haptics backlog item advanced by piece 4.
