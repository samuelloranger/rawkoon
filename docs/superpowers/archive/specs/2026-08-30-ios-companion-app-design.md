> Shipped in #48.

# Rawkoon iOS Companion — Design & Build Spec

**Date:** 2026-08-30
**Status:** approved (design deck reviewed in Tether)
**Branch:** `feat/audiobook-player`

## What it is

One native SwiftUI app for the whole Rawkoon instance — not just an audiobook
player. It is the phone front-end for a self-hosted Radarr/Sonarr/Overseerr
replacement.

### Two lanes, one app

The app treats Rawkoon's two media kinds honestly instead of pretending they
are the same:

- **Manage lane — movies & TV.** Discover via TMDB → request → pick a release
  from an indexer → watch qBittorrent pull it in. The app does **not** play
  video; Rawkoon imports to the library and the user watches in Jellyfin/Plex.
  The phone is the remote for the pipeline.
- **Listen lane — audiobooks.** The one thing the app plays itself. Chapters
  download for real offline on any connection; position syncs to the server;
  Now Playing is the signature screen. This is the piece a browser PWA cannot
  do reliably (background audio, real offline files). **Shipped.**

## Design system — "Cozy Dusk"

Palette and typography mirror `apps/web/src/index.css` so web and native read
as one product. Dark-only by design. Implemented in
`apps/ios/Rawkoon/Theme.swift`.

| Token | Hex | Role |
|---|---|---|
| base | #1C1715 | app background |
| raised | #241E1B | cards, rows, sheets |
| inset | #171311 | fields |
| well | #141010 | grooves & tracks |
| border / borderStrong | #322A25 / #3A2F27 | strokes |
| apricot | #E8A06A | primary · play · active |
| terracotta | #CF6A4E | pressed · progress start |
| seed | #86B98A | in library · seeders |
| importing | #8FB6D6 | importing / renaming |
| textStrong / text / muted / faint | #F4ECE4 / #E3D8CF / #AA9A8C / #9D8775 | text ramp |
| onAccent | #2A1A10 | ink on apricot |

**Type:** Fraunces (bundled variable TTF) for titles/headers only, via
`Font.display(_:weight:)` (falls back to system serif); SF Pro for all
controls; DM Mono / `.monospaced` for data (sizes, speeds, seeders, times, %).

**Principle:** native structure, rawkoon skin. iOS 26 Liquid Glass is a
material, not a color — recompiled on Xcode 26 the bars adopt glass for free;
we tint them apricot. Keep TabView / NavigationStack / sheets / swipe actions /
Dynamic Type. Spend boldness on the warm ground, the serif, and Now Playing.
Semantic color (green present, blue importing) is separate from the accent.

**Shared components** (`Views/Components.swift`): `BookCover` (spine edge),
`StatusBadge` (mono semantic pill), `DuskProgress` (terracotta→apricot bar),
`SpineRow` (chapter spine rail).

## Information architecture

Four tabs + a Liquid-Glass audio mini-player riding above the tab bar on every
tab (tap to expand to Now Playing):

1. **Discover** — TMDB browse + search across movies / TV / books; poster grid;
   green check = in library, `+` = request.
2. **Library** — everything in the instance; books open the offline player,
   movies/shows open the manage detail.
3. **Activity** — live download queue (state, progress, ↓ speed, seeders, ETA);
   History + Calendar behind a segmented control.
4. **Settings** — server, downloads, log out; later admin controls.

## Screens

- **Discover** — search field, segmented Movies/TV/Books/All, trending poster
  grid (2:3), in-library flag.
- **Media detail (movie/show)** — backdrop hero fading into dusk ground, TMDB
  overview, status pill, per-season status + monitor toggles, "Search releases".
- **Release grab sheet** — indexer releases sorted by seeders: quality chip,
  size, seeder count (green), indexer, age → Grab hands to download client.
- **Activity queue** — qBittorrent-backed rows: state pill
  (Downloading/Importing/Seeding), DuskProgress, DM Mono speed/seeders/ETA.
- **Book detail** (shipped, themed) — resume/download buttons, chapter spine rail.
- **Now Playing** (shipped, themed) — dusk-glow ground, apricot play, mono
  scrubber times, speed menu; sleep timer to come.

## Build order (roadmap)

0. Offline audiobook player — **shipped**.
1. Design-system pass — **shipped** (Theme + repaint 5 screens).
2. Sleep timer; persistent glass mini-player.
3. Discover & request.
4. Media detail & manual grab.
5. Activity queue.
6. Push notifications (APNs) — device-token endpoint + APNs channel on the
   existing server notification pipeline.
7. Lock Screen / widgets / Live Activities / CarPlay.
8. Full admin controls (indexers, quality profiles, users).

Everything reuses the REST API the web app already speaks
(`apps/api/src/routes`: medias · search · requests · downloadClient · books).

## Constraints

- Target iOS 18, iPhone-only, portrait, dark-only.
- Swift 5 language mode, SwiftUI, no third-party UI deps.
- Pure logic testable on Linux goes in `RawkoonKit` (SwiftPM, Foundation-only).
- iOS UI cannot be compiled locally — the CI `build` job (macos-26) is the
  verifier; push to `feat/audiobook-player` triggers it.
- API models: exact field names come from `apps/shared/src/types` and the route
  handlers (see the extracted contract). Shared types are the contract — match
  them, don't invent.
