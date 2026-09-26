# Re-encode queue — iOS app design

Date: 2026-09-26 · Status: approved design, pending implementation plan
Depends on: the server/web re-encode queue (`docs/superpowers/specs/2026-09-25-reencode-queue-design.md`). No server changes.
Out of scope (future): a Live Activity for running jobs (Lock Screen / Dynamic Island), which needs relay, server and widget-extension work.

## Goal

Give admins full parity with the web in the iOS app (iPhone + Mac Catalyst): start a re-encode on a file, a season or a whole movie/show; see the queue at a glance on Home; and manage the queue and history from Settings. Everything uses the existing `/api/transcode/*` endpoints.

## Decisions

| Topic | Decision |
|---|---|
| UI stack | Native SwiftUI, following existing detail / settings / Home patterns |
| Live updates | Polling while visible: `/summary` every 5 s on Home; `/jobs` every 2 s on the admin screen while a job runs, 10 s otherwise. No SSE event (keeps the SSE contract and `SSEEventRegistry` untouched) |
| Admin gating | `AppModel.isAdmin`; entry points hidden for non-admins; the admin screen shows the existing "Admin only" unavailable view |
| Request encoding | Request bodies use the `*Plain` encoder (no key conversion): job `settings` keys are camelCase on the API (`convertLosslessAudio`, `targetVideoKbps`), selection keys are snake_case written out (`file_ids`, `media_id`, `season`). Responses decode with the default snake_case decoder |
| Pure logic | Lives in `Sources/RawkoonKit` so it is unit-tested with `swift test` |
| Strings | Every new string gets en + fr entries in `Localizable.xcstrings` (`scripts/check-l10n.py` gate) |
| Catalyst | Sheets carry explicit Cancel / Add toolbar buttons (Catalyst sheets are not swipe-dismissable) |

## Entry points (detail screen)

All are admin-only and in-library only (the Manage context the detail screen already computes).

- **Whole movie/show:** "Re-encode…" item in the Manage overflow menu (`managementControlsCard` in `Detail/MediaDetailView+Management.swift`). Selection `{ media_id }`.
- **Season:** "Re-encode season…" in the per-season menu (`DetailSeasonsSection.seasonMenu`), through a new `onSeasonReencode: (Int) -> Void` closure wired from `MediaDetailView`. Selection `{ media_id, season }`.
- **File:** "Re-encode…" in `DetailFileRow`'s context menu (movie and episode files) and a button next to Remux in the expanded row. Selection `{ file_ids: [id] }`.

Each sets a pending `@State` value (`ReencodeTarget { selection, subtitle }`, `Identifiable`) presented with `.sheet(item:)` from `attachSheets`, wrapped in `NavigationStack` with `.environment(model)`. When the sheet reports a successful enqueue, the detail screen shows a success toast; no other refresh is needed.

## `ReencodeSheet`

`NavigationStack { Form { … } }`, `.scrollContentBackground(.hidden)`, `.background(Theme.base)`, `.tint(Theme.apricot)`. Title "Re-encode", subtitle row with the target description. Toolbar: Cancel (leading), **Add N file(s)** (trailing, confirmation action; disabled while 0 eligible or submitting).

Sections, top to bottom:

1. **Video**
   - Codec: segmented HEVC / AV1 (hint text under the control: "widest support" / "smallest"). A codec with no available encoder is disabled.
   - Encoder: segmented CPU / GPU. GPU is disabled when `/capabilities` has no VAAPI combo for the codec; the section footer shows `device_label` or `vaapi_unavailable_reason`.
   - Resolution: segmented Keep / 1080p / 720p. An option is disabled when the source already fits its box (1920×1080 / 1280×720), using `source_width` / `source_height` from the estimate — the same rule as the web and API.
2. **Size**
   - Mode: segmented Quality / Target size.
   - Quality: preset segmented High / Balanced / Small; `DisclosureGroup("Advanced")` with a quality value field (CRF for CPU, QP for GPU; empty = preset) and, for CPU only, speed Slower / Default / Faster.
   - Target: "GB per file (average)" decimal field; footer "≈ X Mbps video". The `targetVideoKbps` sent to the API is derived from the quality-mode estimate's `total_audio_bytes`, `total_duration_secs` and file count (same formula as the web).
