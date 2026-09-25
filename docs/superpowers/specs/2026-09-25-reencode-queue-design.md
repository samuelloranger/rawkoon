# Re-encode queue — design

Date: 2026-09-25 · Status: approved design, pending implementation plan
Mockups: [`2026-09-25-reencode-queue-mockup/`](2026-09-25-reencode-queue-mockup/) (`modal.html`, `queue.html`, illustrative numbers)

## Goal

Let an admin shrink oversized library files (REMUXes, 4K files on 1080p profiles, bloated AVC packs) by re-encoding them in place, from the existing file-level remux surface and from season/show level. The admin picks codec, encoder and size target in one modal, sees a predicted final size before queueing, and the original is only replaced after the output passes validation. Jobs run one at a time from a persistent, reorderable queue, visible in a home widget and in a Settings admin tab.

Primary outcome: reclaim disk. Playback compatibility and quality upgrades are out of scope.

## Decisions

| Topic | Decision |
|---|---|
| Queue backing | Postgres table + in-process dispatcher (not BullMQ) — reorder, pause, run window and history are plain SQL |
| Encoders | Software (`libx265`, `libsvtav1`) always; VAAPI (`hevc_vaapi`, `av1_vaapi`) when `/dev/dri` + ffmpeg support are detected. Chosen **per job** in the modal |
| Output codecs | HEVC, AV1 |
| Resolution | Keep, or downscale to 1080p / 720p (only options below source are enabled) |
| Size control | Two modes: **Quality** (3 presets + advanced QP/CRF + speed) with estimated size, **Target size** (GB per file) with near-exact size |
| Estimate | Rough estimate recomputed instantly on every change (bitrate model). Sample-encode refine only on explicit "Refine estimate" click; a settings change after refining marks the estimate outdated |
| Audio | Copied by default. Optional toggle converts lossless tracks (TrueHD, DTS-HD MA, FLAC, PCM) to EAC3; lossy tracks and all subtitles always copied |
| Validation | ffprobe structural checks + SSIM on sample clips (always on, not a user choice). No full decode pass, no manual approval step |
| Hardlinked sources | Allowed. Estimate and history split savings into "frees now" (nlink = 1) vs "frees after seeding" (nlink > 1); a warning explains disk use grows temporarily |
| Entry points | File panel, season, whole show (one job per file, grouped by batch) |
| Queue controls | Live progress (%/fps/ETA/size), cancel, retry, pause/resume, drag-reorder + move-to-top (file or batch), run window, history |
| Concurrency | 1 |
| Dolby Vision | Profile 5 refused at enqueue (no HDR10 base layer). Profiles 7/8 encode the HDR10 base layer; UI shows "DV → HDR10" |

## Architecture

```
Web modal (file / season / show)
  ├─ POST /api/transcode/estimate   rough, or refined via sample encode
  └─ POST /api/transcode/jobs       one row per file, status=queued, appended to queue tail

Dispatcher (in-process, started from initWorkers)
  tick every 10 s:
    skip if paused, outside run window, or a job is running
    claim next queued row by position  (SELECT … FOR UPDATE SKIP LOCKED)
    run pipeline: preflight → encode → validate → replace → rescan
  progress: in memory → libraryEventBus "transcode-progress" SSE; row persisted every ~15 s

Boot recovery (before first tick)
  running rows → queued (same position)
  delete orphan *.rawkoon-tmp.mkv
  resolve leftover *.rawkoon-orig (see Replace)
```

The dispatcher follows the repo convention that workers run in the API process. ffmpeg runs as a child process under `nice`; the API stays responsive. A container restart mid-encode loses that encode's progress and the job restarts from zero.

### Units

API (`apps/api/src/services/transcode/`):

| Unit | Responsibility | Depends on |
|---|---|---|
| `capabilities.ts` | Probe `ffmpeg -encoders` and `/dev/dri/renderD*`; return available `{codec, encoder}` combos. Cached at boot, refreshable | ffmpeg |
| `probe.ts` | ffprobe JSON → typed source description (streams, HDR/DV profile, duration, bitrate) | ffprobe |
| `buildArgs.ts` | **Pure.** Settings + probe → ffmpeg argv for encode and for sample clips | — |
| `estimate.ts` | Rough model (bitrate × duration + audio) and refine (cut clips once by stream copy, encode clips, extrapolate). Results cached per settings key | probe, buildArgs |
| `validate.ts` | Structural checks on output + SSIM on aligned sample clips | ffprobe, ffmpeg |
| `swap.ts` | Atomic replace with EXDEV fallback and recovery | fs |
| `pipeline.ts` | Runs one job end to end, reports step + progress, honours cancel | all above |
| `dispatcher.ts` | Claim loop, pause/window gate, boot recovery, cancel signalling | pipeline, prisma |
| `window.ts` | **Pure.** Is `now` inside `[start, end)`, including windows crossing midnight | — |

