# Rawkoon iOS — Interactive Release Search Parity: Design Spec

> **Status:** draft for review · **Date:** 2026-09-06 · **Branch:** `feat/ios-interactive-search-parity`
> **Source of truth:** the web interactive release picker (`apps/web/src/pages/medias/_component/InteractiveSearch*.tsx`, `apps/web/src/lib/utils/interactive-search.ts`, `apps/web/src/pages/medias/_component/useAiPick.ts`). Parity target is the **movie/TV** picker, not the book path.
> **Research:** full web spec + API contract + iOS gap analysis captured 2026-09-06 (subagent parity map).

## 0. Design Contract (BINDING — every agent, spec & implementation, MUST follow)

Embedded verbatim into every implementation subagent's prompt:

1. **Behavioral parity with the web picker is the acceptance test.** Same filters, same keyword/rejection logic, same sorting, same AI-picks, same result-row fields. Where web and iOS differ, web wins. Port the real constants verbatim (`STOP_WORDS`, `COMMON_TITLE_LANGUAGES`, thresholds), do not paraphrase them.
2. **Same server endpoints as the web — no new bespoke endpoint.** Every field iOS needs is already emitted by `GET /api/medias/interactive-search` and the existing `ai-pick` / `ai-warm` / `blocklist` / `grab` routes. **No backend change is required or permitted** in this milestone. (Promoting inline request/response schemas into `apps/shared` is an optional, separate cleanup — out of scope here.)
3. **Match the existing iOS house style.** Study `ReleaseSearchView.swift` and mirror its idioms: view-owned `@State`, `.task { await load() }`, `model.api()`, `Theme` tokens, the three-layer architecture (APIClient actor · Codable DTOs · thin views). Pure decision logic (rejection heuristic, sort comparators, key normalization) lands in `RawkoonKit` so it is Linux-testable. No MVVM layer, no new third-party deps.
4. **No behavior change outside the release-search surface; no on-device state migration.** Keychain, position journal, downloaded library untouched.
5. **No release, ever, by any agent.** No version bump, tag, or GitHub release — publishing auto-uploads TestFlight and auto-redeploys prod; the user's call alone.
6. **Verification is macbuild.** A phase is done only when `lint` + `kit` + `build` are green on the `macbuild` host (Linux builds RawkoonKit only). Pull first; beware the stale-git BUILD-SUCCEEDED trap.
7. **New strings are English inline literals** — no `.xcstrings` migration here; keep literals extraction-friendly. Coded rejection/score labels get a Swift map mirroring the web's `REJECTION_CODE_KEYS` / `COMPONENT_CODE_KEYS`.

Any deviation from this contract is a defect, not a judgment call.

---

## 1. Summary, Goals, Non-Goals

The iOS movie/TV release picker (`ReleaseSearchView.swift`) is structurally close to the web picker — it runs the same server search with the same params, has the five sort keys, `hideRejected`/`showPacksOnly` toggles, the season/complete selector, and token/url grab paths. But it is **materially incomplete**: it invents its own quality label by scanning the title instead of using the server's `parsed_quality`, it has no client-side rejection heuristic (so it shows junk the web hides), no tracker/language filters, no score breakdown, no per-release Block, lossy grabs, and **no AI-picks at all**.

This milestone brings the iOS picker to **full behavioral parity** with the web picker, additively, in independently-shippable slices on top of a shared decode/logic foundation built first.

**Goals**
- Decode and render every field the server already emits: `parsed_quality`, `quality_rejection_reasons[]`, `score_breakdown`, `source`.
- Port the web's client-side logic verbatim into `RawkoonKit`: the `isClientRejected` rejection heuristic (year + 70%-distinctive-word title match, `STOP_WORDS`), title-suffix stripping, key normalization, and the sort comparators.
- Add the missing filters: tracker include/exclude and language include (dynamic chip multiselects), aligned `filterQuery` normalization.
- Add AI-picks end to end: gate on Local AI enabled, pre-warm, `ai-pick` request, banner (loading/error/pick/grabbed), and the picked-row badge.
- Bring the result row to full parity: all badges, server parsed-quality chip, leechers, score-breakdown panel, coded rejection reasons, `info_url` link, "already grabbed / Re-grab" state.
- Enrich grabs (`indexer`, `quality_parsed`, `size_bytes`, `is_upgrade`) and add per-release Block.
- Every slice leaves `main` green on `lint` + `kit` + `build` and changes nothing outside the release-search surface.