3. **Audio & subtitles** — toggle "Convert lossless audio to EAC3", footer "Lossy tracks and all subtitles are always copied untouched.", then one row per `audio_changes` entry: label → `to` when on, "copy" when off; "No lossless audio tracks." when empty.
4. **Estimate** (last section, always visible)
   - Large estimated total ("≈ 148 GB", no "≈" in target mode), source size struck through, "±N%", green "−X saved" capsule.
   - A two-segment bar (frees now / after seeding) and three figures: Frees now, After seeding, Est. time.
   - Seeding warning (amber) when any file has `nlink > 1`, with `temporary_growth_bytes`.
   - Footer line: "Rough estimate · bitrate model" / "Refined · F files · C clips" / "Computed from bitrate × duration" / "Estimate outdated — settings changed" (amber). In quality mode a **Refine estimate** button (becomes "Refine again") runs the refine request; a spinner row shows "Sampling clips…" while it runs.
5. **Skipped** — `DisclosureGroup("N files skipped")` listing `title — reason`, shown only when `excluded` is non-empty.

Behaviour:
- On appear: load `/capabilities` and the first rough estimate.
- Every settings change re-requests the rough estimate after a 300 ms debounce (`.task(id: settingsKey)` with a leading sleep). Target mode first needs a quality-mode estimate for the batch's duration/audio; both are fetched as needed.
- A refined estimate is stored with the settings key it was computed for; when the current key differs, the card shows the rough estimate and the "outdated" footer.
- Submit posts the batch, shows a toast "N files added to the re-encode queue", and dismisses. Errors show an error toast and keep the sheet open.

## Home card

In `HomeView`'s admin widgets, a `widgetCard("Re-encode", systemImage: "gauge.with.dots.needle.67percent")`:
- Header trailing: state badge (`StatusBadge`): Running (seed), Paused (amber), Waits for HH:MM (importing blue), Idle (muted).
- Current job: poster (existing cached image), title, "HEVC · CPU", `DuskProgress`, "62% · 214 fps" and "~6 min left".
- Next two items with source size; "+ N more · ~total" when more remain.
- Footer: "−X saved · N done" and a red "N failed" when non-zero.
- Hidden entirely when `summary.show` is false or the user is not admin.
- Tapping pushes the admin Re-encode screen.
- Data: loaded with the rest of Home in `load()`, then refreshed every 5 s by a cancellable task that runs only while Home is the active root tab and on screen (`onAppear`/`onDisappear` + `isActiveRootTab`). A failed poll keeps the last value.

## Admin screen — Settings → Jobs & releases → Re-encode

New `SettingsDestination.reencode` (group `jobsReleases`, icon `gauge.with.dots.needle.67percent`, keywords "re-encode, transcode, hevc, av1, queue, compress"), extending every switch in `SettingsDestination`. View `ReencodeAdminView` in `Views/Settings/admin/`, following the `BlocklistAdminView` skeleton (`SettingsStateView`, optimistic update + rollback, `model.toast`, `settingsErrorMessage`, `loadGen` race guard).

Sections:
1. **Status** — state badge; Pause/Resume button; "Run window" toggle; start and end `DatePicker(.hourAndMinute)` rows shown when enabled (converted to/from "HH:MM").
2. **Overview** — four figures: Queued (count · ~time · input size), Saved (30 d), Frees after seeding, Failed.
3. **Now encoding** (when a job runs) — title, settings chips, step row (Queued → Encoding N% → Validating → Replacing → Rescan), `DuskProgress`, speed (fps · ×), elapsed, ETA, size so far → estimate. Destructive "Cancel" button with confirmation.
4. **Queue** — rows: title, settings summary, source size → estimate. Grouped by batch with a header row ("Show · N files remaining") carrying Move to top / Remove all. `.onMove` reorders; swipe actions: Move to top, Remove. Empty state: "Nothing queued. Open a movie or show and choose Re-encode."
5. **History** (last 30 days) — rows: title, result (Replaced / Replaced · seeding / Failed / Cancelled), before → after, saved or "0 now · X later", SSIM; failure reason as a secondary line. Swipe: Retry (failed/cancelled). Toolbar menu: "Clear finished" with confirmation.
6. **Advanced** (`DisclosureGroup`) — SSIM mean threshold, SSIM per-clip minimum, CPU threads (empty = auto), saved on commit.

