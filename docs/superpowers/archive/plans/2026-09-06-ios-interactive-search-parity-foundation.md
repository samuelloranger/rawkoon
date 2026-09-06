> Shipped in #98.

# Interactive Search Parity — Plan: Foundation + phased build

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the iOS movie/TV interactive release picker (`ReleaseSearchView.swift`) to full behavioral parity with the web picker — same filters, keyword/rejection logic, sorting, AI-picks, and result-row fields — additively, on the existing three-layer architecture, with all pure logic in `RawkoonKit`.

**Architecture:** Codable DTOs extend `Models.swift`; network in `APIClient.swift` (actor); view in `ReleaseSearchView.swift`. All pure decisions (key normalization, title-suffix strip, client rejection heuristic, sort comparators, filter-option derivation) live in a new `RawkoonKit` module `InteractiveSearchLogic`, unit-tested on Linux with cases ported from the web's `interactive-search.ts`.

**Tech Stack:** SwiftUI (iOS 18 target, Xcode 26 SDK), Swift 6 in `RawkoonKit`, XCTest. No new third-party deps.

**Spec:** `docs/superpowers/specs/2026-09-06-ios-interactive-release-search-parity-design.md`.

## Global Constraints

- **Behavioral parity with the web picker is the acceptance test; web wins on any difference.** Port real constants verbatim.
- **No backend change** — the server already emits every field. No new endpoint, no `apps/shared` change (optional cleanup is out of scope).
- **`macbuild` ssh is the only real gate** — Linux builds only `RawkoonKit`. `lint` + `kit` + `build` green on macbuild per phase; then CI green on the PR. Work in the git worktree `.claude/worktrees/ios-search-parity`.
- **`RawkoonKit` is Swift 6; tests are XCTest**, Linux-runnable.
- **No new third-party deps. No release / version bump / tag — human-only.**
- **Cozy Dusk only:** colors from `Theme`; apricot obeys the One Lamp Rule; motion gates on `accessibilityReduceMotion`; tap targets ≥44pt; respect Dynamic Type.
- **No behavior change outside the release-search surface. No on-device state migration.**
- **New strings are English inline literals.**

---

## PHASE 0 — Foundation (inline, serial; no UI change)

### Task 0.1: DTO decode of the full wire type
**Files:** edit `Rawkoon/Models.swift` (`ReleaseItem`, ~477-519).
**Do:** Add Codable decode for the fields iOS currently drops:
- `struct ParsedQuality: Codable { let resolution: Int?; let source: String?; let codec: String?; let hdr: String? }` → `parsedQuality` (`parsed_quality`).
- `qualityRejectionReasons: [String]?` (`quality_rejection_reasons`).
- `struct ScoreComponent: Codable { let code: String; let value: Int; let params: [String: String]? }` (params may be absent/heterogeneous — decode leniently or as `[String: AnyCodable]` if a value type is needed; prefer `[String:String]?` and confirm against a real response fixture) and `struct ScoreBreakdown: Codable { let rejected: Bool; let total: Int?; let components: [ScoreComponent]; let matchedFormats: [String] }` → `scoreBreakdown` (`score_breakdown`, `matched_formats`).
- `source: String?`.
**Verify:** a decode test (Task 0.4) against a captured real `GET /api/medias/interactive-search` response confirms every new field decodes without throwing.

### Task 0.2: `RawkoonKit/InteractiveSearchLogic` — pure logic, ported verbatim
**Files:** create `Sources/RawkoonKit/InteractiveSearchLogic.swift`.
**Produces (mirror `apps/web/src/lib/utils/interactive-search.ts`):**
- `static let stopWords: Set<String>` — the 29 words verbatim (`the, and, for, are, but, not, all, can, had, her, was, one, our, out, has, him, his, how, its, let, new, now, old, see, two, way, who, did, via`).
- `func normalizeKey(_:) -> String` — NFD → strip combining marks → trim → lowercase (`normalizeFilterKey`, `:159-164`).
- `func normalizeForMatch(_:) -> String` — NFD → strip marks → lowercase → `[^\p{L}\p{N}]+`→space.
- `func stripTitleSuffixes(_:) -> String` — remove `\s+S\d{1,2}E\d{1,3}\s*$`, `\s+S\d{1,2}\s*$`, `\s+(?:19|20)\d{2}\s*$` (`useInteractiveSearchState.ts:214-222`).
- `func distinctiveWords(_ title: String) -> [String]` — normalized words len ≥3 not in `stopWords`.
- `func isClientRejected(releaseTitle:expectedTitle:expectedYear:) -> Bool` — year check (`(19|20)\d{2}` present and ≠ expectedYear → true) + title-match check (fewer than `ceil(count*0.7)` distinctive words present → true). (`:219-252`).
- `enum SortKey { case quality, seeders, age, size, title }`, `enum SortDir { case asc, desc }`, `func sortReleases(_:by:dir:) -> [T]` generic over a protocol exposing `qualityScore/seeders/age/sizeBytes/title/rejected` — null sentinels + quality rejected-sink + title tie-break + asc/desc flip exactly per `filterAndSortReleases` (`:319-340`).
- `func trackerOptions(_:) / languageOptions(_:)` — dynamic, alphabetical, `__unknown_tracker__` / `__unknown_language__` fallbacks.
**Constraint:** `\p{Mn}`/`\p{L}`/`\p{N}` via `CharacterSet`/`unicodeScalars`; no Foundation-only APIs unavailable on Linux (verify `String.applyingTransform(.stripCombiningMarks)` availability — if Linux-unsafe, implement via `unicodeScalars.filter`).

