# Re-encode Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin re-encode library files (file / season / show) to HEVC or AV1 with a predicted size, run them from a persistent reorderable queue, and replace originals only after validation — with a home widget and a Settings admin tab.

**Architecture:** A Postgres `transcode_jobs` table is the queue. An in-process `TranscodeDispatcher` (started from `initWorkers`) claims one job at a time and runs a pipeline of pure, injectable units: `probe` → `buildArgs` → ffmpeg → `validate` (ffprobe structure + SSIM) → `swap` (atomic rename, EXDEV-safe) → rescan. Live progress stays in memory and is polled by the web through `/api/transcode/*`.

**Tech Stack:** Bun + Hono + Prisma 7 (Postgres) API, ffmpeg/ffprobe 7 child processes, React 19 + TanStack Query + Radix + Tailwind 4 web, bun test / vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-reencode-queue-design.md` (mockups in `docs/superpowers/specs/2026-09-25-reencode-queue-mockup/`)

## Global Constraints

- API imports itself as `@rawkoon/api/<path>`, never relative across dirs. Shared types from `@rawkoon/shared/types`.
- Errors: return helpers from `@rawkoon/api/errors` (`ok`, `badRequest`, `notFound`, `conflict`, `serverError`); never throw to the client.
- All `/api/transcode/*` routes are admin-only via `requireAdmin` from `@rawkoon/api/middleware/hono/auth`.
- BigInt byte counts cross the wire as decimal strings (same as `size_bytes` elsewhere).
- DB file paths may be arr-internal; every filesystem call goes through `remapPath()` from `@rawkoon/api/utils/medias/mediainfoScanner`. DB paths are rewritten with the same pure path functions.
- Temp output: `<dir>/.<basename-without-ext>.rawkoon-tmp.mkv`; EXDEV safety copy: `<dir>/.<basename>.rawkoon-orig`.
- Output container is always MKV. Codecs: `hevc`, `av1`. Encoders: `software` (`libx265`, `libsvtav1`), `vaapi` (`hevc_vaapi`, `av1_vaapi`).
- SSIM thresholds default: mean ≥ `0.97`, every clip ≥ `0.95`. Duration tolerance ±1 s. Free-space factor 1.2 × estimate.
- Concurrency 1. Pause lets the running job finish. Run window is local server time and may cross midnight; a running job finishes after the window closes.
- Progress is **polled** (2 s admin tab while running, 5 s widget). No new SSE event; do not touch `apps/shared/contracts/sse-contract.v1.json`.
- Toast text must come from `t()` (CI "No hardcoded toast copy" check). Every UI string exists in `apps/web/src/locales/en/common.json` and `fr/common.json`.
- TS strict: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Run `bun run typecheck`, `bun run lint`, `bun run test` from repo root before each commit that touches code.
- Comments say why, in one line, only where not obvious.
- Commit messages: Conventional Commits, no Co-Authored-By trailer. Public repo: no instance-specific titles, paths, sizes or hostnames in code, tests, fixtures or messages.

## Review Focus

1. **Source replaced by an upgrade grab mid-encode** — a newer file lands at the same path while ffmpeg runs; the job must fail "Source changed during encode" and must not overwrite the new file. Test in Task 10 (`pipeline aborts when fingerprint changes before replace`).
2. **Container restart while in the EXDEV copy fallback** — `.rawkoon-orig` exists, final is half-written; boot recovery must restore the original. Test in Task 7 (`recoverSwap restores orig when final is invalid`) and Task 11 (`boot recovery runs recoverSwap for running jobs`).
3. **`.mp4` source with `mov_text` subtitles and a `tmcd` data track** — mkv can't hold either as-is; args must convert subs to SRT and drop data streams, and the final path must become `.mkv` with the old `.mp4` removed. Tests in Task 4 (`mp4 source maps subs to srt and drops data`) and Task 6 (`finalPathFor swaps extension`).
4. **Source with cover-art attached picture before the main video stream** — the encoder must target the real video ordinal, not `v:0`, and SSIM must compare the real streams. Tests in Task 3 (`mainVideo skips attached_pic`) and Task 4 (`encodes the ordinal of the main video, not attached pic`).
5. **Run window crossing midnight and paused queue** — `22:00–06:00` must be open at 23:30 and 05:59, closed at 06:00 and 21:59; paused must claim nothing even inside the window. Tests in Task 5 (`isInsideWindow`) and Task 11 (`tick claims nothing when paused / outside window`).

---

## File Structure

API — `apps/api/src/services/transcode/`
| File | Responsibility |
|---|---|
| `settingsSchema.ts` | Zod schema for job settings + request bodies |
| `probe.ts` | ffprobe JSON → `SourceProbe` (pure parser + runner) |
| `ffmpegRunner.ts` | Spawn ffmpeg with nice, abort, `-progress` parsing |
| `buildArgs.ts` | Pure argv builders: encode, sample clip cut, clip encode |
| `presets.ts` | Pure tables: quality values, speed presets, rough bitrate + fps models |
| `queueMath.ts` | Pure: run-window test, position math |
| `outputPath.ts` | Pure: tmp / orig / final path functions |
| `estimate.ts` | Rough estimate (pure) + refine (clip sampling, injected runner) |
| `validate.ts` | Pure structure checks, SSIM parsing, SSIM runner |
| `swap.ts` | Atomic swap with EXDEV fallback + recovery (injected fs) |
| `capabilities.ts` | Detect encoders + working VAAPI device (cached) |
| `pipeline.ts` | One job end to end, injected deps |
| `repo.ts` | Prisma queries for jobs/settings (claim, finish, list, move) |
| `dispatcher.ts` | Tick loop, pause/window gate, cancel, boot recovery, live progress |
| `selection.ts` | Resolve file/season/show selection → candidate files + exclusions |
| `notify.ts` | Batch-finished + failure notifications |
| `rescanFile.ts` | Update `media_files` row after swap |
| `index.ts` | Wire real deps, export `transcodeDispatcher` |

API — routes: `apps/api/src/routes/transcode/index.ts` (+ mount in `apps/api/src/index.ts`).
API — DB: `apps/api/prisma/schema.prisma`, migration `apps/api/prisma/migrations/20260925000000_transcode_queue/migration.sql`.
Shared: `apps/shared/src/types/transcode.ts` (+ export in `types/index.ts`), `NotificationType` additions.
Web: `apps/web/src/lib/endpoints/transcode.ts`, `lib/queryKeys.ts`, `features/transcode/*` (hooks, modal, pure helpers), `pages/_component/TranscodeWidget.tsx`, `pages/settings/_component/TranscodeTab.tsx`, edits in `LibraryFileDetailBlock.tsx`, `LibraryMediaSection.tsx`, `WidgetGrid.tsx`, `Settings.tsx`, locales.
Ops: `Dockerfile` (VA drivers), `.github/workflows/ci.yml` (ffmpeg for integration test), `docs/self-hosting.md`.

---

### Task 1: Shared types and settings schema

**Files:**
- Create: `apps/shared/src/types/transcode.ts`
- Modify: `apps/shared/src/types/index.ts`
- Create: `apps/api/src/services/transcode/settingsSchema.ts`
- Test: `apps/api/src/services/transcode/settingsSchema.test.ts`

**Interfaces:**
- Produces: all `Transcode*` types below; `jobSettingsSchema`, `selectionSchema`, `estimateBodySchema`, `enqueueBodySchema`, `queueSettingsPatchSchema`, `moveBodySchema` (Zod).

- [ ] **Step 1: Write the shared types**

`apps/shared/src/types/transcode.ts`:
```ts
export type TranscodeCodec = "hevc" | "av1";
export type TranscodeEncoder = "software" | "vaapi";
export type TranscodeResolution = "keep" | 1080 | 720;
export type TranscodeMode = "quality" | "target";
export type TranscodePreset = "high" | "balanced" | "small";
export type TranscodeSpeed = "slower" | "default" | "faster";

export interface TranscodeJobSettings {
  codec: TranscodeCodec;
  encoder: TranscodeEncoder;
  resolution: TranscodeResolution;
  mode: TranscodeMode;
  preset: TranscodePreset;
  /** Advanced override: CRF (software) or QP (VAAPI). */
  quality?: number;
  speed: TranscodeSpeed;
  /** Target mode only: video bitrate applied to every file of the batch. */
  targetVideoKbps?: number;
  convertLosslessAudio: boolean;
}

export type TranscodeJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";
export type TranscodeStep =
  | "preflight"
  | "encode"
  | "validate"
  | "replace"
  | "rescan";

export interface TranscodeCombo {
  codec: TranscodeCodec;
  encoder: TranscodeEncoder;
}

export interface TranscodeCapabilities {
  combos: TranscodeCombo[];
  device_label: string | null;
  /** Why VAAPI is unavailable, when it is. */
  vaapi_unavailable_reason: string | null;
}

export interface TranscodeSelection {
  file_ids?: number[];
  media_id?: number;
  season?: number;
}

export interface TranscodeEstimateFile {
  file_id: number;
  title: string;
  source_bytes: string;
  estimated_bytes: string;
  nlink: number;
  duration_secs: number;
}

export interface TranscodeExcludedFile {
  file_id: number;
  title: string;
  reason: string;
}

export type TranscodeEstimateSource = "rough" | "refined" | "target";

export interface TranscodeEstimate {
  files: TranscodeEstimateFile[];
  excluded: TranscodeExcludedFile[];
  total_source_bytes: string;
  total_estimated_bytes: string;
  total_duration_secs: number;
  /** Bytes of audio after conversion, summed; lets the client derive a target bitrate. */
  total_audio_bytes: string;
  range_pct: number;
  frees_now_bytes: string;
  frees_after_seeding_bytes: string;
  /** Extra disk used until seeding copies are removed. */
  temporary_growth_bytes: string;
  eta_secs: number;
  source: TranscodeEstimateSource;
  refined_files: number;
  refined_clips: number;
  /** Lossless audio tracks that the convert toggle would change, first file only. */
  audio_changes: { label: string; to: string }[];
  source_height: number | null;
}

export interface TranscodeLiveProgress {
  progress: number;
  fps: number | null;
  speed: number | null;
  eta_secs: number | null;
  current_bytes: string | null;
}

export interface TranscodeJob {
  id: number;
  media_file_id: number | null;
  media_id: number | null;
  batch_id: string;
  title: string;
  position: number;
  status: TranscodeJobStatus;
  step: TranscodeStep | null;
  settings: TranscodeJobSettings;
  source_bytes: string;
  estimated_bytes: string | null;
  output_bytes: string | null;
  source_nlink: number | null;
  progress: number | null;
  ssim_avg: number | null;
  ssim_min: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  poster_url: string | null;
  live: TranscodeLiveProgress | null;
}

export interface TranscodeQueueSettings {
  paused: boolean;
  window_enabled: boolean;
  window_start: string;
  window_end: string;
  ssim_threshold: number;
  ssim_clip_min: number;
  cpu_threads: number | null;
}

export type TranscodeQueueState =
  | "running"
  | "paused"
  | "waiting_window"
  | "idle";

export interface TranscodeSummary {
  show: boolean;
  state: TranscodeQueueState;
  window_start: string;
  current: TranscodeJob | null;
  next: TranscodeJob[];
  queued_count: number;
  queued_source_bytes: string;
  queued_eta_secs: number;
  saved_bytes_30d: string;
  done_count_30d: number;
  frees_after_seeding_bytes: string;
  failed_count: number;
}

export interface TranscodeJobsResponse {
  jobs: TranscodeJob[];
}
```

Add to `apps/shared/src/types/index.ts` after the last `export *` line:
```ts
export * from "@rawkoon/api/services/transcode/transcode";
```

- [ ] **Step 2: Write the failing schema test**

`apps/api/src/services/transcode/settingsSchema.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import {
  enqueueBodySchema,
  jobSettingsSchema,
  moveBodySchema,
} from "@rawkoon/api/services/transcode/settingsSchema";

const base = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

describe("jobSettingsSchema", () => {
  it("accepts a quality-mode settings object", () => {
    expect(jobSettingsSchema.parse(base)).toEqual(base as never);
  });

  it("requires targetVideoKbps in target mode", () => {
    expect(() => jobSettingsSchema.parse({ ...base, mode: "target" })).toThrow();
    expect(
      jobSettingsSchema.parse({ ...base, mode: "target", targetVideoKbps: 3000 })
        .targetVideoKbps,
    ).toBe(3000);
  });

  it("rejects unknown codecs and resolutions", () => {
    expect(() => jobSettingsSchema.parse({ ...base, codec: "h264" })).toThrow();
    expect(() => jobSettingsSchema.parse({ ...base, resolution: 480 })).toThrow();
  });
});

describe("enqueueBodySchema", () => {
  it("requires a non-empty selection", () => {
    expect(() => enqueueBodySchema.parse({ selection: {}, settings: base })).toThrow();
    expect(
      enqueueBodySchema.parse({ selection: { media_id: 3, season: 1 }, settings: base })
        .selection.season,
    ).toBe(1);
  });
});

describe("moveBodySchema", () => {
  it("accepts exactly one of top / before_id / after_id", () => {
    expect(moveBodySchema.parse({ top: true }).top).toBe(true);
    expect(() => moveBodySchema.parse({})).toThrow();
    expect(() => moveBodySchema.parse({ top: true, before_id: 2 })).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/settingsSchema.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/services/transcode/settingsSchema`.

- [ ] **Step 4: Implement the schemas**

`apps/api/src/services/transcode/settingsSchema.ts`:
```ts
import { z } from "zod";

export const jobSettingsSchema = z
  .object({
    codec: z.enum(["hevc", "av1"]),
    encoder: z.enum(["software", "vaapi"]),
    resolution: z.union([z.literal("keep"), z.literal(1080), z.literal(720)]),
    mode: z.enum(["quality", "target"]),
    preset: z.enum(["high", "balanced", "small"]),
    quality: z.number().int().min(0).max(255).optional(),
    speed: z.enum(["slower", "default", "faster"]),
    targetVideoKbps: z.number().int().min(100).max(200_000).optional(),
    convertLosslessAudio: z.boolean(),
  })
  .refine((s) => s.mode !== "target" || s.targetVideoKbps != null, {
    message: "targetVideoKbps is required in target mode",
  });

export const selectionSchema = z
  .object({
    file_ids: z.array(z.number().int().positive()).min(1).max(2000).optional(),
    media_id: z.number().int().positive().optional(),
    season: z.number().int().min(0).optional(),
  })
  .refine((s) => (s.file_ids?.length ?? 0) > 0 || s.media_id != null, {
    message: "Select files or a media item",
  });

export const estimateBodySchema = z.object({
  selection: selectionSchema,
  settings: jobSettingsSchema,
  refine: z.boolean().optional(),
});

export const enqueueBodySchema = z.object({
  selection: selectionSchema,
  settings: jobSettingsSchema,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const queueSettingsPatchSchema = z.object({
  paused: z.boolean().optional(),
  window_enabled: z.boolean().optional(),
  window_start: hhmm.optional(),
  window_end: hhmm.optional(),
  ssim_threshold: z.number().min(0.5).max(1).optional(),
  ssim_clip_min: z.number().min(0.5).max(1).optional(),
  cpu_threads: z.number().int().min(1).max(256).nullable().optional(),
});

export const moveBodySchema = z
  .object({
    top: z.literal(true).optional(),
    before_id: z.number().int().positive().optional(),
    after_id: z.number().int().positive().optional(),
  })
  .refine(
    (b) =>
      [b.top != null, b.before_id != null, b.after_id != null].filter(Boolean)
        .length === 1,
    { message: "Provide exactly one of top, before_id, after_id" },
  );

export type JobSettingsInput = z.infer<typeof jobSettingsSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/transcode/settingsSchema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/shared/src/types/transcode.ts apps/shared/src/types/index.ts apps/api/src/services/transcode/settingsSchema.ts apps/api/src/services/transcode/settingsSchema.test.ts
git commit -m "feat(transcode): add shared types and request schemas"
```

---

### Task 2: Database models and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add models; add back-relations on `MediaFile` and `LibraryMedia`)
- Create: `apps/api/prisma/migrations/20260925000000_transcode_queue/migration.sql`

**Interfaces:**
- Produces: Prisma delegates `prisma.transcodeJob`, `prisma.transcodeSettings` with the fields below.

- [ ] **Step 1: Add the models**

Append to `apps/api/prisma/schema.prisma`:
```prisma
model TranscodeJob {
  id             Int           @id @default(autoincrement())
  mediaFileId    Int?          @map("media_file_id")
  mediaId        Int?          @map("media_id")
  batchId        String        @map("batch_id") @db.Uuid
  title          String
  position       Float
  status         String        @default("queued")
  step           String?
  settings       Json
  sourceBytes    BigInt        @map("source_bytes")
  estimatedBytes BigInt?       @map("estimated_bytes")
  outputBytes    BigInt?       @map("output_bytes")
  sourceNlink    Int?          @map("source_nlink")
  progress       Float?
  ssimAvg        Float?        @map("ssim_avg")
  ssimMin        Float?        @map("ssim_min")
  error          String?
  createdAt      DateTime      @default(now()) @map("created_at")
  startedAt      DateTime?     @map("started_at")
  finishedAt     DateTime?     @map("finished_at")
  mediaFile      MediaFile?    @relation(fields: [mediaFileId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  media          LibraryMedia? @relation(fields: [mediaId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([status, position], map: "ix_transcode_jobs_status_position")
  @@index([batchId], map: "ix_transcode_jobs_batch_id")
  @@map("transcode_jobs")
}

model TranscodeSettings {
  id            Int      @id @default(1)
  paused        Boolean  @default(false)
  windowEnabled Boolean  @default(false) @map("window_enabled")
  windowStart   String   @default("01:00") @map("window_start")
  windowEnd     String   @default("08:00") @map("window_end")
  ssimThreshold Float    @default(0.97) @map("ssim_threshold")
  ssimClipMin   Float    @default(0.95) @map("ssim_clip_min")
  cpuThreads    Int?     @map("cpu_threads")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@map("transcode_settings")
}
```

Inside `model MediaFile { … }` add the line:
```prisma
  transcodeJobs  TranscodeJob[]
```
Inside `model LibraryMedia { … }` add the line:
```prisma
  transcodeJobs  TranscodeJob[]
```

- [ ] **Step 2: Write the migration SQL**

`apps/api/prisma/migrations/20260925000000_transcode_queue/migration.sql`:
```sql
CREATE TABLE "transcode_jobs" (
  "id" SERIAL PRIMARY KEY,
  "media_file_id" INTEGER REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "media_id" INTEGER REFERENCES "library_media"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "batch_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "position" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "step" TEXT,
  "settings" JSONB NOT NULL,
  "source_bytes" BIGINT NOT NULL,
  "estimated_bytes" BIGINT,
  "output_bytes" BIGINT,
  "source_nlink" INTEGER,
  "progress" DOUBLE PRECISION,
  "ssim_avg" DOUBLE PRECISION,
  "ssim_min" DOUBLE PRECISION,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3)
);

CREATE INDEX "ix_transcode_jobs_status_position" ON "transcode_jobs"("status", "position");
CREATE INDEX "ix_transcode_jobs_batch_id" ON "transcode_jobs"("batch_id");
-- One active job per file; history rows are unconstrained.
CREATE UNIQUE INDEX "ux_transcode_jobs_active_file" ON "transcode_jobs"("media_file_id")
  WHERE "status" IN ('queued', 'running');

CREATE TABLE "transcode_settings" (
  "id" INTEGER PRIMARY KEY DEFAULT 1,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "window_enabled" BOOLEAN NOT NULL DEFAULT false,
  "window_start" TEXT NOT NULL DEFAULT '01:00',
  "window_end" TEXT NOT NULL DEFAULT '08:00',
  "ssim_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.97,
  "ssim_clip_min" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
  "cpu_threads" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 3: Apply to the dev DB and generate the client**

Run: `bun run dev:services && cd apps/api && bun run db:migrate && bun run db:generate`
Expected: `1 migration applied` (`20260925000000_transcode_queue`), then `Generated Prisma Client`.

- [ ] **Step 4: Verify types compile**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260925000000_transcode_queue
git commit -m "feat(transcode): add transcode_jobs and transcode_settings tables"
```

---

### Task 3: ffprobe parsing

**Files:**
- Create: `apps/api/src/services/transcode/probe.ts`
- Test: `apps/api/src/services/transcode/probe.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ProbeStream {
  index: number; // absolute input stream index
  type: "video" | "audio" | "subtitle" | "attachment" | "data";
  ordinal: number; // index among streams of the same type (for -c:v:N)
  codec: string;
  profile: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  pixFmt: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorSpace: string | null;
  channels: number | null;
  bitRate: number | null; // bits/s
  language: string | null;
  title: string | null;
  attachedPic: boolean;
  dvProfile: number | null;
}
export interface SourceProbe {
  durationSecs: number;
  sizeBytes: bigint;
  bitRate: number | null;
  streams: ProbeStream[];
  video: ProbeStream | null; // main video (first non-attached-pic)
  isHdr: boolean;
  dvProfile: number | null;
}
export function parseProbe(json: unknown): SourceProbe;
export async function probeFile(path: string): Promise<SourceProbe>; // throws Error("ffprobe failed: …")
```

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/transcode/probe.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";

const fixture = {
  format: { duration: "5400.5", size: "4000000000", bit_rate: "5925000" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "mjpeg",
      disposition: { attached_pic: 1 },
      tags: {},
    },
    {
      index: 1,
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main 10",
      width: 3840,
      height: 2160,
      r_frame_rate: "24000/1001",
      pix_fmt: "yuv420p10le",
      color_primaries: "bt2020",
      color_transfer: "smpte2084",
      color_space: "bt2020nc",
      disposition: { attached_pic: 0 },
      side_data_list: [
        { side_data_type: "DOVI configuration record", dv_profile: 8 },
      ],
    },
    {
      index: 2,
      codec_type: "audio",
      codec_name: "truehd",
      channels: 8,
      tags: { language: "eng", title: "Main" },
      disposition: {},
    },
    {
      index: 3,
      codec_type: "audio",
      codec_name: "ac3",
      channels: 6,
      bit_rate: "640000",
      tags: { language: "fre" },
      disposition: {},
    },
    {
      index: 4,
      codec_type: "subtitle",
      codec_name: "subrip",
      tags: { language: "fre" },
      disposition: {},
    },
  ],
};

describe("parseProbe", () => {
  it("reads format fields", () => {
    const p = parseProbe(fixture);
    expect(p.durationSecs).toBeCloseTo(5400.5);
    expect(p.sizeBytes).toBe(4_000_000_000n);
    expect(p.bitRate).toBe(5_925_000);
  });

  it("mainVideo skips attached_pic", () => {
    const p = parseProbe(fixture);
    expect(p.video?.index).toBe(1);
    expect(p.video?.ordinal).toBe(1);
    expect(p.video?.fps).toBeCloseTo(23.976, 2);
  });

  it("detects HDR and Dolby Vision profile", () => {
    const p = parseProbe(fixture);
    expect(p.isHdr).toBe(true);
    expect(p.dvProfile).toBe(8);
  });

  it("assigns per-type ordinals and languages", () => {
    const p = parseProbe(fixture);
    const audio = p.streams.filter((s) => s.type === "audio");
    expect(audio.map((a) => a.ordinal)).toEqual([0, 1]);
    expect(audio.map((a) => a.language)).toEqual(["eng", "fre"]);
    expect(audio[1].bitRate).toBe(640_000);
    expect(audio[0].bitRate).toBeNull();
  });

  it("treats a file without video as video=null", () => {
    const p = parseProbe({ format: { duration: "10", size: "10" }, streams: [] });
    expect(p.video).toBeNull();
    expect(p.isHdr).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/probe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/services/transcode/probe.ts`:
```ts
type RawStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  color_primaries?: string;
  color_transfer?: string;
  color_space?: string;
  channels?: number;
  bit_rate?: string;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
  side_data_list?: { side_data_type?: string; dv_profile?: number }[];
};

type RawProbe = {
  format?: { duration?: string; size?: string; bit_rate?: string };
  streams?: RawStream[];
};

export interface ProbeStream {
  index: number;
  type: "video" | "audio" | "subtitle" | "attachment" | "data";
  ordinal: number;
  codec: string;
  profile: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  pixFmt: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorSpace: string | null;
  channels: number | null;
  bitRate: number | null;
  language: string | null;
  title: string | null;
  attachedPic: boolean;
  dvProfile: number | null;
}

export interface SourceProbe {
  durationSecs: number;
  sizeBytes: bigint;
  bitRate: number | null;
  streams: ProbeStream[];
  video: ProbeStream | null;
  isHdr: boolean;
  dvProfile: number | null;
}

const TYPES = new Set(["video", "audio", "subtitle", "attachment", "data"]);

function num(v: string | number | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function rate(v: string | undefined): number | null {
  if (!v) return null;
  const [a, b] = v.split("/").map(Number);
  if (!a || !b) return null;
  return a / b;
}

export function parseProbe(json: unknown): SourceProbe {
  const raw = (json ?? {}) as RawProbe;
  const counters: Record<string, number> = {};
  const streams: ProbeStream[] = [];
  for (const s of raw.streams ?? []) {
    const type = s.codec_type ?? "data";
    if (!TYPES.has(type)) continue;
    const ordinal = counters[type] ?? 0;
    counters[type] = ordinal + 1;
    const dv = s.side_data_list?.find(
      (d) => d.side_data_type === "DOVI configuration record",
    );
    streams.push({
      index: s.index ?? streams.length,
      type: type as ProbeStream["type"],
      ordinal,
      codec: s.codec_name ?? "unknown",
      profile: s.profile ?? null,
      width: s.width ?? null,
      height: s.height ?? null,
      fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
      pixFmt: s.pix_fmt ?? null,
      colorPrimaries: s.color_primaries ?? null,
      colorTransfer: s.color_transfer ?? null,
      colorSpace: s.color_space ?? null,
      channels: s.channels ?? null,
      bitRate: num(s.bit_rate),
      language: s.tags?.language ?? null,
      title: s.tags?.title ?? null,
      attachedPic: s.disposition?.attached_pic === 1,
      dvProfile: dv?.dv_profile ?? null,
    });
  }
  const video =
    streams.find((s) => s.type === "video" && !s.attachedPic) ?? null;
  const transfer = video?.colorTransfer ?? "";
  return {
    durationSecs: num(raw.format?.duration) ?? 0,
    sizeBytes: BigInt(raw.format?.size ?? "0"),
    bitRate: num(raw.format?.bit_rate),
    streams,
    video,
    isHdr: transfer === "smpte2084" || transfer === "arib-std-b67",
    dvProfile: video?.dvProfile ?? null,
  };
}

export async function probeFile(path: string): Promise<SourceProbe> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), 60_000);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`ffprobe failed: ${err.trim().slice(0, 300)}`);
  return parseProbe(JSON.parse(out));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/transcode/probe.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/transcode/probe.ts apps/api/src/services/transcode/probe.test.ts
git commit -m "feat(transcode): parse ffprobe output into a typed source probe"
```

---

### Task 4: Presets and ffmpeg argument builders

**Files:**
- Create: `apps/api/src/services/transcode/presets.ts`
- Create: `apps/api/src/services/transcode/buildArgs.ts`
- Test: `apps/api/src/services/transcode/buildArgs.test.ts`

**Interfaces:**
- Consumes: `SourceProbe`, `ProbeStream` (Task 3); `TranscodeJobSettings` (Task 1).
- Produces:
```ts
// presets.ts
export function qualityValue(s: TranscodeJobSettings): number;
export function speedValue(s: TranscodeJobSettings): string;
export function targetHeight(s: TranscodeJobSettings, source: SourceProbe): number | null; // null = keep
export function isLosslessAudio(st: ProbeStream): boolean;
export function eac3BitrateFor(channels: number | null): { kbps: number; channels: number };
export const ROUGH_KBPS_1080: Record<string, Record<TranscodePreset, number>>; // key `${encoder}:${codec}`
export const ROUGH_FPS_1080: Record<string, Record<TranscodeSpeed, number>>;
// buildArgs.ts
export interface EncodeArgsInput {
  input: string; output: string; probe: SourceProbe; settings: TranscodeJobSettings;
  threads: number; vaapiDevice: string | null;
  clip?: { start: number; duration: number }; // sample clip: video only
}
export function buildEncodeArgs(i: EncodeArgsInput): string[];
export function buildClipCutArgs(input: string, output: string, probe: SourceProbe, start: number, duration: number): string[];
```

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/transcode/buildArgs.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import {
  buildClipCutArgs,
  buildEncodeArgs,
} from "@rawkoon/api/services/transcode/buildArgs";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";

const settings: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

const sdrMkv = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p" },
    { index: 1, codec_type: "audio", codec_name: "truehd", channels: 8 },
    { index: 2, codec_type: "audio", codec_name: "ac3", channels: 6 },
    { index: 3, codec_type: "subtitle", codec_name: "subrip" },
  ],
});

const hdrWithCover = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
    {
      index: 1, codec_type: "video", codec_name: "hevc", width: 3840, height: 2160,
      pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc",
    },
    { index: 2, codec_type: "audio", codec_name: "eac3", channels: 6 },
  ],
});

const mp4 = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 1280, height: 720, pix_fmt: "yuv420p" },
    { index: 1, codec_type: "audio", codec_name: "aac", channels: 2 },
    { index: 2, codec_type: "subtitle", codec_name: "mov_text" },
    { index: 3, codec_type: "data", codec_name: "bin_data" },
  ],
});

