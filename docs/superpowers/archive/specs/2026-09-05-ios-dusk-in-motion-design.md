> Shipped in #96/#97.

# Rawkoon iOS — "Dusk in Motion" redesign (design spec)

**Date:** 2026-09-05
**Status:** approved (direction B), all decisions resolved — ready for implementation plan
**Scope target:** `apps/ios` (SwiftUI). Web (`apps/web`) is the quality benchmark, not a port source.
**Board:** task #1057.

## 1. Why

The product owner's lived judgment: the iOS app feels worse than the web app — **not intuitive, not clean, feels slow, not animated/not polished**. Notably *not* "not useful enough" — this is a polish/IA/motion problem, not a feature-parity request. A web↔iOS gap map confirmed the root causes are **information density, information architecture, perceived speed, and near-total absence of motion**, concentrated on four screens the owner named.

The Cozy Dusk design system is already real and enforced in code (`Theme.swift`, the One Lamp Rule, DuskProgress, BookCover). This redesign does **not** replace that identity — it makes it *move*, *denser*, and *faster* on the named screens.

The clean-code milestone's behavior freeze (`apps/ios/.claude/CLAUDE.md`) is **explicitly overridden** by the owner for this work; visible layout/wording change is in scope.

## 2. Goals / non-goals

**Goals**
- One cohesive pass ("one big redesign") landing a unified feel across the four named screens + a notification badge.
- A single reusable **motion language** ("The Lamp") and a **perceived-speed layer**, both shared primitives, not per-screen bolt-ons.
- Close the intuitiveness/density gaps that make iOS feel thinner than web, using **native equivalents** (swipe deck, interactive `List`, filter sheets), never literal web-table ports.

**Non-goals (explicitly out — this is direction B, not C)**
- New top-level surfaces present on web but absent on iOS: Calendar month-grid, Watchlist, Collections, Authors monitoring, global command palette, downloads-import staging, library stats panel. These are a **follow-up milestone**, not this one.
- Any change to audiobook playback, Now Playing internals, offline library, CarPlay, background audio, push deep-linking — iOS is *better* than web here; do not regress. Motion may *enhance* Now Playing (breathing lamp) but must not alter playback behavior or on-device state.
- No migration of on-device state (position journal, Keychain, downloaded library must survive).
- No release. Releases remain human-only (`.claude/CLAUDE.md`, memory `rawkoon-release-is-human-only`); auto-deploys prod.

## 3. Design principles

1. **Keep the room, move the lamp.** Cozy Dusk tokens (`Theme.swift`) and the One Lamp Rule are preserved. Apricot stays rare; motion, not new color, carries the polish.
2. **Native shell, always.** 4-tab TabView + NavigationStack + sheets. No custom nav, no web layouts transplanted. Web patterns become native idioms.
3. **One motion model.** All animation derives from the same physical metaphor and spring constants (§4). Consistency is what reads as "polished."
4. **Perceived speed is polish.** Optimistic UI + warm skeletons + prefetch + killing the known perf bugs (§5) address "feels slow" more than raw optimization.
5. **Density through native components.** `List` rows with secondary text, visible filter chips with counts, collapsible headers — not desktop tables.
6. **Accessibility is not optional in a motion redesign** (§8): every animation gates on Reduce Motion; Dynamic Type must not clip; contrast fixed.

## 4. The "Lamp" motion system (shared primitive)

A new `RawkoonMotion` layer (spring constants, durations, and view modifiers) in one file, consumed everywhere. All effects **crossfade or disable** under `@Environment(\.accessibilityReduceMotion)`.

- **Breathing lamp.** The apricot Play glow (`PlayerView`, `MiniPlayerView`) pulses subtly while playing, settles when paused. Currently static.
- **Matched geometry.** Cover art is one continuous object across library row → mini-player → Now Playing (`matchedGeometryEffect` / zoom transition). Currently a hard sheet present.
- **Springy collections.** List/grid insert, remove, and reorder use one shared spring; grabs and completions land with a bounce.
- **Warm skeletons.** A `ShimmerView` (apricot shimmer over `surface-well`) replaces blank waits and spinners. Never gray.
- **Live DuskProgress.** Existing terracotta→apricot fills animate their value changes instead of snapping.
- **Haptics.** `UIImpactFeedbackGenerator` on grab/complete/destructive-confirm, paired with optimistic UI so the tap confirms before the network.

**Files:** new `Rawkoon/Motion/RawkoonMotion.swift`, new `Rawkoon/Views/Components/ShimmerView.swift`; consumed by all four screens + `Components.swift`.

## 5. Perceived-speed layer