Routes: `apps/api/src/routes/transcode/index.ts`, mounted at `/api/transcode`, all admin-only (`requireUser` + `ensureAdmin`).

Shared: `apps/shared/src/types/transcode.ts` (settings, job, estimate, summary, progress event).

Web:
- `features/transcode/ReencodeModal.tsx` — opened from `LibraryFileDetailBlock` (file) and from the season/show controls in the Management tab.
- `pages/_component/TranscodeWidget.tsx` — added to `WidgetGrid`, admin-only.
- `pages/settings/_component/TranscodeTab.tsx` — new admin tab "Re-encode".
- Hooks: `useTranscodeCapabilities`, `useTranscodeEstimate`, `useTranscodeJobs`, `useTranscodeSettings`, `useTranscodeSummary`, plus an SSE subscription for `transcode-progress`. Query keys in `lib/queryKeys.ts`, endpoints in `lib/endpoints`.
- Strings in `locales/en` and `locales/fr`.

## Modal

One modal, same component for 1 file or N files. Sections, top to bottom:

1. **Video** — Codec (HEVC · AV1), Encoder (CPU · GPU, GPU disabled with reason when not detected; hint line shows the detected device), Resolution (Keep · 1080p · 720p, options at or above source disabled).
2. **Size** — Mode switch Quality / Target size.
   - Quality: presets High / Balanced / Small. "Advanced" disclosure exposes the raw value (CRF for software, QP for VAAPI) and speed (Slower / Default / Faster).
   - Target size: GB per file (average per episode for batches) with the derived video Mbps shown.
3. **Audio & subtitles** — one toggle "Convert lossless audio to EAC3", listing exactly which tracks change and to what (EAC3 640k for ≤ 5.1, 768k above).
4. **Estimate card** (always visible) — estimated total size, original size struck through, ± range, saved amount, a bar, and three figures: frees now, after seeding, estimated time. Hardlink warning when any file has nlink > 1. Footer line states the estimate source (rough / refined N files · M clips / outdated) and the Refine action. Target-size mode shows the computed size with ±3% and no Refine action.
5. **Footer** — Cancel, primary "Add N files to queue".

Files that cannot be queued (DV profile 5, not a video file, already queued) are listed in the modal with the reason and excluded from the count.

### Estimate model

- Rough (quality mode): per-codec, per-preset bits-per-pixel-per-frame table × width × height × fps × duration, plus audio (copied tracks at their measured bitrate, converted tracks at target EAC3 bitrate), plus 1% container overhead. Range ±15%.
- Refine: pick up to 3 files from the batch (largest, median, smallest). For each, cut 6 × 10 s clips spread evenly by stream copy (once per modal session), encode the clips with the chosen settings, compute the video bitrate ratio vs source, apply per file. Range from the clip spread, floor ±5%. Results cached by `(fileIds, settings)` for the modal session.
- Target size: target video bitrate × duration + audio + overhead, ±3%.
- Time: rough fps table per `{encoder, codec, resolution, speed}`, replaced by measured fps after a refine.
- Frees now / after seeding: sum over files of `(source − estimate)` split by `nlink = 1` vs `nlink > 1`.

## Job pipeline

Each step failure deletes the temp output, leaves the original untouched, and sets `status = failed` with a human-readable `error`.

1. **Preflight**
   - Source exists and its fingerprint (dev/ino/mtime) matches the `media_files` row; otherwise "Source changed since queued".
   - Free space in the destination directory ≥ 1.2 × estimated output.
   - DV profile 5 → fail (defensive; the modal already excludes it).
   - Record `sourceNlink`.
2. **Encode**
   - `ffmpeg -nostdin -map 0 -c copy`, re-encode the first non-attached-picture video stream with the chosen encoder; convert lossless audio when enabled; copy everything else (chapters, attachments, cover art, other audio, subtitles). `mov_text` subtitles become SRT.
   - HDR sources: 10-bit output, colour primaries / transfer / matrix and mastering-display + content-light-level metadata carried over.
   - Downscale via `scale` (software) or `scale_vaapi` (VAAPI) keeping aspect ratio.
   - Output always MKV, written to `.<basename>.rawkoon-tmp.mkv` in the source directory.
   - Software encodes run with `nice -n 10` and a thread cap (`cpuThreads` setting, default `nproc − 2`, min 1).
   - Progress parsed from `-progress pipe:1` (`out_time_us`, `fps`, `total_size`).
   - Non-zero exit → fail; SIGKILL by the OOM killer surfaces as "ffmpeg killed (out of memory?)".