const base = { input: "/in.mkv", output: "/out.mkv", threads: 4, vaapiDevice: null };
const expectAll = (a: string[], values: string[]) => {
  for (const v of values) expect(a).toContain(v);
};

describe("buildEncodeArgs", () => {
  it("software hevc quality: copies everything, encodes v:0 with libx265 crf", () => {
    const a = buildEncodeArgs({ ...base, probe: sdrMkv, settings });
    expect(a.slice(0, 3)).toEqual(["ffmpeg", "-nostdin", "-hide_banner"]);
    expectAll(a, ["-map", "0", "-c", "copy", "-c:v:0", "libx265", "-crf", "23", "-preset", "medium"]);
    expect(a.join(" ")).toContain("-map -0:d");
    expect(a).toContain("-progress");
    expect(a.at(-1)).toBe("/out.mkv");
    expect(a.join(" ")).not.toContain("eac3");
  });

  it("encodes the ordinal of the main video, not attached pic", () => {
    const a = buildEncodeArgs({ ...base, probe: hdrWithCover, settings });
    expect(a).toContain("-c:v:1");
    expect(a).not.toContain("-c:v:0");
  });

  it("keeps HDR: 10-bit pix_fmt and colour tags", () => {
    const a = buildEncodeArgs({ ...base, probe: hdrWithCover, settings });
    expect(a.join(" ")).toContain("-pix_fmt:v:1 yuv420p10le");
    expect(a.join(" ")).toContain("-color_trc:v:1 smpte2084");
    expect(a.join(" ")).toContain("-color_primaries:v:1 bt2020");
  });

  it("downscales with a per-stream filter", () => {
    const a = buildEncodeArgs({ ...base, probe: hdrWithCover, settings: { ...settings, resolution: 1080 } });
    expect(a.join(" ")).toContain("-filter:v:1 scale=-2:1080:flags=lanczos");
  });

  it("converts lossless audio to eac3, 7.1 down to 5.1", () => {
    const a = buildEncodeArgs({ ...base, probe: sdrMkv, settings: { ...settings, convertLosslessAudio: true } });
    const j = a.join(" ");
    expect(j).toContain("-c:a:0 eac3 -b:a:0 768k -ac:a:0 6");
    expect(j).not.toContain("-c:a:1 eac3");
  });

  it("mp4 source maps subs to srt and drops data", () => {
    const a = buildEncodeArgs({ ...base, probe: mp4, settings });
    const j = a.join(" ");
    expect(j).toContain("-c:s:0 srt");
    expect(j).toContain("-map -0:d");
  });

  it("svt-av1 uses preset number and 10-bit", () => {
    const a = buildEncodeArgs({ ...base, probe: sdrMkv, settings: { ...settings, codec: "av1" } });
    expectAll(a, ["libsvtav1", "-crf", "30", "-preset", "6"]);
    expect(a.join(" ")).toContain("-pix_fmt:v:0 yuv420p10le");
  });

  it("vaapi hevc uploads frames and uses CQP", () => {
    const a = buildEncodeArgs({ ...base, probe: sdrMkv, vaapiDevice: "/dev/dri/renderD128", settings: { ...settings, encoder: "vaapi" } });
    const j = a.join(" ");
    expect(j).toContain("-init_hw_device vaapi=va:/dev/dri/renderD128");
    expect(j).toContain("-filter_hw_device va");
    expect(j).toContain("-filter:v:0 format=nv12,hwupload");
    expect(j).toContain("-c:v:0 hevc_vaapi -rc_mode CQP -qp 24");
  });

  it("target mode sets bitrate with vbv", () => {
    const a = buildEncodeArgs({ ...base, probe: sdrMkv, settings: { ...settings, mode: "target", targetVideoKbps: 3000 } });
    const j = a.join(" ");
    expect(j).toContain("-b:v:0 3000k");
    expect(j).toContain("-maxrate:v:0 4500k");
    expect(j).not.toContain("-crf");
  });

  it("advanced quality overrides the preset", () => {
    const a = buildEncodeArgs({ ...base, probe: sdrMkv, settings: { ...settings, quality: 19 } });
    expectAll(a, ["-crf", "19"]);
  });

  it("clip mode seeks and maps only the main video", () => {
    const a = buildEncodeArgs({ ...base, probe: hdrWithCover, settings, clip: { start: 50, duration: 10 } });
    const j = a.join(" ");
    expect(j).toContain("-ss 50 -t 10 -i /in.mkv");
    expect(j).toContain("-map 0:1 -an -sn -dn");
    expect(j).toContain("-c:v:0 libx265");
  });
});

