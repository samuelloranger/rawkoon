> Shipped in #67.

# iOS Settings Parity — Phase 3 (Media & Books non-CRUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Native editable Media library settings + scan/reindex/Arr-import, and the non-CRUD Books settings (enable, metadata source order, files & Audiobookshelf) — same endpoints as web.

**Spec:** `docs/superpowers/specs/2026-09-02-ios-settings-full-parity-design.md` §0 (BINDING), §5 Phase 3. Reuses the Phase-2 component library.

## Global Constraints
Design Contract §0 verbatim. macbuild gate (`/tmp/rawkoon-macbuild-gate.sh`, fresh `-derivedDataPath`). The post-processing endpoint (`GET/PATCH /api/library/post-processing/settings`, response `{ settings }`) is **shared** by media and books — each screen sends **only its own key subset**, and **nullable ids/paths must be sent as explicit JSON null** to clear (a synthesized encoder omits nil → keeps old), so the update bodies use a custom `encode(to:)` that `encode`s (not `encodeIfPresent`) the nullable fields. Paths: empty string → null (web `path.trim() || null`).

## File Structure
- `Views/Settings/media/MediaLibrarySettingsView.swift` (settings + scan + reindex sections)
- `Views/Settings/media/ArrLibraryImportView.swift` (SSE status)
- `Views/Settings/books/BooksSettingsView.swift` (enable + metadata order + files & ABS)
- `APIClient+Settings.swift`, `Models.swift` additions.

---

## Slice A — Media library settings + scan + reindex

### Task A1: Post-processing settings DTO + update body + methods
- DTO `PostProcessingSettingsDTO` mirroring `MediaPostProcessingSettings` (all fields optional except the non-null ones); response `{ settings }`.
- `UpdateMediaSettingsBody` with custom `encode(to:)` (camelCase CodingKeys, mediaEncoder converts to snake): encodes `postProcessingEnabled`, `moviesLibraryPath`/`showsLibraryPath`/`downloadsPath` (nil-if-empty → null), `fileOperation`, `movieTemplate`, `episodeTemplate`, `minSeedRatio`, `activeIndexerManager` (null when none), `defaultMovieQualityProfileId`/`defaultShowQualityProfileId` (null when none) — using `encode` for nullable so nil → JSON null.
- Methods: `postProcessingSettings() -> PostProcessingSettingsResponseDTO` (GET), `updateMediaSettings(_:)` (PATCH via `patchExpectOK`). Reuse existing `qualityProfiles()` for the profile pickers.
- [ ] DTOs+methods → build gate.

### Task A2: `MediaLibrarySettingsView`
Form: post-processing-enabled toggle; movies/shows/downloads paths (mono); file-operation picker (hardlink/move); movie/episode templates (mono); min-seed-ratio number; active-indexer-manager picker (Prowlarr/Jackett/None); default movie & show quality-profile pickers (from `qualityProfiles()` + None). Save via `updateMediaSettings`. Admin-gated. Scan card: path + type picker (movie/show) + Run → `scanLibrary(path:type:)` → `{ matched, unmatched }`, show result. Reindex card: Start → `startReindexLanguages()`; poll `reindexLanguagesStatus()` while state active/waiting.
- [ ] Methods `scanLibrary`, `startReindexLanguages`, `reindexLanguagesStatus` → view → link → macbuild gate → commit.

---

## Slice B — Books settings

### Task B1: Books enable + metadata sources + files
- `booksEnabled` toggle → `PATCH /api/settings` (reuse `updateGeneralSettings`? no — needs a `books_enabled`-only body). Add `updateBooksEnabled(_:)` (PATCH /api/settings with `{ books_enabled }`).
- Metadata sources: `bookMetadataSources() -> { order:[String] }` (GET), `updateBookMetadataSources(order:)` (PUT). Reorderable list (up/down) + enabled = present-in-order.
- Files & ABS: a `UpdateBookFilesBody` (custom encode, book-key subset of post-processing, explicit null for cleared strings/ids) via `patchExpectOK`. Fields: books/audiobooks paths, book/audiobook templates, default book quality profile (from `bookQualityProfiles()` read — Phase 4 defines the editor but the read is cheap here), ABS url + audiobook/ebook library ids.
- [ ] DTOs+methods → `BooksSettingsView` → link → macbuild gate → commit.

---

## Slice C — Arr import (SSE)

### Task C1: `ArrLibraryImportView`
Source segmented (both/radarr/sonarr); Radarr/Sonarr URL + API-key fields (per source); Start → `startLibraryMigrate(_:)` → `{ job_id }` (400 "already running" → follow). Status is **SSE** (`text/event-stream`) — consume via `URLSession.bytes(for:)`, iterate `.lines`, parse `data:` lines into a status struct, exposed as `libraryMigrateStatusStream() -> AsyncThrowingStream`. Set `Accept: text/event-stream`, carry the bearer, cancel on `.onDisappear`.
- [ ] SSE reader method → view → link → macbuild gate → commit.

---

## Task Z: Phase 3 gate
- [ ] macbuild green on final commit; no MARKETING_VERSION change; board note.

## Self-Review
Covers spec §5 Phase 3: media library settings (A2), scan+reindex (A2), books enable/metadata/files (B1), Arr import (C1). Quality-profile CRUD editors are Phase 4 (only the read is reused here).