3. **Validate** — all must pass:
   - ffprobe opens the output.
   - Duration within ±1 s of source.
   - Video codec and resolution equal the requested ones.
   - Same audio and subtitle stream counts and languages as source.
   - Output size < source size ("No size gain" otherwise).
   - SSIM on 6 × 10 s clips aligned by timestamp, source scaled to output resolution when downscaling: mean ≥ `ssimThreshold` (default 0.970) and every clip ≥ `ssimClipMin` (default 0.950). Scores stored on the job either way.
4. **Replace**
   - Re-check the source fingerprint ("Source changed during encode" otherwise).
   - Final path = source path, with `.mp4`/other extension → `.mkv`, and when downscaling a resolution token in the file name (`2160p`, `4K`, `1080p`, `720p`) replaced by the new one.
   - `rename(tmp, final)`. If it fails with `EXDEV` (union filesystems may place the temp file on a different branch): rename source → `.<basename>.rawkoon-orig` (same branch), copy tmp → final, fsync, ffprobe + size check final, unlink `.rawkoon-orig` and tmp. At no point is there no valid file on disk.
   - When the final path differs from the source path, remove the old source after the new file is in place.
5. **Rescan**
   - Update the `media_files` row: path, name, size, codec, profile, width/height, bitrate, HDR, tracks, fingerprint, `scannedAt` (existing triggers refresh parent totals).
   - `emitLibraryUpdate(mediaId)`, activity log entry, Jellyfin library refresh when that integration is configured.
   - `status = done`, `outputBytes`, `finishedAt`.

**Cancel** — SIGTERM ffmpeg (SIGKILL after 10 s), delete temp, `status = cancelled`. Cancelling a queued job just marks it cancelled.

**Boot recovery** — `running` → `queued` at the same position; delete any `*.rawkoon-tmp.mkv` next to files referenced by non-final jobs; for any `*.rawkoon-orig`: if the final file exists and passes ffprobe, delete the orig; otherwise rename the orig back.

**Notifications** — through the existing notification channels: batch finished (N files, bytes saved, bytes pending seeding) and each failure.

## Queue behaviour

- Order by `position` (float). New jobs append at `max + 1`. Move = midpoint between neighbours; move-to-top = `min − 1`. Batch move shifts all of the batch's queued rows as a block.
- Pause: dispatcher claims nothing new; the running job finishes. Cancel is separate.
- Run window (optional, `windowStart`/`windowEnd`, local server time, may cross midnight): nothing is claimed outside it. A job already running when the window closes is allowed to finish.
- History keeps finished rows (done / failed / cancelled) for 30 days; "Clear finished" deletes them. Retry re-queues a failed or cancelled row at the tail with the same settings.

## Data model

```prisma
model TranscodeJob {
  id             Int       @id @default(autoincrement())
  mediaFileId    Int?      @map("media_file_id")        // FK media_files, ON DELETE SET NULL
  mediaId        Int?      @map("media_id")             // for grouping/links; ON DELETE SET NULL
  batchId        String    @map("batch_id") @db.Uuid
  title          String                                 // denormalized display label
  position       Float
  status         String    @default("queued")           // queued|running|done|failed|cancelled
  step           String?                                // preflight|encode|validate|replace|rescan
  settings       Json
  sourceBytes    BigInt    @map("source_bytes")
  estimatedBytes BigInt?   @map("estimated_bytes")
  outputBytes    BigInt?   @map("output_bytes")
  sourceNlink    Int?      @map("source_nlink")
  progress       Float?                                 // 0..1, persisted every ~15 s
  ssimAvg        Float?    @map("ssim_avg")
  ssimMin        Float?    @map("ssim_min")
  error          String?
  createdAt      DateTime  @default(now()) @map("created_at")
  startedAt      DateTime? @map("started_at")
  finishedAt     DateTime? @map("finished_at")

  @@index([status, position])
  @@index([batchId])
  @@map("transcode_jobs")
}

model TranscodeSettings {
  id             Int      @id @default(1)
  paused         Boolean  @default(false)
  windowEnabled  Boolean  @default(false) @map("window_enabled")
  windowStart    String   @default("01:00") @map("window_start")   // HH:MM
  windowEnd      String   @default("08:00") @map("window_end")
  ssimThreshold  Float    @default(0.97) @map("ssim_threshold")
  ssimClipMin    Float    @default(0.95) @map("ssim_clip_min")
  cpuThreads     Int?     @map("cpu_threads")                     // null = nproc − 2
  updatedAt      DateTime @updatedAt @map("updated_at")
  @@map("transcode_settings")
}
```

A partial unique index prevents two active jobs for the same file: `UNIQUE (media_file_id) WHERE status IN ('queued','running')`.

`settings` JSON (validated by Zod, typed in shared):
`{ codec: "hevc"|"av1", encoder: "software"|"vaapi", resolution: "keep"|1080|720, mode: "quality"|"target", preset?: "high"|"balanced"|"small", quality?: number, speed?: "slower"|"default"|"faster", targetBytes?: number, convertLosslessAudio: boolean }`