describe("buildClipCutArgs", () => {
  it("stream-copies the main video only", () => {
    expect(buildClipCutArgs("/in.mkv", "/c.mkv", hdrWithCover, 12, 10).join(" ")).toBe(
      "ffmpeg -nostdin -hide_banner -y -loglevel error -ss 12 -t 10 -i /in.mkv -map 0:1 -c copy -an -sn -dn -f matroska /c.mkv",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/buildArgs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement presets**

`apps/api/src/services/transcode/presets.ts`:
```ts
import type {
  TranscodeJobSettings,
  TranscodePreset,
  TranscodeSpeed,
} from "@rawkoon/shared/types";
import type { ProbeStream, SourceProbe } from "@rawkoon/api/services/transcode/probe";

const QUALITY: Record<string, Record<TranscodePreset, number>> = {
  "software:hevc": { high: 20, balanced: 23, small: 26 },
  "software:av1": { high: 26, balanced: 30, small: 35 },
  "vaapi:hevc": { high: 20, balanced: 24, small: 28 },
  // av1_vaapi QP spans 0-255.
  "vaapi:av1": { high: 80, balanced: 110, small: 140 },
};

const SPEED: Record<string, Record<TranscodeSpeed, string>> = {
  "software:hevc": { slower: "slow", default: "medium", faster: "fast" },
  "software:av1": { slower: "4", default: "6", faster: "8" },
};

/** Rough 1080p24 video bitrate in kbps per quality preset; scaled by pixels^0.75 and fps. */
export const ROUGH_KBPS_1080: Record<string, Record<TranscodePreset, number>> = {
  "software:hevc": { high: 5000, balanced: 3200, small: 2000 },
  "software:av1": { high: 3800, balanced: 2400, small: 1500 },
  "vaapi:hevc": { high: 6000, balanced: 4000, small: 2600 },
  "vaapi:av1": { high: 4800, balanced: 3000, small: 1900 },
};

/** Rough 1080p encode fps; scaled by 1080p pixel count / source pixel count. */
export const ROUGH_FPS_1080: Record<string, Record<TranscodeSpeed, number>> = {
  "software:hevc": { slower: 8, default: 18, faster: 35 },
  "software:av1": { slower: 6, default: 20, faster: 45 },
  "vaapi:hevc": { slower: 180, default: 220, faster: 260 },
  "vaapi:av1": { slower: 160, default: 200, faster: 240 },
};

export function comboKey(s: TranscodeJobSettings): string {
  return `${s.encoder}:${s.codec}`;
}

export function qualityValue(s: TranscodeJobSettings): number {
  return s.quality ?? QUALITY[comboKey(s)][s.preset];
}

export function speedValue(s: TranscodeJobSettings): string {
  return SPEED[comboKey(s)]?.[s.speed] ?? "";
}

export function targetHeight(
  s: TranscodeJobSettings,
  source: SourceProbe,
): number | null {
  if (s.resolution === "keep") return null;
  const h = source.video?.height ?? 0;
  return s.resolution < h ? s.resolution : null;
}

const LOSSLESS = new Set(["truehd", "flac", "mlp", "alac"]);

export function isLosslessAudio(st: ProbeStream): boolean {
  if (st.type !== "audio") return false;
  if (LOSSLESS.has(st.codec) || st.codec.startsWith("pcm_")) return true;
  return st.codec === "dts" && /MA|HD MA/i.test(st.profile ?? "");
}

export function eac3BitrateFor(channels: number | null): {
  kbps: number;
  channels: number;
} {
  const ch = channels ?? 2;
  // ffmpeg's eac3 encoder tops out at 5.1.
  if (ch > 6) return { kbps: 768, channels: 6 };
  if (ch > 2) return { kbps: 640, channels: ch };
  return { kbps: 224, channels: ch };
}
```

- [ ] **Step 4: Implement buildArgs**

`apps/api/src/services/transcode/buildArgs.ts`:
```ts
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";
import {
  eac3BitrateFor,
  isLosslessAudio,
  qualityValue,
  speedValue,
  targetHeight,
} from "@rawkoon/api/services/transcode/presets";

export interface EncodeArgsInput {
  input: string;
  output: string;
  probe: SourceProbe;
  settings: TranscodeJobSettings;
  threads: number;
  vaapiDevice: string | null;
  clip?: { start: number; duration: number };
}

const HEAD = ["ffmpeg", "-nostdin", "-hide_banner", "-y"];

function encoderName(s: TranscodeJobSettings): string {
  if (s.encoder === "vaapi") return s.codec === "hevc" ? "hevc_vaapi" : "av1_vaapi";
  return s.codec === "hevc" ? "libx265" : "libsvtav1";
}

function videoArgs(
  i: EncodeArgsInput,
  n: number,
): string[] {
  const { settings: s, probe } = i;
  const v = probe.video!;
  const tenBit = s.codec === "av1" || probe.isHdr || (v.pixFmt ?? "").includes("10");
  const h = targetHeight(s, probe);
  const scale = h ? `scale=-2:${h}:flags=lanczos` : null;
  const out: string[] = [];

  if (s.encoder === "vaapi") {
    const chain = [scale, `format=${tenBit ? "p010" : "nv12"}`, "hwupload"]
      .filter(Boolean)
      .join(",");
    out.push(`-filter:v:${n}`, chain);
  } else if (scale) {
    out.push(`-filter:v:${n}`, scale);
  }

  out.push(`-c:v:${n}`, encoderName(s));

  if (s.mode === "target") {
    const kbps = s.targetVideoKbps!;
    if (s.encoder === "vaapi") out.push("-rc_mode", "VBR");
    out.push(
      `-b:v:${n}`,
      `${kbps}k`,
      `-maxrate:v:${n}`,
      `${Math.round(kbps * 1.5)}k`,
      `-bufsize:v:${n}`,
      `${kbps * 3}k`,
    );
  } else if (s.encoder === "vaapi") {
    out.push("-rc_mode", "CQP", "-qp", String(qualityValue(s)));
  } else {
    out.push("-crf", String(qualityValue(s)));
  }

  if (s.encoder === "software") {
    out.push("-preset", speedValue(s));
    out.push(`-pix_fmt:v:${n}`, tenBit ? "yuv420p10le" : "yuv420p");
    if (s.codec === "hevc") {
      out.push("-x265-params", `log-level=error:pools=${i.threads}`);
    }
  }

  if (probe.isHdr) {
    if (v.colorPrimaries) out.push(`-color_primaries:v:${n}`, v.colorPrimaries);
    if (v.colorTransfer) out.push(`-color_trc:v:${n}`, v.colorTransfer);
    if (v.colorSpace) out.push(`-colorspace:v:${n}`, v.colorSpace);
  }
  return out;
}

export function buildEncodeArgs(i: EncodeArgsInput): string[] {
  const { probe, settings } = i;
  const v = probe.video;
  if (!v) throw new Error("Source has no video stream");
  const args = [...HEAD, "-loglevel", "error"];
  if (settings.encoder === "vaapi") {
    if (!i.vaapiDevice) throw new Error("VAAPI device not available");
    args.push("-init_hw_device", `vaapi=va:${i.vaapiDevice}`, "-filter_hw_device", "va");
  }
  if (i.clip) args.push("-ss", String(i.clip.start), "-t", String(i.clip.duration));
  args.push("-i", i.input);
  if (settings.encoder === "software") args.push("-threads", String(i.threads));

  if (i.clip) {
    args.push("-map", `0:${v.index}`, "-an", "-sn", "-dn");
    args.push(...videoArgs(i, 0));
  } else {
    args.push("-map", "0", "-map", "-0:d", "-c", "copy");
    args.push(...videoArgs(i, v.ordinal));
    if (settings.convertLosslessAudio) {
      for (const a of probe.streams.filter(isLosslessAudio)) {
        const { kbps, channels } = eac3BitrateFor(a.channels);
        args.push(`-c:a:${a.ordinal}`, "eac3", `-b:a:${a.ordinal}`, `${kbps}k`);
        if (channels !== a.channels) args.push(`-ac:a:${a.ordinal}`, String(channels));
      }
    }
    for (const s of probe.streams) {
      if (s.type === "subtitle" && s.codec === "mov_text") args.push(`-c:s:${s.ordinal}`, "srt");
    }
    args.push("-max_muxing_queue_size", "4096");
  }
  args.push("-progress", "pipe:1", "-nostats", "-f", "matroska", i.output);
  return args;
}

export function buildClipCutArgs(
  input: string,
  output: string,
  probe: SourceProbe,
  start: number,
  duration: number,
): string[] {
  if (!probe.video) throw new Error("Source has no video stream");
  return [
    ...HEAD,
    "-loglevel",
    "error",
    "-ss",
    String(start),
    "-t",
    String(duration),
    "-i",
    input,
    "-map",
    `0:${probe.video.index}`,
    "-c",
    "copy",
    "-an",
    "-sn",
    "-dn",
    "-f",
    "matroska",
    output,
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/transcode/buildArgs.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/transcode/presets.ts apps/api/src/services/transcode/buildArgs.ts apps/api/src/services/transcode/buildArgs.test.ts
git commit -m "feat(transcode): build ffmpeg arguments for software and VAAPI encodes"
```

---

### Task 5: Queue math (run window, positions)

**Files:**
- Create: `apps/api/src/services/transcode/queueMath.ts`
- Test: `apps/api/src/services/transcode/queueMath.test.ts`

**Interfaces:**
- Produces:
```ts
export function isInsideWindow(now: Date, start: string, end: string): boolean;
export function positionBetween(prev: number | null, next: number | null): number;
export function blockToTop(minQueued: number | null, count: number): number[];
```

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/transcode/queueMath.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import {
  blockToTop,
  isInsideWindow,
  positionBetween,
} from "@rawkoon/api/services/transcode/queueMath";

const at = (h: number, m: number) => new Date(2026, 0, 1, h, m);

describe("isInsideWindow", () => {
  it("same-day window", () => {
    expect(isInsideWindow(at(1, 0), "01:00", "08:00")).toBe(true);
    expect(isInsideWindow(at(7, 59), "01:00", "08:00")).toBe(true);
    expect(isInsideWindow(at(8, 0), "01:00", "08:00")).toBe(false);
    expect(isInsideWindow(at(0, 59), "01:00", "08:00")).toBe(false);
  });

  it("window crossing midnight", () => {
    expect(isInsideWindow(at(23, 30), "22:00", "06:00")).toBe(true);
    expect(isInsideWindow(at(5, 59), "22:00", "06:00")).toBe(true);
    expect(isInsideWindow(at(6, 0), "22:00", "06:00")).toBe(false);
    expect(isInsideWindow(at(21, 59), "22:00", "06:00")).toBe(false);
  });

  it("equal start and end means always open", () => {
    expect(isInsideWindow(at(12, 0), "03:00", "03:00")).toBe(true);
  });
});

describe("positionBetween", () => {
  it("midpoint, top, and tail", () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(null, 5)).toBe(4);
    expect(positionBetween(7, null)).toBe(8);
    expect(positionBetween(null, null)).toBe(1);
  });
});

describe("blockToTop", () => {
  it("places N rows in order before the current minimum", () => {
    expect(blockToTop(10, 3)).toEqual([7, 8, 9]);
    expect(blockToTop(null, 2)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/queueMath.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/services/transcode/queueMath.ts`:
```ts
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isInsideWindow(now: Date, start: string, end: string): boolean {
  const s = minutes(start);
  const e = minutes(end);
  const n = now.getHours() * 60 + now.getMinutes();
  if (s === e) return true;
  return s < e ? n >= s && n < e : n >= s || n < e;
}

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return 1;
  if (prev == null) return (next as number) - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

export function blockToTop(minQueued: number | null, count: number): number[] {
  const start = (minQueued ?? count + 1) - count;
  return Array.from({ length: count }, (_, i) => start + i);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/transcode/queueMath.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/transcode/queueMath.ts apps/api/src/services/transcode/queueMath.test.ts
git commit -m "feat(transcode): add run-window and queue position math"
```

---

### Task 6: Output path rules

**Files:**
- Create: `apps/api/src/services/transcode/outputPath.ts`
- Test: `apps/api/src/services/transcode/outputPath.test.ts`

**Interfaces:**
- Produces:
```ts
export function tmpPathFor(sourcePath: string): string;
export function origPathFor(sourcePath: string): string;
export function finalPathFor(sourcePath: string, newHeight: number | null): string;
```

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/transcode/outputPath.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import {
  finalPathFor,
  origPathFor,
  tmpPathFor,
} from "@rawkoon/api/services/transcode/outputPath";

describe("outputPath", () => {
  it("tmp and orig are hidden siblings", () => {
    expect(tmpPathFor("/lib/Movie (2010)/Movie (2010).mkv")).toBe(
      "/lib/Movie (2010)/.Movie (2010).rawkoon-tmp.mkv",
    );
    expect(origPathFor("/lib/Movie (2010)/Movie (2010).mkv")).toBe(
      "/lib/Movie (2010)/.Movie (2010).mkv.rawkoon-orig",
    );
  });

  it("finalPathFor keeps an mkv path when resolution is kept", () => {
    expect(finalPathFor("/lib/a/Show - S01E01 [1080p WEB].mkv", null)).toBe(
      "/lib/a/Show - S01E01 [1080p WEB].mkv",
    );
  });

  it("finalPathFor swaps extension", () => {
    expect(finalPathFor("/lib/a/Clip.mp4", null)).toBe("/lib/a/Clip.mkv");
    expect(finalPathFor("/lib/a/Clip.M4V", null)).toBe("/lib/a/Clip.mkv");
  });

  it("finalPathFor rewrites the resolution token when downscaling", () => {
    expect(finalPathFor("/lib/a/Movie [2160p BluRay].mkv", 1080)).toBe(
      "/lib/a/Movie [1080p BluRay].mkv",
    );
    expect(finalPathFor("/lib/a/Movie.4K.HDR.mkv", 1080)).toBe(
      "/lib/a/Movie.1080p.HDR.mkv",
    );
    expect(finalPathFor("/lib/a/Movie.mkv", 720)).toBe("/lib/a/Movie.mkv");
  });

  it("does not touch directory names", () => {
    expect(finalPathFor("/lib/2160p/Movie [2160p].mkv", 1080)).toBe(
      "/lib/2160p/Movie [1080p].mkv",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/outputPath.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/services/transcode/outputPath.ts`:
```ts
import { basename, dirname, extname, join } from "node:path";

const RES_TOKEN = /(^|[\s.[(_-])(2160p|4K|UHD|1080p|720p|576p|480p)(?=$|[\s.\])_-])/i;

export function tmpPathFor(sourcePath: string): string {
  const base = basename(sourcePath, extname(sourcePath));
  return join(dirname(sourcePath), `.${base}.rawkoon-tmp.mkv`);
}

export function origPathFor(sourcePath: string): string {
  return join(dirname(sourcePath), `.${basename(sourcePath)}.rawkoon-orig`);
}

export function finalPathFor(sourcePath: string, newHeight: number | null): string {
  let name = basename(sourcePath, extname(sourcePath));
  if (newHeight) name = name.replace(RES_TOKEN, `$1${newHeight}p`);
  return join(dirname(sourcePath), `${name}.mkv`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/transcode/outputPath.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/transcode/outputPath.ts apps/api/src/services/transcode/outputPath.test.ts
git commit -m "feat(transcode): derive temp, backup and final paths"
```

---

### Task 7: Safe file swap with EXDEV fallback and recovery

**Files:**
- Create: `apps/api/src/services/transcode/swap.ts`
- Test: `apps/api/src/services/transcode/swap.test.ts`

**Interfaces:**
- Consumes: `origPathFor` (Task 6).
- Produces:
```ts
export interface SwapFs {
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  fsync(path: string): Promise<void>;
}
export const nodeSwapFs: SwapFs;
export async function swapInPlace(o: { tmp: string; source: string; final: string; fs: SwapFs; verify: (p: string) => Promise<boolean> }): Promise<void>;
export async function recoverSwap(o: { source: string; final: string; fs: SwapFs; verify: (p: string) => Promise<boolean> }): Promise<"none" | "kept-final" | "restored-orig">;
```

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/transcode/swap.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nodeSwapFs,
  recoverSwap,
  type SwapFs,
  swapInPlace,
} from "@rawkoon/api/services/transcode/swap";
import { origPathFor } from "@rawkoon/api/services/transcode/outputPath";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rawkoon-swap-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exdevFs = (base: SwapFs, failFrom: string): SwapFs => ({
  ...base,
  rename: async (from, to) => {
    if (from === failFrom) {
      const e = new Error("cross-device") as NodeJS.ErrnoException;
      e.code = "EXDEV";
      throw e;
    }
    return base.rename(from, to);
  },
});
const ok = async () => true;

describe("swapInPlace", () => {
  it("renames tmp over the source", async () => {
    const src = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await swapInPlace({ tmp, source: src, final: src, fs: nodeSwapFs, verify: ok });
    expect(await readFile(src, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(tmp)).toBe(false);
  });

  it("removes the old source when the final path differs", async () => {
    const src = join(dir, "a.mp4");
    const fin = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await swapInPlace({ tmp, source: src, final: fin, fs: nodeSwapFs, verify: ok });
    expect(await readFile(fin, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(src)).toBe(false);
  });

  it("falls back to copy on EXDEV and cleans up", async () => {
    const src = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await swapInPlace({ tmp, source: src, final: src, fs: exdevFs(nodeSwapFs, tmp), verify: ok });
    expect(await readFile(src, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(origPathFor(src))).toBe(false);
    expect(await nodeSwapFs.exists(tmp)).toBe(false);
  });

  it("restores the original when the copied file fails verification", async () => {
    const src = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await expect(
      swapInPlace({ tmp, source: src, final: src, fs: exdevFs(nodeSwapFs, tmp), verify: async () => false }),
    ).rejects.toThrow("verification");
    expect(await readFile(src, "utf8")).toBe("old");
    expect(await nodeSwapFs.exists(origPathFor(src))).toBe(false);
  });
});

describe("recoverSwap", () => {
  it("returns none when there is no orig", async () => {
    const src = join(dir, "a.mkv");
    await writeFile(src, "x");
    expect(await recoverSwap({ source: src, final: src, fs: nodeSwapFs, verify: ok })).toBe("none");
  });

  it("recoverSwap restores orig when final is invalid", async () => {
    const src = join(dir, "a.mkv");
    await writeFile(origPathFor(src), "old");
    await writeFile(src, "half-copied");
    const r = await recoverSwap({ source: src, final: src, fs: nodeSwapFs, verify: async () => false });
    expect(r).toBe("restored-orig");
    expect(await readFile(src, "utf8")).toBe("old");
  });

  it("keeps a valid final and deletes orig", async () => {
    const src = join(dir, "a.mkv");
    await writeFile(origPathFor(src), "old");
    await writeFile(src, "new");
    const r = await recoverSwap({ source: src, final: src, fs: nodeSwapFs, verify: ok });
    expect(r).toBe("kept-final");
    expect(await readFile(src, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(origPathFor(src))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/swap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/services/transcode/swap.ts`:
```ts
import { access, copyFile, open, rename, unlink } from "node:fs/promises";
import { origPathFor } from "@rawkoon/api/services/transcode/outputPath";

export interface SwapFs {
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  fsync(path: string): Promise<void>;
}

export const nodeSwapFs: SwapFs = {
  rename,
  copyFile,
  unlink,
  exists: async (p) => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
  fsync: async (p) => {
    const fh = await open(p, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  },
};

async function quietUnlink(fs: SwapFs, p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    /* already gone */
  }
}

export async function swapInPlace(o: {
  tmp: string;
  source: string;
  final: string;
  fs: SwapFs;
  verify: (p: string) => Promise<boolean>;
}): Promise<void> {
  const { tmp, source, final, fs } = o;
  try {
    await fs.rename(tmp, final);
    if (final !== source) await quietUnlink(fs, source);
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
  }
  // Union filesystems can place tmp on another branch; keep the original reachable until the copy is proven.
  const orig = origPathFor(source);
  await fs.rename(source, orig);
  try {
    await fs.copyFile(tmp, final);
    await fs.fsync(final);
    if (!(await o.verify(final))) throw new Error("Copied file failed verification");
  } catch (err) {
    if (final !== source || (await fs.exists(final))) await quietUnlink(fs, final);
    await fs.rename(orig, source);
    throw err;
  }
  await quietUnlink(fs, orig);
  await quietUnlink(fs, tmp);
}

export async function recoverSwap(o: {
  source: string;
  final: string;
  fs: SwapFs;
  verify: (p: string) => Promise<boolean>;
}): Promise<"none" | "kept-final" | "restored-orig"> {
  const { source, final, fs } = o;
  const orig = origPathFor(source);
  if (!(await fs.exists(orig))) return "none";
  if ((await fs.exists(final)) && (await o.verify(final))) {
    await quietUnlink(fs, orig);
    return "kept-final";
  }
  await quietUnlink(fs, final);
  await fs.rename(orig, source);
  return "restored-orig";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/transcode/swap.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/transcode/swap.ts apps/api/src/services/transcode/swap.test.ts
git commit -m "feat(transcode): swap files atomically with a cross-device fallback"
```

---

### Task 8: ffmpeg runner and progress parsing

**Files:**
- Create: `apps/api/src/services/transcode/ffmpegRunner.ts`
- Test: `apps/api/src/services/transcode/ffmpegRunner.test.ts`

**Interfaces:**
- Produces:
```ts
export interface FfmpegProgress { outTimeSecs: number | null; fps: number | null; speed: number | null; totalSize: number | null; done: boolean }
export function parseProgressBlock(block: string): FfmpegProgress;
export interface RunResult { code: number | null; signal: string | null; stderr: string; aborted: boolean }
export type RunFfmpeg = (args: string[], opts: { signal?: AbortSignal; onProgress?: (p: FfmpegProgress) => void; nice?: boolean }) => Promise<RunResult>;
export const runFfmpeg: RunFfmpeg;
export function describeFailure(r: RunResult): string;
```

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/transcode/ffmpegRunner.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import {
  describeFailure,
  parseProgressBlock,
} from "@rawkoon/api/services/transcode/ffmpegRunner";

describe("parseProgressBlock", () => {
  it("reads out_time_us, fps, speed and size", () => {
    const p = parseProgressBlock(
      "frame=240\nfps=48.5\nout_time_us=10000000\ntotal_size=5242880\nspeed=2.02x\nprogress=continue\n",
    );
    expect(p).toEqual({ outTimeSecs: 10, fps: 48.5, speed: 2.02, totalSize: 5242880, done: false });
  });

  it("marks end and tolerates N/A", () => {
    const p = parseProgressBlock("out_time_us=N/A\nspeed=N/A\nprogress=end\n");
    expect(p.done).toBe(true);
    expect(p.outTimeSecs).toBeNull();
    expect(p.speed).toBeNull();
  });
});

describe("describeFailure", () => {
  it("explains an OOM kill", () => {
    expect(describeFailure({ code: null, signal: "SIGKILL", stderr: "", aborted: false })).toBe(
      "ffmpeg killed (out of memory?)",
    );
  });

  it("uses the last stderr line", () => {
    expect(
      describeFailure({ code: 1, signal: null, stderr: "a\nError while opening encoder\n", aborted: false }),
    ).toBe("ffmpeg exited 1: Error while opening encoder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/ffmpegRunner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/services/transcode/ffmpegRunner.ts`:
```ts
export interface FfmpegProgress {
  outTimeSecs: number | null;
  fps: number | null;
  speed: number | null;
  totalSize: number | null;
  done: boolean;
}

export interface RunResult {
  code: number | null;
  signal: string | null;
  stderr: string;
  aborted: boolean;
}

export type RunFfmpeg = (
  args: string[],
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: FfmpegProgress) => void;
    nice?: boolean;
  },
) => Promise<RunResult>;

function n(v: string | undefined): number | null {
  if (v == null) return null;
  const x = Number.parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

export function parseProgressBlock(block: string): FfmpegProgress {
  const kv: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const us = n(kv.out_time_us);
  return {
    outTimeSecs: us == null ? null : us / 1_000_000,
    fps: n(kv.fps),
    speed: n(kv.speed?.replace(/x$/, "")),
    totalSize: n(kv.total_size),
    done: kv.progress === "end",
  };
}

export function describeFailure(r: RunResult): string {
  if (r.aborted) return "Cancelled";
  if (r.signal === "SIGKILL") return "ffmpeg killed (out of memory?)";
  const last = r.stderr.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return `ffmpeg exited ${r.code ?? r.signal}: ${last}`.trim().slice(0, 500);
}

export const runFfmpeg: RunFfmpeg = async (args, opts) => {
  const cmd = opts.nice ? ["nice", "-n", "10", ...args] : args;
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  let aborted = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    aborted = true;
    proc.kill("SIGTERM");
    killTimer = setTimeout(() => proc.kill("SIGKILL"), 10_000);
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const readProgress = (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let idx = buf.search(/progress=(continue|end)\n/);
      while (idx >= 0) {
        const end = buf.indexOf("\n", idx) + 1;
        opts.onProgress?.(parseProgressBlock(buf.slice(0, end)));
        buf = buf.slice(end);
        idx = buf.search(/progress=(continue|end)\n/);
      }
    }
  })();
  const stderrP = new Response(proc.stderr).text();
  const code = await proc.exited;
  await readProgress;
  const stderr = (await stderrP).slice(-4000);
  if (killTimer) clearTimeout(killTimer);
  opts.signal?.removeEventListener("abort", onAbort);
  return { code, signal: proc.signalCode ?? null, stderr, aborted };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/transcode/ffmpegRunner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/transcode/ffmpegRunner.ts apps/api/src/services/transcode/ffmpegRunner.test.ts
git commit -m "feat(transcode): run ffmpeg with progress parsing and cancellation"
```

---

### Task 9: Estimates and validation

**Files:**
- Create: `apps/api/src/services/transcode/estimate.ts`
- Create: `apps/api/src/services/transcode/validate.ts`
- Test: `apps/api/src/services/transcode/estimate.test.ts`
- Test: `apps/api/src/services/transcode/validate.test.ts`

**Interfaces:**
- Consumes: `SourceProbe` (3), presets + `buildEncodeArgs`/`buildClipCutArgs` (4), `RunFfmpeg` (8).
- Produces:
```ts
// estimate.ts
export interface FileEstimate { videoBytes: bigint; audioBytes: bigint; totalBytes: bigint; etaSecs: number }
export function roughEstimate(probe: SourceProbe, s: TranscodeJobSettings): FileEstimate;
export function clipStarts(durationSecs: number, count: number, clipSecs: number): number[];
export function applyRatio(probe: SourceProbe, s: TranscodeJobSettings, ratios: number[]): { est: FileEstimate; rangePct: number };
export async function sampleRatios(o: { input: string; probe: SourceProbe; settings: TranscodeJobSettings; workDir: string; run: RunFfmpeg; threads: number; vaapiDevice: string | null; statSize: (p: string) => Promise<number> }): Promise<{ ratios: number[]; fps: number | null }>;
export const SAMPLE_CLIPS = 6; export const SAMPLE_SECS = 10;
// validate.ts
export function checkStructure(source: SourceProbe, output: SourceProbe, s: TranscodeJobSettings): string | null;
export function checkSsim(scores: number[], t: { avg: number; min: number }): string | null;
export function parseSsimAll(stderr: string): number | null;
export async function measureSsim(o: { source: string; output: string; sourceProbe: SourceProbe; outputProbe: SourceProbe; run: RunFfmpeg }): Promise<number[]>;
```

- [ ] **Step 1: Write the failing estimate test**

`apps/api/src/services/transcode/estimate.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import {
  applyRatio,
  clipStarts,
  roughEstimate,
} from "@rawkoon/api/services/transcode/estimate";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";

const s: TranscodeJobSettings = {
  codec: "hevc", encoder: "software", resolution: "keep", mode: "quality",
  preset: "balanced", speed: "default", convertLosslessAudio: false,
};

// 1 h, 1080p24, 20 Mb/s video + one 640 kb/s AC3 track.
const probe = parseProbe({
  format: { duration: "3600", size: String((20_000_000 + 640_000) * 3600 / 8), bit_rate: "20640000" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "24/1", pix_fmt: "yuv420p" },
    { index: 1, codec_type: "audio", codec_name: "ac3", channels: 6, bit_rate: "640000" },
  ],
});

describe("roughEstimate", () => {
  it("uses the preset bitrate plus copied audio and 1% overhead", () => {
    const e = roughEstimate(probe, s);
    expect(Number(e.videoBytes)).toBe((3200 * 1000 * 3600) / 8);
    expect(Number(e.audioBytes)).toBe((640_000 * 3600) / 8);
    expect(Number(e.totalBytes)).toBe(Math.round((Number(e.videoBytes) + Number(e.audioBytes)) * 1.01));
    expect(e.etaSecs).toBe(Math.round((3600 * 24) / 18));
  });

  it("never predicts more video than the source has", () => {
    const tiny = { ...probe, bitRate: 1_000_000, sizeBytes: BigInt(1_000_000 * 3600 / 8) };
    const e = roughEstimate(tiny, s);
    expect(Number(e.videoBytes)).toBeLessThan(Number(tiny.sizeBytes));
  });

  it("target mode is bitrate × duration", () => {
    const e = roughEstimate(probe, { ...s, mode: "target", targetVideoKbps: 4000 });
    expect(Number(e.videoBytes)).toBe((4000 * 1000 * 3600) / 8);
  });

  it("converted lossless audio uses the eac3 bitrate", () => {
    const lossless = parseProbe({
      format: { duration: "100", size: "100000000" },
      streams: [
        { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "24/1" },
        { index: 1, codec_type: "audio", codec_name: "truehd", channels: 8 },
      ],
    });
    const e = roughEstimate(lossless, { ...s, convertLosslessAudio: true });
    expect(Number(e.audioBytes)).toBe((768_000 * 100) / 8);
  });
});

describe("clipStarts", () => {
  it("spreads clips evenly and stays inside the file", () => {
    expect(clipStarts(600, 6, 10)).toEqual([45, 145, 245, 345, 445, 545]);
    expect(clipStarts(20, 6, 10)).toEqual([0]);
  });
});

describe("applyRatio", () => {
  it("scales source video bytes by the mean ratio with a 5% floor", () => {
    const { est, rangePct } = applyRatio(probe, s, [0.2, 0.2, 0.2]);
    const srcVideo = Number(probe.sizeBytes) - (640_000 * 3600) / 8;
    expect(Number(est.videoBytes)).toBe(Math.round(srcVideo * 0.2));
    expect(rangePct).toBe(5);
  });

  it("widens the range with spread", () => {
    expect(applyRatio(probe, s, [0.1, 0.3]).rangePct).toBe(50);
  });
});
```

- [ ] **Step 2: Write the failing validate test**

`apps/api/src/services/transcode/validate.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";
import {
  checkSsim,
  checkStructure,
  parseSsimAll,
} from "@rawkoon/api/services/transcode/validate";

const s: TranscodeJobSettings = {
  codec: "hevc", encoder: "software", resolution: "keep", mode: "quality",
  preset: "balanced", speed: "default", convertLosslessAudio: false,
};

const mk = (o: { dur?: string; size?: string; codec?: string; h?: number; audio?: string[]; subs?: string[] }) =>
  parseProbe({
    format: { duration: o.dur ?? "100", size: o.size ?? "500" },
    streams: [
      { index: 0, codec_type: "video", codec_name: o.codec ?? "hevc", width: 1920, height: o.h ?? 1080 },
      ...(o.audio ?? ["eng"]).map((l, i) => ({ index: 1 + i, codec_type: "audio", codec_name: "ac3", tags: { language: l } })),
      ...(o.subs ?? []).map((l, i) => ({ index: 10 + i, codec_type: "subtitle", codec_name: "subrip", tags: { language: l } })),
    ],
  });

const source = mk({ size: "1000", codec: "h264", audio: ["fre", "eng"], subs: ["fre"] });

describe("checkStructure", () => {
  it("passes a matching output", () => {
    expect(checkStructure(source, mk({ audio: ["fre", "eng"], subs: ["fre"] }), s)).toBeNull();
  });
  it("fails on duration drift", () => {
    expect(checkStructure(source, mk({ dur: "98.5", audio: ["fre", "eng"], subs: ["fre"] }), s)).toContain("Duration");
  });
  it("fails on wrong codec", () => {
    expect(checkStructure(source, mk({ codec: "h264", audio: ["fre", "eng"], subs: ["fre"] }), s)).toContain("codec");
  });
  it("fails on wrong height", () => {
    expect(checkStructure(source, mk({ h: 720, audio: ["fre", "eng"], subs: ["fre"] }), s)).toContain("height");
  });
  it("fails when audio languages differ", () => {
    expect(checkStructure(source, mk({ audio: ["fre"], subs: ["fre"] }), s)).toContain("Audio");
  });
  it("fails when subtitles are missing", () => {
    expect(checkStructure(source, mk({ audio: ["fre", "eng"] }), s)).toContain("Subtitle");
  });
  it("fails with no size gain", () => {
    expect(checkStructure(source, mk({ size: "1000", audio: ["fre", "eng"], subs: ["fre"] }), s)).toBe("No size gain");
  });
  it("expects the target height when downscaling", () => {
    const uhd = mk({ size: "1000", codec: "h264", h: 2160, audio: ["fre", "eng"], subs: ["fre"] });
    expect(checkStructure(uhd, mk({ h: 1080, audio: ["fre", "eng"], subs: ["fre"] }), { ...s, resolution: 1080 })).toBeNull();
  });
});

describe("checkSsim", () => {
  it("passes above both thresholds", () => {
    expect(checkSsim([0.98, 0.975], { avg: 0.97, min: 0.95 })).toBeNull();
  });
  it("fails on a low mean", () => {
    expect(checkSsim([0.96, 0.964], { avg: 0.97, min: 0.95 })).toContain("0.962");
  });
  it("fails on one bad clip", () => {
    expect(checkSsim([0.99, 0.99, 0.94], { avg: 0.97, min: 0.95 })).toContain("clip");
  });
  it("fails with no scores", () => {
    expect(checkSsim([], { avg: 0.97, min: 0.95 })).toContain("no");
  });
});

describe("parseSsimAll", () => {
  it("reads the All value from ffmpeg stderr", () => {
    expect(
      parseSsimAll("[Parsed_ssim_4 @ 0x1] SSIM Y:0.990 (20.0) U:0.99 V:0.99 All:0.987654 (19.1)\n"),
    ).toBeCloseTo(0.987654);
    expect(parseSsimAll("nothing")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && bun test src/services/transcode/estimate.test.ts src/services/transcode/validate.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement estimate**

`apps/api/src/services/transcode/estimate.ts`:
```ts
import { join } from "node:path";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { buildClipCutArgs, buildEncodeArgs } from "@rawkoon/api/services/transcode/buildArgs";
import type { RunFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import {
  comboKey,
  eac3BitrateFor,
  isLosslessAudio,
  ROUGH_FPS_1080,
  ROUGH_KBPS_1080,
  targetHeight,
} from "@rawkoon/api/services/transcode/presets";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";

export const SAMPLE_CLIPS = 6;
export const SAMPLE_SECS = 10;
const PX_1080 = 1920 * 1080;
const FALLBACK_AUDIO_BPS = 640_000;

export interface FileEstimate {
  videoBytes: bigint;
  audioBytes: bigint;
  totalBytes: bigint;
  etaSecs: number;
}

function outputPixels(probe: SourceProbe, s: TranscodeJobSettings): number {
  const v = probe.video;
  const w = v?.width ?? 1920;
  const h = v?.height ?? 1080;
  const th = targetHeight(s, probe);
  return th ? Math.round((w * th) / h) * th : w * h;
}

function audioBps(probe: SourceProbe, s: TranscodeJobSettings): number {
  let total = 0;
  for (const a of probe.streams.filter((x) => x.type === "audio")) {
    if (s.convertLosslessAudio && isLosslessAudio(a)) total += eac3BitrateFor(a.channels).kbps * 1000;
    else total += a.bitRate ?? FALLBACK_AUDIO_BPS;
  }
  return total;
}

function sourceAudioBps(probe: SourceProbe): number {
  return probe.streams
    .filter((x) => x.type === "audio")
    .reduce((t, a) => t + (a.bitRate ?? FALLBACK_AUDIO_BPS), 0);
}

function etaSecs(probe: SourceProbe, s: TranscodeJobSettings, measuredFps?: number | null): number {
  const v = probe.video;
  const frames = probe.durationSecs * (v?.fps ?? 24);
  const px = (v?.width ?? 1920) * (v?.height ?? 1080);
  const fps = measuredFps ?? (ROUGH_FPS_1080[comboKey(s)][s.speed] * PX_1080) / px;
  return Math.round(frames / fps);
}

function sourceVideoBytes(probe: SourceProbe): number {
  const audio = (sourceAudioBps(probe) * probe.durationSecs) / 8;
  return Math.max(0, Number(probe.sizeBytes) - audio);
}

function finish(videoBytes: number, probe: SourceProbe, s: TranscodeJobSettings, eta: number): FileEstimate {
  const audioBytes = Math.round((audioBps(probe, s) * probe.durationSecs) / 8);
  const v = Math.round(videoBytes);
  return {
    videoBytes: BigInt(v),
    audioBytes: BigInt(audioBytes),
    totalBytes: BigInt(Math.round((v + audioBytes) * 1.01)),
    etaSecs: eta,
  };
}

export function roughEstimate(probe: SourceProbe, s: TranscodeJobSettings): FileEstimate {
  const eta = etaSecs(probe, s);
  if (s.mode === "target") {
    return finish((s.targetVideoKbps! * 1000 * probe.durationSecs) / 8, probe, s, eta);
  }
  const fps = probe.video?.fps ?? 24;
  const kbps = ROUGH_KBPS_1080[comboKey(s)][s.preset] * (outputPixels(probe, s) / PX_1080) ** 0.75 * (fps / 24);
  const predicted = (kbps * 1000 * probe.durationSecs) / 8;
  // A re-encode never lands above ~90% of what the source video already spends.
  return finish(Math.min(predicted, sourceVideoBytes(probe) * 0.9), probe, s, eta);
}

export function clipStarts(durationSecs: number, count: number, clipSecs: number): number[] {
  if (durationSecs < clipSecs * 3) return [0];
  const step = durationSecs / count;
  return Array.from({ length: count }, (_, i) =>
    Math.min(Math.round(step * (i + 0.5) - clipSecs / 2), Math.floor(durationSecs - clipSecs)),
  );
}

export function applyRatio(
  probe: SourceProbe,
  s: TranscodeJobSettings,
  ratios: number[],
  measuredFps?: number | null,
): { est: FileEstimate; rangePct: number } {
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const spread = Math.max(...ratios) - Math.min(...ratios);
  const rangePct = Math.max(5, Math.round((spread / mean) * 50));
  return {
    est: finish(sourceVideoBytes(probe) * mean, probe, s, etaSecs(probe, s, measuredFps)),
    rangePct,
  };
}

export async function sampleRatios(o: {
  input: string;
  probe: SourceProbe;
  settings: TranscodeJobSettings;
  workDir: string;
  run: RunFfmpeg;
  threads: number;
  vaapiDevice: string | null;
  statSize: (p: string) => Promise<number>;
}): Promise<{ ratios: number[]; fps: number | null }> {
  const ratios: number[] = [];
  const fpsSamples: number[] = [];
  const starts = clipStarts(o.probe.durationSecs, SAMPLE_CLIPS, SAMPLE_SECS);
  for (const [i, start] of starts.entries()) {
    const cut = join(o.workDir, `src-${i}.mkv`);
    const enc = join(o.workDir, `enc-${i}-${comboKey(o.settings)}.mkv`);
    const c = await o.run(buildClipCutArgs(o.input, cut, o.probe, start, SAMPLE_SECS), {});
    if (c.code !== 0) continue;
    let lastFps: number | null = null;
    const e = await o.run(
      buildEncodeArgs({
        input: cut, output: enc, probe: o.probe, settings: o.settings,
        threads: o.threads, vaapiDevice: o.vaapiDevice, clip: { start: 0, duration: SAMPLE_SECS },
      }),
      { nice: true, onProgress: (p) => { if (p.fps) lastFps = p.fps; } },
    );
    if (e.code !== 0) continue;
    const [a, b] = await Promise.all([o.statSize(cut), o.statSize(enc)]);
    if (a > 0) ratios.push(b / a);
    if (lastFps) fpsSamples.push(lastFps);
  }
  if (!ratios.length) throw new Error("Sample encode failed");
  const fps = fpsSamples.length ? fpsSamples.reduce((x, y) => x + y, 0) / fpsSamples.length : null;
  return { ratios, fps };
}
```

- [ ] **Step 5: Implement validate**

`apps/api/src/services/transcode/validate.ts`:
```ts
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { clipStarts, SAMPLE_CLIPS, SAMPLE_SECS } from "@rawkoon/api/services/transcode/estimate";
import type { RunFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import { targetHeight } from "@rawkoon/api/services/transcode/presets";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";

function langs(p: SourceProbe, type: "audio" | "subtitle"): string {
  return p.streams.filter((s) => s.type === type).map((s) => s.language ?? "und").join(",");
}

export function checkStructure(source: SourceProbe, output: SourceProbe, s: TranscodeJobSettings): string | null {
  if (!output.video) return "Output has no video stream";
  if (Math.abs(output.durationSecs - source.durationSecs) > 1) {
    return `Duration differs (${source.durationSecs.toFixed(1)}s → ${output.durationSecs.toFixed(1)}s)`;
  }
  if (output.video.codec !== s.codec) return `Video codec is ${output.video.codec}, expected ${s.codec}`;
  const wantH = targetHeight(s, source) ?? source.video?.height ?? null;
  if (wantH != null && output.video.height !== wantH) {
    return `Video height is ${output.video.height}, expected ${wantH}`;
  }
  if (langs(output, "audio") !== langs(source, "audio")) {
    return `Audio tracks differ (${langs(source, "audio")} → ${langs(output, "audio")})`;
  }
  if (langs(output, "subtitle") !== langs(source, "subtitle")) {
    return `Subtitle tracks differ (${langs(source, "subtitle")} → ${langs(output, "subtitle")})`;
  }
  if (output.sizeBytes >= source.sizeBytes) return "No size gain";
  return null;
}

export function checkSsim(scores: number[], t: { avg: number; min: number }): string | null {
  if (!scores.length) return "Quality check produced no scores";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const low = scores.filter((x) => x < t.min).length;
  if (avg < t.avg) return `Quality check: SSIM ${avg.toFixed(3)} below ${t.avg.toFixed(3)}`;
  if (low) return `Quality check: ${low} of ${scores.length} clip(s) below ${t.min.toFixed(3)}`;
  return null;
}

export function parseSsimAll(stderr: string): number | null {
  const m = stderr.match(/All:([0-9.]+)/g);
  if (!m) return null;
  return Number.parseFloat(m.at(-1)!.slice(4));
}

export async function measureSsim(o: {
  source: string;
  output: string;
  sourceProbe: SourceProbe;
  outputProbe: SourceProbe;
  run: RunFfmpeg;
}): Promise<number[]> {
  const sv = o.sourceProbe.video!;
  const ov = o.outputProbe.video!;
  const scores: number[] = [];
  for (const start of clipStarts(o.sourceProbe.durationSecs, SAMPLE_CLIPS, SAMPLE_SECS)) {
    const graph =
      `[0:${ov.index}]setpts=PTS-STARTPTS,format=yuv420p[a];` +
      `[1:${sv.index}]scale=${ov.width}:${ov.height}:flags=bicubic,setpts=PTS-STARTPTS,format=yuv420p[b];` +
      "[a][b]ssim";
    const r = await o.run(
      [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "info",
        "-ss", String(start), "-t", String(SAMPLE_SECS), "-i", o.output,
        "-ss", String(start), "-t", String(SAMPLE_SECS), "-i", o.source,
        "-lavfi", graph, "-f", "null", "-",
      ],
      { nice: true },
    );
    const v = r.code === 0 ? parseSsimAll(r.stderr) : null;
    if (v != null) scores.push(v);
  }
  return scores;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/transcode/estimate.test.ts src/services/transcode/validate.test.ts`
Expected: PASS (8 + 13 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/transcode/estimate.ts apps/api/src/services/transcode/validate.ts apps/api/src/services/transcode/estimate.test.ts apps/api/src/services/transcode/validate.test.ts
git commit -m "feat(transcode): estimate output size and validate re-encoded files"
```

---

### Task 10: Capabilities detection and job pipeline

**Files:**
- Create: `apps/api/src/services/transcode/capabilities.ts`
- Create: `apps/api/src/services/transcode/pipeline.ts`
- Test: `apps/api/src/services/transcode/capabilities.test.ts`
- Test: `apps/api/src/services/transcode/pipeline.test.ts`

**Interfaces:**
- Consumes: Tasks 3–9.
- Produces:
```ts
// capabilities.ts
export interface Capabilities { combos: TranscodeCombo[]; vaapiDevice: string | null; deviceLabel: string | null; vaapiUnavailableReason: string | null }
export function parseEncoderList(out: string): Set<string>;
export async function detectCapabilities(force?: boolean): Promise<Capabilities>;
// pipeline.ts
export interface PipelineSource { dbPath: string; sizeBytes: bigint; fileMtimeMs: bigint | null; fileDev: string | null; fileIno: string | null }
export interface PipelineJob { id: number; settings: TranscodeJobSettings; estimatedBytes: bigint | null; source: PipelineSource }
export interface PipelineDeps {
  mapPath(p: string): string;
  probe(path: string): Promise<SourceProbe>;
  run: RunFfmpeg;
  fingerprint(path: string): Promise<FileFingerprint | null>;
  nlink(path: string): Promise<number>;
  freeBytes(dir: string): Promise<bigint>;
  fs: SwapFs;
  capabilities(): Promise<Capabilities>;
  rescan(finalDbPath: string): Promise<void>;
}
export interface PipelineHooks { onStep(step: TranscodeStep): void; onProgress(p: TranscodeLiveProgress): void }
export type PipelineResult =
  | { ok: true; outputBytes: bigint; ssimAvg: number; ssimMin: number; nlink: number; finalDbPath: string }
  | { ok: false; error: string; cancelled: boolean; ssimAvg?: number; ssimMin?: number; nlink?: number };
export async function runPipeline(job: PipelineJob, deps: PipelineDeps, hooks: PipelineHooks, opts: { signal: AbortSignal; threads: number; thresholds: { avg: number; min: number } }): Promise<PipelineResult>;
```

- [ ] **Step 1: Write the failing capabilities test**

`apps/api/src/services/transcode/capabilities.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { parseEncoderList } from "@rawkoon/api/services/transcode/capabilities";

describe("parseEncoderList", () => {
  it("extracts encoder names from ffmpeg -encoders", () => {
    const out = [
      "Encoders:",
      " V..... = Video",
      " ------",
      " V....D libx265              libx265 H.265 / HEVC (codec hevc)",
      " V..... libsvtav1            SVT-AV1 (codec av1)",
      " V....D hevc_vaapi           H.265/HEVC (VAAPI) (codec hevc)",
      " A....D aac                  AAC",
    ].join("\n");
    const s = parseEncoderList(out);
    expect([...s].sort()).toEqual(["aac", "hevc_vaapi", "libsvtav1", "libx265"]);
  });
});
```

- [ ] **Step 2: Write the failing pipeline test**

`apps/api/src/services/transcode/pipeline.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";
import { type PipelineDeps, type PipelineJob, runPipeline } from "@rawkoon/api/services/transcode/pipeline";
import type { SwapFs } from "@rawkoon/api/services/transcode/swap";

const settings: TranscodeJobSettings = {
  codec: "hevc", encoder: "software", resolution: "keep", mode: "quality",
  preset: "balanced", speed: "default", convertLosslessAudio: false,
};

const srcProbe = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "24/1" },
    { index: 1, codec_type: "audio", codec_name: "ac3", tags: { language: "eng" } },
  ],
});
const outProbe = parseProbe({
  format: { duration: "100", size: "400" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
    { index: 1, codec_type: "audio", codec_name: "ac3", tags: { language: "eng" } },
  ],
});

const fp = { sizeBytes: 1000n, mtimeMs: 5n, dev: "1", ino: "2" };

function makeDeps(over: Partial<PipelineDeps> = {}) {
  const calls: string[] = [];
  const memFs: SwapFs = {
    rename: async (a, b) => { calls.push(`rename ${a} -> ${b}`); },
    copyFile: async () => {},
    unlink: async (p) => { calls.push(`unlink ${p}`); },
    exists: async () => false,
    fsync: async () => {},
  };
  let probes = 0;
  const deps: PipelineDeps = {
    mapPath: (p) => p,
    probe: async () => (probes++ === 0 ? srcProbe : outProbe),
    run: async (args, opts) => {
      if (args.includes("-progress")) opts.onProgress?.({ outTimeSecs: 50, fps: 100, speed: 4, totalSize: 200, done: false });
      const ssim = args.includes("-lavfi");
      return { code: 0, signal: null, stderr: ssim ? "SSIM All:0.990 (20)" : "", aborted: false };
    },
    fingerprint: async () => fp,
    nlink: async () => 2,
    freeBytes: async () => 10_000n,
    fs: memFs,
    capabilities: async () => ({ combos: [{ codec: "hevc", encoder: "software" }], vaapiDevice: null, deviceLabel: null, vaapiUnavailableReason: "none" }),
    rescan: async () => { calls.push("rescan"); },
    ...over,
  };
  return { deps, calls };
}

const job: PipelineJob = {
  id: 1, settings, estimatedBytes: 400n,
  source: { dbPath: "/lib/a.mkv", sizeBytes: 1000n, fileMtimeMs: 5n, fileDev: "1", fileIno: "2" },
};
const opts = () => ({ signal: new AbortController().signal, threads: 2, thresholds: { avg: 0.97, min: 0.95 } });
const hooks = () => {
  const steps: string[] = [];
  const progress: number[] = [];
  return { steps, progress, h: { onStep: (s: string) => steps.push(s), onProgress: (p: { progress: number }) => progress.push(p.progress) } };
};

describe("runPipeline", () => {
  it("runs every step and swaps the file", async () => {
    const { deps, calls } = makeDeps();
    const hk = hooks();
    const r = await runPipeline(job, deps, hk.h as never, opts());
    expect(r).toMatchObject({ ok: true, outputBytes: 400n, nlink: 2, finalDbPath: "/lib/a.mkv" });
    expect(hk.steps).toEqual(["preflight", "encode", "validate", "replace", "rescan"]);
    expect(hk.progress[0]).toBeCloseTo(0.5);
    expect(calls).toContain("rename /lib/.a.rawkoon-tmp.mkv -> /lib/a.mkv");
    expect(calls.at(-1)).toBe("rescan");
  });

  it("fails preflight when the source changed since queueing", async () => {
    const { deps } = makeDeps({ fingerprint: async () => ({ ...fp, mtimeMs: 99n }) });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r).toMatchObject({ ok: false, error: "Source changed since queued" });
  });

  it("fails preflight without enough free space", async () => {
    const { deps } = makeDeps({ freeBytes: async () => 100n });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("free space");
  });

  it("refuses Dolby Vision profile 5", async () => {
    const dv5 = { ...srcProbe, dvProfile: 5 };
    const { deps } = makeDeps({ probe: async () => dv5 });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect((r as { error: string }).error).toContain("Dolby Vision profile 5");
  });

  it("fails validation and deletes tmp, leaving the source alone", async () => {
    const { deps, calls } = makeDeps({
      run: async (args) => ({ code: 0, signal: null, stderr: args.includes("-lavfi") ? "All:0.900 (9)" : "", aborted: false }),
    });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r.ok).toBe(false);
    expect((r as { ssimAvg: number }).ssimAvg).toBeCloseTo(0.9);
    expect(calls).toContain("unlink /lib/.a.rawkoon-tmp.mkv");
    expect(calls.some((c) => c.startsWith("rename"))).toBe(false);
  });

  it("pipeline aborts when fingerprint changes before replace", async () => {
    let n = 0;
    const { deps, calls } = makeDeps({ fingerprint: async () => (n++ === 0 ? fp : { ...fp, ino: "999" }) });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r).toMatchObject({ ok: false, error: "Source changed during encode" });
    expect(calls.some((c) => c.startsWith("rename"))).toBe(false);
  });

  it("reports cancellation", async () => {
    const { deps } = makeDeps({ run: async () => ({ code: 255, signal: null, stderr: "", aborted: true }) });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r).toMatchObject({ ok: false, cancelled: true, error: "Cancelled" });
  });

  it("fails when VAAPI is chosen but unavailable", async () => {
    const { deps } = makeDeps();
    const r = await runPipeline({ ...job, settings: { ...settings, encoder: "vaapi" } }, deps, hooks().h as never, opts());
    expect((r as { error: string }).error).toBe("VAAPI device not available");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && bun test src/services/transcode/capabilities.test.ts src/services/transcode/pipeline.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement capabilities**

`apps/api/src/services/transcode/capabilities.ts`:
```ts
import { readdir } from "node:fs/promises";
import type { TranscodeCombo } from "@rawkoon/shared/types";

export interface Capabilities {
  combos: TranscodeCombo[];
  vaapiDevice: string | null;
  deviceLabel: string | null;
  vaapiUnavailableReason: string | null;
}

export function parseEncoderList(out: string): Set<string> {
  const names = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s[VAS][.A-Z]{5}\s+(\S+)/);
    if (m && m[1] !== "=") names.add(m[1]);
  }
  return names;
}

async function exec(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const t = setTimeout(() => p.kill(), 20_000);
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  clearTimeout(t);
  return { code, out };
}

async function vaapiWorks(device: string, encoder: string): Promise<boolean> {
  const r = await exec([
    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
    "-init_hw_device", `vaapi=va:${device}`, "-filter_hw_device", "va",
    "-f", "lavfi", "-i", "testsrc2=s=320x240:d=0.2",
    "-vf", "format=nv12,hwupload", "-c:v", encoder, "-f", "null", "-",
  ]);
  return r.code === 0;
}

let cached: Capabilities | null = null;

export async function detectCapabilities(force = false): Promise<Capabilities> {
  if (cached && !force) return cached;
  const combos: TranscodeCombo[] = [];
  const enc = parseEncoderList((await exec(["ffmpeg", "-hide_banner", "-encoders"])).out);
  if (enc.has("libx265")) combos.push({ codec: "hevc", encoder: "software" });
  if (enc.has("libsvtav1")) combos.push({ codec: "av1", encoder: "software" });

  let device: string | null = null;
  let reason: string | null = null;
  try {
    const node = (await readdir("/dev/dri")).filter((f) => f.startsWith("renderD")).sort()[0];
    device = node ? `/dev/dri/${node}` : null;
  } catch {
    device = null;
  }
  if (!device) {
    reason = "No GPU render device (/dev/dri) in the container";
  } else {
    for (const [codec, name] of [["hevc", "hevc_vaapi"], ["av1", "av1_vaapi"]] as const) {
      if (enc.has(name) && (await vaapiWorks(device, name))) combos.push({ codec, encoder: "vaapi" });
    }
    if (!combos.some((c) => c.encoder === "vaapi")) {
      reason = "GPU found but VAAPI encoding failed (missing driver?)";
      device = null;
    }
  }
  cached = {
    combos,
    vaapiDevice: device,
    deviceLabel: device ? `VAAPI · ${device.split("/").at(-1)}` : null,
    vaapiUnavailableReason: reason,
  };
  return cached;
}
```

- [ ] **Step 5: Implement the pipeline**

`apps/api/src/services/transcode/pipeline.ts`:
```ts
import { dirname } from "node:path";
import type {
  TranscodeJobSettings,
  TranscodeLiveProgress,
  TranscodeStep,
} from "@rawkoon/shared/types";
import type { FileFingerprint } from "@rawkoon/api/utils/medias/fileFingerprint";
import { buildEncodeArgs } from "@rawkoon/api/services/transcode/buildArgs";
import type { Capabilities } from "@rawkoon/api/services/transcode/capabilities";
import { describeFailure, type RunFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import { finalPathFor, tmpPathFor } from "@rawkoon/api/services/transcode/outputPath";
import { targetHeight } from "@rawkoon/api/services/transcode/presets";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";
import { type SwapFs, swapInPlace } from "@rawkoon/api/services/transcode/swap";
import { checkSsim, checkStructure, measureSsim } from "@rawkoon/api/services/transcode/validate";

export interface PipelineSource {
  dbPath: string;
  sizeBytes: bigint;
  fileMtimeMs: bigint | null;
  fileDev: string | null;
  fileIno: string | null;
}

export interface PipelineJob {
  id: number;
  settings: TranscodeJobSettings;
  estimatedBytes: bigint | null;
  source: PipelineSource;
}

export interface PipelineDeps {
  mapPath(p: string): string;
  probe(path: string): Promise<SourceProbe>;
  run: RunFfmpeg;
  fingerprint(path: string): Promise<FileFingerprint | null>;
  nlink(path: string): Promise<number>;
  freeBytes(dir: string): Promise<bigint>;
  fs: SwapFs;
  capabilities(): Promise<Capabilities>;
  rescan(finalDbPath: string): Promise<void>;
}

export interface PipelineHooks {
  onStep(step: TranscodeStep): void;
  onProgress(p: TranscodeLiveProgress): void;
}

export type PipelineResult =
  | { ok: true; outputBytes: bigint; ssimAvg: number; ssimMin: number; nlink: number; finalDbPath: string }
  | { ok: false; error: string; cancelled: boolean; ssimAvg?: number; ssimMin?: number; nlink?: number };

class StepError extends Error {}

function sameFile(src: PipelineSource, live: FileFingerprint | null): boolean {
  if (!live) return false;
  if (live.sizeBytes !== src.sizeBytes) return false;
  if (src.fileMtimeMs != null && live.mtimeMs !== src.fileMtimeMs) return false;
  if (src.fileIno && live.ino && src.fileIno !== live.ino) return false;
  return true;
}

export async function runPipeline(
  job: PipelineJob,
  deps: PipelineDeps,
  hooks: PipelineHooks,
  opts: { signal: AbortSignal; threads: number; thresholds: { avg: number; min: number } },
): Promise<PipelineResult> {
  const src = deps.mapPath(job.source.dbPath);
  const tmp = tmpPathFor(src);
  let nlink: number | undefined;
  let scores: number[] = [];
  const ssim = () =>
    scores.length
      ? { ssimAvg: scores.reduce((a, b) => a + b, 0) / scores.length, ssimMin: Math.min(...scores) }
      : {};
  try {
    hooks.onStep("preflight");
    if (!sameFile(job.source, await deps.fingerprint(src))) throw new StepError("Source changed since queued");
    const probe = await deps.probe(src);
    if (!probe.video) throw new StepError("Source has no video stream");
    if (probe.dvProfile === 5) throw new StepError("Dolby Vision profile 5 cannot be re-encoded");
    const caps = await deps.capabilities();
    if (job.settings.encoder === "vaapi" && !caps.vaapiDevice) throw new StepError("VAAPI device not available");
    const need = ((job.estimatedBytes ?? job.source.sizeBytes) * 12n) / 10n;
    if ((await deps.freeBytes(dirname(src))) < need) throw new StepError("Not enough free space for the output");
    nlink = await deps.nlink(src);

    hooks.onStep("encode");
    const started = Date.now();
    const r = await deps.run(
      buildEncodeArgs({ input: src, output: tmp, probe, settings: job.settings, threads: opts.threads, vaapiDevice: caps.vaapiDevice }),
      {
        signal: opts.signal,
        nice: job.settings.encoder === "software",
        onProgress: (p) => {
          const progress = p.outTimeSecs != null ? Math.min(1, p.outTimeSecs / probe.durationSecs) : 0;
          const elapsed = (Date.now() - started) / 1000;
          hooks.onProgress({
            progress,
            fps: p.fps,
            speed: p.speed,
            eta_secs: progress > 0.01 ? Math.round((elapsed / progress) * (1 - progress)) : null,
            current_bytes: p.totalSize != null ? String(p.totalSize) : null,
          });
        },
      },
    );
    if (r.aborted) return await cleanup({ ok: false, error: "Cancelled", cancelled: true });
    if (r.code !== 0) throw new StepError(describeFailure(r));

    hooks.onStep("validate");
    const out = await deps.probe(tmp);
    const structural = checkStructure(probe, out, job.settings);
    if (structural) throw new StepError(structural);
    scores = await measureSsim({ source: src, output: tmp, sourceProbe: probe, outputProbe: out, run: deps.run });
    const quality = checkSsim(scores, opts.thresholds);
    if (quality) throw new StepError(quality);

    hooks.onStep("replace");
    if (!sameFile(job.source, await deps.fingerprint(src))) throw new StepError("Source changed during encode");
    const h = targetHeight(job.settings, probe);
    const final = finalPathFor(src, h);
    const finalDbPath = finalPathFor(job.source.dbPath, h);
    await swapInPlace({
      tmp, source: src, final, fs: deps.fs,
      verify: async (p) => {
        try {
          const v = await deps.probe(p);
          return v.sizeBytes === out.sizeBytes;
        } catch {
          return false;
        }
      },
    });

    hooks.onStep("rescan");
    try {
      await deps.rescan(finalDbPath);
    } catch (e) {
      return { ok: false, cancelled: false, nlink, ...ssim(), error: `Replaced on disk but the library update failed (${(e as Error).message}); run Rescan files` };
    }
    const s = ssim() as { ssimAvg: number; ssimMin: number };
    return { ok: true, outputBytes: out.sizeBytes, nlink: nlink ?? 1, finalDbPath, ...s };
  } catch (e) {
    const msg = e instanceof StepError ? e.message : `Unexpected error: ${(e as Error).message}`;
    return await cleanup({ ok: false, error: msg, cancelled: false, nlink, ...ssim() });
  }

  async function cleanup(res: PipelineResult): Promise<PipelineResult> {
    try {
      await deps.fs.unlink(tmp);
    } catch {
      /* nothing written */
    }
    return res;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/transcode/capabilities.test.ts src/services/transcode/pipeline.test.ts`
Expected: PASS (1 + 8 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/transcode/capabilities.ts apps/api/src/services/transcode/pipeline.ts apps/api/src/services/transcode/capabilities.test.ts apps/api/src/services/transcode/pipeline.test.ts
git commit -m "feat(transcode): detect encoders and run a validated re-encode pipeline"
```

---

### Task 11: Repository, rescan, notifications, dispatcher

**Files:**
- Create: `apps/api/src/services/transcode/repo.ts`
- Create: `apps/api/src/services/transcode/rescanFile.ts`
- Create: `apps/api/src/services/transcode/notify.ts`
- Create: `apps/api/src/services/transcode/dispatcher.ts`
- Create: `apps/api/src/services/transcode/index.ts`
- Modify: `apps/shared/src/types/notification.ts` (add two `NotificationType` members)
- Modify: `apps/api/src/services/notificationCopy.ts` (add four copy keys)
- Modify: `apps/api/src/services/queueService.ts` (start/stop dispatcher in `initWorkers` / `closeAllWorkers`)
- Test: `apps/api/src/services/transcode/dispatcher.test.ts`

**Interfaces:**
- Consumes: `runPipeline` & types (10), `isInsideWindow` (5), `recoverSwap`, `nodeSwapFs` (7), `tmpPathFor`/`finalPathFor` (6).
- Produces:
```ts
// repo.ts
export interface ClaimedJob { id: number; batchId: string; title: string; mediaId: number | null; mediaFileId: number | null; settings: TranscodeJobSettings; estimatedBytes: bigint | null; step: string | null; source: PipelineSource | null }
export interface TranscodeRepo {
  getSettings(): Promise<TranscodeQueueSettings>;
  claimNext(): Promise<ClaimedJob | null>;
  runningJobs(): Promise<ClaimedJob[]>;
  requeue(id: number): Promise<void>;
  markStep(id: number, step: TranscodeStep): Promise<void>;
  saveProgress(id: number, progress: number): Promise<void>;
  finish(id: number, r: PipelineResult): Promise<void>;
  batchRemaining(batchId: string): Promise<number>;
  batchSummary(batchId: string): Promise<{ done: number; failed: number; savedBytes: bigint; pendingSeedBytes: bigint }>;
}
export const prismaTranscodeRepo: TranscodeRepo;
// dispatcher.ts
export class TranscodeDispatcher {
  constructor(repo: TranscodeRepo, deps: PipelineDeps, notify: TranscodeNotifier, now?: () => Date, threads?: () => number);
  start(): void; stop(): Promise<void>;
  tick(): Promise<void>; recover(): Promise<void>;
  cancel(jobId: number): boolean;
  live(jobId: number): TranscodeLiveProgress | null;
  runningJobId(): number | null;
}
export interface TranscodeNotifier { jobFailed(job: ClaimedJob, error: string): Promise<void>; batchFinished(job: ClaimedJob, s: { done: number; failed: number; savedBytes: bigint; pendingSeedBytes: bigint }): Promise<void> }
// index.ts
export const transcodeDispatcher: TranscodeDispatcher;
```

- [ ] **Step 1: Write the failing dispatcher test**

`apps/api/src/services/transcode/dispatcher.test.ts`:
```ts
import { describe, expect, it, mock } from "bun:test";
import type { TranscodeQueueSettings } from "@rawkoon/shared/types";

mock.module("@rawkoon/api/services/transcode/pipeline", () => ({
  runPipeline: async (_job: unknown, _deps: unknown, hooks: { onStep: (s: string) => void; onProgress: (p: unknown) => void }) => {
    hooks.onStep("encode");
    hooks.onProgress({ progress: 0.4, fps: 10, speed: 1, eta_secs: 5, current_bytes: "1" });
    return { ok: true, outputBytes: 10n, ssimAvg: 0.99, ssimMin: 0.98, nlink: 1, finalDbPath: "/a.mkv" };
  },
}));

const { TranscodeDispatcher } = await import("@rawkoon/api/services/transcode/dispatcher");

const baseSettings: TranscodeQueueSettings = {
  paused: false, window_enabled: false, window_start: "01:00", window_end: "08:00",
  ssim_threshold: 0.97, ssim_clip_min: 0.95, cpu_threads: null,
};

function makeRepo(settings: Partial<TranscodeQueueSettings> = {}, queued = 1) {
  const events: string[] = [];
  let left = queued;
  const job = {
    id: 7, batchId: "b", title: "T", mediaId: 1, mediaFileId: 2, step: null, estimatedBytes: 5n,
    settings: { codec: "hevc", encoder: "software", resolution: "keep", mode: "quality", preset: "balanced", speed: "default", convertLosslessAudio: false },
    source: { dbPath: "/a.mkv", sizeBytes: 100n, fileMtimeMs: 1n, fileDev: null, fileIno: null },
  };
  const repo = {
    getSettings: async () => ({ ...baseSettings, ...settings }),
    claimNext: async () => { if (left <= 0) return null; left--; events.push("claim"); return job; },
    runningJobs: async () => [{ ...job, step: "replace" }],
    requeue: async (id: number) => { events.push(`requeue ${id}`); },
    markStep: async (_: number, s: string) => { events.push(`step ${s}`); },
    saveProgress: async () => {},
    finish: async (id: number) => { events.push(`finish ${id}`); },
    batchRemaining: async () => 0,
    batchSummary: async () => ({ done: 1, failed: 0, savedBytes: 90n, pendingSeedBytes: 0n }),
  };
  const notifier = { jobFailed: mock(async () => {}), batchFinished: mock(async () => {}) };
  return { repo, events, notifier };
}

const deps = {} as never;

describe("TranscodeDispatcher.tick", () => {
  it("claims, runs, finishes and notifies the finished batch", async () => {
    const { repo, events, notifier } = makeRepo();
    const d = new TranscodeDispatcher(repo as never, deps, notifier as never);
    await d.tick();
    expect(events).toEqual(["claim", "step encode", "finish 7"]);
    expect(notifier.batchFinished).toHaveBeenCalledTimes(1);
    expect(d.runningJobId()).toBeNull();
  });

  it("tick claims nothing when paused", async () => {
    const { repo, events } = makeRepo({ paused: true });
    await new TranscodeDispatcher(repo as never, deps, { jobFailed: async () => {}, batchFinished: async () => {} }).tick();
    expect(events).toEqual([]);
  });

  it("tick claims nothing outside window", async () => {
    const { repo, events } = makeRepo({ window_enabled: true, window_start: "01:00", window_end: "08:00" });
    const noon = () => new Date(2026, 0, 1, 12, 0);
    await new TranscodeDispatcher(repo as never, deps, { jobFailed: async () => {}, batchFinished: async () => {} }, noon).tick();
    expect(events).toEqual([]);
  });

  it("claims inside the window", async () => {
    const { repo, events } = makeRepo({ window_enabled: true, window_start: "01:00", window_end: "08:00" });
    const two = () => new Date(2026, 0, 1, 2, 0);
    await new TranscodeDispatcher(repo as never, deps, { jobFailed: async () => {}, batchFinished: async () => {} }, two).tick();
    expect(events[0]).toBe("claim");
  });

  it("cancel returns false when the job is not running", () => {
    const { repo } = makeRepo();
    expect(new TranscodeDispatcher(repo as never, deps, { jobFailed: async () => {}, batchFinished: async () => {} }).cancel(99)).toBe(false);
  });
});

describe("TranscodeDispatcher.recover", () => {
  it("boot recovery runs recoverSwap for running jobs and requeues them", async () => {
    const { repo, events } = makeRepo();
    const seen: string[] = [];
    const fsDeps = {
      mapPath: (p: string) => p,
      probe: async () => { throw new Error("n/a"); },
      fs: {
        exists: async (p: string) => { seen.push(`exists ${p}`); return false; },
        unlink: async (p: string) => { seen.push(`unlink ${p}`); },
        rename: async () => {}, copyFile: async () => {}, fsync: async () => {},
      },
    };
    const d = new TranscodeDispatcher(repo as never, fsDeps as never, { jobFailed: async () => {}, batchFinished: async () => {} });
    await d.recover();
    expect(seen).toContain("exists /.a.mkv.rawkoon-orig");
    expect(seen).toContain("unlink /.a.rawkoon-tmp.mkv");
    expect(events).toContain("requeue 7");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/dispatcher.test.ts`
Expected: FAIL — module `dispatcher` not found.

- [ ] **Step 3: Implement the repository**

`apps/api/src/services/transcode/repo.ts`:
```ts
import type {
  TranscodeJobSettings,
  TranscodeQueueSettings,
  TranscodeStep,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import type { PipelineResult, PipelineSource } from "@rawkoon/api/services/transcode/pipeline";

export interface ClaimedJob {
  id: number;
  batchId: string;
  title: string;
  mediaId: number | null;
  mediaFileId: number | null;
  settings: TranscodeJobSettings;
  estimatedBytes: bigint | null;
  step: string | null;
  source: PipelineSource | null;
}

export interface TranscodeRepo {
  getSettings(): Promise<TranscodeQueueSettings>;
  claimNext(): Promise<ClaimedJob | null>;
  runningJobs(): Promise<ClaimedJob[]>;
  requeue(id: number): Promise<void>;
  markStep(id: number, step: TranscodeStep): Promise<void>;
  saveProgress(id: number, progress: number): Promise<void>;
  finish(id: number, r: PipelineResult): Promise<void>;
  batchRemaining(batchId: string): Promise<number>;
  batchSummary(batchId: string): Promise<{ done: number; failed: number; savedBytes: bigint; pendingSeedBytes: bigint }>;
}

export async function loadQueueSettings(): Promise<TranscodeQueueSettings> {
  const s = await prisma.transcodeSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  return {
    paused: s.paused,
    window_enabled: s.windowEnabled,
    window_start: s.windowStart,
    window_end: s.windowEnd,
    ssim_threshold: s.ssimThreshold,
    ssim_clip_min: s.ssimClipMin,
    cpu_threads: s.cpuThreads,
  };
}

const jobInclude = {
  mediaFile: { select: { filePath: true, sizeBytes: true, fileMtimeMs: true, fileDev: true, fileIno: true } },
} as const;

type JobRow = Awaited<ReturnType<typeof loadJob>>;

function loadJob(id: number) {
  return prisma.transcodeJob.findUnique({ where: { id }, include: jobInclude });
}

function toClaimed(row: NonNullable<JobRow>): ClaimedJob {
  const f = row.mediaFile;
  return {
    id: row.id,
    batchId: row.batchId,
    title: row.title,
    mediaId: row.mediaId,
    mediaFileId: row.mediaFileId,
    settings: row.settings as unknown as TranscodeJobSettings,
    estimatedBytes: row.estimatedBytes,
    step: row.step,
    source: f
      ? { dbPath: f.filePath, sizeBytes: f.sizeBytes, fileMtimeMs: f.fileMtimeMs, fileDev: f.fileDev, fileIno: f.fileIno }
      : null,
  };
}

export const prismaTranscodeRepo: TranscodeRepo = {
  getSettings: loadQueueSettings,

  async claimNext() {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      UPDATE transcode_jobs SET status = 'running', step = 'preflight', started_at = now(), progress = 0, error = NULL
      WHERE id = (
        SELECT id FROM transcode_jobs WHERE status = 'queued'
        ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (!rows[0]) return null;
    const row = await loadJob(rows[0].id);
    return row ? toClaimed(row) : null;
  },

  async runningJobs() {
    const rows = await prisma.transcodeJob.findMany({ where: { status: "running" }, include: jobInclude });
    return rows.map(toClaimed);
  },

  async requeue(id) {
    await prisma.transcodeJob.update({ where: { id }, data: { status: "queued", step: null, progress: null, startedAt: null } });
  },

  async markStep(id, step) {
    await prisma.transcodeJob.update({ where: { id }, data: { step } });
  },

  async saveProgress(id, progress) {
    await prisma.transcodeJob.update({ where: { id }, data: { progress } });
  },

  async finish(id, r) {
    const base = { finishedAt: new Date(), step: null, sourceNlink: r.nlink ?? null, ssimAvg: r.ssimAvg ?? null, ssimMin: r.ssimMin ?? null };
    if (r.ok) {
      await prisma.transcodeJob.update({ where: { id }, data: { ...base, status: "done", progress: 1, outputBytes: r.outputBytes, error: null } });
    } else {
      await prisma.transcodeJob.update({ where: { id }, data: { ...base, status: r.cancelled ? "cancelled" : "failed", error: r.error } });
    }
  },

  async batchRemaining(batchId) {
    return prisma.transcodeJob.count({ where: { batchId, status: { in: ["queued", "running"] } } });
  },

  async batchSummary(batchId) {
    const rows = await prisma.transcodeJob.findMany({
      where: { batchId, status: { in: ["done", "failed"] } },
      select: { status: true, sourceBytes: true, outputBytes: true, sourceNlink: true },
    });
    let savedBytes = 0n;
    let pendingSeedBytes = 0n;
    for (const r of rows) {
      if (r.status !== "done" || r.outputBytes == null) continue;
      const diff = r.sourceBytes - r.outputBytes;
      if ((r.sourceNlink ?? 1) > 1) pendingSeedBytes += diff;
      else savedBytes += diff;
    }
    return {
      done: rows.filter((r) => r.status === "done").length,
      failed: rows.filter((r) => r.status === "failed").length,
      savedBytes,
      pendingSeedBytes,
    };
  },
};
```

- [ ] **Step 4: Implement rescanFile**

`apps/api/src/services/transcode/rescanFile.ts`:
```ts
import { basename } from "node:path";
import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { triggerJellyfinLibraryScan } from "@rawkoon/api/services/jellyfinLibraryRefresh";
import { fingerprintDbFields, statFileFingerprint } from "@rawkoon/api/utils/medias/fileFingerprint";
import { remapPath, scanMediaInfo } from "@rawkoon/api/utils/medias/mediainfoScanner";

export async function rescanTranscodedFile(mediaFileId: number, finalDbPath: string): Promise<void> {
  const fp = await statFileFingerprint(remapPath(finalDbPath));
  if (!fp) throw new Error("Output file not found after replace");
  const mi = await scanMediaInfo(finalDbPath);
  if (!mi) throw new Error("mediainfo could not read the output");
  const row = await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: {
      filePath: finalDbPath,
      fileName: basename(finalDbPath),
      ...fingerprintDbFields(fp),
      durationSecs: mi.durationSecs,
      videoCodec: mi.videoCodec,
      videoProfile: mi.videoProfile,
      width: mi.width,
      height: mi.height,
      frameRate: mi.frameRate,
      bitDepth: mi.bitDepth,
      videoBitrate: mi.videoBitrate,
      hdrFormat: mi.hdrFormat,
      resolution: mi.resolution,
      audioTracks: mi.audioTracks as object[],
      subtitleTracks: mi.subtitleTracks as object[],
      languageTags: classifyLanguageTags(mi.audioTracks as LibraryAudioTrack[], null),
      scannedAt: new Date(),
    },
    select: { mediaId: true, episode: { select: { mediaId: true } } },
  });
  const mediaId = row.mediaId ?? row.episode?.mediaId;
  if (mediaId) emitLibraryUpdate(mediaId);
  void triggerJellyfinLibraryScan().catch(() => {});
}
```

- [ ] **Step 5: Add notification types and copy**

In `apps/shared/src/types/notification.ts`, add inside the `NotificationType` union after `| "library_attention"`:
```ts
  | "library_transcode_finished"
  | "library_transcode_failed"
```

In `apps/api/src/services/notificationCopy.ts`, add next to `libraryPostProcessFailedBody`:
```ts
  libraryTranscodeFinishedTitle: {
    en: () => "Re-encode batch finished",
    fr: () => "Réencodage terminé",
  },
  libraryTranscodeFinishedBody: {
    en: (p) => `${p.title}: ${p.done} done, ${p.failed} failed, ${p.saved} freed${p.pending ? `, ${p.pending} after seeding` : ""}`,
    fr: (p) => `${p.title} : ${p.done} terminés, ${p.failed} en échec, ${p.saved} libérés${p.pending ? `, ${p.pending} après le partage` : ""}`,
  },
  libraryTranscodeFailedTitle: {
    en: () => "Re-encode failed",
    fr: () => "Échec du réencodage",
  },
  libraryTranscodeFailedBody: {
    en: (p) => `${p.title}: ${p.reason}`,
    fr: (p) => `${p.title} : ${p.reason}`,
  },
```
If the copy map's param type is a fixed union of keys, add `title`, `done`, `failed`, `saved`, `pending` to it following the existing pattern in that file.

- [ ] **Step 6: Implement notify**

`apps/api/src/services/transcode/notify.ts`:
```ts
import { notificationCopy } from "@rawkoon/api/services/notificationCopy";
import { getAdminNotificationTargets } from "@rawkoon/api/services/notificationPreferences";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import type { ClaimedJob } from "@rawkoon/api/services/transcode/repo";
import type { TranscodeNotifier } from "@rawkoon/api/services/transcode/dispatcher";

function gb(bytes: bigint): string {
  return `${(Number(bytes) / 1e9).toFixed(1)} GB`;
}

async function toAdmins(
  build: (locale: string | null) => { title: string; body: string; type: string },
  preferenceKey: "library_downloaded" | "library_failed",
  mediaId: number | null,
): Promise<void> {
  for (const admin of await getAdminNotificationTargets()) {
    const msg = build(admin.locale);
    try {
      await createAndQueueNotification(
        admin.id, msg.title, msg.body, msg.type, "/settings?tab=transcode",
        mediaId != null ? { media_id: mediaId } : undefined, undefined,
        { preferenceKey, skipPreferenceCheck: false },
      );
    } catch (e) {
      console.warn("[transcode] notification failed:", e);
    }
  }
}

export const transcodeNotifier: TranscodeNotifier = {
  async jobFailed(job: ClaimedJob, error: string) {
    await toAdmins(
      (l) => ({
        type: "library_transcode_failed",
        title: notificationCopy(l, "libraryTranscodeFailedTitle"),
        body: notificationCopy(l, "libraryTranscodeFailedBody", { title: job.title, reason: error }),
      }),
      "library_failed",
      job.mediaId,
    );
  },
  async batchFinished(job, s) {
    await toAdmins(
      (l) => ({
        type: "library_transcode_finished",
        title: notificationCopy(l, "libraryTranscodeFinishedTitle"),
        body: notificationCopy(l, "libraryTranscodeFinishedBody", {
          title: job.title.split(" — ")[0],
          done: String(s.done),
          failed: String(s.failed),
          saved: gb(s.savedBytes),
          pending: s.pendingSeedBytes > 0n ? gb(s.pendingSeedBytes) : "",
        }),
      }),
      "library_downloaded",
      job.mediaId,
    );
  },
};
```

- [ ] **Step 7: Implement the dispatcher**

`apps/api/src/services/transcode/dispatcher.ts`:
```ts
import { cpus } from "node:os";
import type { TranscodeLiveProgress } from "@rawkoon/shared/types";
import { finalPathFor, tmpPathFor } from "@rawkoon/api/services/transcode/outputPath";
import { type PipelineDeps, runPipeline } from "@rawkoon/api/services/transcode/pipeline";
import { isInsideWindow } from "@rawkoon/api/services/transcode/queueMath";
import type { ClaimedJob, TranscodeRepo } from "@rawkoon/api/services/transcode/repo";
import { recoverSwap } from "@rawkoon/api/services/transcode/swap";

export interface TranscodeNotifier {
  jobFailed(job: ClaimedJob, error: string): Promise<void>;
  batchFinished(job: ClaimedJob, s: { done: number; failed: number; savedBytes: bigint; pendingSeedBytes: bigint }): Promise<void>;
}

const TICK_MS = 10_000;
const PERSIST_MS = 15_000;

export class TranscodeDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: { id: number; abort: AbortController; live: TranscodeLiveProgress | null } | null = null;
  private busy: Promise<void> | null = null;

  constructor(
    private repo: TranscodeRepo,
    private deps: PipelineDeps,
    private notifier: TranscodeNotifier,
    private now: () => Date = () => new Date(),
    private defaultThreads: () => number = () => Math.max(1, cpus().length - 2),
  ) {}

  start(): void {
    if (this.timer) return;
    void this.recover()
      .catch((e) => console.error("[transcode] boot recovery failed:", e))
      .finally(() => {
        this.timer = setInterval(() => void this.tick(), TICK_MS);
      });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running?.abort.abort();
    await this.busy;
  }

  runningJobId(): number | null {
    return this.running?.id ?? null;
  }

  live(jobId: number): TranscodeLiveProgress | null {
    return this.running?.id === jobId ? this.running.live : null;
  }

  cancel(jobId: number): boolean {
    if (this.running?.id !== jobId) return false;
    this.running.abort.abort();
    return true;
  }

  async recover(): Promise<void> {
    for (const job of await this.repo.runningJobs()) {
      if (job.source) {
        const src = this.deps.mapPath(job.source.dbPath);
        const verify = async (p: string) => {
          try {
            await this.deps.probe(p);
            return true;
          } catch {
            return false;
          }
        };
        const h = job.settings.resolution === "keep" ? null : job.settings.resolution;
        await recoverSwap({ source: src, final: finalPathFor(src, h), fs: this.deps.fs, verify }).catch((e) =>
          console.error(`[transcode] recoverSwap failed for job ${job.id}:`, e),
        );
        await this.deps.fs.unlink(tmpPathFor(src)).catch(() => {});
      }
      await this.repo.requeue(job.id);
    }
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    const settings = await this.repo.getSettings();
    if (settings.paused) return;
    if (settings.window_enabled && !isInsideWindow(this.now(), settings.window_start, settings.window_end)) return;
    const job = await this.repo.claimNext();
    if (!job) return;
    this.busy = this.execute(job, settings.cpu_threads ?? this.defaultThreads(), {
      avg: settings.ssim_threshold,
      min: settings.ssim_clip_min,
    }).finally(() => {
      this.busy = null;
      this.running = null;
    });
    await this.busy;
  }

  private async execute(job: ClaimedJob, threads: number, thresholds: { avg: number; min: number }): Promise<void> {
    const abort = new AbortController();
    this.running = { id: job.id, abort, live: null };
    let lastPersist = 0;
    // PipelineDeps.rescan takes one argument; the file id travels in the token (split in index.ts).
    const deps: PipelineDeps = { ...this.deps, rescan: (finalDbPath) => this.deps.rescan(`${job.mediaFileId}|${finalDbPath}`) };
    const result = job.source
      ? await runPipeline(
          { id: job.id, settings: job.settings, estimatedBytes: job.estimatedBytes, source: job.source },
          deps,
          {
            onStep: (step) => void this.repo.markStep(job.id, step).catch(() => {}),
            onProgress: (p) => {
              if (this.running) this.running.live = p;
              if (Date.now() - lastPersist > PERSIST_MS) {
                lastPersist = Date.now();
                void this.repo.saveProgress(job.id, p.progress).catch(() => {});
              }
            },
          },
          { signal: abort.signal, threads, thresholds },
        )
      : ({ ok: false, cancelled: false, error: "File no longer in library" } as const);

    await this.repo.finish(job.id, result);
    if (!result.ok && !result.cancelled) await this.notifier.jobFailed(job, result.error).catch(() => {});
    if ((await this.repo.batchRemaining(job.batchId)) === 0) {
      await this.notifier.batchFinished(job, await this.repo.batchSummary(job.batchId)).catch(() => {});
    }
  }
}
```

- [ ] **Step 8: Wire real deps**

`apps/api/src/services/transcode/index.ts`:
```ts
import { stat, statfs } from "node:fs/promises";
import { statFileFingerprint } from "@rawkoon/api/utils/medias/fileFingerprint";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { TranscodeDispatcher } from "@rawkoon/api/services/transcode/dispatcher";
import { runFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import { transcodeNotifier } from "@rawkoon/api/services/transcode/notify";
import type { PipelineDeps } from "@rawkoon/api/services/transcode/pipeline";
import { probeFile } from "@rawkoon/api/services/transcode/probe";
import { prismaTranscodeRepo } from "@rawkoon/api/services/transcode/repo";
import { rescanTranscodedFile } from "@rawkoon/api/services/transcode/rescanFile";
import { nodeSwapFs } from "@rawkoon/api/services/transcode/swap";

export const transcodeDeps: PipelineDeps = {
  mapPath: remapPath,
  probe: probeFile,
  run: runFfmpeg,
  fingerprint: statFileFingerprint,
  nlink: async (p) => Number((await stat(p)).nlink),
  freeBytes: async (dir) => {
    const s = await statfs(dir, { bigint: true });
    return s.bavail * s.bsize;
  },
  fs: nodeSwapFs,
  capabilities: () => detectCapabilities(),
  rescan: async (token) => {
    const [id, path] = token.split(/\|(.*)/s);
    await rescanTranscodedFile(Number(id), path);
  },
};

export const transcodeDispatcher = new TranscodeDispatcher(prismaTranscodeRepo, transcodeDeps, transcodeNotifier);
```

- [ ] **Step 9: Start/stop with the other workers**

In `apps/api/src/services/queueService.ts`, at the end of the body of `initWorkers()` add:
```ts
  void import("./transcode").then(({ transcodeDispatcher }) => transcodeDispatcher.start());
```
At the start of the body of `closeAllWorkers()` add:
```ts
  await import("./transcode").then(({ transcodeDispatcher }) => transcodeDispatcher.stop());
```
(If `closeAllWorkers` is not `async`, make it `async`; its caller in `src/index.ts` already awaits or ignores the promise — check and keep behaviour.)

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/transcode/`
Expected: PASS (all transcode suites, including 6 dispatcher tests).
Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/services/transcode apps/api/src/services/queueService.ts apps/api/src/services/notificationCopy.ts apps/shared/src/types/notification.ts
git commit -m "feat(transcode): add queue dispatcher with boot recovery and notifications"
```

---

### Task 12: Selection, estimates and API routes

**Files:**
- Create: `apps/api/src/services/transcode/selection.ts`
- Create: `apps/api/src/services/transcode/estimateService.ts`
- Create: `apps/api/src/services/transcode/queueApi.ts`
- Create: `apps/api/src/routes/transcode/index.ts`
- Modify: `apps/api/src/index.ts` (mount `/api/transcode`)
- Test: `apps/api/src/services/transcode/selection.test.ts`
- Test: `apps/api/src/routes/transcode/transcodeRoutes.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
```ts
// selection.ts
export interface CandidateFile { id: number; title: string; dbPath: string; sizeBytes: bigint; mediaId: number | null; fileMtimeMs: bigint | null; fileDev: string | null; fileIno: string | null }
export const VIDEO_EXTENSIONS: Set<string>;
export function exclusionReason(o: { path: string; probe: SourceProbe | null; settings: TranscodeJobSettings; active: boolean; caps: Capabilities }): string | null;
export async function loadCandidates(sel: TranscodeSelection): Promise<CandidateFile[]>;
// estimateService.ts
export async function estimateSelection(sel: TranscodeSelection, settings: TranscodeJobSettings, refine: boolean): Promise<TranscodeEstimate>;
// queueApi.ts
export async function enqueueSelection(sel, settings): Promise<{ batch_id: string; count: number; excluded: TranscodeExcludedFile[] }>;
export async function listJobs(statuses: TranscodeJobStatus[], since?: Date): Promise<TranscodeJob[]>;
export async function cancelOrRemove(id: number): Promise<"cancelled" | "removed" | "not_found" | "finished">;
export async function removeBatch(batchId: string): Promise<number>;
export async function moveJob(id: number, body: { top?: true; before_id?: number; after_id?: number }): Promise<boolean>;
export async function moveBatchTop(batchId: string): Promise<number>;
export async function retryJob(id: number): Promise<boolean>;
export async function clearHistory(): Promise<number>;
export async function updateQueueSettings(patch): Promise<TranscodeQueueSettings>;
export async function buildSummary(): Promise<TranscodeSummary>;
// routes
export const transcodeRoutes: Hono<Env>;
```

- [ ] **Step 1: Write the failing selection test**

`apps/api/src/services/transcode/selection.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";
import { exclusionReason } from "@rawkoon/api/services/transcode/selection";

const settings: TranscodeJobSettings = {
  codec: "hevc", encoder: "software", resolution: "keep", mode: "quality",
  preset: "balanced", speed: "default", convertLosslessAudio: false,
};
const caps = { combos: [{ codec: "hevc" as const, encoder: "software" as const }], vaapiDevice: null, deviceLabel: null, vaapiUnavailableReason: "none" };
const p1080 = parseProbe({ format: { duration: "10", size: "10" }, streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }] });

describe("exclusionReason", () => {
  it("accepts a normal file", () => {
    expect(exclusionReason({ path: "/a.mkv", probe: p1080, settings, active: false, caps })).toBeNull();
  });
  it("rejects non-video extensions", () => {
    expect(exclusionReason({ path: "/a.srt", probe: null, settings, active: false, caps })).toBe("Not a video file");
  });
  it("rejects files already queued", () => {
    expect(exclusionReason({ path: "/a.mkv", probe: p1080, settings, active: true, caps })).toBe("Already queued");
  });
  it("rejects unreadable files", () => {
    expect(exclusionReason({ path: "/a.mkv", probe: null, settings, active: false, caps })).toBe("Could not read the file");
  });
  it("rejects Dolby Vision profile 5", () => {
    expect(exclusionReason({ path: "/a.mkv", probe: { ...p1080, dvProfile: 5 }, settings, active: false, caps })).toContain("Dolby Vision profile 5");
  });
  it("rejects a downscale that is not lower than the source", () => {
    expect(exclusionReason({ path: "/a.mkv", probe: p1080, settings: { ...settings, resolution: 1080 }, active: false, caps })).toBe("Already 1080p or lower");
  });
  it("rejects an unavailable encoder combo", () => {
    expect(exclusionReason({ path: "/a.mkv", probe: p1080, settings: { ...settings, codec: "av1" }, active: false, caps })).toBe("Encoder not available");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/transcode/selection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement selection**

`apps/api/src/services/transcode/selection.ts`:
```ts
import { extname } from "node:path";
import type { TranscodeJobSettings, TranscodeSelection } from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import type { Capabilities } from "@rawkoon/api/services/transcode/capabilities";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";

export const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".m4v", ".avi", ".mov", ".ts", ".m2ts", ".wmv", ".webm"]);

export interface CandidateFile {
  id: number;
  title: string;
  dbPath: string;
  sizeBytes: bigint;
  mediaId: number | null;
  fileMtimeMs: bigint | null;
  fileDev: string | null;
  fileIno: string | null;
}

export function exclusionReason(o: {
  path: string;
  probe: SourceProbe | null;
  settings: TranscodeJobSettings;
  active: boolean;
  caps: Capabilities;
}): string | null {
  if (!VIDEO_EXTENSIONS.has(extname(o.path).toLowerCase())) return "Not a video file";
  if (o.active) return "Already queued";
  if (!o.caps.combos.some((c) => c.codec === o.settings.codec && c.encoder === o.settings.encoder)) return "Encoder not available";
  if (!o.probe?.video) return "Could not read the file";
  if (o.probe.dvProfile === 5) return "Dolby Vision profile 5 has no HDR10 fallback";
  if (o.settings.resolution !== "keep" && (o.probe.video.height ?? 0) <= o.settings.resolution) {
    return `Already ${o.settings.resolution}p or lower`;
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export async function loadCandidates(sel: TranscodeSelection): Promise<CandidateFile[]> {
  const where = sel.file_ids?.length
    ? { id: { in: sel.file_ids } }
    : sel.season != null
      ? { episode: { mediaId: sel.media_id, season: sel.season } }
      : { OR: [{ mediaId: sel.media_id }, { episode: { mediaId: sel.media_id } }] };
  const rows = await prisma.mediaFile.findMany({
    where,
    select: {
      id: true, filePath: true, sizeBytes: true, mediaId: true, fileMtimeMs: true, fileDev: true, fileIno: true,
      media: { select: { title: true } },
      episode: { select: { season: true, episode: true, mediaId: true, media: { select: { title: true } } } },
    },
    orderBy: [{ episode: { season: "asc" } }, { episode: { episode: "asc" } }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.episode
      ? `${r.episode.media.title} — S${pad(r.episode.season)}E${pad(r.episode.episode)}`
      : (r.media?.title ?? `File ${r.id}`),
    dbPath: r.filePath,
    sizeBytes: r.sizeBytes,
    mediaId: r.mediaId ?? r.episode?.mediaId ?? null,
    fileMtimeMs: r.fileMtimeMs,
    fileDev: r.fileDev,
    fileIno: r.fileIno,
  }));
}
```

- [ ] **Step 4: Implement the estimate service**

`apps/api/src/services/transcode/estimateService.ts`:
```ts
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  TranscodeEstimate,
  TranscodeEstimateFile,
  TranscodeExcludedFile,
  TranscodeJobSettings,
  TranscodeSelection,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { applyRatio, type FileEstimate, roughEstimate, SAMPLE_CLIPS, sampleRatios } from "@rawkoon/api/services/transcode/estimate";
import { runFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import { eac3BitrateFor, isLosslessAudio } from "@rawkoon/api/services/transcode/presets";
import { probeFile, type SourceProbe } from "@rawkoon/api/services/transcode/probe";
import { type CandidateFile, exclusionReason, loadCandidates } from "@rawkoon/api/services/transcode/selection";

const probeCache = new Map<string, SourceProbe>();
const refineCache = new Map<string, { at: number; value: { est: FileEstimate; rangePct: number } }>();
const REFINE_TTL_MS = 30 * 60_000;

async function cachedProbe(f: CandidateFile): Promise<SourceProbe | null> {
  const key = `${f.id}:${f.sizeBytes}:${f.fileMtimeMs}`;
  const hit = probeCache.get(key);
  if (hit) return hit;
  try {
    const p = await probeFile(remapPath(f.dbPath));
    probeCache.set(key, p);
    return p;
  } catch {
    return null;
  }
}

async function nlinkOf(f: CandidateFile): Promise<number> {
  try {
    return Number((await stat(remapPath(f.dbPath))).nlink);
  } catch {
    return 1;
  }
}

export async function activeFileIds(ids: number[]): Promise<Set<number>> {
  const rows = await prisma.transcodeJob.findMany({
    where: { mediaFileId: { in: ids }, status: { in: ["queued", "running"] } },
    select: { mediaFileId: true },
  });
  return new Set(rows.map((r) => r.mediaFileId!));
}

export async function resolveEligible(sel: TranscodeSelection, settings: TranscodeJobSettings) {
  const caps = await detectCapabilities();
  const candidates = await loadCandidates(sel);
  const active = await activeFileIds(candidates.map((c) => c.id));
  const eligible: { file: CandidateFile; probe: SourceProbe }[] = [];
  const excluded: TranscodeExcludedFile[] = [];
  for (const file of candidates) {
    const probe = await cachedProbe(file);
    const reason = exclusionReason({ path: file.dbPath, probe, settings, active: active.has(file.id), caps });
    if (reason) excluded.push({ file_id: file.id, title: file.title, reason });
    else eligible.push({ file, probe: probe! });
  }
  return { eligible, excluded, caps };
}

function pickSamples<T extends { file: CandidateFile }>(items: T[]): T[] {
  if (items.length <= 3) return items;
  const sorted = [...items].sort((a, b) => Number(a.file.sizeBytes - b.file.sizeBytes));
  return [sorted[sorted.length - 1], sorted[Math.floor(sorted.length / 2)], sorted[0]];
}

export async function estimateSelection(
  sel: TranscodeSelection,
  settings: TranscodeJobSettings,
  refine: boolean,
): Promise<TranscodeEstimate> {
  const { eligible, excluded, caps } = await resolveEligible(sel, settings);
  const settingsKey = JSON.stringify(settings);
  let ratio: number | null = null;
  let rangePct = settings.mode === "target" ? 3 : 15;
  let refinedFiles = 0;
  let fps: number | null = null;

  if (refine && settings.mode === "quality" && eligible.length) {
    const ratios: number[] = [];
    for (const item of pickSamples(eligible)) {
      const key = `${item.file.id}:${settingsKey}`;
      const hit = refineCache.get(key);
      if (hit && Date.now() - hit.at < REFINE_TTL_MS) {
        ratios.push(Number(hit.value.est.videoBytes) / Math.max(1, Number(roughEstimate(item.probe, settings).videoBytes)));
        continue;
      }
      const workDir = join(tmpdir(), "rawkoon-transcode", String(item.file.id));
      await mkdir(workDir, { recursive: true });
      try {
        const r = await sampleRatios({
          input: remapPath(item.file.dbPath), probe: item.probe, settings, workDir, run: runFfmpeg,
          threads: 4, vaapiDevice: caps.vaapiDevice, statSize: async (p) => (await stat(p)).size,
        });
        const applied = applyRatio(item.probe, settings, r.ratios, r.fps);
        refineCache.set(key, { at: Date.now(), value: applied });
        ratios.push(Number(applied.est.videoBytes) / Math.max(1, Number(roughEstimate(item.probe, settings).videoBytes)));
        rangePct = Math.max(5, applied.rangePct);
        fps = r.fps;
        refinedFiles++;
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    if (ratios.length) ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }

  const files: TranscodeEstimateFile[] = [];
  let totalSrc = 0n, totalEst = 0n, totalAudio = 0n, freesNow = 0n, freesLater = 0n, growth = 0n;
  let eta = 0, duration = 0;
  for (const { file, probe } of eligible) {
    const rough = roughEstimate(probe, settings);
    const video = ratio != null ? BigInt(Math.round(Number(rough.videoBytes) * ratio)) : rough.videoBytes;
    const total = ((video + rough.audioBytes) * 101n) / 100n;
    const nlink = await nlinkOf(file);
    const saved = file.sizeBytes > total ? file.sizeBytes - total : 0n;
    if (nlink > 1) { freesLater += saved; growth += total; } else freesNow += saved;
    totalSrc += file.sizeBytes; totalEst += total; totalAudio += rough.audioBytes;
    duration += probe.durationSecs;
    eta += fps && probe.video?.fps ? Math.round((probe.durationSecs * probe.video.fps) / fps) : rough.etaSecs;
    files.push({ file_id: file.id, title: file.title, source_bytes: String(file.sizeBytes), estimated_bytes: String(total), nlink, duration_secs: probe.durationSecs });
  }

  const first = eligible[0]?.probe;
  const audioChanges = first
    ? first.streams.filter(isLosslessAudio).map((a) => ({
        label: `${(a.language ?? "und").toUpperCase()} · ${a.codec.toUpperCase()}${a.channels ? ` ${a.channels}ch` : ""}`,
        to: `EAC3 ${eac3BitrateFor(a.channels).kbps}k`,
      }))
    : [];

  return {
    files, excluded,
    total_source_bytes: String(totalSrc),
    total_estimated_bytes: String(totalEst),
    total_duration_secs: Math.round(duration),
    total_audio_bytes: String(totalAudio),
    range_pct: rangePct,
    frees_now_bytes: String(freesNow),
    frees_after_seeding_bytes: String(freesLater),
    temporary_growth_bytes: String(growth),
    eta_secs: eta,
    source: settings.mode === "target" ? "target" : refinedFiles ? "refined" : "rough",
    refined_files: refinedFiles,
    refined_clips: refinedFiles * SAMPLE_CLIPS,
    audio_changes: audioChanges,
    source_height: first?.video?.height ?? null,
  };
}
```

- [ ] **Step 5: Implement queue API functions**

`apps/api/src/services/transcode/queueApi.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  TranscodeExcludedFile,
  TranscodeJob,
  TranscodeJobSettings,
  TranscodeJobStatus,
  TranscodeQueueSettings,
  TranscodeSelection,
  TranscodeSummary,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { roughEstimate } from "@rawkoon/api/services/transcode/estimate";
import { transcodeDispatcher } from "@rawkoon/api/services/transcode/index";
import { blockToTop, isInsideWindow, positionBetween } from "@rawkoon/api/services/transcode/queueMath";
import { loadQueueSettings } from "@rawkoon/api/services/transcode/repo";
import { resolveEligible } from "@rawkoon/api/services/transcode/estimateService";

type Row = Prisma.TranscodeJobGetPayload<{ include: typeof withPoster }>;

function toJob(r: Row): TranscodeJob {
  return {
    id: r.id, media_file_id: r.mediaFileId, media_id: r.mediaId, batch_id: r.batchId, title: r.title,
    position: r.position, status: r.status as TranscodeJobStatus, step: (r.step as TranscodeJob["step"]) ?? null,
    settings: r.settings as unknown as TranscodeJobSettings,
    source_bytes: String(r.sourceBytes), estimated_bytes: r.estimatedBytes != null ? String(r.estimatedBytes) : null,
    output_bytes: r.outputBytes != null ? String(r.outputBytes) : null, source_nlink: r.sourceNlink,
    progress: r.progress, ssim_avg: r.ssimAvg, ssim_min: r.ssimMin, error: r.error,
    created_at: r.createdAt.toISOString(), started_at: r.startedAt?.toISOString() ?? null,
    finished_at: r.finishedAt?.toISOString() ?? null, poster_url: r.media?.posterUrl ?? null,
    live: transcodeDispatcher.live(r.id),
  };
}

const withPoster = { media: { select: { posterUrl: true } } } as const;

export async function enqueueSelection(sel: TranscodeSelection, settings: TranscodeJobSettings) {
  const { eligible, excluded } = await resolveEligible(sel, settings);
  const batchId = randomUUID();
  const tail = await prisma.transcodeJob.aggregate({ where: { status: "queued" }, _max: { position: true } });
  let pos = tail._max.position ?? 0;
  const created: number[] = [];
  const skipped: TranscodeExcludedFile[] = [...excluded];
  for (const { file, probe } of eligible) {
    pos += 1;
    try {
      const row = await prisma.transcodeJob.create({
        data: {
          mediaFileId: file.id, mediaId: file.mediaId, batchId, title: file.title, position: pos,
          settings: settings as object, sourceBytes: file.sizeBytes,
          estimatedBytes: roughEstimate(probe, settings).totalBytes,
        },
      });
      created.push(row.id);
    } catch {
      // Partial unique index: another request queued this file first.
      skipped.push({ file_id: file.id, title: file.title, reason: "Already queued" });
    }
  }
  return { batch_id: batchId, count: created.length, excluded: skipped };
}

export async function listJobs(statuses: TranscodeJobStatus[], since?: Date): Promise<TranscodeJob[]> {
  const rows = await prisma.transcodeJob.findMany({
    where: { status: { in: statuses }, ...(since ? { OR: [{ finishedAt: null }, { finishedAt: { gte: since } }] } : {}) },
    include: withPoster,
    orderBy: statuses.every((s) => s === "queued" || s === "running") ? { position: "asc" } : { finishedAt: "desc" },
    take: 1000,
  });
  return rows.map(toJob);
}

export async function cancelOrRemove(id: number): Promise<"cancelled" | "removed" | "not_found" | "finished"> {
  const row = await prisma.transcodeJob.findUnique({ where: { id }, select: { status: true } });
  if (!row) return "not_found";
  if (row.status === "running") return transcodeDispatcher.cancel(id) ? "cancelled" : "not_found";
  if (row.status !== "queued") return "finished";
  await prisma.transcodeJob.update({ where: { id }, data: { status: "cancelled", finishedAt: new Date() } });
  return "removed";
}

export async function removeBatch(batchId: string): Promise<number> {
  const r = await prisma.transcodeJob.updateMany({ where: { batchId, status: "queued" }, data: { status: "cancelled", finishedAt: new Date() } });
  return r.count;
}

export async function moveJob(id: number, body: { top?: true; before_id?: number; after_id?: number }): Promise<boolean> {
  const row = await prisma.transcodeJob.findUnique({ where: { id }, select: { status: true } });
  if (row?.status !== "queued") return false;
  let pos: number;
  if (body.top) {
    const min = await prisma.transcodeJob.aggregate({ where: { status: "queued" }, _min: { position: true } });
    pos = positionBetween(null, min._min.position ?? 1);
  } else {
    const anchorId = (body.before_id ?? body.after_id)!;
    const anchor = await prisma.transcodeJob.findUnique({ where: { id: anchorId }, select: { position: true, status: true } });
    if (anchor?.status !== "queued") return false;
    const neighbour = await prisma.transcodeJob.findFirst({
      where: { status: "queued", id: { not: id }, position: body.before_id ? { lt: anchor.position } : { gt: anchor.position } },
      orderBy: { position: body.before_id ? "desc" : "asc" },
      select: { position: true },
    });
    pos = body.before_id
      ? positionBetween(neighbour?.position ?? null, anchor.position)
      : positionBetween(anchor.position, neighbour?.position ?? null);
  }
  await prisma.transcodeJob.update({ where: { id }, data: { position: pos } });
  return true;
}

export async function moveBatchTop(batchId: string): Promise<number> {
  const rows = await prisma.transcodeJob.findMany({ where: { batchId, status: "queued" }, orderBy: { position: "asc" }, select: { id: true } });
  const min = await prisma.transcodeJob.aggregate({ where: { status: "queued" }, _min: { position: true } });
  const positions = blockToTop(min._min.position ?? null, rows.length);
  await prisma.$transaction(rows.map((r, i) => prisma.transcodeJob.update({ where: { id: r.id }, data: { position: positions[i] } })));
  return rows.length;
}

export async function retryJob(id: number): Promise<boolean> {
  const row = await prisma.transcodeJob.findUnique({ where: { id }, select: { status: true } });
  if (row?.status !== "failed" && row?.status !== "cancelled") return false;
  const tail = await prisma.transcodeJob.aggregate({ where: { status: "queued" }, _max: { position: true } });
  try {
    await prisma.transcodeJob.update({
      where: { id },
      data: { status: "queued", position: (tail._max.position ?? 0) + 1, error: null, step: null, progress: null, startedAt: null, finishedAt: null, outputBytes: null, ssimAvg: null, ssimMin: null },
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearHistory(): Promise<number> {
  const r = await prisma.transcodeJob.deleteMany({ where: { status: { in: ["done", "failed", "cancelled"] } } });
  return r.count;
}

export async function purgeOldHistory(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  await prisma.transcodeJob.deleteMany({ where: { status: { in: ["done", "failed", "cancelled"] }, finishedAt: { lt: cutoff } } });
}

export async function updateQueueSettings(p: Partial<TranscodeQueueSettings>): Promise<TranscodeQueueSettings> {
  await loadQueueSettings();
  await prisma.transcodeSettings.update({
    where: { id: 1 },
    data: {
      paused: p.paused, windowEnabled: p.window_enabled, windowStart: p.window_start, windowEnd: p.window_end,
      ssimThreshold: p.ssim_threshold, ssimClipMin: p.ssim_clip_min, cpuThreads: p.cpu_threads,
    },
  });
  return loadQueueSettings();
}

export async function buildSummary(): Promise<TranscodeSummary> {
  await purgeOldHistory();
  const settings = await loadQueueSettings();
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since24 = new Date(Date.now() - 86_400_000);
  const [active, done, failedCount, recent] = await Promise.all([
    prisma.transcodeJob.findMany({ where: { status: { in: ["running", "queued"] } }, include: withPoster, orderBy: { position: "asc" } }),
    prisma.transcodeJob.findMany({ where: { status: "done", finishedAt: { gte: since30 } }, select: { sourceBytes: true, outputBytes: true, sourceNlink: true } }),
    prisma.transcodeJob.count({ where: { status: "failed", finishedAt: { gte: since30 } } }),
    prisma.transcodeJob.count({ where: { finishedAt: { gte: since24 } } }),
  ]);
  const running = active.find((j) => j.status === "running") ?? null;
  const queued = active.filter((j) => j.status === "queued");
  let saved = 0n, pending = 0n;
  for (const d of done) {
    if (d.outputBytes == null) continue;
    const diff = d.sourceBytes - d.outputBytes;
    if ((d.sourceNlink ?? 1) > 1) pending += diff; else saved += diff;
  }
  const inWindow = !settings.window_enabled || isInsideWindow(new Date(), settings.window_start, settings.window_end);
  const state = running ? "running" : settings.paused ? "paused" : queued.length && !inWindow ? "waiting_window" : queued.length ? "running" : "idle";
  const eta = queued.reduce((t, j) => t + Math.round(Number(j.sourceBytes) / 25_000_000), 0);
  return {
    show: active.length > 0 || recent > 0,
    state,
    window_start: settings.window_start,
    current: running ? toJob(running) : null,
    next: queued.slice(0, 2).map(toJob),
    queued_count: queued.length,
    queued_source_bytes: String(queued.reduce((t, j) => t + j.sourceBytes, 0n)),
    queued_eta_secs: eta,
    saved_bytes_30d: String(saved),
    done_count_30d: done.length,
    frees_after_seeding_bytes: String(pending),
    failed_count: failedCount,
  };
}
```
(`queued_eta_secs` uses a flat 25 MB/s input-processing guess per queued job; it's a display hint only.)

- [ ] **Step 6: Write the failing route test**

`apps/api/src/routes/transcode/transcodeRoutes.test.ts`:
```ts
import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireAdmin: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("user", { id: "u", is_admin: true });
    await next();
  },
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
}));

const calls: string[] = [];
mock.module("@rawkoon/api/services/transcode/queueApi", () => ({
  enqueueSelection: async () => { calls.push("enqueue"); return { batch_id: "b", count: 2, excluded: [] }; },
  listJobs: async (s: string[]) => { calls.push(`list ${s.join(",")}`); return []; },
  cancelOrRemove: async (id: number) => (id === 404 ? "not_found" : "removed"),
  removeBatch: async () => 3,
  moveJob: async (id: number) => id !== 404,
  moveBatchTop: async () => 2,
  retryJob: async (id: number) => id !== 404,
  clearHistory: async () => 5,
  updateQueueSettings: async (p: object) => ({ paused: false, ...p }),
  buildSummary: async () => ({ show: false }),
}));
mock.module("@rawkoon/api/services/transcode/estimateService", () => ({
  estimateSelection: async (_s: unknown, _set: unknown, refine: boolean) => ({ source: refine ? "refined" : "rough" }),
}));
mock.module("@rawkoon/api/services/transcode/capabilities", () => ({
  detectCapabilities: async () => ({ combos: [], deviceLabel: null, vaapiUnavailableReason: "none", vaapiDevice: null }),
}));
mock.module("@rawkoon/api/services/transcode/repo", () => ({
  loadQueueSettings: async () => ({ paused: false }),
}));

const { transcodeRoutes } = await import("@rawkoon/api/routes/transcode");
const app = new Hono().route("/api/transcode", transcodeRoutes);

const settings = { codec: "hevc", encoder: "software", resolution: "keep", mode: "quality", preset: "balanced", speed: "default", convertLosslessAudio: false };
const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("transcode routes", () => {
  it("estimate passes the refine flag", async () => {
    const r = await post("/api/transcode/estimate", { selection: { file_ids: [1] }, settings, refine: true });
    expect(r.status).toBe(200);
    expect((await r.json()).source).toBe("refined");
  });

  it("estimate rejects invalid settings", async () => {
    const r = await post("/api/transcode/estimate", { selection: { file_ids: [1] }, settings: { ...settings, codec: "vp9" } });
    expect(r.status).toBe(400);
  });

  it("enqueue returns the batch", async () => {
    const r = await post("/api/transcode/jobs", { selection: { media_id: 1 }, settings });
    expect(await r.json()).toEqual({ batch_id: "b", count: 2, excluded: [] });
  });

  it("lists queued jobs by default", async () => {
    await app.request("/api/transcode/jobs");
    expect(calls).toContain("list queued,running");
  });

  it("404s unknown jobs on delete, move and retry", async () => {
    expect((await app.request("/api/transcode/jobs/404", { method: "DELETE" })).status).toBe(404);
    expect((await post("/api/transcode/jobs/404/move", { top: true })).status).toBe(404);
    expect((await post("/api/transcode/jobs/404/retry", {})).status).toBe(404);
  });

  it("patches settings", async () => {
    const r = await app.request("/api/transcode/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: true }),
    });
    expect((await r.json()).paused).toBe(true);
  });

  it("rejects a malformed window time", async () => {
    const r = await app.request("/api/transcode/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ window_start: "25:00" }),
    });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd apps/api && bun test src/routes/transcode/transcodeRoutes.test.ts`
Expected: FAIL — cannot resolve `@rawkoon/api/routes/transcode`.

- [ ] **Step 8: Implement the routes**

`apps/api/src/routes/transcode/index.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import type { TranscodeJobStatus } from "@rawkoon/shared/types";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { estimateSelection } from "@rawkoon/api/services/transcode/estimateService";
import {
  buildSummary, cancelOrRemove, clearHistory, enqueueSelection, listJobs,
  moveBatchTop, moveJob, removeBatch, retryJob, updateQueueSettings,
} from "@rawkoon/api/services/transcode/queueApi";
import { loadQueueSettings } from "@rawkoon/api/services/transcode/repo";
import {
  enqueueBodySchema, estimateBodySchema, moveBodySchema, queueSettingsPatchSchema,
} from "@rawkoon/api/services/transcode/settingsSchema";

const STATUSES = new Set<TranscodeJobStatus>(["queued", "running", "done", "failed", "cancelled"]);

function idParam(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /capabilities · POST /estimate · POST|GET /jobs · DELETE /jobs/:id
 * POST /jobs/:id/move · POST /jobs/:id/retry · DELETE /batches/:id · POST /batches/:id/move
 * DELETE /history · GET|PATCH /settings · GET /summary
 */
export const transcodeRoutes = new Hono<Env>()
  .use("*", requireAdmin)

  .get("/capabilities", async () => {
    const c = await detectCapabilities();
    return ok({ combos: c.combos, device_label: c.deviceLabel, vaapi_unavailable_reason: c.vaapiUnavailableReason });
  })

  .post("/estimate", jsonV(estimateBodySchema), async (c) => {
    const b = c.req.valid("json");
    try {
      return ok(await estimateSelection(b.selection, b.settings, b.refine === true));
    } catch (e) {
      console.error("[transcode] estimate failed:", e);
      return serverError("Estimate failed");
    }
  })

  .post("/jobs", jsonV(enqueueBodySchema), async (c) => {
    const b = c.req.valid("json");
    return ok(await enqueueSelection(b.selection, b.settings));
  })

  .get("/jobs", async (c) => {
    const raw = (c.req.query("status") ?? "queued,running").split(",");
    const statuses = raw.filter((s): s is TranscodeJobStatus => STATUSES.has(s as TranscodeJobStatus));
    if (!statuses.length) return badRequest("Invalid status filter");
    const since = c.req.query("since");
    return ok({ jobs: await listJobs(statuses, since ? new Date(since) : undefined) });
  })

  .delete("/jobs/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    if (!id) return badRequest("Invalid job id");
    const r = await cancelOrRemove(id);
    if (r === "not_found") return notFound("Job not found");
    if (r === "finished") return badRequest("Job already finished");
    return ok({ result: r });
  })

  .post("/jobs/:id/move", jsonV(moveBodySchema), async (c) => {
    const id = idParam(c.req.param("id"));
    if (!id) return badRequest("Invalid job id");
    return (await moveJob(id, c.req.valid("json"))) ? ok({ moved: true }) : notFound("Queued job not found");
  })

  .post("/jobs/:id/retry", async (c) => {
    const id = idParam(c.req.param("id"));
    if (!id) return badRequest("Invalid job id");
    return (await retryJob(id)) ? ok({ retried: true }) : notFound("Failed or cancelled job not found");
  })

  .delete("/batches/:batchId", async (c) => ok({ removed: await removeBatch(c.req.param("batchId")) }))

  .post("/batches/:batchId/move", jsonV(z.object({ top: z.literal(true) })), async (c) =>
    ok({ moved: await moveBatchTop(c.req.param("batchId")) }),
  )

  .delete("/history", async () => ok({ removed: await clearHistory() }))

  .get("/settings", async () => ok(await loadQueueSettings()))

  .patch("/settings", jsonV(queueSettingsPatchSchema), async (c) => ok(await updateQueueSettings(c.req.valid("json"))))

  .get("/summary", async () => ok(await buildSummary()));
```

In `apps/api/src/index.ts`, add the import next to the other route imports:
```ts
import { transcodeRoutes } from "./routes/transcode";
```
and add to the `.route(...)` chain right after `.route("/api/library", libraryRoutes)`:
```ts
  .route("/api/transcode", transcodeRoutes)
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/transcode/selection.test.ts src/routes/transcode/transcodeRoutes.test.ts`
Expected: PASS (7 + 7 tests).
Run: `bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/transcode apps/api/src/routes/transcode apps/api/src/index.ts
git commit -m "feat(transcode): expose estimate, queue and settings endpoints"
```

---

### Task 13: End-to-end pipeline test with real ffmpeg

**Files:**
- Create: `apps/api/test/transcodePipeline.integration.test.ts`
- Modify: `.github/workflows/ci.yml` (install ffmpeg in the `test` job)

**Interfaces:**
- Consumes: `runPipeline`, `probeFile`, `runFfmpeg`, `nodeSwapFs`, `detectCapabilities` (real implementations).

- [ ] **Step 1: Write the integration test**

`apps/api/test/transcodePipeline.integration.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { runFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import { type PipelineDeps, runPipeline } from "@rawkoon/api/services/transcode/pipeline";
import { probeFile } from "@rawkoon/api/services/transcode/probe";
import { nodeSwapFs } from "@rawkoon/api/services/transcode/swap";
import { statFileFingerprint } from "@rawkoon/api/utils/medias/fileFingerprint";

const hasFfmpeg = Bun.which("ffmpeg") != null && Bun.which("ffprobe") != null;
const d = hasFfmpeg ? describe : describe.skip;

let dir: string;
let src: string;
const settings: TranscodeJobSettings = {
  codec: "hevc", encoder: "software", resolution: "keep", mode: "quality",
  preset: "small", speed: "faster", convertLosslessAudio: false,
};

async function makeSource(path: string) {
  await writeFile(join(dir, "s.srt"), "1\n00:00:01,000 --> 00:00:02,000\nhello\n");
  const p = Bun.spawn([
    "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=40",
    "-f", "lavfi", "-i", "sine=f=440:d=40",
    "-f", "lavfi", "-i", "sine=f=880:d=40",
    "-i", join(dir, "s.srt"),
    "-map", "0", "-map", "1", "-map", "2", "-map", "3",
    "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0",
    "-c:a", "aac", "-c:s", "srt",
    "-metadata:s:a:0", "language=fre", "-metadata:s:a:1", "language=eng", "-metadata:s:s:0", "language=fre",
    path,
  ]);
  expect(await p.exited).toBe(0);
}

function deps(rescanned: string[]): PipelineDeps {
  return {
    mapPath: (p) => p, probe: probeFile, run: runFfmpeg, fingerprint: statFileFingerprint,
    nlink: async (p) => Number((await stat(p)).nlink), freeBytes: async () => 10n ** 12n,
    fs: nodeSwapFs, capabilities: () => detectCapabilities(),
    rescan: async (p) => { rescanned.push(p); },
  };
}

async function jobFor(path: string) {
  const fp = (await statFileFingerprint(path))!;
  return { id: 1, settings, estimatedBytes: null, source: { dbPath: path, sizeBytes: fp.sizeBytes, fileMtimeMs: fp.mtimeMs, fileDev: fp.dev, fileIno: fp.ino } };
}
const hooks = { onStep: () => {}, onProgress: () => {} };

d("transcode pipeline (real ffmpeg)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rawkoon-tc-"));
    src = join(dir, "Clip [360p].mkv");
    await makeSource(src);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fails validation with an impossible threshold and leaves the source byte-identical", async () => {
    const before = await readFile(src);
    const r = await runPipeline(await jobFor(src), deps([]), hooks, {
      signal: new AbortController().signal, threads: 2, thresholds: { avg: 1.01, min: 0.5 },
    });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("Quality check");
    expect((await readFile(src)).equals(before)).toBe(true);
  }, 120_000);

  it("re-encodes, validates, replaces and rescans", async () => {
    const rescanned: string[] = [];
    const r = await runPipeline(await jobFor(src), deps(rescanned), hooks, {
      signal: new AbortController().signal, threads: 2, thresholds: { avg: 0.9, min: 0.8 },
    });
    expect(r).toMatchObject({ ok: true, finalDbPath: src });
    const out = await probeFile(src);
    expect(out.video?.codec).toBe("hevc");
    expect(out.streams.filter((s) => s.type === "audio").map((s) => s.language)).toEqual(["fre", "eng"]);
    expect(out.streams.filter((s) => s.type === "subtitle")).toHaveLength(1);
    expect(rescanned).toEqual([src]);
  }, 180_000);

  it("cancel mid-encode removes the temp file", async () => {
    const other = join(dir, "Other.mkv");
    await makeSource(other);
    const ac = new AbortController();
    const p = runPipeline(await jobFor(other), deps([]), { onStep: (s) => { if (s === "encode") setTimeout(() => ac.abort(), 300); }, onProgress: () => {} }, {
      signal: ac.signal, threads: 1, thresholds: { avg: 0.9, min: 0.8 },
    });
    const r = await p;
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(await nodeSwapFs.exists(join(dir, ".Other.rawkoon-tmp.mkv"))).toBe(false);
  }, 120_000);
});
```

- [ ] **Step 2: Run it locally**

Run: `cd apps/api && bun test test/transcodePipeline.integration.test.ts`
Expected: PASS (3 tests) on a machine with ffmpeg; skipped where ffmpeg is absent.

- [ ] **Step 3: Install ffmpeg in CI**

In `.github/workflows/ci.yml`, in the `test` job, add before the `- name: Test` step:
```yaml
      - name: Install ffmpeg
        run: sudo apt-get update -y && sudo apt-get install -y ffmpeg
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/transcodePipeline.integration.test.ts .github/workflows/ci.yml
git commit -m "test(transcode): exercise the pipeline end to end with real ffmpeg"
```

---

### Task 14: Web data layer (endpoints, keys, hooks, pure helpers)

**Files:**
- Create: `apps/web/src/lib/endpoints/transcode.ts`
- Modify: `apps/web/src/lib/endpoints/index.ts`
- Modify: `apps/web/src/lib/queryKeys.ts`
- Create: `apps/web/src/features/transcode/hooks.ts`
- Create: `apps/web/src/features/transcode/format.ts`
- Test: `apps/web/src/features/transcode/format.test.ts`

**Interfaces:**
- Produces:
```ts
export const TRANSCODE_ENDPOINTS: { CAPABILITIES; ESTIMATE; JOBS; JOB(id); JOB_MOVE(id); JOB_RETRY(id); BATCH(id); BATCH_MOVE(id); HISTORY; SETTINGS; SUMMARY };
queryKeys.transcode: { all; capabilities(); estimate(sel, settings); jobs(status); settings(); summary() };
export function useTranscodeCapabilities(enabled?: boolean);
export function useTranscodeEstimate(sel: TranscodeSelection, settings: TranscodeJobSettings, enabled: boolean);
export function useRefineTranscodeEstimate();
export function useEnqueueTranscode();
export function useTranscodeJobs(status: "active" | "history");
export function useTranscodeSummary(enabled: boolean);
export function useTranscodeSettings();
export function useUpdateTranscodeSettings();
export function useTranscodeJobAction(); // { cancel(id), retry(id), moveTop(id), moveBefore(id, beforeId), removeBatch(batchId), batchTop(batchId), clearHistory() }
// format.ts
export function formatBytes(bytes: string | number | bigint): string;
export function formatDuration(secs: number): string;
export function settingsKey(s: TranscodeJobSettings): string;
export function targetKbpsFromGb(gbPerFile: number, fileCount: number, totalAudioBytes: number, totalDurationSecs: number): number;
export function derivedMbps(kbps: number): string;
```

- [ ] **Step 1: Write the failing helper test**

`apps/web/src/features/transcode/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { derivedMbps, formatBytes, formatDuration, settingsKey, targetKbpsFromGb } from "@/features/transcode/format";

describe("transcode format helpers", () => {
  it("formats bytes in decimal units", () => {
    expect(formatBytes("1500000000")).toBe("1.5 GB");
    expect(formatBytes(1_234_000_000_000n)).toBe("1.23 TB");
    expect(formatBytes(900_000_000)).toBe("900 MB");
  });

  it("formats durations", () => {
    expect(formatDuration(59)).toBe("<1 min");
    expect(formatDuration(360)).toBe("6 min");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
  });

  it("derives a video bitrate from a per-file GB target", () => {
    // 2 files × 1.5 GB, 100 MB audio total, 2 h total → (3e9 − 1e8) × 8 / 7200 / 1000
    expect(targetKbpsFromGb(1.5, 2, 100_000_000, 7200)).toBe(3222);
    expect(targetKbpsFromGb(0.01, 1, 100_000_000, 3600)).toBe(100);
  });

  it("stable settings key and Mbps text", () => {
    const s = { codec: "hevc", encoder: "software", resolution: "keep", mode: "quality", preset: "balanced", speed: "default", convertLosslessAudio: false } as const;
    expect(settingsKey(s)).toBe(settingsKey({ ...s }));
    expect(derivedMbps(3222)).toBe("3.2 Mbps");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test --run src/features/transcode/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement endpoints, keys, helpers**

`apps/web/src/lib/endpoints/transcode.ts`:
```ts
export const TRANSCODE_ENDPOINTS = {
  CAPABILITIES: "/api/transcode/capabilities",
  ESTIMATE: "/api/transcode/estimate",
  JOBS: "/api/transcode/jobs",
  JOB: (id: number) => `/api/transcode/jobs/${id}`,
  JOB_MOVE: (id: number) => `/api/transcode/jobs/${id}/move`,
  JOB_RETRY: (id: number) => `/api/transcode/jobs/${id}/retry`,
  BATCH: (id: string) => `/api/transcode/batches/${id}`,
  BATCH_MOVE: (id: string) => `/api/transcode/batches/${id}/move`,
  HISTORY: "/api/transcode/history",
  SETTINGS: "/api/transcode/settings",
  SUMMARY: "/api/transcode/summary",
};
```
Add `export * from "@rawkoon/api/services/transcode/transcode";` to `apps/web/src/lib/endpoints/index.ts`.

In `apps/web/src/lib/queryKeys.ts`, add a top-level entry inside the `queryKeys` object (next to `library`):
```ts
  transcode: {
    all: ["transcode"] as const,
    capabilities: () => [...queryKeys.transcode.all, "capabilities"] as const,
    estimate: (selection: unknown, settings: string) =>
      [...queryKeys.transcode.all, "estimate", selection, settings] as const,
    jobs: (status: "active" | "history") => [...queryKeys.transcode.all, "jobs", status] as const,
    settings: () => [...queryKeys.transcode.all, "settings"] as const,
    summary: () => [...queryKeys.transcode.all, "summary"] as const,
  },
```

`apps/web/src/features/transcode/format.ts`:
```ts
import type { TranscodeJobSettings } from "@rawkoon/shared/types";

export function formatBytes(bytes: string | number | bigint): string {
  const n = Number(bytes);
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

export function formatDuration(secs: number): string {
  if (secs < 60) return "<1 min";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function settingsKey(s: TranscodeJobSettings): string {
  return JSON.stringify([s.codec, s.encoder, s.resolution, s.mode, s.preset, s.quality ?? null, s.speed, s.targetVideoKbps ?? null, s.convertLosslessAudio]);
}

export function targetKbpsFromGb(gbPerFile: number, fileCount: number, totalAudioBytes: number, totalDurationSecs: number): number {
  if (totalDurationSecs <= 0) return 100;
  const videoBits = (gbPerFile * 1e9 * fileCount - totalAudioBytes) * 8;
  return Math.max(100, Math.round(videoBits / totalDurationSecs / 1000));
}

export function derivedMbps(kbps: number): string {
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}
```

- [ ] **Step 4: Implement hooks**

`apps/web/src/features/transcode/hooks.ts`:
```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TranscodeCapabilities, TranscodeEstimate, TranscodeJobSettings, TranscodeJobsResponse,
  TranscodeQueueSettings, TranscodeSelection, TranscodeSummary,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { TRANSCODE_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { settingsKey } from "@/features/transcode/format";

export function useTranscodeCapabilities(enabled = true) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.capabilities(),
    queryFn: () => fetcher<TranscodeCapabilities>(TRANSCODE_ENDPOINTS.CAPABILITIES),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useTranscodeEstimate(selection: TranscodeSelection, settings: TranscodeJobSettings, enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.estimate(selection, settingsKey(settings)),
    queryFn: () =>
      fetcher<TranscodeEstimate>(TRANSCODE_ENDPOINTS.ESTIMATE, { method: "POST", body: { selection, settings, refine: false } }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useRefineTranscodeEstimate() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (b: { selection: TranscodeSelection; settings: TranscodeJobSettings }) =>
      fetcher<TranscodeEstimate>(TRANSCODE_ENDPOINTS.ESTIMATE, { method: "POST", body: { ...b, refine: true } }),
  });
}

export function useEnqueueTranscode() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { selection: TranscodeSelection; settings: TranscodeJobSettings }) =>
      fetcher<{ batch_id: string; count: number }>(TRANSCODE_ENDPOINTS.JOBS, { method: "POST", body: b }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.transcode.all }),
  });
}

export function useTranscodeJobs(status: "active" | "history") {
  const fetcher = useFetcher();
  const qs = status === "active" ? "queued,running" : `done,failed,cancelled&since=${new Date(Date.now() - 30 * 86_400_000).toISOString()}`;
  return useQuery({
    queryKey: queryKeys.transcode.jobs(status),
    queryFn: () => fetcher<TranscodeJobsResponse>(`${TRANSCODE_ENDPOINTS.JOBS}?status=${qs}`),
    refetchInterval: (q) =>
      status === "active" && q.state.data?.jobs.some((j) => j.status === "running") ? 2000 : 10_000,
  });
}

export function useTranscodeSummary(enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.summary(),
    queryFn: () => fetcher<TranscodeSummary>(TRANSCODE_ENDPOINTS.SUMMARY),
    enabled,
    refetchInterval: 5000,
  });
}

export function useTranscodeSettings() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.settings(),
    queryFn: () => fetcher<TranscodeQueueSettings>(TRANSCODE_ENDPOINTS.SETTINGS),
  });
}

export function useUpdateTranscodeSettings() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TranscodeQueueSettings>) =>
      fetcher<TranscodeQueueSettings>(TRANSCODE_ENDPOINTS.SETTINGS, { method: "PATCH", body: patch }),
    onSuccess: (data) => qc.setQueryData(queryKeys.transcode.settings(), data),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.transcode.all }),
  });
}

export function useTranscodeJobAction() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (req: { url: string; method: "POST" | "DELETE"; body?: unknown }) =>
      fetcher<unknown>(req.url, { method: req.method, body: req.body }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.transcode.all }),
  });
  return {
    isPending: run.isPending,
    cancel: (id: number) => run.mutateAsync({ url: TRANSCODE_ENDPOINTS.JOB(id), method: "DELETE" }),
    retry: (id: number) => run.mutateAsync({ url: TRANSCODE_ENDPOINTS.JOB_RETRY(id), method: "POST", body: {} }),
    moveTop: (id: number) => run.mutateAsync({ url: TRANSCODE_ENDPOINTS.JOB_MOVE(id), method: "POST", body: { top: true } }),
    moveBefore: (id: number, beforeId: number) =>
      run.mutateAsync({ url: TRANSCODE_ENDPOINTS.JOB_MOVE(id), method: "POST", body: { before_id: beforeId } }),
    moveAfter: (id: number, afterId: number) =>
      run.mutateAsync({ url: TRANSCODE_ENDPOINTS.JOB_MOVE(id), method: "POST", body: { after_id: afterId } }),
    removeBatch: (batchId: string) => run.mutateAsync({ url: TRANSCODE_ENDPOINTS.BATCH(batchId), method: "DELETE" }),
    batchTop: (batchId: string) => run.mutateAsync({ url: TRANSCODE_ENDPOINTS.BATCH_MOVE(batchId), method: "POST", body: { top: true } }),
    clearHistory: () => run.mutateAsync({ url: TRANSCODE_ENDPOINTS.HISTORY, method: "DELETE" }),
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/web && bun run test --run src/features/transcode/format.test.ts`
Expected: PASS (4 tests).
Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/endpoints/transcode.ts apps/web/src/lib/endpoints/index.ts apps/web/src/lib/queryKeys.ts apps/web/src/features/transcode
git commit -m "feat(web): add transcode endpoints, query keys and hooks"
```

---

### Task 15: Re-encode modal and entry points

**Files:**
- Create: `apps/web/src/features/transcode/ReencodeModal.tsx`
- Create: `apps/web/src/features/transcode/Segmented.tsx`
- Modify: `apps/web/src/pages/medias/_component/LibraryFileDetailBlock.tsx` (button next to Remux)
- Modify: `apps/web/src/pages/medias/_component/LibraryMediaSection.tsx` (season button + header "Re-encode show")
- Modify: `apps/web/src/locales/en/common.json`, `apps/web/src/locales/fr/common.json`
- Test: `apps/web/src/features/transcode/ReencodeModal.test.tsx`

**Interfaces:**
- Consumes: hooks + format helpers (Task 14), `Dialog` from `@/components/dialog`, `Switch` from `@/components/ui/switch`, `toast` from `sonner`.
- Produces:
```tsx
export function ReencodeModal(props: { isOpen: boolean; onClose: () => void; selection: TranscodeSelection; subtitle: string }): JSX.Element;
export function Segmented<T extends string | number>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string; disabled?: boolean; title?: string }[]; ariaLabel: string }): JSX.Element;
```

- [ ] **Step 1: Add locale keys**

Add a top-level `"transcode"` object to `apps/web/src/locales/en/common.json`:
```json
"transcode": {
  "openButton": "Re-encode…",
  "openSeason": "Re-encode season",
  "openShow": "Re-encode show",
  "title": "Re-encode",
  "fileCount_one": "{{count}} file",
  "fileCount_other": "{{count}} files",
  "sections": { "video": "Video", "size": "Size", "audio": "Audio & subtitles" },
  "codec": "Codec",
  "codecHevcHint": "widest support",
  "codecAv1Hint": "smallest",
  "encoder": "Encoder",
  "encoderCpu": "CPU",
  "encoderCpuHint": "best size · slow",
  "encoderGpu": "GPU",
  "encoderGpuHint": "VAAPI · much faster",
  "detected": "Detected: {{label}}",
  "resolution": "Resolution",
  "resKeep": "Keep",
  "mode": "Mode",
  "modeQuality": "Quality",
  "modeQualityHint": "size estimated",
  "modeTarget": "Target size",
  "modeTargetHint": "size exact",
  "preset": "Preset",
  "presetHigh": "High",
  "presetBalanced": "Balanced",
  "presetSmall": "Small",
  "advanced": "Advanced",
  "qualityValue": "Quality value",
  "qualityValueHintCrf": "CRF · lower = better",
  "qualityValueHintQp": "QP · lower = better",
  "speed": "Speed preset",
  "speedSlower": "Slower",
  "speedDefault": "Default",
  "speedFaster": "Faster",
  "perFile": "Per file",
  "gbPerFile": "GB per file (average)",
  "derived": "≈ {{mbps}} video · audio as set below",
  "convertAudio": "Convert lossless audio to EAC3",
  "convertAudioHint": "Lossy tracks and all subtitles are always copied untouched.",
  "copy": "copy",
  "noLossless": "No lossless audio tracks.",
  "estimate": {
    "saved": "−{{size}}",
    "freesNow": "Frees now",
    "afterSeeding": "After seeding",
    "time": "Est. time",
    "seedingWarning_one": "{{count}} file is still seeding. Its space frees when the torrent is removed; until then disk use grows by about {{size}}.",
    "seedingWarning_other": "{{count}} files are still seeding. Their space frees when the torrents are removed; until then disk use grows by about {{size}}.",
    "rough": "Rough estimate · bitrate model",
    "refined": "Refined · {{files}} files · {{clips}} clips",
    "target": "Computed from bitrate × duration",
    "outdated": "Estimate outdated — settings changed",
    "refine": "Refine estimate",
    "refineAgain": "Refine again",
    "refining": "Sampling clips…",
    "loading": "Estimating…"
  },
  "excludedTitle_one": "{{count}} file skipped",
  "excludedTitle_other": "{{count}} files skipped",
  "cancel": "Cancel",
  "submit_one": "Add {{count}} file to queue",
  "submit_other": "Add {{count}} files to queue",
  "queued_one": "{{count}} file added to the re-encode queue",
  "queued_other": "{{count}} files added to the re-encode queue",
  "queueFailed": "Could not add to the queue",
  "refineFailed": "Could not refine the estimate",
  "dvNote": "Dolby Vision → HDR10"
}
```

Add the same keys to `apps/web/src/locales/fr/common.json` with:
```json
"transcode": {
  "openButton": "Réencoder…",
  "openSeason": "Réencoder la saison",
  "openShow": "Réencoder la série",
  "title": "Réencoder",
  "fileCount_one": "{{count}} fichier",
  "fileCount_other": "{{count}} fichiers",
  "sections": { "video": "Vidéo", "size": "Taille", "audio": "Audio et sous-titres" },
  "codec": "Codec",
  "codecHevcHint": "le plus compatible",
  "codecAv1Hint": "le plus petit",
  "encoder": "Encodeur",
  "encoderCpu": "CPU",
  "encoderCpuHint": "meilleure taille · lent",
  "encoderGpu": "GPU",
  "encoderGpuHint": "VAAPI · bien plus rapide",
  "detected": "Détecté : {{label}}",
  "resolution": "Résolution",
  "resKeep": "Garder",
  "mode": "Mode",
  "modeQuality": "Qualité",
  "modeQualityHint": "taille estimée",
  "modeTarget": "Taille cible",
  "modeTargetHint": "taille exacte",
  "preset": "Préréglage",
  "presetHigh": "Haute",
  "presetBalanced": "Équilibré",
  "presetSmall": "Petit",
  "advanced": "Avancé",
  "qualityValue": "Valeur de qualité",
  "qualityValueHintCrf": "CRF · plus bas = meilleur",
  "qualityValueHintQp": "QP · plus bas = meilleur",
  "speed": "Vitesse",
  "speedSlower": "Plus lent",
  "speedDefault": "Par défaut",
  "speedFaster": "Plus rapide",
  "perFile": "Par fichier",
  "gbPerFile": "Go par fichier (moyenne)",
  "derived": "≈ {{mbps}} vidéo · audio selon le réglage ci-dessous",
  "convertAudio": "Convertir l'audio sans perte en EAC3",
  "convertAudioHint": "Les pistes avec perte et tous les sous-titres sont toujours copiés tels quels.",
  "copy": "copie",
  "noLossless": "Aucune piste audio sans perte.",
  "estimate": {
    "saved": "−{{size}}",
    "freesNow": "Libéré maintenant",
    "afterSeeding": "Après le partage",
    "time": "Durée est.",
    "seedingWarning_one": "{{count}} fichier est encore en partage. Son espace sera libéré quand le torrent sera retiré ; d'ici là, l'espace disque augmente d'environ {{size}}.",
    "seedingWarning_other": "{{count}} fichiers sont encore en partage. Leur espace sera libéré quand les torrents seront retirés ; d'ici là, l'espace disque augmente d'environ {{size}}.",
    "rough": "Estimation approximative · modèle de débit",
    "refined": "Affiné · {{files}} fichiers · {{clips}} extraits",
    "target": "Calculé à partir du débit × durée",
    "outdated": "Estimation périmée — réglages modifiés",
    "refine": "Affiner l'estimation",
    "refineAgain": "Affiner à nouveau",
    "refining": "Échantillonnage…",
    "loading": "Estimation…"
  },
  "excludedTitle_one": "{{count}} fichier ignoré",
  "excludedTitle_other": "{{count}} fichiers ignorés",
  "cancel": "Annuler",
  "submit_one": "Ajouter {{count}} fichier à la file",
  "submit_other": "Ajouter {{count}} fichiers à la file",
  "queued_one": "{{count}} fichier ajouté à la file de réencodage",
  "queued_other": "{{count}} fichiers ajoutés à la file de réencodage",
  "queueFailed": "Impossible d'ajouter à la file",
  "refineFailed": "Impossible d'affiner l'estimation",
  "dvNote": "Dolby Vision → HDR10"
}
```

- [ ] **Step 2: Write the failing modal test**

`apps/web/src/features/transcode/ReencodeModal.test.tsx`:
```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const estimate = {
  files: [{ file_id: 1, title: "A", source_bytes: "4000000000", estimated_bytes: "1500000000", nlink: 2, duration_secs: 3000 }],
  excluded: [{ file_id: 2, title: "B", reason: "Already queued" }],
  total_source_bytes: "4000000000", total_estimated_bytes: "1500000000", total_duration_secs: 3000,
  total_audio_bytes: "100000000", range_pct: 15, frees_now_bytes: "0", frees_after_seeding_bytes: "2500000000",
  temporary_growth_bytes: "1500000000", eta_secs: 600, source: "rough", refined_files: 0, refined_clips: 0,
  audio_changes: [{ label: "ENG · TRUEHD 8ch", to: "EAC3 768k" }], source_height: 1080,
};
const refineMutate = vi.fn(async () => ({ ...estimate, source: "refined", refined_files: 1, refined_clips: 6 }));
const enqueueMutate = vi.fn(async () => ({ batch_id: "b", count: 1 }));

vi.mock("@/features/transcode/hooks", () => ({
  useTranscodeCapabilities: () => ({
    data: { combos: [{ codec: "hevc", encoder: "software" }, { codec: "av1", encoder: "software" }], device_label: null, vaapi_unavailable_reason: "No GPU" },
  }),
  useTranscodeEstimate: () => ({ data: estimate, isFetching: false }),
  useRefineTranscodeEstimate: () => ({ mutateAsync: refineMutate, isPending: false }),
  useEnqueueTranscode: () => ({ mutateAsync: enqueueMutate, isPending: false }),
}));

const { ReencodeModal } = await import("@/features/transcode/ReencodeModal");

describe("ReencodeModal", () => {
  beforeEach(() => {
    refineMutate.mockClear();
    enqueueMutate.mockClear();
  });

  const open = () =>
    renderWithProviders(<ReencodeModal isOpen onClose={() => {}} selection={{ media_id: 1 }} subtitle="Show · 2 files" />);

  it("disables GPU with the reason and 1080p for a 1080p source", () => {
    open();
    expect(screen.getByRole("radio", { name: /GPU/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "1080p" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "720p" })).not.toBeDisabled();
  });

  it("shows exclusions and the seeding warning", () => {
    open();
    expect(screen.getByText(/1 file skipped/)).toBeInTheDocument();
    expect(screen.getByText(/Already queued/)).toBeInTheDocument();
    expect(screen.getByText(/still seeding/)).toBeInTheDocument();
  });

  it("marks a refined estimate outdated after a settings change", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Refine estimate/ }));
    await waitFor(() => expect(screen.getByText(/Refined · 1 files · 6 clips/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: /AV1/ }));
    expect(screen.getByText(/Estimate outdated/)).toBeInTheDocument();
  });

  it("switching to target mode hides refine", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Target size/ }));
    expect(screen.queryByRole("button", { name: /Refine/ })).toBeNull();
    expect(screen.getByLabelText(/GB per file/)).toBeInTheDocument();
  });

  it("submits the selection and settings", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Add 1 file to queue/ }));
    await waitFor(() => expect(enqueueMutate).toHaveBeenCalledTimes(1));
    expect(enqueueMutate.mock.calls[0][0]).toMatchObject({ selection: { media_id: 1 }, settings: { codec: "hevc", encoder: "software", mode: "quality" } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bun run test --run src/features/transcode/ReencodeModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement Segmented**

`apps/web/src/features/transcode/Segmented.tsx`:
```tsx
import { cn } from "@/lib/utils";

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string; disabled?: boolean; title?: string }[];
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap gap-0.5 rounded-lg border border-neutral-800 bg-neutral-950 p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-left text-[13px] font-medium transition-colors",
              on ? "bg-neutral-800 text-neutral-50 ring-1 ring-inset ring-neutral-700" : "text-neutral-400 hover:text-neutral-200",
              "disabled:cursor-not-allowed disabled:opacity-35",
            )}
          >
            {o.label}
            {o.hint && (
              <span className={cn("block text-[11px] font-normal", on ? "text-primary-400" : "text-neutral-500")}>{o.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Implement the modal**

`apps/web/src/features/transcode/ReencodeModal.tsx`:
```tsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  TranscodeCodec, TranscodeEncoder, TranscodeEstimate, TranscodeJobSettings,
  TranscodeMode, TranscodePreset, TranscodeResolution, TranscodeSelection, TranscodeSpeed,
} from "@rawkoon/shared/types";
import { Dialog } from "@/components/dialog";
import { Switch } from "@/components/ui/switch";
import { derivedMbps, formatBytes, formatDuration, settingsKey, targetKbpsFromGb } from "@/features/transcode/format";
import { useEnqueueTranscode, useRefineTranscodeEstimate, useTranscodeCapabilities, useTranscodeEstimate } from "@/features/transcode/hooks";
import { Segmented } from "@/features/transcode/Segmented";

const DEFAULT: TranscodeJobSettings = {
  codec: "hevc", encoder: "software", resolution: "keep", mode: "quality",
  preset: "balanced", speed: "default", convertLosslessAudio: false,
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="my-2 grid grid-cols-[110px_1fr] items-center gap-3 mobile-max:grid-cols-1">
      <span className="text-[13px] text-neutral-400">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-neutral-800 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 font-mono text-xs uppercase tracking-wider text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

export function ReencodeModal({
  isOpen, onClose, selection, subtitle,
}: { isOpen: boolean; onClose: () => void; selection: TranscodeSelection; subtitle: string }) {
  const { t } = useTranslation("common");
  const [s, setS] = useState<TranscodeJobSettings>(DEFAULT);
  const [gbPerFile, setGbPerFile] = useState(1.5);
  const [refined, setRefined] = useState<{ key: string; data: TranscodeEstimate } | null>(null);
  const caps = useTranscodeCapabilities(isOpen);
  const refine = useRefineTranscodeEstimate();
  const enqueue = useEnqueueTranscode();

  const has = (codec: TranscodeCodec, encoder: TranscodeEncoder) =>
    caps.data?.combos.some((c) => c.codec === codec && c.encoder === encoder) ?? false;
  const gpuAvailable = has(s.codec, "vaapi");

  // Target mode needs the batch's duration/audio from a quality-mode estimate first.
  const baseEstimate = useTranscodeEstimate(selection, { ...s, mode: "quality", targetVideoKbps: undefined }, isOpen);
  const base = baseEstimate.data;
  const effective: TranscodeJobSettings = useMemo(() => {
    if (s.mode !== "target" || !base) return s;
    return { ...s, targetVideoKbps: targetKbpsFromGb(gbPerFile, base.files.length, Number(base.total_audio_bytes), base.total_duration_secs) };
  }, [s, base, gbPerFile]);
  const debounced = useDebounced(effective, 300);
  const live = useTranscodeEstimate(selection, debounced, isOpen && (debounced.mode === "quality" || debounced.targetVideoKbps != null));

  const key = settingsKey(effective);
  const est = refined && refined.key === key ? refined.data : (live.data ?? base);
  const outdated = refined != null && refined.key !== key;
  const sourceHeight = est?.source_height ?? null;
  const count = est?.files.length ?? 0;
  const seeding = est?.files.filter((f) => f.nlink > 1).length ?? 0;
  const set = <K extends keyof TranscodeJobSettings>(k: K, v: TranscodeJobSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  const onRefine = async () => {
    try {
      const data = await refine.mutateAsync({ selection, settings: effective });
      setRefined({ key, data });
    } catch {
      toast.error(t("transcode.refineFailed"));
    }
  };

  const onSubmit = async () => {
    try {
      const r = await enqueue.mutateAsync({ selection, settings: effective });
      toast.success(t("transcode.queued", { count: r.count }));
      onClose();
    } catch {
      toast.error(t("transcode.queueFailed"));
    }
  };

  const saved = est ? Number(est.total_source_bytes) - Number(est.total_estimated_bytes) : 0;
  const nowPct = est && Number(est.total_source_bytes) ? (Number(est.frees_now_bytes) / Number(est.total_source_bytes)) * 100 : 0;
  const laterPct = est && Number(est.total_source_bytes) ? (Number(est.frees_after_seeding_bytes) / Number(est.total_source_bytes)) * 100 : 0;
  const sourceLine =
    est?.source === "target" ? t("transcode.estimate.target")
    : outdated ? t("transcode.estimate.outdated")
    : est?.source === "refined" ? t("transcode.estimate.refined", { files: est.refined_files, clips: est.refined_clips })
    : t("transcode.estimate.rough");

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t("transcode.title")} panelClassName="max-w-[560px] p-0" bodyScroll>
      <div className="flex min-h-0 flex-col">
        <p className="px-5 pb-3 text-[13px] text-neutral-400">{subtitle}</p>
        <div className="min-h-0 overflow-y-auto px-5">
          <Section title={t("transcode.sections.video")}>
            <Row label={t("transcode.codec")}>
              <Segmented<TranscodeCodec>
                ariaLabel={t("transcode.codec")} value={s.codec} onChange={(v) => setS((p) => ({ ...p, codec: v, encoder: has(v, p.encoder) ? p.encoder : "software" }))}
                options={[
                  { value: "hevc", label: "HEVC", hint: t("transcode.codecHevcHint"), disabled: !has("hevc", "software") && !has("hevc", "vaapi") },
                  { value: "av1", label: "AV1", hint: t("transcode.codecAv1Hint"), disabled: !has("av1", "software") && !has("av1", "vaapi") },
                ]}
              />
            </Row>
            <Row label={t("transcode.encoder")}>
              <Segmented<TranscodeEncoder>
                ariaLabel={t("transcode.encoder")} value={s.encoder} onChange={(v) => set("encoder", v)}
                options={[
                  { value: "software", label: t("transcode.encoderCpu"), hint: t("transcode.encoderCpuHint"), disabled: !has(s.codec, "software") },
                  { value: "vaapi", label: t("transcode.encoderGpu"), hint: t("transcode.encoderGpuHint"), disabled: !gpuAvailable, title: caps.data?.vaapi_unavailable_reason ?? undefined },
                ]}
              />
              <p className="mt-1 text-xs text-neutral-500">
                {caps.data?.device_label ? t("transcode.detected", { label: caps.data.device_label }) : caps.data?.vaapi_unavailable_reason}
              </p>
            </Row>
            <Row label={t("transcode.resolution")}>
              <Segmented<TranscodeResolution>
                ariaLabel={t("transcode.resolution")} value={s.resolution} onChange={(v) => set("resolution", v)}
                options={[
                  { value: "keep", label: t("transcode.resKeep"), hint: sourceHeight ? `${sourceHeight}p` : undefined },
                  { value: 1080, label: "1080p", disabled: sourceHeight != null && sourceHeight <= 1080 },
                  { value: 720, label: "720p", disabled: sourceHeight != null && sourceHeight <= 720 },
                ]}
              />
            </Row>
          </Section>

          <Section title={t("transcode.sections.size")}>
            <Row label={t("transcode.mode")}>
              <Segmented<TranscodeMode>
                ariaLabel={t("transcode.mode")} value={s.mode} onChange={(v) => set("mode", v)}
                options={[
                  { value: "quality", label: t("transcode.modeQuality"), hint: t("transcode.modeQualityHint") },
                  { value: "target", label: t("transcode.modeTarget"), hint: t("transcode.modeTargetHint") },
                ]}
              />
            </Row>
            {s.mode === "quality" ? (
              <>
                <Row label={t("transcode.preset")}>
                  <Segmented<TranscodePreset>
                    ariaLabel={t("transcode.preset")} value={s.preset} onChange={(v) => setS((p) => ({ ...p, preset: v, quality: undefined }))}
                    options={[
                      { value: "high", label: t("transcode.presetHigh") },
                      { value: "balanced", label: t("transcode.presetBalanced") },
                      { value: "small", label: t("transcode.presetSmall") },
                    ]}
                  />
                </Row>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[13px] text-neutral-400">{t("transcode.advanced")}</summary>
                  <Row label={t("transcode.qualityValue")}>
                    <input
                      type="number" aria-label={t("transcode.qualityValue")} value={s.quality ?? ""} min={0} max={255}
                      onChange={(e) => set("quality", e.target.value === "" ? undefined : Number(e.target.value))}
                      className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-neutral-50"
                    />
                    <span className="ml-2 font-mono text-xs text-neutral-400">
                      {s.encoder === "vaapi" ? t("transcode.qualityValueHintQp") : t("transcode.qualityValueHintCrf")}
                    </span>
                  </Row>
                  {s.encoder === "software" && (
                    <Row label={t("transcode.speed")}>
                      <Segmented<TranscodeSpeed>
                        ariaLabel={t("transcode.speed")} value={s.speed} onChange={(v) => set("speed", v)}
                        options={[
                          { value: "slower", label: t("transcode.speedSlower") },
                          { value: "default", label: t("transcode.speedDefault") },
                          { value: "faster", label: t("transcode.speedFaster") },
                        ]}
                      />
                    </Row>
                  )}
                </details>
              </>
            ) : (
              <Row label={t("transcode.perFile")}>
                <label className="flex items-center gap-2">
                  <input
                    type="number" step={0.1} min={0.1} value={gbPerFile}
                    onChange={(e) => setGbPerFile(Number(e.target.value) || 0.1)}
                    className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-neutral-50"
                  />
                  <span className="text-[13px] text-neutral-400">{t("transcode.gbPerFile")}</span>
                </label>
                {effective.targetVideoKbps != null && (
                  <p className="mt-1 text-xs text-neutral-500">{t("transcode.derived", { mbps: derivedMbps(effective.targetVideoKbps) })}</p>
                )}
              </Row>
            )}
          </Section>

          <Section title={t("transcode.sections.audio")}>
            <label className="flex cursor-pointer items-start gap-2.5">
              <Switch checked={s.convertLosslessAudio} onCheckedChange={(v: boolean) => set("convertLosslessAudio", v)} aria-label={t("transcode.convertAudio")} />
              <span>
                <span className="block font-medium text-neutral-50">{t("transcode.convertAudio")}</span>
                <span className="block text-xs text-neutral-500">{t("transcode.convertAudioHint")}</span>
              </span>
            </label>
            <div className="ml-11 mt-2 grid gap-1">
              {est?.audio_changes.length ? (
                est.audio_changes.map((a) => (
                  <div key={a.label} className="flex justify-between text-xs text-neutral-400">
                    <span>{a.label}</span>
                    <span>{s.convertLosslessAudio ? <><span className="text-primary-400">→</span> {a.to}</> : t("transcode.copy")}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-neutral-500">{t("transcode.noLossless")}</span>
              )}
            </div>
          </Section>

          {est && est.excluded.length > 0 && (
            <details className="mb-3 rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-400">
              <summary className="cursor-pointer">{t("transcode.excludedTitle", { count: est.excluded.length })}</summary>
              <ul className="mt-1.5 space-y-0.5">
                {est.excluded.map((x) => (
                  <li key={x.file_id}>{x.title} — {x.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="mx-5 mt-1 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3.5" aria-live="polite">
          {est ? (
            <>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="font-display text-2xl font-semibold text-neutral-50">
                  {est.source === "target" ? "" : "≈ "}{formatBytes(est.total_estimated_bytes)}
                </span>
                <span className="text-sm text-neutral-500 line-through">{formatBytes(est.total_source_bytes)}</span>
                <span className="text-xs text-neutral-400">±{est.range_pct}%</span>
                {saved > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                    {t("transcode.estimate.saved", { size: formatBytes(saved) })}
                  </span>
                )}
              </div>
              <div className="my-3 flex h-1.5 overflow-hidden rounded-full bg-neutral-800">
                <i className="block h-full bg-emerald-400" style={{ width: `${nowPct}%` }} />
                <i className="block h-full bg-emerald-400/35" style={{ width: `${laterPct}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div><div className="font-mono text-[11px] uppercase text-neutral-500">{t("transcode.estimate.freesNow")}</div><div className="font-medium text-neutral-50">{formatBytes(est.frees_now_bytes)}</div></div>
                <div><div className="font-mono text-[11px] uppercase text-neutral-500">{t("transcode.estimate.afterSeeding")}</div><div className="text-neutral-400">+{formatBytes(est.frees_after_seeding_bytes)}</div></div>
                <div><div className="font-mono text-[11px] uppercase text-neutral-500">{t("transcode.estimate.time")}</div><div className="font-medium text-neutral-50">~{formatDuration(est.eta_secs)}</div></div>
              </div>
              {seeding > 0 && (
                <p className="mt-2.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-300">
                  {t("transcode.estimate.seedingWarning", { count: seeding, size: formatBytes(est.temporary_growth_bytes) })}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-dashed border-neutral-800 pt-2.5 text-xs text-neutral-400">
                <span className={outdated ? "text-amber-300" : undefined}>{refine.isPending ? t("transcode.estimate.refining") : sourceLine}</span>
                {s.mode === "quality" && (
                  <button type="button" onClick={onRefine} disabled={refine.isPending || count === 0} className="font-medium text-primary-400 disabled:opacity-40">
                    {refined ? t("transcode.estimate.refineAgain") : t("transcode.estimate.refine")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <span className="text-sm text-neutral-400">{t("transcode.estimate.loading")}</span>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-200">
            {t("transcode.cancel")}
          </button>
          <button
            type="button" onClick={onSubmit} disabled={count === 0 || enqueue.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-[#2A1A10] hover:bg-primary-500 disabled:opacity-50"
          >
            {t("transcode.submit", { count })}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
```
If `Switch`'s prop names differ (check `apps/web/src/components/ui/switch.tsx`), use its actual `checked`/change prop names.

- [ ] **Step 6: Wire the entry points**

In `apps/web/src/pages/medias/_component/LibraryFileDetailBlock.tsx`:
1. Add imports:
```tsx
import { Gauge } from "lucide-react";
import { ReencodeModal } from "@/features/transcode/ReencodeModal";
```
2. Next to `const [showRemux, setShowRemux] = useState(false);` add:
```tsx
  const [showReencode, setShowReencode] = useState(false);
```
3. Replace the footer `<div className="mt-3 flex items-center justify-between">…</div>` so both buttons render (keep the existing remux condition):
```tsx
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-neutral-500">
          <Clock size={9} className="inline mr-1" />
          {t("library.fileDetail.scanned", { date: scannedDate })}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowReencode(true)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            <Gauge size={10} />
            {t("transcode.openButton")}
          </button>
          {isMkv && audioTracks.length > 1 && !showRemux && (
            <button
              type="button"
              onClick={() => setShowRemux(true)}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
            >
              <Shuffle size={10} />
              {t("library.fileDetail.remux.openButton")}
            </button>
          )}
        </div>
      </div>
      <ReencodeModal
        isOpen={showReencode}
        onClose={() => setShowReencode(false)}
        selection={{ file_ids: [file.id] }}
        subtitle={file.file_name}
      />
```
(`file.file_name` is on `LibraryFileInfo`; if the field is named differently, use the filename field that type exposes.)

In `apps/web/src/pages/medias/_component/LibraryMediaSection.tsx`:
1. Add imports: `import { Gauge } from "lucide-react";` (merge into the existing lucide import) and `import { ReencodeModal } from "@/features/transcode/ReencodeModal";`
2. Add state after the other `useState` calls:
```tsx
  const [reencode, setReencode] = useState<{ season: number | null } | null>(null);
```
3. In the header, immediately before the "Rescan files" `<button>`, add:
```tsx
        <button
          type="button"
          onClick={() => setReencode({ season: null })}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors shrink-0"
        >
          <Gauge size={10} />
          {isShow ? t("transcode.openShow") : t("transcode.openButton")}
        </button>
```
4. In the season action row, right after the `onSearchSeason` button block, add:
```tsx
                      <button
                        type="button"
                        onClick={() => setReencode({ season: s.season })}
                        title={t("transcode.openSeason")}
                        className="rounded-md p-2.5 mobile-max:px-3 mobile-max:py-3 text-neutral-400 hover:text-primary-400 hover:bg-primary-950/30 transition-colors"
                      >
                        <Gauge size={14} className="mobile-max:size-3" />
                      </button>
```
5. Before the component's closing `</Card>`, render:
```tsx
      {reencode && (
        <ReencodeModal
          isOpen
          onClose={() => setReencode(null)}
          selection={{ media_id: libraryId, ...(reencode.season != null ? { season: reencode.season } : {}) }}
          subtitle={reencode.season != null ? t("transcode.openSeason") + ` ${reencode.season}` : t("transcode.fileCount", { count: files.length })}
        />
      )}
```

- [ ] **Step 7: Run tests, typecheck and lint**

Run: `cd apps/web && bun run test --run src/features/transcode`
Expected: PASS (format 4 + modal 5).
Run: `bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/transcode apps/web/src/pages/medias/_component/LibraryFileDetailBlock.tsx apps/web/src/pages/medias/_component/LibraryMediaSection.tsx apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
git commit -m "feat(web): add the re-encode modal to file, season and show views"
```

---

### Task 16: Home widget

**Files:**
- Create: `apps/web/src/pages/_component/TranscodeWidget.tsx`
- Modify: `apps/web/src/pages/_component/WidgetGrid.tsx`
- Modify: `apps/web/src/pages/_component/WidgetGrid.test.tsx`
- Modify: locales (add `transcode.widget.*`)
- Test: `apps/web/src/pages/_component/TranscodeWidget.test.tsx`

**Interfaces:**
- Consumes: `useTranscodeSummary` (14), `useCurrentUser` from `@/lib/auth/useAuth`, `WidgetShell`/`WidgetHeader` from `@/pages/_component/widgetPrimitives`, `formatBytes`/`formatDuration`.
- Produces: `export function TranscodeWidget(): JSX.Element | null`.

- [ ] **Step 1: Add locale keys**

In `en/common.json` under `"transcode"` add:
```json
"widget": {
  "title": "Re-encode",
  "running": "Running",
  "paused": "Paused",
  "waits": "Waits for {{time}}",
  "idle": "Idle",
  "left": "~{{time}} left",
  "more": "+ {{count}} more",
  "total": "~{{time}} total",
  "saved": "−{{size}} saved · {{count}} done",
  "failed_one": "{{count}} failed",
  "failed_other": "{{count}} failed",
  "manage": "Manage →",
  "queued": "{{count}} queued"
}
```
In `fr/common.json` under `"transcode"` add:
```json
"widget": {
  "title": "Réencodage",
  "running": "En cours",
  "paused": "En pause",
  "waits": "Attend {{time}}",
  "idle": "Inactif",
  "left": "~{{time}} restant",
  "more": "+ {{count}} autres",
  "total": "~{{time}} au total",
  "saved": "−{{size}} libérés · {{count}} terminés",
  "failed_one": "{{count}} échec",
  "failed_other": "{{count}} échecs",
  "manage": "Gérer →",
  "queued": "{{count}} en file"
}
```

- [ ] **Step 2: Write the failing widget test**

`apps/web/src/pages/_component/TranscodeWidget.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

let user: { is_admin: boolean } | null = { is_admin: true };
let summary: Record<string, unknown> | undefined;
vi.mock("@/lib/auth/useAuth", () => ({ useCurrentUser: () => ({ data: user }) }));
vi.mock("@/features/transcode/hooks", () => ({ useTranscodeSummary: () => ({ data: summary }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/settings">{children}</a> }));

const { TranscodeWidget } = await import("@/pages/_component/TranscodeWidget");

const job = (id: number, title: string) => ({
  id, title, source_bytes: "4600000000", settings: { codec: "hevc", encoder: "vaapi" }, poster_url: null,
  live: { progress: 0.62, fps: 214, speed: 8.9, eta_secs: 360, current_bytes: "1" },
});

describe("TranscodeWidget", () => {
  it("renders nothing for non-admins", () => {
    user = { is_admin: false };
    summary = { show: true };
    const { container } = renderWithProviders(<TranscodeWidget />);
    expect(container).toBeEmptyDOMElement();
    user = { is_admin: true };
  });

  it("renders nothing when the summary says hide", () => {
    summary = { show: false };
    const { container } = renderWithProviders(<TranscodeWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the running job, next items and totals", () => {
    summary = {
      show: true, state: "running", window_start: "01:00", current: job(1, "Show — S03E07"),
      next: [job(2, "Show — S03E08"), job(3, "Show — S03E09")], queued_count: 60, queued_eta_secs: 32400,
      saved_bytes_30d: "187000000000", done_count_30d: 34, failed_count: 1,
    };
    renderWithProviders(<TranscodeWidget />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Show — S03E07")).toBeInTheDocument();
    expect(screen.getByText(/62%/)).toBeInTheDocument();
    expect(screen.getByText("Show — S03E08")).toBeInTheDocument();
    expect(screen.getByText(/\+ 58 more/)).toBeInTheDocument();
    expect(screen.getByText(/187.0 GB saved/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it("shows the waiting-window state", () => {
    summary = {
      show: true, state: "waiting_window", window_start: "01:00", current: null, next: [], queued_count: 3,
      queued_eta_secs: 100, saved_bytes_30d: "0", done_count_30d: 0, failed_count: 0,
    };
    renderWithProviders(<TranscodeWidget />);
    expect(screen.getByText("Waits for 01:00")).toBeInTheDocument();
    expect(screen.getByText("3 queued")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bun run test --run src/pages/_component/TranscodeWidget.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the widget**

`apps/web/src/pages/_component/TranscodeWidget.tsx`:
```tsx
import { Link } from "@tanstack/react-router";
import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TranscodeJob, TranscodeQueueState } from "@rawkoon/shared/types";
import { formatBytes, formatDuration } from "@/features/transcode/format";
import { useTranscodeSummary } from "@/features/transcode/hooks";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { cn } from "@/lib/utils";
import { WidgetHeader, WidgetShell } from "@/pages/_component/widgetPrimitives";

function StatePill({ state, windowStart }: { state: TranscodeQueueState; windowStart: string }) {
  const { t } = useTranslation("common");
  const cls = {
    running: "bg-emerald-500/10 text-emerald-300",
    paused: "bg-amber-400/10 text-amber-300",
    waiting_window: "bg-sky-400/10 text-sky-300",
    idle: "bg-neutral-800 text-neutral-400",
  }[state];
  const label = {
    running: t("transcode.widget.running"),
    paused: t("transcode.widget.paused"),
    waiting_window: t("transcode.widget.waits", { time: windowStart }),
    idle: t("transcode.widget.idle"),
  }[state];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>{label}</span>;
}

function codecLine(j: TranscodeJob): string {
  return `${j.settings.codec.toUpperCase()} · ${j.settings.encoder === "vaapi" ? "GPU" : "CPU"}`;
}

export function TranscodeWidget() {
  const { t } = useTranslation("common");
  const { data: user } = useCurrentUser();
  const isAdmin = user?.is_admin === true;
  const { data } = useTranscodeSummary(isAdmin);
  if (!isAdmin || !data?.show) return null;
  const cur = data.current;
  const remaining = data.queued_count - data.next.length;

  return (
    <WidgetShell>
      <WidgetHeader icon={Gauge} title={t("transcode.widget.title")} right={<StatePill state={data.state} windowStart={data.window_start} />} />
      <div className="px-3.5 py-3">
        {cur ? (
          <div className="flex items-start gap-2.5">
            {cur.poster_url ? (
              <img src={cur.poster_url} alt="" className="h-[50px] w-[34px] flex-none rounded object-cover" />
            ) : (
              <div className="h-[50px] w-[34px] flex-none rounded bg-neutral-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-neutral-50">{cur.title}</div>
              <div className="text-xs text-neutral-500">{codecLine(cur)}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-950">
                <i className="block h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-400" style={{ width: `${Math.round((cur.live?.progress ?? cur.progress ?? 0) * 100)}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-neutral-400">
                <span>
                  {Math.round((cur.live?.progress ?? cur.progress ?? 0) * 100)}%{cur.live?.fps ? ` · ${Math.round(cur.live.fps)} fps` : ""}
                </span>
                {cur.live?.eta_secs != null && <span>{t("transcode.widget.left", { time: formatDuration(cur.live.eta_secs) })}</span>}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-neutral-400">{t("transcode.widget.queued", { count: data.queued_count })}</div>
        )}
        {data.next.length > 0 && (
          <div className="mt-3 grid gap-1 text-xs">
            {data.next.map((j) => (
              <div key={j.id} className="flex justify-between text-neutral-400">
                <span className="truncate">{j.title}</span>
                <span className="font-mono">{formatBytes(j.source_bytes)}</span>
              </div>
            ))}
            {remaining > 0 && (
              <div className="flex justify-between text-neutral-500">
                <span>{t("transcode.widget.more", { count: remaining })}</span>
                <span className="font-mono">{t("transcode.widget.total", { time: formatDuration(data.queued_eta_secs) })}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-neutral-800 px-3.5 py-2.5 text-xs">
        <span className="text-emerald-300">
          {t("transcode.widget.saved", { size: formatBytes(data.saved_bytes_30d), count: data.done_count_30d })}
          {data.failed_count > 0 && <span className="ml-2 text-red-400">{t("transcode.widget.failed", { count: data.failed_count })}</span>}
        </span>
        <Link to="/settings" search={{ tab: "transcode" }} className="font-semibold text-primary-400">
          {t("transcode.widget.manage")}
        </Link>
      </div>
    </WidgetShell>
  );
}
```
If `WidgetHeader` does not accept `right` as shown, match its actual prop from `widgetPrimitives.tsx` (it documents an optional right-aligned slot).

- [ ] **Step 5: Add to the grid and its test**

In `apps/web/src/pages/_component/WidgetGrid.tsx`, import and render after `RssStatusPanel`:
```tsx
import { TranscodeWidget } from "@/pages/_component/TranscodeWidget";
…
      <CardErrorBoundary>
        <TranscodeWidget />
      </CardErrorBoundary>
```
In `WidgetGrid.test.tsx`, add a mock and include its test id:
```tsx
vi.mock("@/pages/_component/TranscodeWidget", () => ({
  TranscodeWidget: () => <div data-testid="w-transcode" />,
}));
```
and add `"w-transcode"` to the id list in the `renders every widget` test.

- [ ] **Step 6: Run tests**

Run: `cd apps/web && bun run test --run src/pages/_component/TranscodeWidget.test.tsx src/pages/_component/WidgetGrid.test.tsx`
Expected: PASS (4 + 1).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/_component/TranscodeWidget.tsx apps/web/src/pages/_component/TranscodeWidget.test.tsx apps/web/src/pages/_component/WidgetGrid.tsx apps/web/src/pages/_component/WidgetGrid.test.tsx apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
git commit -m "feat(web): show the re-encode queue on the home dashboard"
```

---

### Task 17: Settings → Admin → Re-encode tab

**Files:**
- Create: `apps/web/src/pages/settings/_component/TranscodeTab.tsx`
- Modify: `apps/web/src/pages/settings/_component/Settings.tsx` (Tab union, admin list, render)
- Modify: locales (add `settings.transcode.title` and `transcode.admin.*`)
- Test: `apps/web/src/pages/settings/_component/TranscodeTab.test.tsx`

**Interfaces:**
- Consumes: `useTranscodeJobs`, `useTranscodeSettings`, `useUpdateTranscodeSettings`, `useTranscodeJobAction`, `useTranscodeSummary` (14); `Switch`.
- Produces: `export function TranscodeTab(): JSX.Element`.

- [ ] **Step 1: Add locale keys**

In `en/common.json`: add `"transcode": { "title": "Re-encode" }` inside the existing `"settings"` object, and under the top-level `"transcode"` add:
```json
"admin": {
  "runWindow": "Run window",
  "pause": "Pause queue",
  "resume": "Resume queue",
  "stats": { "queued": "Queued", "saved": "Saved", "afterSeeding": "Frees after seeding", "failed": "Failed" },
  "statsQueuedHint": "~{{time}} · {{size}} in",
  "statsSavedHint": "{{count}} files · last 30 d",
  "statsSeedHint": "still hardlinked",
  "statsFailedHint": "originals untouched",
  "now": "Now encoding",
  "steps": { "queued": "Queued", "encode": "Encoding", "validate": "Validating", "replace": "Replacing", "rescan": "Rescan" },
  "speed": "Speed",
  "elapsed": "Elapsed",
  "eta": "ETA",
  "size": "Size",
  "estWas": "Est. was",
  "cancelJob": "Cancel",
  "queue": "Queue",
  "queueHint": "Drag to reorder · batches stay grouped",
  "emptyQueue": "Nothing queued. Open a movie or show and choose Re-encode.",
  "batch_one": "{{title}} · {{count}} file remaining",
  "batch_other": "{{title}} · {{count}} files remaining",
  "moveTop": "Move to top",
  "remove": "Remove",
  "removeAll": "Remove all",
  "history": "History",
  "historyHint": "Last 30 days",
  "clearFinished": "Clear finished",
  "cols": { "item": "Item", "settings": "Settings", "size": "Size", "est": "Est.", "result": "Result", "beforeAfter": "Before → after", "saved": "Saved", "ssim": "SSIM", "took": "Took" },
  "result": { "done": "Replaced", "seeding": "· seeding", "failed": "Failed", "cancelled": "Cancelled" },
  "savedLater": "0 now · {{size}} later",
  "kept": "{{size}} kept",
  "retry": "Retry",
  "advanced": "Advanced",
  "ssimThreshold": "SSIM mean threshold",
  "ssimClipMin": "SSIM per-clip minimum",
  "cpuThreads": "CPU threads (empty = auto)",
  "actionFailed": "Action failed"
}
```
In `fr/common.json`: add `"transcode": { "title": "Réencodage" }` inside `"settings"`, and under top-level `"transcode"`:
```json
"admin": {
  "runWindow": "Plage horaire",
  "pause": "Mettre en pause",
  "resume": "Reprendre",
  "stats": { "queued": "En file", "saved": "Libéré", "afterSeeding": "Libéré après le partage", "failed": "Échecs" },
  "statsQueuedHint": "~{{time}} · {{size}} en entrée",
  "statsSavedHint": "{{count}} fichiers · 30 derniers jours",
  "statsSeedHint": "encore liés en dur",
  "statsFailedHint": "originaux intacts",
  "now": "Encodage en cours",
  "steps": { "queued": "En file", "encode": "Encodage", "validate": "Validation", "replace": "Remplacement", "rescan": "Rescan" },
  "speed": "Vitesse",
  "elapsed": "Écoulé",
  "eta": "Restant",
  "size": "Taille",
  "estWas": "Estimé",
  "cancelJob": "Annuler",
  "queue": "File",
  "queueHint": "Glisser pour réordonner · les lots restent groupés",
  "emptyQueue": "Rien en file. Ouvrez un film ou une série et choisissez Réencoder.",
  "batch_one": "{{title}} · {{count}} fichier restant",
  "batch_other": "{{title}} · {{count}} fichiers restants",
  "moveTop": "Mettre en tête",
  "remove": "Retirer",
  "removeAll": "Tout retirer",
  "history": "Historique",
  "historyHint": "30 derniers jours",
  "clearFinished": "Vider les terminés",
  "cols": { "item": "Élément", "settings": "Réglages", "size": "Taille", "est": "Est.", "result": "Résultat", "beforeAfter": "Avant → après", "saved": "Libéré", "ssim": "SSIM", "took": "Durée" },
  "result": { "done": "Remplacé", "seeding": "· en partage", "failed": "Échec", "cancelled": "Annulé" },
  "savedLater": "0 maintenant · {{size}} plus tard",
  "kept": "{{size}} conservés",
  "retry": "Réessayer",
  "advanced": "Avancé",
  "ssimThreshold": "Seuil SSIM moyen",
  "ssimClipMin": "SSIM minimum par extrait",
  "cpuThreads": "Threads CPU (vide = auto)",
  "actionFailed": "Échec de l'action"
}
```

- [ ] **Step 2: Write the failing tab test**

`apps/web/src/pages/settings/_component/TranscodeTab.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const actions = {
  isPending: false, cancel: vi.fn(async () => {}), retry: vi.fn(async () => {}), moveTop: vi.fn(async () => {}),
  moveBefore: vi.fn(async () => {}), moveAfter: vi.fn(async () => {}), removeBatch: vi.fn(async () => {}),
  batchTop: vi.fn(async () => {}), clearHistory: vi.fn(async () => {}),
};
const update = vi.fn();
const settings = { codec: "hevc", encoder: "software", resolution: "keep", mode: "quality", preset: "balanced", speed: "default", convertLosslessAudio: false };
const mk = (id: number, status: string, extra: object = {}) => ({
  id, status, batch_id: "b1", title: `Item ${id}`, position: id, step: null, settings, source_bytes: "4000000000",
  estimated_bytes: "1500000000", output_bytes: null, source_nlink: 1, progress: null, ssim_avg: null, ssim_min: null,
  error: null, created_at: "2026-01-01T00:00:00Z", started_at: null, finished_at: null, poster_url: null, live: null,
  media_id: 1, media_file_id: id, ...extra,
});

vi.mock("@/features/transcode/hooks", () => ({
  useTranscodeJobs: (s: string) => ({
    data: {
      jobs: s === "active"
        ? [mk(1, "running", { step: "encode", live: { progress: 0.5, fps: 100, speed: 4, eta_secs: 60, current_bytes: "700000000" } }), mk(2, "queued"), mk(3, "queued")]
        : [mk(9, "failed", { error: "Quality check: SSIM 0.951 below 0.970", ssim_avg: 0.951, finished_at: "2026-01-01T01:00:00Z" })],
    },
  }),
  useTranscodeSettings: () => ({ data: { paused: false, window_enabled: false, window_start: "01:00", window_end: "08:00", ssim_threshold: 0.97, ssim_clip_min: 0.95, cpu_threads: null } }),
  useUpdateTranscodeSettings: () => ({ mutate: update }),
  useTranscodeSummary: () => ({ data: { state: "running", queued_count: 2, queued_eta_secs: 100, queued_source_bytes: "8000000000", saved_bytes_30d: "0", done_count_30d: 0, frees_after_seeding_bytes: "0", failed_count: 1, window_start: "01:00" } }),
  useTranscodeJobAction: () => actions,
}));

const { TranscodeTab } = await import("@/pages/settings/_component/TranscodeTab");

describe("TranscodeTab", () => {
  it("shows the current job with its step", () => {
    renderWithProviders(<TranscodeTab />);
    expect(screen.getByText("Now encoding")).toBeInTheDocument();
    expect(screen.getByText(/Encoding 50%/)).toBeInTheDocument();
  });

  it("pauses the queue", () => {
    renderWithProviders(<TranscodeTab />);
    fireEvent.click(screen.getByRole("button", { name: /Pause queue/ }));
    expect(update).toHaveBeenCalledWith({ paused: true });
  });

  it("moves a queued job to the top", () => {
    renderWithProviders(<TranscodeTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "Move to top" }).at(-1)!);
    expect(actions.moveTop).toHaveBeenCalledWith(3);
  });

  it("drag-and-drop calls moveBefore", () => {
    renderWithProviders(<TranscodeTab />);
    const rows = screen.getAllByTestId("queue-row");
    fireEvent.dragStart(rows[1]);
    fireEvent.drop(rows[0]);
    expect(actions.moveBefore).toHaveBeenCalledWith(3, 2);
  });

  it("shows the failure reason and retries", () => {
    renderWithProviders(<TranscodeTab />);
    expect(screen.getByText(/SSIM 0.951 below 0.970/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(actions.retry).toHaveBeenCalledWith(9);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bun run test --run src/pages/settings/_component/TranscodeTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the tab**

`apps/web/src/pages/settings/_component/TranscodeTab.tsx`:
```tsx
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { TranscodeJob, TranscodeStep } from "@rawkoon/shared/types";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatDuration } from "@/features/transcode/format";
import {
  useTranscodeJobAction, useTranscodeJobs, useTranscodeSettings, useTranscodeSummary, useUpdateTranscodeSettings,
} from "@/features/transcode/hooks";
import { cn } from "@/lib/utils";

const STEPS: TranscodeStep[] = ["encode", "validate", "replace", "rescan"];

function settingsLabel(j: TranscodeJob): string {
  const s = j.settings;
  const parts = [s.codec.toUpperCase(), s.encoder === "vaapi" ? "GPU" : "CPU"];
  if (s.resolution !== "keep") parts.push(`→${s.resolution}p`);
  parts.push(s.mode === "target" ? `${((s.targetVideoKbps ?? 0) / 1000).toFixed(1)} Mbps` : s.preset);
  if (s.convertLosslessAudio) parts.push("EAC3");
  return parts.join(" · ");
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">{label}</div>
      <div className={cn("mt-0.5 font-display text-xl font-semibold text-neutral-50", tone)}>{value}</div>
      <div className="text-xs text-neutral-500">{hint}</div>
    </div>
  );
}

export function TranscodeTab() {
  const { t } = useTranslation("common");
  const active = useTranscodeJobs("active").data?.jobs ?? [];
  const history = useTranscodeJobs("history").data?.jobs ?? [];
  const settings = useTranscodeSettings().data;
  const summary = useTranscodeSummary(true).data;
  const update = useUpdateTranscodeSettings();
  const act = useTranscodeJobAction();
  const [dragId, setDragId] = useState<number | null>(null);

  const running = active.find((j) => j.status === "running") ?? null;
  const queued = active.filter((j) => j.status === "queued");
  const batches = useMemo(() => {
    const out: { batchId: string; jobs: TranscodeJob[] }[] = [];
    for (const j of queued) {
      const last = out.at(-1);
      if (last?.batchId === j.batch_id) last.jobs.push(j);
      else out.push({ batchId: j.batch_id, jobs: [j] });
    }
    return out;
  }, [queued]);

  const safe = (p: Promise<unknown>) => p.catch(() => toast.error(t("transcode.admin.actionFailed")));

  const stepIndex = running?.step ? STEPS.indexOf(running.step) : -1;
  const progress = running?.live?.progress ?? running?.progress ?? 0;
  const elapsed = running?.started_at ? Math.round((Date.now() - Date.parse(running.started_at)) / 1000) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex-1" />
        {settings && (
          <label className="flex items-center gap-2 text-[13px] text-neutral-400">
            <Switch checked={settings.window_enabled} onCheckedChange={(v: boolean) => update.mutate({ window_enabled: v })} aria-label={t("transcode.admin.runWindow")} />
            {t("transcode.admin.runWindow")}
            <input type="time" value={settings.window_start} aria-label="start" onChange={(e) => update.mutate({ window_start: e.target.value })} className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50" />
            –
            <input type="time" value={settings.window_end} aria-label="end" onChange={(e) => update.mutate({ window_end: e.target.value })} className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50" />
          </label>
        )}
        {settings && (
          <button type="button" onClick={() => update.mutate({ paused: !settings.paused })} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-semibold text-neutral-200 hover:bg-neutral-900">
            {settings.paused ? t("transcode.admin.resume") : t("transcode.admin.pause")}
          </button>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("transcode.admin.stats.queued")} value={String(summary.queued_count)} hint={t("transcode.admin.statsQueuedHint", { time: formatDuration(summary.queued_eta_secs), size: formatBytes(summary.queued_source_bytes) })} />
          <Stat label={t("transcode.admin.stats.saved")} value={formatBytes(summary.saved_bytes_30d)} tone="text-emerald-300" hint={t("transcode.admin.statsSavedHint", { count: summary.done_count_30d })} />
          <Stat label={t("transcode.admin.stats.afterSeeding")} value={formatBytes(summary.frees_after_seeding_bytes)} hint={t("transcode.admin.statsSeedHint")} />
          <Stat label={t("transcode.admin.stats.failed")} value={String(summary.failed_count)} tone="text-red-400" hint={t("transcode.admin.statsFailedHint")} />
        </div>
      )}

      {running && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex items-start gap-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">{t("transcode.admin.now")}</div>
              <div className="font-display text-[17px] font-semibold text-neutral-50">{running.title}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 text-[11px] text-neutral-400">{settingsLabel(running)}</span>
              </div>
            </div>
            <button type="button" onClick={() => safe(act.cancel(running.id))} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-semibold text-neutral-200">
              {t("transcode.admin.cancelJob")}
            </button>
          </div>
          <div className="my-4 flex">
            <div className="relative flex-1 pt-3 text-[11px] text-neutral-400 before:absolute before:left-0 before:right-1 before:top-0 before:h-[3px] before:rounded before:bg-emerald-400">{t("transcode.admin.steps.queued")}</div>
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={cn(
                  "relative flex-1 pt-3 text-[11px] before:absolute before:left-0 before:right-1 before:top-0 before:h-[3px] before:rounded",
                  i < stepIndex ? "text-neutral-400 before:bg-emerald-400" : i === stepIndex ? "font-semibold text-neutral-50 before:bg-primary-400" : "text-neutral-500 before:bg-neutral-800",
                )}
              >
                {t(`transcode.admin.steps.${s}`)}{s === "encode" && i === stepIndex ? ` ${Math.round(progress * 100)}%` : ""}
              </div>
            ))}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-950">
            <i className="block h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-400" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 text-sm md:grid-cols-5">
            <div><div className="font-mono text-[11px] text-neutral-500">{t("transcode.admin.speed")}</div><div className="text-neutral-50">{running.live?.fps ? `${Math.round(running.live.fps)} fps · ${running.live.speed ?? "–"}×` : "–"}</div></div>
            <div><div className="font-mono text-[11px] text-neutral-500">{t("transcode.admin.elapsed")}</div><div className="text-neutral-50">{formatDuration(elapsed)}</div></div>
            <div><div className="font-mono text-[11px] text-neutral-500">{t("transcode.admin.eta")}</div><div className="text-neutral-50">{running.live?.eta_secs != null ? `~${formatDuration(running.live.eta_secs)}` : "–"}</div></div>
            <div><div className="font-mono text-[11px] text-neutral-500">{t("transcode.admin.size")}</div><div className="text-neutral-50">{formatBytes(running.source_bytes)} → {running.live?.current_bytes ? formatBytes(running.live.current_bytes) : "–"}</div></div>
            <div><div className="font-mono text-[11px] text-neutral-500">{t("transcode.admin.estWas")}</div><div className="text-neutral-400">{running.estimated_bytes ? formatBytes(running.estimated_bytes) : "–"}</div></div>
          </div>
        </section>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-[17px] font-semibold text-neutral-50">{t("transcode.admin.queue")}</h2>
        <span className="text-xs text-neutral-500">{t("transcode.admin.queueHint")}</span>
      </div>
      <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        {queued.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-400">{t("transcode.admin.emptyQueue")}</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-neutral-800 text-left font-mono text-[11px] uppercase text-neutral-500">
                <th className="w-6 px-3 py-2" /><th className="px-3 py-2">{t("transcode.admin.cols.item")}</th>
                <th className="px-3 py-2 mobile-max:hidden">{t("transcode.admin.cols.settings")}</th>
                <th className="px-3 py-2">{t("transcode.admin.cols.size")}</th><th className="px-3 py-2">{t("transcode.admin.cols.est")}</th><th />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <Fragment key={`${b.batchId}-${b.jobs[0].id}`}>
                  {b.jobs.length > 1 && (
                    <tr className="bg-neutral-950 text-xs text-neutral-400">
                      <td /><td colSpan={4} className="px-3 py-2">{t("transcode.admin.batch", { title: b.jobs[0].title.split(" — ")[0], count: b.jobs.length })}</td>
                      <td className="whitespace-nowrap px-2 text-right">
                        <button type="button" aria-label={t("transcode.admin.moveTop")} onClick={() => safe(act.batchTop(b.batchId))} className="rounded px-1.5 py-1 hover:bg-neutral-900">⤒</button>
                        <button type="button" onClick={() => safe(act.removeBatch(b.batchId))} className="rounded px-1.5 py-1 hover:bg-neutral-900">{t("transcode.admin.removeAll")}</button>
                      </td>
                    </tr>
                  )}
                  {b.jobs.map((j) => (
                    <tr
                      key={j.id}
                      data-testid="queue-row"
                      draggable
                      onDragStart={() => setDragId(j.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragId != null && dragId !== j.id) void safe(act.moveBefore(dragId, j.id));
                        setDragId(null);
                      }}
                      className="border-b border-neutral-800 last:border-b-0"
                    >
                      <td className="cursor-grab px-3 py-2 text-neutral-500">⋮⋮</td>
                      <td className="px-3 py-2 text-neutral-200">{j.title}</td>
                      <td className="px-3 py-2 text-neutral-400 mobile-max:hidden">{settingsLabel(j)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatBytes(j.source_bytes)}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-300">{j.estimated_bytes ? `~${formatBytes(j.estimated_bytes)}` : "–"}</td>
                      <td className="whitespace-nowrap px-2 text-right text-neutral-500">
                        <button type="button" aria-label={t("transcode.admin.moveTop")} onClick={() => safe(act.moveTop(j.id))} className="rounded px-1.5 py-1 hover:bg-neutral-950">⤒</button>
                        <button type="button" aria-label={t("transcode.admin.remove")} onClick={() => safe(act.cancel(j.id))} className="rounded px-1.5 py-1 hover:bg-neutral-950">✕</button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="flex items-center justify-between">
        <h2 className="font-display text-[17px] font-semibold text-neutral-50">{t("transcode.admin.history")}</h2>
        <span className="text-xs text-neutral-500">
          {t("transcode.admin.historyHint")} ·{" "}
          <button type="button" onClick={() => safe(act.clearHistory())} className="text-primary-400">{t("transcode.admin.clearFinished")}</button>
        </span>
      </div>
      <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-neutral-800 text-left font-mono text-[11px] uppercase text-neutral-500">
              <th className="px-3 py-2">{t("transcode.admin.cols.item")}</th><th className="px-3 py-2">{t("transcode.admin.cols.result")}</th>
              <th className="px-3 py-2">{t("transcode.admin.cols.beforeAfter")}</th><th className="px-3 py-2">{t("transcode.admin.cols.saved")}</th>
              <th className="px-3 py-2 mobile-max:hidden">{t("transcode.admin.cols.ssim")}</th><th className="px-3 py-2 mobile-max:hidden">{t("transcode.admin.cols.took")}</th><th />
            </tr>
          </thead>
          <tbody>
            {history.map((j) => {
              const diff = j.output_bytes ? Number(j.source_bytes) - Number(j.output_bytes) : 0;
              const seeding = (j.source_nlink ?? 1) > 1;
              const took = j.started_at && j.finished_at ? Math.round((Date.parse(j.finished_at) - Date.parse(j.started_at)) / 1000) : null;
              return (
                <Fragment key={j.id}>
                  <tr className="border-b border-neutral-800">
                    <td className="px-3 py-2">{j.title}</td>
                    <td className={cn("px-3 py-2", j.status === "done" ? "text-emerald-300" : j.status === "failed" ? "text-red-400" : "text-neutral-400")}>
                      {t(`transcode.admin.result.${j.status === "done" ? "done" : j.status}`)}
                      {j.status === "done" && seeding && <span className="text-neutral-500"> {t("transcode.admin.result.seeding")}</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {j.status === "done" && j.output_bytes ? `${formatBytes(j.source_bytes)} → ${formatBytes(j.output_bytes)}` : t("transcode.admin.kept", { size: formatBytes(j.source_bytes) })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {j.status !== "done" ? "–" : seeding ? <span className="text-neutral-400">{t("transcode.admin.savedLater", { size: formatBytes(diff) })}</span> : <span className="text-emerald-300">−{formatBytes(diff)}</span>}
                    </td>
                    <td className={cn("px-3 py-2 tabular-nums mobile-max:hidden", j.status === "failed" && j.ssim_avg != null && "text-red-400")}>{j.ssim_avg?.toFixed(3) ?? "–"}</td>
                    <td className="px-3 py-2 tabular-nums mobile-max:hidden">{took != null ? formatDuration(took) : "–"}</td>
                    <td className="px-2 text-right">
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <button type="button" onClick={() => safe(act.retry(j.id))} className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-950">↻ {t("transcode.admin.retry")}</button>
                      )}
                    </td>
                  </tr>
                  {j.error && j.status === "failed" && (
                    <tr className="border-b border-neutral-800"><td colSpan={7} className="px-3 pb-2 text-xs text-red-400">{j.error}</td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {settings && (
        <details className="text-sm text-neutral-400">
          <summary className="cursor-pointer">{t("transcode.admin.advanced")}</summary>
          <div className="mt-2 grid max-w-md gap-2">
            {(
              [
                ["ssim_threshold", t("transcode.admin.ssimThreshold"), 0.001],
                ["ssim_clip_min", t("transcode.admin.ssimClipMin"), 0.001],
              ] as const
            ).map(([k, label, step]) => (
              <label key={k} className="flex items-center justify-between gap-3">
                {label}
                <input type="number" step={step} min={0.5} max={1} defaultValue={settings[k]} onBlur={(e) => update.mutate({ [k]: Number(e.target.value) })} className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50" />
              </label>
            ))}
            <label className="flex items-center justify-between gap-3">
              {t("transcode.admin.cpuThreads")}
              <input type="number" min={1} defaultValue={settings.cpu_threads ?? ""} onBlur={(e) => update.mutate({ cpu_threads: e.target.value === "" ? null : Number(e.target.value) })} className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50" />
            </label>
          </div>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Register the tab**

In `apps/web/src/pages/settings/_component/Settings.tsx`:
1. Add `| "transcode"` to the `Tab` union.
2. Import: `import { TranscodeTab } from "@/pages/settings/_component/TranscodeTab";` and add `Gauge` to the lucide import.
3. In the admin tab list, after the `jobs` entry, add:
```tsx
        { id: "transcode", label: t("settings.transcode.title"), icon: Gauge },
```
4. In the render block, after the `JobsTab` line, add:
```tsx
          {activeTab === "transcode" && currentUser?.is_admin && <TranscodeTab />}
```
If the settings route validates `tab` with a fixed list (check `apps/web/src/pages/settings/index.tsx`), add `"transcode"` there too.

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `cd apps/web && bun run test --run src/pages/settings/_component/TranscodeTab.test.tsx`
Expected: PASS (5 tests).
Run: `bun run typecheck && bun run lint && bun run test`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/settings/_component/TranscodeTab.tsx apps/web/src/pages/settings/_component/TranscodeTab.test.tsx apps/web/src/pages/settings/_component/Settings.tsx apps/web/src/pages/settings/index.tsx apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
git commit -m "feat(web): add the re-encode queue admin tab"
```

---

### Task 18: Image drivers, docs and final verification

**Files:**
- Modify: `Dockerfile`
- Modify: `docs/self-hosting.md`
- Modify: `docker-compose.prod-example.yml` (commented GPU lines)

- [ ] **Step 1: Ship VA-API drivers in the image**

In `Dockerfile`, replace the runtime `RUN apt-get update …` line with:
```dockerfile
# Keep ffmpeg installed: audiobook chapter probing/splitting and library re-encoding shell out to it.
# VA-API drivers let re-encoding use an Intel/AMD GPU when /dev/dri is passed through.
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update -y \
    && apt-get install -y openssl curl mediainfo mkvtoolnix ffmpeg intel-media-va-driver-non-free mesa-va-drivers \
    && rm -rf /var/lib/apt/lists/*
```
Keep the existing comment lines above it about OpenSSL/curl/mediainfo.

- [ ] **Step 2: Verify the image builds and detects encoders**

Run: `docker build -t rawkoon:reencode-test . && docker run --rm --entrypoint sh rawkoon:reencode-test -c "ffmpeg -hide_banner -encoders | grep -E 'libx265|libsvtav1|hevc_vaapi|av1_vaapi'"`
Expected: four matching encoder lines.

- [ ] **Step 3: Document GPU + memory**

Append to `docs/self-hosting.md`:
````markdown
## Re-encoding (optional GPU)

Settings → Admin → Re-encode runs ffmpeg inside the Rawkoon container. CPU encoding (HEVC via x265, AV1 via SVT-AV1) works everywhere. To let it use an Intel or AMD GPU through VA-API, pass the render device and group:

```yaml
services:
  rawkoon:
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "${RENDER_GID}"   # getent group render | cut -d: -f3
```

The modal shows "Detected: VAAPI · renderD128" when it works, or the reason when it doesn't.

Software encodes of 4K sources can use several GB of RAM; give the container at least 4 GB (`deploy.resources.limits.memory`) if you re-encode 4K on the CPU.

Re-encoded files replace the originals only after validation. Files that are still hardlinked to a seeding torrent keep using disk space until that torrent is removed.
````

In `docker-compose.prod-example.yml`, under the `rawkoon` service, add commented lines:
```yaml
    # Optional: GPU re-encoding (VA-API). See docs/self-hosting.md.
    # devices:
    #   - /dev/dri:/dev/dri
    # group_add:
    #   - "${RENDER_GID}"
```

- [ ] **Step 4: Full verification**

Run from repo root:
```bash
bun run formatCheck && bun run lint && bun run typecheck && bun run test && bun run build
```
Expected: every command exits 0; the API suite includes the transcode unit tests and the integration test (not skipped, since ffmpeg is installed locally).

- [ ] **Step 5: Manual smoke test in dev**

Run `bun run dev:services`, `bun run dev:api`, `bun run dev:web`. With an admin account and a short sample video in the dev library:
1. Open the movie → Management → file → "Re-encode…". Expect: GPU disabled with reason (no `/dev/dri` on the host dev API process unless present), estimate card filled, "Refine estimate" changes the source line to "Refined · 1 files · 6 clips".
2. Change codec to AV1 → "Estimate outdated — settings changed".
3. "Add 1 file to queue" → toast; home shows the Re-encode widget with Running; Settings → Re-encode shows steps advancing to Rescan and a history row "Replaced".
4. Pause → state pill "Paused"; queue a second file → it stays queued; Resume → it starts within ~10 s.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docs/self-hosting.md docker-compose.prod-example.yml
git commit -m "build: ship VA-API drivers and document GPU re-encoding"
```

---

## Self-Review Notes

- Spec coverage: modal sections (T15), estimate rough/refine/target + outdated (T9, T12, T15), exclusions incl. DV5 (T12), pipeline steps/validation/EXDEV/rename/mp4 (T3–T10), boot recovery (T7, T11), notifications (T11), queue controls pause/window/reorder/batch/retry/history/purge (T5, T12, T17), widget visibility (T12 `show`, T16), capabilities + GPU reason (T10, T15), docs/drivers (T18). SSE replaced by polling (spec updated).
- `PipelineDeps.rescan` stays single-argument (Task 10); Task 11 encodes `mediaFileId|path` into that argument rather than widening the interface, so Task 10's tests and signature stay valid.
- Type names used across tasks: `SourceProbe`, `ProbeStream`, `TranscodeJobSettings`, `PipelineDeps`, `PipelineResult`, `ClaimedJob`, `TranscodeRepo`, `TranscodeNotifier`, `Capabilities`, `CandidateFile` — each defined once in the task listed in its Interfaces block.