**Non-Goals**
- **No release.** (See contract §5.)
- **No backend change.** (See contract §2.) The server already returns everything.
- **No localization migration.** English inline literals only.
- **No book-path parity.** The book release search is a separate, simpler surface; out of scope.
- **Deferred (flagged, not built):** the language/title picker (`buildTitleOptions` + `COMMON_TITLE_LANGUAGES`) — it needs TMDB per-language translations surfaced on the iOS media model, which iOS does not carry today. Specified in §6 as an optional later slice, not required for the core parity.

---

## 2. The web feature — authoritative behavior (parity contract)

All file:line references are to `apps/web`. Port behavior, not implementation.

### 2.1 Two query inputs (must not conflate)
- **`searchApiQuery`** — the server search term (sent to the API; re-runs the indexer search). Min length 2 (or 1 for season/complete). `useInteractiveSearchState.ts:120-127`.
- **`filterQuery`** — pure client-side substring filter over already-loaded releases; never hits the server. Haystack = normalized `` `${title} ${indexer}` `` (NFD → strip marks → lowercase). `interactive-search.ts:310-313`.

### 2.2 Filters (`FilterState`, `useInteractiveSearchState.ts:35-48`)
| Filter | Type | Default | Effect |
|---|---|---|---|
| `filterQuery` | text | `""` | client substring match (2.1) |
| `hideRejected` | toggle | `true` | hides `rejected` **and** applies `isClientRejected` in search mode (2.3) |
| `showPacksOnly` | toggle | `false` | keeps `is_season_pack \|\| is_complete_series` |
| `sortBy` | segment | `quality` if `library_media_id` else `seeders` | see 2.4 |
| `sortDir` | toggle | `desc` | see 2.4 |
| `includedTrackers` | chips | `[]` | whitelist by normalized indexer key |
| `excludedTrackers` | chips | `[]` | blacklist; **mutually exclusive** with included |
| `includedLanguages` | chips | `[]` | OR-match against release `languages` |
| `selectedSeason` | segment | `defaultSeason ?? null` | server-side season/complete search; forces packs-only |

- Tracker & language options are **derived dynamically from loaded results**, alphabetical. Unknown → `"__unknown_tracker__"` / `"__unknown_language__"` (`interactive-search.ts:11-12`).
- Key normalization `normalizeFilterKey` (`:159-164`): NFD → strip `\p{Mn}` → trim → lowercase.

### 2.3 Keyword / rejection logic (`interactive-search.ts`) — port verbatim
`isClientRejected` (`:219-252`), applied only in **search mode** (no `library_media_id`) when `hideRejected` is on and a `mediaTitle` is known:
- **Year check** (`:231-234`): release title has a `(19|20)\d{2}` year that ≠ expected `mediaYear` → reject.
- **Title-match check** (`:238-251`): distinctive words of the expected title (len ≥3, not a stop word); reject if fewer than `ceil(count * 0.7)` appear in the normalized release title.

**`STOP_WORDS` (29, verbatim, `:181-211`):**
```
the, and, for, are, but, not, all, can, had, her, was, one, our, out,
has, him, his, how, its, let, new, now, old, see, two, way, who, did, via
```
Matching normalization: NFD → strip `\p{Mn}` → lowercase → `[^\p{L}\p{N}]+`→space.

**Title-suffix stripping before match** (`useInteractiveSearchState.ts:214-222`): strip `\s+S\d{1,2}E\d{1,3}\s*$`, `\s+S\d{1,2}\s*$`, `\s+(?:19|20)\d{2}\s*$`.

There is **no** client quality-keyword list — quality preference is entirely server-side scoring, returned as `quality_score` / `parsed_quality` / `score_breakdown`.

### 2.4 Sorting (`filterAndSortReleases`, `interactive-search.ts:319-340`)
| `sortBy` | field | null sentinel | tie-break |
|---|---|---|---|
| `quality` | `quality_score` | `-MAX_SAFE_INT` | rejected sink first, then score, then `title.localeCompare` |
| `seeders` | `seeders` | `-1` | title |
| `age` | `age` | `MAX_SAFE_INT` | title |
| `size` | `size_bytes` | `-1` | title |
| `title` | `title.localeCompare` | — | — |
`sortDir` flips all non-quality comparators; `quality desc` = higher first. `quality` only meaningful with `library_media_id`. Label for `quality` = **"Profile score"**.