## API

All under `/api/transcode`, admin-only.

| Method | Path | Purpose |
|---|---|---|
| GET | `/capabilities` | Available `{codec, encoder}` combos + detected device label |
| POST | `/estimate` | Body `{ fileIds? , mediaId?, season?, settings, refine? }` → per-file + total estimate, range, frees now / after seeding, time, excluded files with reasons |
| POST | `/jobs` | Same selection + settings → creates a batch; returns `batchId` and count |
| GET | `/jobs` | `?status=queued,running` or `?status=done,failed,cancelled&since=` |
| DELETE | `/jobs/:id` | Cancel running / remove queued |
| DELETE | `/batches/:batchId` | Remove all queued jobs of a batch |
| POST | `/jobs/:id/move` | `{ beforeId? , afterId? , top? }` |
| POST | `/batches/:batchId/move` | `{ top: true }` |
| POST | `/jobs/:id/retry` | Re-queue failed/cancelled |
| DELETE | `/history` | Clear finished rows |
| GET/PATCH | `/settings` | Pause, window, thresholds, threads |
| GET | `/summary` | Widget payload: state (running/paused/waiting-window/idle), current job + progress, next 2, queued count + ETA, saved (30 d), failed count |

SSE: `transcode-progress` event on the existing library events stream — `{ jobId, step, progress, fps, speed, etaSecs, currentBytes }`.

## Home widget

Admin-only card in `WidgetGrid`:
- Header: "Re-encode" + state pill (Running / Paused / Waits for HH:MM).
- Current job: poster, title, `source codec → target · encoder`, progress bar, % · fps, time left.
- Next two items with source size, then "+ N more · ~total time".
- Footer: saved bytes + done count (red "N failed" when any), "Manage →" to the Settings tab.
- Hidden when nothing is queued or running and nothing finished in the last 24 h.

## Settings → Admin → Re-encode

- Toolbar: state pill, run-window toggle + start/end, Pause/Resume.
- Stat row: Queued (count, ETA, input bytes), Saved (30 d), Frees after seeding, Failed.
- Current job card: poster, title, settings chips, step bar (Queued → Encoding % → Validating → Replacing → Rescan), progress bar, speed, elapsed, ETA, live size vs estimate, Cancel.
- Queue table grouped by batch: drag handle, position, item, settings summary, size, estimate, move-to-top, remove; batch row with move-to-top and remove-all.
- History table: item, result (Replaced / Replaced · seeding / Failed / Cancelled), before → after, saved (or "0 now · X later"), SSIM, duration, Retry; failure reason inline under the row.
- Validation thresholds and CPU threads under a small "Advanced" disclosure.

## Error handling summary

| Situation | Outcome |
|---|---|
| Source changed / deleted before or during encode | failed, temp removed |
| Not enough free space | failed at preflight |
| ffmpeg non-zero / OOM kill | failed with exit reason |
| Validation failure | failed, reason names the check (and SSIM scores) |
| EXDEV on rename | copy fallback with `.rawkoon-orig` safety |
| Process restart mid-job | re-queued at same position, temp cleaned |
| Restart mid-copy fallback | recovered from `.rawkoon-orig` at boot |
| GPU selected but device missing at run time | failed "VAAPI device not available" |

## Testing

- **Unit (bun test)**: `buildArgs` snapshot matrix (codec × encoder × mode × audio × HDR × downscale × mp4 source); `window` (inside/outside, crossing midnight); estimate math (rough, refine extrapolation, target); validate rules against fixture ffprobe JSON, one per failure; filename rewrite (extension, resolution token); position math for move/top/batch; `swap` against a temp dir with an injected `EXDEV` and with a simulated crash between steps followed by recovery.
- **Integration (real ffmpeg, bun test)**: generate a 10 s `testsrc2` MKV with two audio tracks and an SRT; run the full pipeline with software HEVC → file replaced, row updated, SSIM stored; second run with an impossible SSIM threshold → failed, original byte-identical; cancel mid-encode → temp removed. VAAPI cases skip when no render node exists.
- **Web (vitest)**: modal (disabled options, mode switch, outdated estimate after change, excluded files), widget visibility rules, queue reorder calls the right endpoint.

## Deployment notes

- The image already ships ffmpeg 7 with `libx265`, `libsvtav1` and VAAPI encoders.
- GPU encoding requires passing `/dev/dri` and the `render` group to the container; document in `docs/self-hosting.md`.
- Software encodes of 4K sources can need several GB of RAM; document a recommended container memory limit (≥ 4 GB) for users who enable it.

## Out of scope (v1)

Library-wide multi-select, concurrency > 1, resuming partial encodes, VMAF, H.264 output, manual approval before replace, per-track audio codec choice, removing torrents from the download client after replace.
