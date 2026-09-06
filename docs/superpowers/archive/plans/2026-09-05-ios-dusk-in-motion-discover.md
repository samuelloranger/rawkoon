> Shipped in #96/#97.

# Dusk in Motion — Plan 2: Discover (swipe deck + Explore filter grid)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the passive Discover rails with a native swipe-triage **deck** (personalized/trending, role-aware actions, dismiss+undo) plus a filterable **Explore** grid (provider/genre/sort/language, paginated), built on the foundation primitives (`RawkoonMotion`, `ShimmerView`) — closing the "passive, no filters, no add-from-feed" gap.

**Architecture:** New `APIClient` methods wrap already-existing server endpoints (no backend work). A `SwipeDeck` view drives the deck with spring gestures + haptics; an `ExploreView` + filter sheet drives the grid. `DiscoverView` becomes deck-primary with a Filter button opening Explore; unified search stays.

**Tech Stack:** SwiftUI (iOS 18 target, Xcode 26 SDK). Foundation primitives from Plan 1. No new deps.

**Spec:** `docs/superpowers/specs/2026-09-05-ios-dusk-in-motion-design.md` (§6.1 Discover). Builds on `docs/superpowers/plans/2026-09-05-ios-dusk-in-motion-foundation.md` (merged into this same branch, committed at/after 0039c7a).

## Global Constraints