### Task 0.3: Coded-label maps
**Files:** create `Rawkoon/Views/Detail/ReleaseCodeLabels.swift` (app target).
**Do:** `RejectionCodeLabels: [String: String]` mirroring web `REJECTION_CODE_KEYS` (`apps/web/src/lib/i18n/scoringCodes.ts`) and `ScoreComponentLabels: [String: String]` mirroring `COMPONENT_CODE_KEYS`, English literals. Unknown code → show the raw code.

### Task 0.4: APIClient methods + tests
**Files:** edit `Rawkoon/APIClient.swift`; add `Sources/RawkoonKit/...` tests under `Tests/RawkoonKitTests/InteractiveSearchLogicTests.swift`.
**Produces:**
- `func aiPick(mediaContext:releases:) async throws -> AiPick` → `POST /api/medias/search/ai-pick`; request `{media_context:{title,year,type}, releases:[{key,title,size_bytes,seeders,score}]}`; response `struct AiPick { let releaseKey: String; let reasoning: String }`.
- `func aiWarm() async` → `GET /api/medias/search/ai-warm` (fire-and-forget, ignore errors).
- `func localAiEnabled() async -> Bool` → `GET /api/integrations/local-ai` (integration.enabled).
- `func blockRelease(_:) async throws` → `POST /api/medias/blocklist` `{release_title, indexer?, media_id?, episode_id?}`.
- Extend the grab-by-url body (`GrabUrlBody`) to include `indexer`, `quality_parsed`, `size_bytes`, `is_upgrade`; thread through `grab(_:)`.
**Tests (XCTest, Linux):** port web cases — year mismatch, 70% threshold with/without stop words, diacritics; `normalizeKey`; `stripTitleSuffixes`; each sort comparator's null handling + rejected-sink + asc/desc; tracker/language option derivation; `ReleaseItem` decode fixture.
**Gate:** `swift test` green on Linux; `lint`+`kit`+`build` green on macbuild.

---

## PHASE 1 — Rejection heuristic + parsed quality + result row
- [ ] Wire `InteractiveSearchLogic.isClientRejected` into the `hideRejected` path **only in search mode** (no `library_media_id`), using the stripped title + expected year; server-flagged `rejected` still hidden too.
- [ ] Replace the title keyword-scan quality label with the server `parsedQuality` chip (`{resolution}p · source · codec`, drop falsy).
- [ ] Result row badges to web parity: Complete-series ("Intégrale"), Season pack, indexer, size, parsed-quality chip, HDR, FL, profile score, age, S/L (**show leechers**), languages.
- [ ] Render coded `qualityRejectionReasons` (via `RejectionCodeLabels`) on rejected rows; keep `rejection_reason` fallback; amber card border.
- [ ] Link title to `info_url` when present.
- [ ] macbuild green + CI green.

## PHASE 2 — Filters
- [ ] Tracker include/exclude chip multiselect: dynamic options (`trackerOptions`), alphabetical, **mutually exclusive** (selecting one side removes the key from the other), whitelist/blacklist by normalized key.
- [ ] Language include chip multiselect: dynamic (`languageOptions`), OR-match against release `languages`.
- [ ] Align `filterQuery` haystack to web: normalized `title + indexer` (NFD), drop languages from the haystack.
- [ ] Score-breakdown expandable panel on non-rejected rows: signed total, each component `code→label + signed value` (via `ScoreComponentLabels`), `matched_formats` chips.
- [ ] macbuild green + CI green.

## PHASE 3 — AI-picks
- [ ] Read `localAiEnabled()` once on sheet open; gate all AI UI on it.
- [ ] Pre-warm via `aiWarm()` (fire-and-forget) when the sheet opens.
- [ ] After results load (and when the non-rejected candidate guid-set changes), call `aiPick` with `!rejected` candidates; cache per `(title,year,type,guids)`.
- [ ] AI-pick banner pinned above the list: states loading ("AI is picking the best release…") / error+Retry / pick(title + reasoning + Grab + dismiss) / grabbed (auto-dismiss ~1800ms).
- [ ] Highlight the picked row (`guid == releaseKey`) with a violet "AI Pick" Sparkles badge; grab-from-banner reuses the grab path.
- [ ] macbuild green + CI green.

## PHASE 4 — Grab enrichment + Block + Re-grab state
- [ ] Send enriched grab body (`indexer`, `quality_parsed`, `size_bytes`, `is_upgrade`) on both grab paths; token path uses `magnet_url ?? download_url`.
- [ ] Per-release **Block** button → `blockRelease`; "Block"/"Blocked" states.
- [ ] "already grabbed / Re-grab" state: compare release title against current library downloads; button label "Re-grab this release".
- [ ] macbuild green + CI green.

## PHASE 5 — Language/title picker (IN SCOPE, confirmed 2026-09-06)
- [ ] **Prerequisite:** surface TMDB per-language translations on the iOS media model (not carried today). Check what the web reads (`buildTitleOptions` inputs) and add the equivalent field to the iOS media DTO + the endpoint response if the server already returns it; if the server does not expose translations to the media detail iOS calls, flag it (this is the one place a server touch may be needed — confirm before adding).
- [ ] Port `buildTitleOptions` + `COMMON_TITLE_LANGUAGES` (`es,de,it,pt,ja,ko,zh,ru`); add a language/title picker (`SearchTitleSelect` analogue) driving `searchApiQuery` (platform title first, EN/FR pinned, original-language, then allowlist; dedupe by lowercased query; secondary titles ≥2 chars).
- [ ] macbuild green + CI green.

---

## Execution model (per the redesign)
- **Phase 0 built inline** (serial; shared files: Models, APIClient, RawkoonKit) so subagents don't collide on them.
- **Phases 1–4** implementable by subagents in a workflow once the foundation is green.
- After each phase: build on macbuild → capture screenshots (movie w/ many releases; series w/ packs) → present via Tether → wait for CI. **No release** — the user cuts any release.