- **Kill the Activity N+1 (client-side).** `ActivityView.swift:206-225` does a serial per-media `downloads()` fetch; no batch endpoint exists (`libraryFilesRoutes.ts:72` is per-media). **Decision: client-side concurrent fetch + cache** (no API change) — fire the per-media requests concurrently with a task group and coalesce. This is the concrete "feels slow" cause.
- **Infinite scroll.** Replace the manual "Load more" button (`LibraryView.swift:394-408`) with virtualized on-appear paging; same pattern for Activity history and Explore results.
- **Optimistic actions.** Grab / monitor / approve / dismiss update the UI immediately (with rollback + toast on failure), rather than spinner-then-refetch.
- **Prefetch.** Discover deck prefetches the next N cards; detail prefetches on row appearance.
- **Skeletons over blank.** Every list/detail shows shimmer placeholders on first load and during refetch, keyed to the eventual layout.

## 6. Per-screen designs

### 6.0 Navigation shell / IA (`RawkoonApp.swift`)
**Decision: tab bar + a dedicated Search tab. No sidebar (iPhone-only, `TARGETED_DEVICE_FAMILY: 1`).**
- Adopt the modern iOS 26 `Tab` API with **`.tabViewStyle(.sidebarAdaptable)`** — renders as a tab bar on iPhone today; if iPad is ever enabled it becomes a sidebar for free, no rework.
- Tabs: **Discover · Library · Activity · Settings** (household); admins also keep **Home** (dashboard) as a 5th tab. **No Search tab** — abandoned 2026-09-05 (owner ruling): a `Tab(role: .search)` pushed the admin bar to 6 tabs and iOS buried it in the "More" overflow, defeating its purpose. Buried surfaces (Requests/Explore/Watchlist) stay reachable via in-screen navigation, not a global search entry point.
- **Mini-player → `tabViewBottomAccessory`** (native iOS 26 slot above the bar), retiring the hand-rolled `MiniPlayerInset` in `RawkoonApp.swift:294-306`; it cooperates with tab-bar-minimize-on-scroll and Liquid Glass.
- Admin-vs-household tab divergence (`RawkoonApp.swift:204,285-287`) is preserved (admins get Home; households default to Library).
- **Liquid Glass is the default and non-disableable** — the dark-only warm theme must be verified against it (apricot tint, legibility over blurred content). This is a real test surface, not a given.

### 6.1 Discover (`DiscoverView.swift`)
- **Swipe-triage deck** as the primary mode: one card at a time, poster + "why this pick" label, actions add / watchlist / dismiss, with undo. Keyboard/gesture native. Prefetch + infinite supply.
- **Explore mode** behind a toolbar Filter button → native filter **sheet**: provider picker, genre picker, sort, original-language toggle, result count; results in a paginated/infinite grid. This is web's `/explore` as a native sheet, not an inline toolbar.
- Kind filter (movie/TV/book) promoted out of search-only into a persistent scope.
- Unified search stays (iOS already does this well); add "already owned → open my copy."
- **Native mapping note:** the swipe deck is a mobile-origin pattern — build it as the real Discover tab; the current rails feed is retired or folded into Explore.

### 6.2 Title / Book detail (`MediaDetailView.swift`, `BookView.swift`)
- **Merge Info + Management into one scroll.** Hero: cover (matched-geometry source), title (Fraunces), ratings (TMDB ★ + Rotten Tomatoes), genres, year/runtime, trailer button, provider/where-to-watch rail, external links, key facts as `LabeledContent`.
- **One interactive season/episode `List`.** Per-season and per-episode actions via **swipe actions + context menu**: interactive/auto search (grab), monitor toggle, retry-skipped, delete file. **Grabbing a missing episode must be possible here** — today it is possible nowhere (`MediaDetailView.swift:1437-1485`, 696-736).
- Per-season DuskProgress ("8/10 grabbed").
- Cast rail (horizontal), providers rail.
- Books: same treatment on `BookView` — edition ledger, per-edition quality profile + monitored, acquisition-track stepper; preserve the superior audiobook/offline surfaces untouched.
- **Non-admin book request — DEFERRED (scope decision, see Q3).** The critique flagged that non-admins dead-end on book search. But the request system only accepts `media_type: movie | series` (`apps/shared/src/types/media.ts:3`; `mediaRequests.createRequest`); books are **not a requestable type**. Adding this is cross-stack backend + schema work, which is feature-parity the owner deprioritized. **Out of this milestone** unless the owner pulls it in; for now, hide the dead-end row rather than show a no-op.

### 6.3 Activity (`ActivityView.swift`)
- **Queue / History segmented**, each with **status filter chips showing counts** (All / Downloading / Importing / Done, etc.).
- Queue rows: cover thumbnail, humanized title (`Show · S2E8`), live line (`1080p · 2.1 GB · 6.4 MB/s · 3m left`), animated DuskProgress.
- History: filterable (service, type), paginated/infinite, humanized sentences + colored pills (port `activityPresentation.ts` semantics natively).
- N+1 fixed (§5); skeletons during load.