- **iOS 18.0 deployment target, iPhone only.** Any iOS-26-only API MUST be `#available(iOS 26, *)`-gated (see the foundation's `MiniPlayerContentInset` pattern). Build settings in `project.yml` only.
- **All verification on macbuild** (no swift/xcodebuild on homelab): edit local worktree → commit (source only, NEVER `Rawkoon.xcodeproj`, it's gitignored) → `git push macbuild worktree-ios-dusk-in-motion` → on `~/rawkoon-wt/ios-dusk-in-motion`: `/opt/homebrew/bin/xcodegen generate` + `xcodebuild build -project Rawkoon.xcodeproj -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`, and `/opt/homebrew/bin/swiftformat Rawkoon Sources Tests --lint` must stay 0/111 (run `swiftformat` without `--lint` to auto-fix first). See `.superpowers/sdd/2026-09-05-ios-dusk-in-motion-foundation/build-recipe.md`.
- **Cozy Dusk only** — colors via `Theme`; apricot obeys the One Lamp Rule (the deck's primary action is the one lamp per card). Fraunces (`Font.display`) titles only.
- **Reduce Motion:** deck gestures/animations use `RawkoonMotion` and gate on `@Environment(\.accessibilityReduceMotion)`. 44pt min targets. Respect Dynamic Type (no fixed caption heights — fix the poster caption pattern where touched).
- **Decisions (owner):** deck-level label only ("For you" personalized / "Trending now"), NO per-card reason, NO backend change. Deck actions: dismiss (+undo), watchlist, and a primary that is **Add-to-library for admins, Request for non-admins**. No push to `origin`. No version bump/tag/release.

## Server endpoints to wrap (already exist — iOS-client work only)
- Deck: `GET /api/medias/discover/deck?exclude=<csv>&limit=<n>&language=<l>` → `{items:[DiscoverDeckItem], source:"personalized"|"trending"}`.
- Dismiss: `POST /api/medias/discover/dismiss` `{tmdb_id, type}`; undo `DELETE /api/medias/discover/dismiss/:tmdbId?type=`.
- Explore grid: `GET /api/medias/discover?type=movie|tv&provider_id=&genre_id=&sort_by=&page=&language=&original_language=` → `{items, page, region, total_pages, total_results}`.
- Genres: `GET /api/medias/genres`. Providers: streaming-providers endpoint (`MEDIAS_ENDPOINTS.STREAMING_PROVIDERS`).
- Reuse: `addToLibrary(tmdbId:type:)`, `createRequest(_:)`, `addToWatchlist(...)`/`removeFromWatchlist(...)` (all already in `APIClient`).

---

### Task 1: APIClient — deck fetch + dismiss/undo + models

**Files:**
- Modify: `apps/ios/Rawkoon/APIClient.swift` (add methods near `explore()` ~:773)
- Modify: `apps/ios/Rawkoon/Models.swift` (add `DiscoverDeckItem`, `DiscoverDeckResponse`, `DiscoverSource`)

**Interfaces produced:**
- `struct DiscoverDeckItem: Codable, Identifiable` mirroring the server's `DiscoverDeckItem` (`apps/shared/src/types/discover.ts`) — read that shape and mirror its fields (tmdbId, mediaType, title, posterUrl/posterPath, overview, releaseYear, voteAverage, plus whatever it carries). Match the JSON keys exactly (the codebase decodes snake_case via the client's existing decoder — follow how `TmdbSearchItem` maps keys).
- `enum DiscoverSource: String, Codable { case personalized, trending }`
- `struct DiscoverDeckResponse: Codable { let items: [DiscoverDeckItem]; let source: DiscoverSource }`
- `func discoverDeck(exclude: [Int], limit: Int, language: String?) async throws -> DiscoverDeckResponse`
- `func dismissDiscover(tmdbId: Int, type: String) async throws`
- `func undismissDiscover(tmdbId: Int, type: String) async throws`

- [ ] **Step 1: Read the server contract**
Read `apps/shared/src/types/discover.ts` and `apps/api/src/routes/medias/discover/index.ts` to get exact field names / JSON keys and the dismiss body shape (`{tmdb_id, type}`). Mirror them in the Codable models, matching the key-decoding convention `TmdbSearchItem` already uses in `Models.swift`.

- [ ] **Step 2: Add the models to `Models.swift`**
Define `DiscoverSource`, `DiscoverDeckItem`, `DiscoverDeckResponse` with keys matching the server JSON.

- [ ] **Step 3: Add the client methods to `APIClient.swift`**
```swift
func discoverDeck(exclude: [Int], limit: Int = 20, language: String? = nil) async throws -> DiscoverDeckResponse {
    var q = "?limit=\(limit)"
    if !exclude.isEmpty { q += "&exclude=\(exclude.map(String.init).joined(separator: ","))" }
    if let language { q += "&language=\(language)" }
    return try await get("/api/medias/discover/deck\(q)")
}
func dismissDiscover(tmdbId: Int, type: String) async throws {
    try await post("/api/medias/discover/dismiss", body: ["tmdb_id": tmdbId, "type": type])
}
func undismissDiscover(tmdbId: Int, type: String) async throws {
    try await delete("/api/medias/discover/dismiss/\(tmdbId)?type=\(type)")
}
```
Match the actual `get`/`post`/`delete` helper signatures in `APIClient.swift` (read them — body encoding, return handling; `post`/`delete` may be `@discardableResult` or need a `Void`/`EmptyResponse` type). Adapt exactly.

- [ ] **Step 4: Build + format on macbuild**
Per the build recipe: push, `xcodegen generate` + `xcodebuild build … CODE_SIGNING_ALLOWED=NO` → BUILD SUCCEEDED; `swiftformat … --lint` 0 issues.

- [ ] **Step 5: Commit** (source only)
```bash
git commit -m "feat(ios): APIClient deck fetch + dismiss/undo + models"
```

---

### Task 2: APIClient — Explore filter grid + genres + providers

**Files:**
- Modify: `apps/ios/Rawkoon/APIClient.swift`
- Modify: `apps/ios/Rawkoon/Models.swift`

**Interfaces produced:**
- `struct DiscoverMediasResponse: Codable { items:[TmdbSearchItem]; page:Int; region:String?; totalPages:Int; totalResults:Int }` (mirror `apps/shared/src/types/media.ts` `DiscoverMediasResponse`; reuse `TmdbSearchItem` if the item shape matches, else a dedicated item type).
- `struct Genre: Codable, Identifiable { id:Int; name:String }`, `struct StreamingProvider: Codable, Identifiable { id:Int; name:String; logoPath:String? }` (mirror server shapes).
- `func discoverGrid(type: String, providerId: Int?, genreId: Int?, sortBy: String?, page: Int, language: String?, originalLanguage: String?) async throws -> DiscoverMediasResponse`
- `func genres(type: String) async throws -> [Genre]`
- `func streamingProviders(type: String) async throws -> [StreamingProvider]`

- [ ] **Step 1: Read server shapes** — `apps/shared/src/types/media.ts` (`DiscoverMediasResponse`, valid sorts `DISCOVER_VALID_SORTS`), the genres + streaming-providers response shapes in `apps/api/src/routes/medias/tmdb/tmdbMetaRoutes.ts` and `apps/web/src/lib/endpoints/medias.ts`.

- [ ] **Step 2: Add models** to `Models.swift` (matching JSON keys).

- [ ] **Step 3: Add client methods** to `APIClient.swift`, URL-encoding each optional query param only when present. Copy the exact `DISCOVER_VALID_SORTS` values into a Swift `enum DiscoverSort` so the UI can't send an invalid sort.

- [ ] **Step 4: Build + format on macbuild** (BUILD SUCCEEDED, lint 0).
- [ ] **Step 5: Commit** `feat(ios): APIClient Explore grid + genres + providers`

---

### Task 3: `SwipeDeck` — the triage deck view

**Files:**
- Create: `apps/ios/Rawkoon/Views/Discover/SwipeDeck.swift`
- Create: `apps/ios/Rawkoon/Views/Discover/DeckCardView.swift`

**Interfaces:**
- Consumes: `DiscoverDeckItem`, `RawkoonMotion` (spring, `rawkoonMotion`), `BookCover`/poster rendering, `Theme`.
- Produces: `struct SwipeDeck: View` — init with the loaded `[DiscoverDeckItem]`, the deck-level label, and closures `onDismiss: (DiscoverDeckItem)->Void`, `onWatchlist: (DiscoverDeckItem)->Void`, `onPrimary: (DiscoverDeckItem)->Void`, `onExhausted: ()->Void`, `onOpen: (DiscoverDeckItem)->Void`.

- [ ] **Step 1: DeckCardView** — a 2:3 poster card (cover fills, gradient scrim, title in Fraunces, year·★·mediaType in mono), rounded 16, cover-float shadow. A small deck-level label pill top-left ("For you" / "Trending now"). Accessibility: card is one element with label = title + metadata; action buttons have their own labels.

- [ ] **Step 2: SwipeDeck gesture + stack** — render up to 3 stacked cards (top interactive, 2 behind scaled/dimmed). `DragGesture`: horizontal drag past a threshold triggers dismiss (left) or primary (right); vertical-up triggers watchlist; release under threshold springs back via `RawkoonMotion.spring`. Under Reduce Motion, replace the drag-follow with tap-only action buttons (no card-follow animation) — gate the offset/rotation on `!reduceMotion`. A row of three action buttons below the deck (dismiss ✕, primary ＋/paper-plane, watchlist bookmark) is ALWAYS present so the deck is fully usable without gestures (a11y + discoverability).

- [ ] **Step 3: advance + haptics** — on any action, pop the top item, call the matching closure, and fire `UIImpactFeedbackGenerator` (`.rigid` for dismiss, `.medium` for primary/watchlist), gated off under Reduce Motion is NOT required (haptics are fine), but skip if the user disables system haptics (system handles that). When the stack empties, call `onExhausted`.

- [ ] **Step 4: build + format on macbuild**; add a temporary `#Preview` with sample `DiscoverDeckItem`s to screenshot the deck (`deck.png`), verify card layout + buttons + Reduce-Motion tap-only mode; remove the preview before commit unless reusable.
- [ ] **Step 5: Commit** `feat(ios): SwipeDeck triage view with reduce-motion + a11y buttons`

---

### Task 4: `ExploreView` — filter sheet + paginated grid

**Files:**
- Create: `apps/ios/Rawkoon/Views/Discover/ExploreView.swift`
- Create: `apps/ios/Rawkoon/Views/Discover/ExploreFilterSheet.swift`

**Interfaces:**
- Consumes: `discoverGrid`, `genres`, `streamingProviders`, `TmdbSearchItem`, `ShimmerView`, `Theme`.
- Produces: `struct ExploreView: View` (presented as a sheet or pushed screen from Discover's Filter button).

- [ ] **Step 1: Filter state + sheet** — `type` (movie/tv segmented), provider picker (grid of provider logos from `streamingProviders`), genre picker (chips from `genres`), sort menu (`DiscoverSort`), original-language toggle. Filter state persists while the Explore screen is open. A visible chip row shows active filters with counts (fix the "dropdown menu, no counts" gap).

- [ ] **Step 2: Paginated grid** — `LazyVGrid` of 2:3 posters (reuse a poster card that does NOT clip captions at Dynamic Type — use flexible height + `minimumScaleFactor`, fixing the §8 clip gap for this new code). Infinite scroll: fetch next `page` on the last row's `onAppear` until `page >= totalPages`. `ShimmerView` skeleton grid on first load and while a new filter query is in flight.

- [ ] **Step 3: empty/error states** — `ContentUnavailableView` with a real "no results for these filters" message + a clear-filters affordance; keep prior results on a refresh error (mirror DiscoverView's keep-stale pattern).

- [ ] **Step 4: build + format on macbuild**; screenshot the filter sheet + a filtered grid (`explore.png`) — with prod token via reverse tunnel if available, else code-verify + build-clean. Verify large-Dynamic-Type doesn't clip poster titles.
- [ ] **Step 5: Commit** `feat(ios): Explore filter sheet + paginated discover grid`

---

### Task 5: Wire `DiscoverView` — deck-primary + Explore + role-aware actions

**Files:**
- Modify: `apps/ios/Rawkoon/Views/DiscoverView.swift`

**Interfaces consumed:** `SwipeDeck`, `ExploreView`, deck/dismiss client methods, `addToLibrary`/`createRequest`/`addToWatchlist`, `model.isAdmin`.

- [ ] **Step 1: Deck-primary body** — when not searching, show the `SwipeDeck` (loaded via `discoverDeck`) instead of the rails. Keep the unified search (searchField + kindPicker + searchContent) exactly as-is for the searching branch. Add a toolbar **Filter** button opening `ExploreView`.
- [ ] **Step 2: Deck data + actions** — load the deck, track dismissed/excluded tmdbIds, prefetch the next batch when the stack runs low (call `discoverDeck(exclude:)` again), and on `onExhausted` fetch more or show a tasteful empty state. Wire the closures:
  - `onDismiss` → `dismissDiscover(tmdbId:type:)` + append to exclude; offer an **Undo** toast (reuse the app's toast) that calls `undismissDiscover`.
  - `onWatchlist` → `addToWatchlist(...)`.
  - `onPrimary` → **`model.isAdmin ? addToLibrary(tmdbId:type:) : createRequest(...)`**; confirmation toast ("Added to library" / "Requested — we'll notify you"). Build the `createRequest` payload from the deck item (read `createRequest`'s expected input type).
  - `onOpen` (tap the card body, not an action) → push `MediaDetailView`.
- [ ] **Step 3: retire the rails** — remove the `feedContent`/`rail`/`loadFeed`/`ExploreFeed` rails path (the deck replaces it). Keep `posterCard`/search. (The `explore()` rails endpoint stays server-side; iOS just no longer renders rails on Discover.)
- [ ] **Step 4: build + format on macbuild**; screenshot deck-primary Discover + Filter→Explore for admin and (if a credential is available) non-admin, confirming the primary action label differs (Add vs Request). Verify no regression to search.
- [ ] **Step 5: Commit** `feat(ios): Discover deck-primary with Explore filter + role-aware actions`

---

### Task 6: Discover integration gate

**Files:** none (verification).
- [ ] **Step 1:** On macbuild at the branch head: `swiftformat Rawkoon Sources Tests --lint` (0/111), `swift test` (still green), `xcodegen generate` + `xcodebuild build … CODE_SIGNING_ALLOWED=NO` (BUILD SUCCEEDED).
- [ ] **Step 2:** Sim regression sweep: Discover deck loads + swipes + undo works; Explore filters + infinite scroll; search unchanged; mini-player/tab shell from Plan 1 unaffected. Light + dark (dark-only) + one large-Dynamic-Type + Reduce-Motion pass. Screenshot each state.
- [ ] **Step 3:** Do NOT merge — lands with the other phases in the one merge.

## Self-review notes
- Spec §6.1 coverage: deck (T3, T5), Explore filters/sort/provider/pagination (T2, T4), dismiss/undo (T1, T5), role-aware add/request (T5), deck-level label (T3/T5, no backend per ruling). Cross-surface search "jump" is N/A (Search tab abandoned).
- No placeholders: server shapes are read in Step 1 of T1/T2 before mirroring (the exact JSON keys live in `apps/shared/src/types/*` — the implementer copies them rather than guessing).
- Reduce Motion + Dynamic Type + 44pt handled in T3/T4 (and the poster-caption clip gap fixed for new grid code).