Polling: `/jobs?status=queued,running` every 2 s while a job runs, else 10 s; history and settings on appear and after each action; summary with each poll. The loop runs only while the screen is visible.

## Notifications

`NotificationDestination.resolve(url:)` learns `/settings?tab=transcode` (the URL the server attaches to `library_transcode_finished` / `library_transcode_failed`) and routes to Settings → Re-encode. The leading-visual map keeps its default fallback; add explicit styles for the two types (library style for finished, failure style for failed).

## Networking and models

`APIClient+Transcode.swift`:

| Method | Call |
|---|---|
| `transcodeCapabilities()` | GET `/api/transcode/capabilities` |
| `transcodeEstimate(selection:settings:refine:)` | POST `/api/transcode/estimate` |
| `enqueueTranscode(selection:settings:)` | POST `/api/transcode/jobs` |
| `transcodeJobs(active:)` | GET `/api/transcode/jobs?status=…` (history adds `since`) |
| `cancelTranscodeJob(id:)` | DELETE `/api/transcode/jobs/:id` |
| `moveTranscodeJob(id:placement:)` | POST `/api/transcode/jobs/:id/move` (`top` / `before_id` / `after_id`) |
| `retryTranscodeJob(id:)` | POST `/api/transcode/jobs/:id/retry` |
| `removeTranscodeBatch(id:)` / `moveTranscodeBatchToTop(id:)` | DELETE `/batches/:id` / POST `/batches/:id/move` |
| `clearTranscodeHistory()` | DELETE `/api/transcode/history` |
| `transcodeSettings()` / `updateTranscodeSettings(_:)` | GET / PATCH `/api/transcode/settings` |
| `transcodeSummary()` | GET `/api/transcode/summary` |

`Models+Transcode.swift`: `nonisolated … Decodable, Sendable` DTOs mirroring `@rawkoon/shared` `transcode.ts` (byte counts as `String`), plus the `Encodable` `TranscodeJobSettings` (camelCase keys) and `TranscodeSelection` (explicit snake_case `CodingKeys`), encoded with the plain encoder.

## RawkoonKit (pure, unit-tested)

`Sources/RawkoonKit/Transcode.swift`:
- `transcodeTargetKbps(gbPerFile:fileCount:totalAudioBytes:totalDurationSecs:) -> Int` (floor 100).
- `transcodeSettingsKey(...)` stable key for estimate caching / outdated detection.
- `transcodeResolutionFits(sourceWidth:sourceHeight:box:) -> Bool`.
- `hhmmToMinutes(_:) -> Int?` / `minutesToHHMM(_:) -> String`.
- `transcodeMovePlacement(ids:from:to:) -> TranscodeMovePlacement` — turns a single `.onMove` into `top` / `before(id)` / `after(id)` against the post-move order.
- `transcodeStepIndex(step:) -> Int?` for the step row.

## Error handling

- All calls go through the existing `APIError` → `userMessage` → toast path.
- Failed polls are silent and keep the last data; the next successful poll clears any stale error state.
- Optimistic queue actions (remove, move, retry) roll back on failure with an error toast.
- A 403 on the admin screen falls back to the "Admin only" view (e.g. after the user loses admin).

## Testing

- `swift test` for the RawkoonKit helpers above (bitrate math, key stability, box fit, HH:MM round trip, every move-placement case including first/last and no-op moves).
- `RawkoonTests`: decoding of captured JSON for summary / jobs / estimate / capabilities responses; encoding of `TranscodeJobSettings` and `TranscodeSelection` asserts exact key names; `NotificationDestination` routes `/settings?tab=transcode`.
- `scripts/check-l10n.py`, SwiftFormat and SwiftLint as in CI.
- Manual: build and install on a physical iPhone through the Mac build host (no TestFlight), then exercise every entry point, the sheet (both modes, refine, outdated, skipped), the Home card states, and the admin screen actions against a server running the re-encode queue.