### 6.4 Settings (`SettingsView.swift` + `Settings/**`)
- **Regroup the flat 22-link admin wall** (`SettingsView.swift:73-208`) into labeled inset sections: **Integrations** (indexers, download clients, TMDB, Jellyfin, Books provider), **Library & Quality** (quality profiles, custom formats, media library), **Users & Security** (users, sessions, OIDC), **Jobs & Releases** (jobs, health, releases jobs).
- Add **`.searchable`** over settings destinations.
- Pull hardcoded lists from `@rawkoon/shared` where they currently drift (notification keys, job actions) — noted by the gap map.

### 6.5 Notification badge (new)
**Decision: app-icon (home-screen) badge is the requirement.**
- **App-icon badge** via `UNUserNotificationCenter.setBadgeCount`, driven by the unread count from the existing notifications model (`HomeView.swift:45-61` bell logic), kept in sync on foreground/refresh and cleared as items are read.
- Tab-bar badge on the Activity tab is a cheap complement and may ride along, but the app-icon badge is the deliverable.

## 7. New / changed components

| Component | File | Purpose |
|---|---|---|
| `RawkoonMotion` | `Rawkoon/Motion/RawkoonMotion.swift` (new) | Spring constants, durations, Reduce-Motion-gated modifiers |
| `ShimmerView` | `Rawkoon/Views/Components/ShimmerView.swift` (new) | Warm skeleton placeholder |
| `FilterChipRow` | `Components.swift` (extend) | Visible filter chips with counts + active state |
| `SwipeDeck` | `Rawkoon/Views/Discover/SwipeDeck.swift` (new) | Card-triage gesture view |
| `EpisodeActionRow` | `MediaDetailView.swift` (extend) | Interactive episode row with swipe/context actions |
| Badge plumbing | `RawkoonApp.swift`, notifications model | Tab + app-icon unread count |

## 8. Accessibility (carried from the critique, mandatory in a motion pass)
- **Reduce Motion:** every animation in §4 gates on `accessibilityReduceMotion` (crossfade/instant fallback). Today 0/3 sites do.
- **Dynamic Type:** remove fixed caption heights (`Components.swift:143-149`, `DiscoverView.swift:377-383`, `HomeView.swift:196-199`); segmented pickers fall back to `Menu`/scroll above a size threshold. Test at accessibility sizes.
- **Contrast:** verify `Theme.faint` on raised/well ≥ 4.5:1 for caption text; lift or promote to `muted` where it fails.
- **Targets:** MiniPlayer close ≥ 44pt on both axes (`MiniPlayerView.swift:56-59`).
- **VoiceOver:** deck cards, episode actions, and filter chips need labels/values; skeletons `accessibilityHidden`.

## 9. Shippability strategy (one big merge)
**Decision: land the whole redesign as one merge to `main`.**
- Work on a single long-lived feature branch in a **git worktree** (memory `shared-worktrees-branch-switch` — other agents branch-switch shared checkouts; a worktree isolates this). Build order internally is motion primitives → nav shell → per-screen, but they merge together.
- The branch must be green on **lint + kit + build** on **`macbuild`** before the merge. **`macbuild` ssh is the only real gate** (memory `macbuild-ios-verification`); Linux builds only RawkoonKit, so a green Linux run proves nothing.
- Because it's one big merge, keep the branch continuously buildable (don't let it rot); verify on the booted simulator per screen — light + dark + one large-Dynamic-Type + Reduce-Motion pass — before the single merge.
- **No release, no version bump, no tag** — human-only (memory `rawkoon-release-is-human-only`); a release auto-deploys prod.

## 10. Testing
- **RawkoonKit unit tests** for any extracted pure logic (deck supply/prefetch ordering, filter/count derivation, badge count reconciliation) — this is the layer Linux CI can cover.
- View-model logic tests where behavior changed (optimistic action rollback).
- Manual sim pass per screen (light/dark/Dynamic Type/Reduce Motion) — the parts unit tests can't reach.

## 11. Decisions (all resolved with the owner)
1. **Navigation — RESOLVED:** tab bar (`.sidebarAdaptable` style), mini-player as `tabViewBottomAccessory`, no sidebar (iPhone-only). **Search tab abandoned 2026-09-05** — it overflowed the admin bar into "More". See §6.0.
2. **Discover — RESOLVED:** deck-primary; Explore (filters/sort/provider) behind a Filter button. Cross-surface jump is via in-screen nav (no global search). See §6.1.
3. **Notification badge — RESOLVED:** app-icon (home-screen) badge is the deliverable. See §6.5.
4. **Activity N+1 — RESOLVED:** client-side concurrent fetch, no API change. See §5.
5. **Merge — RESOLVED:** one big merge to `main` from a single worktree branch, green on macbuild lint+kit+build. See §9.
6. **Non-admin book request — DEFERRED (fact):** backend doesn't support `media_type: book`; out of this milestone. See §6.2.

_No open questions remain; ready for implementation planning._