### 2.5 AI-picks (`useAiPick.ts`, `InteractiveSearchPanel.tsx`, `AiPickBanner.tsx`)
- **Gate:** Local AI integration enabled (`aiConfig.integration.enabled`) AND `releases.length > 0` AND initial search not loading. Pre-warm on panel open: fire-and-forget `GET /api/medias/search/ai-warm`.
- **Request:** `POST /api/medias/search/ai-pick`, candidates = `!rejected`. Body `{ media_context:{title,year,type}, releases:[{key:guid, title, size_bytes, seeders, score:quality_score, rejected:false}] }`. Cached per `(title,year,type,joined guids)`, `staleTime` 5min, `retry:0`.
- **Response:** `{ release_key: string, reasoning: string }` (reasoning <150 chars, server-truncated; `release_key` validated to a submitted guid or discarded).
- **Display:** banner above the list — states loading / error+Retry / pick(title+reasoning+Grab+dismiss) / grabbed(auto-dismiss ~1800ms). Matched release `guid === release_key`; its row gets a violet **"AI Pick"** Sparkles badge. Grab from banner = same download path.

### 2.6 Result row (`ReleaseCard.tsx`) — every field, in order
Title (→ `info_url` new tab if present) · badges: **AI Pick** (if pick) · **Intégrale** (`is_complete_series`) · **Season pack** (`is_season_pack && !complete`) · indexer · size `formatBytes` · **parsed quality** `` `${resolution}p · source · codec` `` (drop falsy, join " · ") · **HDR** (amber, `parsed_quality.hdr`) · **FL** (green, `freeleech`) · **profile score** `"Score {n}"` (if `quality_score != null`) · **age** `"Age: {n}d"` · **S/L** `"S/L: {s}/{l}"` (dash for null) · **languages** (comma-joined). Rejected → amber card border + coded `quality_rejection_reasons` (mapped via `REJECTION_CODE_KEYS`). Not-rejected + `score_breakdown` → expandable panel: signed `total`, each component `code→label + signed value`, `matched_formats` chips (`COMPONENT_CODE_KEYS`).

### 2.7 Actions
- **Grab** (`downloadRelease`, `useInteractiveSearchState.ts:257-307`): (a) search + `library_media_id` + `download_url` → library grab `{download_url, release_title, indexer, quality_parsed, size_bytes, episode_id, is_upgrade?}`; (b) `download_token` only → resolve via `POST /api/medias/interactive-search/download` then grab `magnet_url ?? download_url`. Button states: "Download this release" / "Starting..." / "Re-grab this release" (when title matches a library download).
- **Block** (`POST /api/medias/blocklist`, `{release_title, indexer?, media_id?, episode_id?}`).

---

## 3. API contract (already satisfied by the server)

- `GET /api/medias/interactive-search` — `q, library_media_id?, season?, tmdb_id?, complete?, media_type?` → `MediaInteractiveSearchResponse { success, service, releases: InteractiveReleaseItem[], indexer_warnings? }` (`apps/shared/src/types/media.ts:152-157`).
- `POST /api/medias/interactive-search/download` — `{token}` → `{success, service, download_url?, magnet_url?}`.
- `POST /api/library/:id/grab` — `{download_url, release_title, indexer?, quality_parsed?, size_bytes?, episode_id?, is_upgrade?}` (inline schema) → `{grabbed, ...}`.
- `POST /api/medias/search/ai-pick` → `{release_key, reasoning}`; `GET /api/medias/search/ai-warm` → 204.
- `GET /api/integrations/local-ai` → integration config (for the AI gate).
- `POST /api/medias/blocklist` — `{release_title, indexer?, media_id?, episode_id?}`.

**Wire type `InteractiveReleaseItem`** (`apps/shared/src/types/media.ts:86-125`): `guid, title, indexer, indexer_id, languages[], protocol, size_bytes, age, seeders, leechers, rejected, rejection_reason, info_url, source, download_token?, download_url?, quality_score?, parsed_quality?{resolution,source,codec,hdr}, quality_rejection_reasons?[], score_breakdown?{rejected,total,components[{code,value,params?}],matched_formats[]}, is_season_pack?, is_complete_series?, freeleech?`.

---

## 4. iOS gap summary (have → need)

**Have (parity/near):** server search + params, 5 sort keys + dir + default logic, `hideRejected`/`showPacksOnly`, season/complete selector, `filterQuery` (haystack differs), token/url grab, decode of the basic fields + `qualityScore`.

**Need:**
- **Decode:** `parsed_quality`, `quality_rejection_reasons[]`, `score_breakdown`, `source`.
- **Logic (→ RawkoonKit):** `isClientRejected` + `STOP_WORDS` + title-suffix strip + `normalizeFilterKey` + sort comparators (as pure, tested functions).
- **Filters:** tracker include/exclude, language include; align `filterQuery` normalization to `title + indexer` NFD.
- **AI-picks:** everything (gate, warm, pick, banner, badge).
- **Row:** pack/HDR/AI badges, server parsed-quality chip (drop title keyword-scan), leechers, score-breakdown panel, coded rejection reasons, `info_url` link, Re-grab state.
- **Actions:** enrich grab body; per-release Block.

---

## 5. Architecture & conventions

- **Three layers unchanged.** DTOs in `Models.swift`; network in `APIClient.swift` (actor); view in `ReleaseSearchView.swift`. Pure decisions in `RawkoonKit` (Linux-testable via XCTest).
- **New RawkoonKit module** `InteractiveSearchLogic` (working name): `stopWords`, `normalizeKey`, `stripTitleSuffixes`, `distinctiveWords`, `isClientRejected(releaseTitle:expectedTitle:expectedYear:)`, `sortReleases(_:by:dir:)`. Each mirrors the web function and gets a unit test ported from `apps/web/src/lib/utils/interactive-search.test.ts` (if present) plus explicit cases.
- **Coded-label maps** `RejectionCodeLabels` / `ScoreComponentLabels` mirroring the web i18n key maps, English literals.
- **AI gate** read once via `GET /api/integrations/local-ai`; cache in the view for the sheet's lifetime.
- **Filter option derivation** (trackers/languages) is a pure function over the loaded `[ReleaseItem]` → also in RawkoonKit, tested.

---

## 6. Phasing (independently shippable; each green on macbuild before the next)

- **Phase 0 — Foundation (inline, serial):** DTO decode (`parsed_quality`, `quality_rejection_reasons`, `score_breakdown`, `source`); RawkoonKit `InteractiveSearchLogic` (normalize/strip/rejection/sort) + tests; coded-label maps; APIClient methods (`aiPick`, `aiWarm`, `localAiIntegration`, `blockRelease`, enriched grab body). No UI change yet — proves the substrate compiles + tests pass on Linux and macbuild.
- **Phase 1 — Rejection + parsed quality + result row.** Wire `isClientRejected` into `hideRejected` (search mode); replace the title keyword-scan with server `parsed_quality`; render full badge set, leechers, coded rejection reasons, `info_url` link. (Highest signal, no AI dependency.)
- **Phase 2 — Filters.** Tracker include/exclude + language include chip multiselects (dynamic options, mutually-exclusive trackers), aligned `filterQuery` normalization, score-breakdown expandable panel.
- **Phase 3 — AI-picks.** Gate + pre-warm + `ai-pick` call + banner (all states) + picked-row badge + grab-from-banner.
- **Phase 4 — Grab enrichment + Block + Re-grab state.** Enriched grab body; per-release Block; "already grabbed / Re-grab" comparison against library downloads.
- **Phase 5 (optional, flagged) — Language/title picker.** `buildTitleOptions` + `COMMON_TITLE_LANGUAGES`; requires surfacing TMDB translations on the iOS media model — a prerequisite, not free. Ship only if the user wants it.

---

## 7. Verification & acceptance

- **Per phase:** `swiftformat --lint` clean, `RawkoonKit` XCTest green on Linux, `lint`+`kit`+`build` green on macbuild, then CI green on the PR.
- **Behavioral acceptance:** drive the macbuild simulator against the live instance for a movie with many releases and a series with season packs; confirm the filtered/sorted/rejected set and the AI pick match what the web renders for the same query. Screenshot the result row, filter sheet, and AI banner via Tether.
- **Parity test corpus:** the RawkoonKit tests encode the exact web cases (year mismatch, 70% threshold with/without stop words, diacritics, tracker/language normalization, each sort comparator's null handling).

---

## 8. Open questions (resolve before Phase 3 / 5)

1. ~~**Phase 5 (language/title picker):** build now or defer?~~ **RESOLVED 2026-09-06: build now, in scope.** Note it needs a model change (TMDB translations on iOS) and may require confirming the server exposes translations to the iOS media-detail endpoint before implementing.
2. **AI banner placement** in the iOS sheet — pinned header above the list (matches web) vs. an inline first row. Default: pinned header.
3. **Block scope** — per-release only (web parity) vs. also exposing the blocklist manager. Default: per-release only this milestone.
