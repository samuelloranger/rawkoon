# Cleanup Release (Queue Janitor + Seeding Lifecycle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dead, fake and malicious releases from being re-grabbed. Release torrents from the client once their seed target is met, including after a delete or an upgrade. Surface orphaned torrents. Show all of it live on a new Downloads page.

**Architecture:** `DownloadHistory` is the ownership ledger. It gains `seed_released_*` columns, and every piece of policy is a pure function in `services/seeding/seedPolicy.ts`. Two thin runners apply that policy:
- `services/downloadJanitor.ts#rejectRelease`: fail, blocklist, remove.
- `services/seeding/seedSweep.ts#runSeedSweep`: plan, then release.

Both take injected deps, so tests never touch Prisma. The reconcile loop and `finishPostProcess` call the janitor. A 15-minute scheduled job and the post-import hook call the sweep. A new admin-only `/api/downloads` route domain feeds the web, and the `library.seed-state` SSE event keeps it live.

**Tech Stack:** Bun, Hono, Prisma 7 / Postgres 17, BullMQ, Zod, React 19, TanStack Query/Router, Tailwind 4, i18next, vitest, bun test, SwiftUI (one stub case).

**Spec:** `docs/superpowers/specs/2026-09-22-cleanup-release-design.md`. The mockup at `docs/superpowers/specs/2026-09-22-cleanup-release-mockup/index.html` is authoritative for layout and copy.

**Branch:** work in the worktree `~/sites/rawkoon-cleanup-spec`. Before Task 1: `git checkout -b feat/cleanup-release`. All paths below are relative to that repo root.

## Global Constraints

- The API imports itself as `@rawkoon/api/<path>`, never by relative path (CLAUDE.md).
- Errors are **returned** from `@rawkoon/api/errors` (`ok`, `badRequest`, `notFound`, `serverError`), never thrown.
- Every `/api/downloads` route carries its own `requireAdmin`. Never use `.use('*')`, which leaks across `.route()` merges.
- Shared request and response types live in `apps/shared/src/types/seeding.ts` and are re-exported from `apps/shared/src/types/index.ts`. REST bodies are snake_case; SSE payloads are camelCase.
- Comments give the *why* in one short line. TS strict mode has `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns` on.
- Every new web string goes into **both** `apps/web/src/locales/en/common.json` and `apps/web/src/locales/fr/common.json`.
- Default blocked extensions, verbatim: `exe scr lnk bat cmd com msi pif vbs ps1 jar apk`.
- Private defaults: ratio `1.0`, seed time `4320` minutes (72 h). The public default is the existing `minSeedRatio` plus `publicSeedTimeMins` (null).
- `seedSweepEnabled` defaults to **false**. While it is false, the existing import-time ratio removal behaves exactly as it does today.
- An indexer that is unknown or unreachable counts as **private**.
- Rejected releases and released torrents: remove the data unless another torrent in the client shares the content path. Never touch a torrent that is neither in a `rawkoon-*` category nor tagged `rawkoon-dh-N`.
- API tests: `cd apps/api && bun test <file>` per task. The final gate is the **full** suite, compared against `main`, because the suite is order-dependent.
- Web tests: `cd apps/web && env -u NODE_ENV bunx vitest run <file>`. This shell exports `NODE_ENV=production`, which breaks React `act`.
- iOS changes are verified only on `macbuild` (see Task 9), and must pass all four iOS lint steps.
- Public-facing text (commits, comments, fixtures) describes code and failure modes, never a specific instance. No `Co-Authored-By` trailers.
- Never tag, bump the version, or cut a release.

## Review Focus

These are the input classes most likely to bite, each with the task whose tests pin it:

1. **A rejected release whose hash is shared with another live row.** For example, a season pack plus an episode re-grab of the same torrent. The torrent must **not** be removed out from under the live row. *Task 5.*
2. **A library item removed while its grab is still downloading.** The pending row, now without a target, must be failed and its torrent removed. It must **not** complete later and fire a "post-processing failed" notice. *Task 10.*
3. **Hash case mismatch between the DB and the client.** An uppercase hash in `download_history` and a lowercase one from the client must still match, in the janitor, the sweep and orphan classification. *Tasks 3, 5, 7.*
4. **The client unreachable, or `remove` throwing, mid-sweep.** No row may be stamped released, so the next pass retries. *Task 7.*
5. **A magnet with no metadata yet** (an empty file list). The malware check must retry on the next pass, **not** record the torrent as clean. *Task 6.*

---

## File Structure

**API: new**
- `apps/api/src/services/seeding/seedPolicy.ts`: pure rules, progress, ownership, orphans and extensions.
- `apps/api/src/services/seeding/indexerPrivacy.ts`: indexer name → private map, cached for 1 h.
- `apps/api/src/services/seeding/seedSweep.ts`: `planSeedReleases` (pure), `runSeedSweep`, `evaluateSeedRelease`, `releaseTorrentNow`, `releasePendingForRemovedMedia`.
- `apps/api/src/services/seeding/seedingView.ts`: pure view builders for the routes.
- `apps/api/src/services/downloadJanitor.ts`: `rejectRelease`, `findBlockedFileInTorrent`.
- `apps/api/src/services/postProcessFailure.ts`: the `PostProcessFailure` type, kept apart to avoid an import cycle.
- `apps/api/src/routes/downloads/index.ts`: the admin `/api/downloads` domain.
- `apps/api/prisma/migrations/20260922000000_cleanup_release/migration.sql`
- Tests: `apps/api/test/seedPolicy.test.ts`, `indexerPrivacy.test.ts`, `downloadJanitor.test.ts`, `seedSweep.test.ts`, `seedingView.test.ts`.
- `apps/api/e2e/fixtures/downloads.ts`

**API: modified**
- `prisma/schema.prisma`
- `services/downloadClient/{types,qbittorrentAdapter,transmissionAdapter,delugeAdapter}.ts`, plus `services/qbittorrent/torrentQueries.ts`.
- `workers/checkDownloadCompletion.ts`
- `services/downloadOutcome.ts`, `postProcessorSingle.ts`, `postProcessorSeasonPack.ts`, `postProcessorBook.ts`.
- `services/queueService.ts`, `services/jobs/scheduledTasksWorker.ts`, `routes/admin/adminJobRoutes.ts`.
- `services/libraryEvents.ts`, `contracts/sseContract.ts`, `apps/shared/contracts/sse-contract.v1.json`, `routes/library/libraryJobWorkerRoutes.ts`.
- `routes/library/libraryListRoutes.ts` (delete), `routes/library/libraryFilesRoutes.ts` (history `seed`), `routes/library/libraryMediaAdmin.ts` (settings), `routes/medias/blocklist/index.ts` (kind and source), `src/index.ts` (mount).

**Shared:** `apps/shared/src/types/seeding.ts` (new), `types/index.ts`, `types/library.ts`, `types/media.ts`.

**iOS:** `apps/ios/Rawkoon/ServerState/SSEEventRegistry.swift` and `apps/ios/RawkoonTests/LibraryEventMappingTests.swift`.

**Web: new**, all under `apps/web/src/features/seeding/`:
- `lib/seedFormat.ts`, `lib/ruleSentence.ts`, `lib/mergeSeedState.ts`, with tests.
- `hooks/useSeeding.ts`, `hooks/useOrphans.ts`, `hooks/useSeedRules.ts`, `hooks/useJanitorStats.ts`.
- `components/ReleaseMeter.tsx`, `SeedingRow.tsx`, `SeedingView.tsx`, `OrphansView.tsx`, `DownloadsPage.tsx`, with tests.
- `pages/settings/_component/SeedingSettingsSection.tsx`, `DownloadSafetySection.tsx` and `ExtensionChipInput.tsx`, with tests.

**Web: modified**
- `pages/library/downloads.tsx`
- `lib/endpoints/downloads.ts`, `lib/queryKeys.ts`
- `features/medias/hooks/useLibraryEvents.ts`, `useRemoveFromLibrary.ts`, `useBlocklist.ts`
- `pages/settings/_component/{MediaPostProcessingTab,MediaPostProcessingSettingsBody,BlocklistTab,LibraryHealthCard,jobsConfig}.tsx`
- `pages/medias/_component/{LibraryActionsSection,LibraryDownloadHistorySection}.tsx`
- Both locale files.

---

### Task 1: Schema, migration, shared types

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260922000000_cleanup_release/migration.sql`
- Create: `apps/shared/src/types/seeding.ts`
- Modify: `apps/shared/src/types/index.ts`

**Interfaces:**
- Produces:
  - Prisma fields `DownloadHistory.seedReleasedAt/seedReleaseReason/seedReleasedBytes`, `GrabBlocklist.kind`, model `IndexerSeedRule`, and `MediaSettings.publicSeedTimeMins/privateSeedRatio/privateSeedTimeMins/seedSweepEnabled/blockedExtensions`.
  - Every shared type named in this task.

- [ ] **Step 1: Edit `schema.prisma`**

In `model DownloadHistory`, after `bookEditionId`, add:

```prisma
  /// When Rawkoon removed (or stopped tracking) this row's torrent. Null = still owned.
  seedReleasedAt             DateTime? @map("seed_released_at")
  /// target_met | stalled | malware | import_rejected | manual | move_mode | adopted
  seedReleaseReason          String?   @map("seed_release_reason")
  /// Torrent size at release, for the "GB freed" line; null when unknown.
  seedReleasedBytes          BigInt?   @map("seed_released_bytes")
```

Append to the existing index doc comments in the same model. This is a comment, not an `@@index`, because Prisma can't express a partial index and ignores it in drift detection:

```prisma
  /// The seed sweep is served by a PARTIAL index created in
  /// 20260922000000_cleanup_release: (torrent_hash) WHERE seed_released_at IS
  /// NULL AND completed_at IS NOT NULL AND failed = false.
```

In `model GrabBlocklist`, after `reason`, add:

```prisma
  /// stalled | malware | import_rejected; null = added by a user.
  kind         String?
```

and next to the existing indexes:

```prisma
  @@index([kind, blockedAt], map: "ix_grab_blocklist_kind_blocked_at")
```

In `model MediaSettings`, after `downloadPollActiveHookedSecs`, add:

```prisma
  // ── Seeding lifecycle ─────────────────────────────
  /// Public default = minSeedRatio + this. Null = no time target.
  publicSeedTimeMins      Int?     @map("public_seed_time_mins")
  privateSeedRatio        Float?   @default(1) @map("private_seed_ratio")
  privateSeedTimeMins     Int?     @default(4320) @map("private_seed_time_mins")
  /// Off until an admin opts in: the first sweep would otherwise release every old torrent at once.
  seedSweepEnabled        Boolean  @default(false) @map("seed_sweep_enabled")
  blockedExtensions       String[] @default(["exe", "scr", "lnk", "bat", "cmd", "com", "msi", "pif", "vbs", "ps1", "jar", "apk"]) @map("blocked_extensions")
```

Add a new model after `GrabBlocklist`:

```prisma
/// Per-indexer seed target override; absent = the public/private default applies.
model IndexerSeedRule {
  id           Int      @id @default(autoincrement())
  indexerName  String   @unique @map("indexer_name")
  ratio        Float?
  seedTimeMins Int?     @map("seed_time_mins")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("indexer_seed_rule")
}
```

- [ ] **Step 2: Write the migration SQL**

`apps/api/prisma/migrations/20260922000000_cleanup_release/migration.sql`:

```sql
-- Cleanup release: queue janitor + seeding lifecycle. Additive only.

ALTER TABLE "download_history"
  ADD COLUMN "seed_released_at" TIMESTAMP(3),
  ADD COLUMN "seed_release_reason" TEXT,
  ADD COLUMN "seed_released_bytes" BIGINT;

-- Partial, like ix_download_history_active_grabbed_at: the sweep reads only
-- completed, unreleased, non-failed rows of a table that only grows.
CREATE INDEX "ix_download_history_seed_pending"
  ON "download_history" ("torrent_hash")
  WHERE "seed_released_at" IS NULL AND "completed_at" IS NOT NULL AND "failed" = false;

ALTER TABLE "grab_blocklist" ADD COLUMN "kind" TEXT;
CREATE INDEX "ix_grab_blocklist_kind_blocked_at" ON "grab_blocklist" ("kind", "blocked_at");

CREATE TABLE "indexer_seed_rule" (
  "id" SERIAL NOT NULL,
  "indexer_name" TEXT NOT NULL,
  "ratio" DOUBLE PRECISION,
  "seed_time_mins" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "indexer_seed_rule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "indexer_seed_rule_indexer_name_key" ON "indexer_seed_rule" ("indexer_name");

ALTER TABLE "media_settings"
  ADD COLUMN "public_seed_time_mins" INTEGER,
  ADD COLUMN "private_seed_ratio" DOUBLE PRECISION DEFAULT 1,
  ADD COLUMN "private_seed_time_mins" INTEGER DEFAULT 4320,
  ADD COLUMN "seed_sweep_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blocked_extensions" TEXT[] DEFAULT ARRAY['exe','scr','lnk','bat','cmd','com','msi','pif','vbs','ps1','jar','apk']::TEXT[];
```

- [ ] **Step 3: Apply it to the dev DB and check there is no drift**

Run:
```bash
bun run dev:services
cd apps/api && set -a && . ../../.env && set +a
bunx prisma migrate deploy && bunx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL" --script | grep -v '^--' | grep -c . ; bun run db:generate
```
Expected: `deploy` applies `20260922000000_cleanup_release`, and the `diff` line count is `0`. If `diff` needs a separate shadow DB, run `bun run db:migrate:dev --create-only --name drift_check` instead and confirm it generates an **empty** migration, then delete that folder.

- [ ] **Step 4: Create the shared types**

`apps/shared/src/types/seeding.ts`:

```ts
/** Why Rawkoon stopped owning a torrent (download_history.seed_release_reason). */
export type SeedReleaseReason =
  | "target_met"
  | "stalled"
  | "malware"
  | "import_rejected"
  | "manual"
  | "move_mode"
  | "adopted";

/** Why the janitor blocklisted a release; null on the entry = added by a user. */
export type BlocklistKind = "stalled" | "malware" | "import_rejected";

export interface SeedRule {
  ratio: number | null;
  seed_time_mins: number | null;
}

export type SeedRuleSource = "override" | "private_default" | "public_default";

export type SeedingBadge = "removed_from_library" | "replaced_by_upgrade";

export interface SeedingTorrent {
  hash: string;
  name: string;
  title: string;
  year: number | null;
  kind_label: "movie" | "show" | "ebook" | "audiobook" | null;
  media_id: number | null;
  book_id: number | null;
  poster_url: string | null;
  indexer: string | null;
  is_private: boolean;
  badges: SeedingBadge[];
  rule: SeedRule;
  rule_source: SeedRuleSource;
  ratio: number | null;
  seeding_time_secs: number | null;
  up_speed: number;
  size_bytes: number;
  /** 0..1 progress toward each target; null when that target is not set. */
  ratio_pct: number | null;
  time_pct: number | null;
  lead: "ratio" | "time" | null;
  /** Seconds until release; null when it cannot be reached (idle, ratio-only). */
  eta_secs: number | null;
  target_met: boolean;
  owes_seed_time: boolean;
}

export interface ReleasedTorrent {
  hash: string;
  title: string;
  reason: SeedReleaseReason;
  released_at: string;
  size_bytes: number | null;
}

export interface SeedingResponse {
  enabled: boolean;
  torrents: SeedingTorrent[];
  released_today: ReleasedTorrent[];
  /** Present with ?preview=1: what one sweep would release now. */
  would_release_now?: { count: number; bytes: number };
}

export interface OrphanTorrent {
  hash: string;
  name: string;
  category: string | null;
  size_bytes: number;
  ratio: number | null;
  seeding_time_secs: number | null;
  content_path: string | null;
  shares_data: boolean;
}

export interface OrphansResponse {
  orphans: OrphanTorrent[];
  total_bytes: number;
}

export interface RemoveOrphansRequest {
  hashes: string[];
  delete_data: boolean;
}

export interface RemoveOrphansResponse {
  removed: string[];
  refused: string[];
  freed_bytes: number;
}

export interface IndexerSeedRuleRow {
  indexer: string;
  is_private: boolean;
  override: SeedRule | null;
  effective: SeedRule;
  source: SeedRuleSource;
  held_count: number;
}

export interface SeedRulesResponse {
  indexers: IndexerSeedRuleRow[];
}

export interface UpsertSeedRuleRequest {
  ratio: number | null;
  seed_time_mins: number | null;
}

export interface JanitorStats {
  days: number;
  stalled: number;
  malware: number;
  import_rejected: number;
}

/** Seed state of one download_history row, shown as a chip in the history. */
export interface DownloadSeedState {
  state: "seeding" | "released" | "blocklisted";
  reason: SeedReleaseReason | null;
  ratio: number | null;
  seeding_time_secs: number | null;
}

/** One torrent in a `seed-state` SSE event. camelCase like every SSE payload. */
export interface SeedStateItem {
  hash: string;
  ratio: number | null;
  seedingTimeSecs: number | null;
  upSpeed: number;
  etaSecs: number | null;
  released?: { reason: SeedReleaseReason; at: string; freedBytes: number | null };
}

export interface SeedStateEvent {
  kind: "seed-state";
  ts: number;
  torrents: SeedStateItem[];
}
```

Add `export * from "./seeding";` to `apps/shared/src/types/index.ts`.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS. Nothing uses the new fields yet.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/shared/src/types
git commit -m "feat(db): seeding ledger columns, indexer seed rules, janitor settings"
```

---

### Task 2: Adapter fields (`seedingTimeSecs`, `upSpeed`, `category`) and `listFiles`

**Files:**
- Modify: `apps/api/src/services/downloadClient/types.ts`, `qbittorrentAdapter.ts`, `transmissionAdapter.ts`, `delugeAdapter.ts`
- Modify: `apps/api/src/services/qbittorrent/torrentQueries.ts`
- Modify tests: `apps/api/test/qbittorrentAdapter.test.ts`, `transmissionAdapter.test.ts`, `delugeAdapter.test.ts`, `reconcilePendingDownloads.test.ts`, `reconcileNormalized.test.ts`, `libraryDownloadsLive.test.ts`, `apps/api/src/workers/downloadProgressBroadcaster.test.ts` (any object literal typed `NormalizedTorrent`).

**Interfaces:**
- Produces:
  - `NormalizedTorrent` gains `upSpeed: number`, `seedingTimeSecs: number | null` and `category: string | null`.
  - `DownloadClientAdapter.listFiles(hash: string): Promise<string[] | null>`. An empty file list from the client maps to `null`, meaning metadata is unknown.
  - `fetchQbittorrentTorrentFiles(config, hash): Promise<string[]>`.

- [ ] **Step 1: Write the failing mapper tests**

In `apps/api/test/delugeAdapter.test.ts`:
- Add `upload_payload_rate: 7, seeding_time: 3600` to the input.
- Add `upSpeed: 7, seedingTimeSecs: 3600, category: null` to the expected object.
- Add a second case:

```ts
  it("reports no seed time when Deluge omits it", () => {
    const t = delugeRowToNormalized("abcd", { name: "X", progress: 50, state: "Downloading" });
    expect(t.seedingTimeSecs).toBeNull();
    expect(t.upSpeed).toBe(0);
    expect(t.category).toBeNull();
  });
```

In `transmissionAdapter.test.ts`, extend the existing `transmissionRowToNormalized` expectation:
- input `rateUpload: 5, secondsSeeding: 120`
- expected `upSpeed: 5, seedingTimeSecs: 120, category: null`

In `qbittorrentAdapter.test.ts`, extend the `qbRawToNormalized` expectation:
- input `upspeed: 9, seeding_time: 60, category: "rawkoon-movies"`
- expected `upSpeed: 9, seedingTimeSecs: 60, category: "rawkoon-movies"`

Add one more case: `category: ""` maps to `category: null`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/delugeAdapter.test.ts test/transmissionAdapter.test.ts test/qbittorrentAdapter.test.ts`
Expected: FAIL. The new keys are missing from the mapped objects.

- [ ] **Step 3: Implement**

In `types.ts`, add to `NormalizedTorrent` (after `dlSpeed`):

```ts
  /** bytes/s */
  upSpeed: number;
  /** Seconds spent seeding since completion; null when the client does not report it. */
  seedingTimeSecs: number | null;
  /** qBittorrent category; null for clients without categories. */
  category: string | null;
```

Add to `DownloadClientAdapter`:

```ts
  /** Relative file paths, or null while the torrent's metadata is still unknown. */
  listFiles(hash: string): Promise<string[] | null>;
```

In `qbittorrentAdapter.ts#qbRawToNormalized`, add:

```ts
    upSpeed: num(raw.upspeed),
    seedingTimeSecs: typeof raw.seeding_time === "number" ? raw.seeding_time : null,
    category: str(raw.category) || null,
```

and in the adapter object:

```ts
    async listFiles(hash: string) {
      const files = await fetchQbittorrentTorrentFiles(config, hash);
      return files.length > 0 ? files : null;
    },
```

In `qbittorrent/torrentQueries.ts`, append:

```ts
/** Relative paths of a torrent's files; empty while metadata is unresolved. */
export const fetchQbittorrentTorrentFiles = async (
  config: QbittorrentIntegrationConfig,
  hash: string,
): Promise<string[]> => {
  const payload = await qbFetchJson<unknown>(
    config,
    `/api/v2/torrents/files?hash=${encodeURIComponent(hash.trim())}`,
  );
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => toRecord(entry)?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
};
```

Then import it in `qbittorrentAdapter.ts` from `@rawkoon/api/services/qbittorrent/torrentQueries`.

In `transmissionAdapter.ts`:
- Add `"rateUpload"` and `"secondsSeeding"` to `TORRENT_FIELDS`.
- In the mapper:

```ts
    upSpeed: num(raw.rateUpload),
    seedingTimeSecs: typeof raw.secondsSeeding === "number" ? raw.secondsSeeding : null,
    category: null,
```

- Add the adapter method:

```ts
    async listFiles(hash: string) {
      const result = await rpc<{ torrents: Array<{ files?: Array<{ name?: unknown }> }> }>(
        "torrent-get",
        { fields: ["files"], ids: [hash] },
      );
      const names = (result.torrents?.[0]?.files ?? [])
        .map((f) => f.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0);
      return names.length > 0 ? names : null;
    },
```

In `delugeAdapter.ts`:
- Add `"upload_payload_rate"` and `"seeding_time"` to `STATUS_FIELDS`.
- In the mapper:

```ts
    upSpeed: num(raw.upload_payload_rate),
    seedingTimeSecs: typeof raw.seeding_time === "number" ? raw.seeding_time : null,
    category: null,
```

- Add the adapter method:

```ts
    async listFiles(hash: string) {
      const status = await call<{ files?: Array<{ path?: unknown }> }>(
        "core.get_torrent_status",
        [hash, ["files"]],
      );
      const paths = (status?.files ?? [])
        .map((f) => f.path)
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      return paths.length > 0 ? paths : null;
    },
```

- [ ] **Step 4: Fix every `NormalizedTorrent` literal flagged by the typechecker**

Run: `bun run typecheck 2>&1 | grep -E "error" | head -40`

For each test builder listed in **Files**, add `upSpeed: 0, seedingTimeSecs: null, category: null` to the default object. For example, the `torrent()` helper in `reconcilePendingDownloads.test.ts` gets these three lines after `dlSpeed: 1000,`. Any in-memory fake adapter in the tests (a search for `listTorrents:` in `apps/api/test`) gains `listFiles: async () => null`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && bun test test/delugeAdapter.test.ts test/transmissionAdapter.test.ts test/qbittorrentAdapter.test.ts test/reconcilePendingDownloads.test.ts test/reconcileNormalized.test.ts test/libraryDownloadsLive.test.ts src/workers/downloadProgressBroadcaster.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(download-client): report upload speed, seed time, category and file list"
```

---

### Task 3: Pure seed policy

**Files:**
- Create: `apps/api/src/services/seeding/seedPolicy.ts`
- Test: `apps/api/test/seedPolicy.test.ts`

**Interfaces:**
- Consumes: `NormalizedTorrent` (Task 2).
- Produces (exact exports):

```ts
export type Rule = { ratio: number | null; seedTimeMins: number | null };
export type RuleSource = "override" | "private_default" | "public_default";
export interface SeedDefaults { publicRule: Rule; privateRule: Rule }
export interface RuleContext {
  defaults: SeedDefaults;
  overrides: ReadonlyMap<string, Rule>; // key: indexer name, trimmed + lowercased
  privacy: ReadonlyMap<string, boolean>; // key: indexer name, trimmed + lowercased → isPrivate
}
export interface SeedStats { ratio: number | null; seedingTimeSecs: number | null; upSpeed: number; sizeBytes: number }
export interface SeedProgress { ratioPct: number | null; timePct: number | null; lead: "ratio" | "time" | null; etaSecs: number | null; met: boolean }
export function indexerKey(indexer: string | null | undefined): string | null;
export function isIndexerPrivate(indexer: string | null | undefined, privacy: ReadonlyMap<string, boolean>): boolean;
export function resolveIndexerRule(indexer: string | null | undefined, ctx: RuleContext): { rule: Rule; source: RuleSource; isPrivate: boolean };
export function isSeedTargetMet(stats: SeedStats, rule: Rule): boolean;
export function seedProgress(stats: SeedStats, rule: Rule): SeedProgress;
export function governingProgress(stats: SeedStats, rules: Rule[]): SeedProgress & { rule: Rule };
export function isRawkoonOwned(t: Pick<NormalizedTorrent, "category" | "labels">): boolean;
export function sharesContentPath(t: NormalizedTorrent, all: readonly NormalizedTorrent[]): boolean;
export function classifyOrphans(torrents: readonly NormalizedTorrent[], ownedHashes: ReadonlySet<string>): NormalizedTorrent[];
export function normalizeExtension(raw: string): string | null;
export function findBlockedFile(files: readonly string[], extensions: readonly string[]): string | null;
export function statsOf(t: NormalizedTorrent): SeedStats;
```

A hash owned by several rows is released only when **every** row's rule is met. `governingProgress` reports the unmet rule with the longest wait. This is how "strictest wins" plays out under either-target semantics.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/seedPolicy.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  classifyOrphans,
  findBlockedFile,
  governingProgress,
  isRawkoonOwned,
  isSeedTargetMet,
  normalizeExtension,
  resolveIndexerRule,
  seedProgress,
  sharesContentPath,
  type RuleContext,
} from "@rawkoon/api/services/seeding/seedPolicy";

const GB = 1024 ** 3;

function torrent(o: Partial<NormalizedTorrent> = {}): NormalizedTorrent {
  return {
    hash: "a".repeat(40), name: "T", state: "completed", progress: 1,
    savePath: "/dl", contentPath: "/dl/T", seeds: 0, peers: 0, dlSpeed: 0,
    upSpeed: 0, seedingTimeSecs: 0, category: "rawkoon-movies",
    sizeBytes: GB, labels: [], ratio: 0, ...o,
  };
}

const ctx: RuleContext = {
  defaults: {
    publicRule: { ratio: 1, seedTimeMins: null },
    privateRule: { ratio: 1, seedTimeMins: 4320 },
  },
  overrides: new Map([["quarry", { ratio: 2, seedTimeMins: 10080 }]]),
  privacy: new Map([["nimbus", true], ["harbor", false], ["quarry", true]]),
};

describe("resolveIndexerRule", () => {
  it("prefers an override", () => {
    expect(resolveIndexerRule("Quarry", ctx)).toEqual({
      rule: { ratio: 2, seedTimeMins: 10080 }, source: "override", isPrivate: true,
    });
  });
  it("uses the private default for a private indexer", () => {
    expect(resolveIndexerRule(" nimbus ", ctx).source).toBe("private_default");
  });
  it("uses the public default for a public indexer", () => {
    expect(resolveIndexerRule("Harbor", ctx)).toMatchObject({ source: "public_default", isPrivate: false });
  });
  it("treats unknown and null indexers as private", () => {
    expect(resolveIndexerRule("Mystery", ctx).source).toBe("private_default");
    expect(resolveIndexerRule(null, ctx).isPrivate).toBe(true);
  });
});

describe("isSeedTargetMet", () => {
  const stats = { ratio: 0.5, seedingTimeSecs: 3600, upSpeed: 0, sizeBytes: GB };
  it("is met immediately when no target is set", () => {
    expect(isSeedTargetMet(stats, { ratio: null, seedTimeMins: null })).toBe(true);
  });
  it("is met by either target", () => {
    expect(isSeedTargetMet({ ...stats, ratio: 1 }, { ratio: 1, seedTimeMins: 4320 })).toBe(true);
    expect(isSeedTargetMet({ ...stats, seedingTimeSecs: 4320 * 60 }, { ratio: 1, seedTimeMins: 4320 })).toBe(true);
  });
  it("is not met when neither target is reached", () => {
    expect(isSeedTargetMet(stats, { ratio: 1, seedTimeMins: 4320 })).toBe(false);
  });
  it("never counts a null client reading as met", () => {
    expect(isSeedTargetMet({ ...stats, ratio: null }, { ratio: 1, seedTimeMins: null })).toBe(false);
  });
});

describe("seedProgress", () => {
  it("leads with the target that will be met first", () => {
    // ratio: 0.5 of 1.0 on 1 GiB at 1 MiB/s → 512 s; time: 72 h - 1 h → 255600 s
    const p = seedProgress({ ratio: 0.5, seedingTimeSecs: 3600, upSpeed: 1024 ** 2, sizeBytes: GB }, { ratio: 1, seedTimeMins: 4320 });
    expect(p.lead).toBe("ratio");
    expect(p.etaSecs).toBe(512);
    expect(p.ratioPct).toBe(0.5);
    expect(p.met).toBe(false);
  });
  it("cannot reach a ratio-only target while idle", () => {
    const p = seedProgress({ ratio: 0.05, seedingTimeSecs: 10, upSpeed: 0, sizeBytes: GB }, { ratio: 1, seedTimeMins: null });
    expect(p.etaSecs).toBeNull();
    expect(p.timePct).toBeNull();
  });
});

describe("governingProgress", () => {
  it("is met only when every rule is met, and reports the slowest", () => {
    const stats = { ratio: 1.2, seedingTimeSecs: 3600, upSpeed: 0, sizeBytes: GB };
    const g = governingProgress(stats, [
      { ratio: 1, seedTimeMins: null },
      { ratio: null, seedTimeMins: 120 },
    ]);
    expect(g.met).toBe(false);
    expect(g.rule).toEqual({ ratio: null, seedTimeMins: 120 });
    expect(g.etaSecs).toBe(3600);
  });
});

describe("ownership and orphans", () => {
  it("recognises the rawkoon category and the per-download tag", () => {
    expect(isRawkoonOwned(torrent())).toBe(true);
    expect(isRawkoonOwned(torrent({ category: null, labels: ["rawkoon-dh-12"] }))).toBe(true);
    expect(isRawkoonOwned(torrent({ category: "tv-sonarr", labels: ["other"] }))).toBe(false);
  });
  it("detects a cross-seed sharing the content path", () => {
    const a = torrent({ hash: "a".repeat(40), contentPath: "/dl/Film/" });
    const b = torrent({ hash: "b".repeat(40), contentPath: "/dl/Film" });
    expect(sharesContentPath(a, [a, b])).toBe(true);
    expect(sharesContentPath(a, [a])).toBe(false);
  });
  it("classifies orphans case-insensitively and ignores foreign torrents", () => {
    const owned = torrent({ hash: "A".repeat(40) });
    const orphan = torrent({ hash: "c".repeat(40) });
    const foreign = torrent({ hash: "d".repeat(40), category: "radarr", labels: [] });
    const out = classifyOrphans([owned, orphan, foreign], new Set(["a".repeat(40)]));
    expect(out.map((t) => t.hash)).toEqual(["c".repeat(40)]);
  });
});

describe("blocked files", () => {
  it("normalizes user input", () => {
    expect(normalizeExtension(" .EXE ")).toBe("exe");
    expect(normalizeExtension("tar.gz")).toBeNull();
    expect(normalizeExtension("")).toBeNull();
  });
  it("matches the final segment's extension only", () => {
    const exts = ["exe", "lnk"];
    expect(findBlockedFile(["Movie/movie.mkv", "Movie/Setup.EXE"], exts)).toBe("Movie/Setup.EXE");
    expect(findBlockedFile(["Movie.exe/movie.mkv"], exts)).toBeNull();
    expect(findBlockedFile(["Movie/movie.mkv"], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/seedPolicy.test.ts`
Expected: FAIL, "Cannot find module …/seedPolicy".

- [ ] **Step 3: Implement `seedPolicy.ts`**

```ts
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

export type Rule = { ratio: number | null; seedTimeMins: number | null };
export type RuleSource = "override" | "private_default" | "public_default";
export interface SeedDefaults {
  publicRule: Rule;
  privateRule: Rule;
}
export interface RuleContext {
  defaults: SeedDefaults;
  overrides: ReadonlyMap<string, Rule>;
  privacy: ReadonlyMap<string, boolean>;
}
export interface SeedStats {
  ratio: number | null;
  seedingTimeSecs: number | null;
  upSpeed: number;
  sizeBytes: number;
}
export interface SeedProgress {
  ratioPct: number | null;
  timePct: number | null;
  lead: "ratio" | "time" | null;
  etaSecs: number | null;
  met: boolean;
}

const RAWKOON_TAG = /^rawkoon-dh-\d+$/i;

export function indexerKey(indexer: string | null | undefined): string | null {
  const key = indexer?.trim().toLowerCase();
  return key ? key : null;
}

export function isIndexerPrivate(
  indexer: string | null | undefined,
  privacy: ReadonlyMap<string, boolean>,
): boolean {
  const key = indexerKey(indexer);
  // Unknown counts as private: seeding too long is the safe mistake.
  return key ? (privacy.get(key) ?? true) : true;
}

export function resolveIndexerRule(
  indexer: string | null | undefined,
  ctx: RuleContext,
): { rule: Rule; source: RuleSource; isPrivate: boolean } {
  const key = indexerKey(indexer);
  const isPrivate = isIndexerPrivate(indexer, ctx.privacy);
  const override = key ? ctx.overrides.get(key) : undefined;
  if (override) return { rule: override, source: "override", isPrivate };
  return isPrivate
    ? { rule: ctx.defaults.privateRule, source: "private_default", isPrivate }
    : { rule: ctx.defaults.publicRule, source: "public_default", isPrivate };
}

export function isSeedTargetMet(stats: SeedStats, rule: Rule): boolean {
  if (rule.ratio == null && rule.seedTimeMins == null) return true;
  if (rule.ratio != null && stats.ratio != null && stats.ratio >= rule.ratio)
    return true;
  return (
    rule.seedTimeMins != null &&
    stats.seedingTimeSecs != null &&
    stats.seedingTimeSecs >= rule.seedTimeMins * 60
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function seedProgress(stats: SeedStats, rule: Rule): SeedProgress {
  const met = isSeedTargetMet(stats, rule);
  const ratioPct =
    rule.ratio != null && rule.ratio > 0 ? clamp01((stats.ratio ?? 0) / rule.ratio) : null;
  const timePct =
    rule.seedTimeMins != null && rule.seedTimeMins > 0
      ? clamp01((stats.seedingTimeSecs ?? 0) / (rule.seedTimeMins * 60))
      : null;
  if (rule.ratio == null && rule.seedTimeMins == null) {
    return { ratioPct, timePct, lead: null, etaSecs: 0, met };
  }
  const etas: Array<{ lead: "ratio" | "time"; secs: number }> = [];
  if (rule.ratio != null) {
    const remaining = Math.max(0, rule.ratio - (stats.ratio ?? 0)) * stats.sizeBytes;
    if (remaining === 0) etas.push({ lead: "ratio", secs: 0 });
    else if (stats.upSpeed > 0) etas.push({ lead: "ratio", secs: Math.round(remaining / stats.upSpeed) });
  }
  if (rule.seedTimeMins != null) {
    etas.push({ lead: "time", secs: Math.max(0, rule.seedTimeMins * 60 - (stats.seedingTimeSecs ?? 0)) });
  }
  if (etas.length === 0) {
    return { ratioPct, timePct, lead: rule.ratio != null ? "ratio" : null, etaSecs: null, met };
  }
  const soonest = etas.reduce((a, b) => (b.secs < a.secs ? b : a));
  return { ratioPct, timePct, lead: soonest.lead, etaSecs: met ? 0 : soonest.secs, met };
}

export function governingProgress(
  stats: SeedStats,
  rules: Rule[],
): SeedProgress & { rule: Rule } {
  const evaluated = rules.map((rule) => ({ rule, p: seedProgress(stats, rule) }));
  const unmet = evaluated.filter((e) => !e.p.met);
  if (unmet.length === 0) {
    const first = evaluated[0] ?? { rule: { ratio: null, seedTimeMins: null }, p: seedProgress(stats, { ratio: null, seedTimeMins: null }) };
    return { ...first.p, met: true, rule: first.rule };
  }
  // Null ETA (unreachable) is the longest wait of all.
  const slowest = unmet.reduce((a, b) =>
    (b.p.etaSecs ?? Number.POSITIVE_INFINITY) > (a.p.etaSecs ?? Number.POSITIVE_INFINITY) ? b : a,
  );
  return { ...slowest.p, met: false, rule: slowest.rule };
}

export function isRawkoonOwned(t: Pick<NormalizedTorrent, "category" | "labels">): boolean {
  if (t.category?.toLowerCase().startsWith("rawkoon-")) return true;
  return t.labels.some((label) => RAWKOON_TAG.test(label.trim()));
}

const normPath = (p: string) => p.replace(/[\\/]+$/, "");

export function sharesContentPath(
  t: NormalizedTorrent,
  all: readonly NormalizedTorrent[],
): boolean {
  if (!t.contentPath) return false;
  const mine = normPath(t.contentPath);
  const hash = t.hash.toLowerCase();
  return all.some(
    (o) => o.hash.toLowerCase() !== hash && o.contentPath != null && normPath(o.contentPath) === mine,
  );
}

export function classifyOrphans(
  torrents: readonly NormalizedTorrent[],
  ownedHashes: ReadonlySet<string>,
): NormalizedTorrent[] {
  return torrents.filter((t) => isRawkoonOwned(t) && !ownedHashes.has(t.hash.toLowerCase()));
}

export function normalizeExtension(raw: string): string | null {
  const ext = raw.trim().toLowerCase().replace(/^\.+/, "");
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
}

export function findBlockedFile(
  files: readonly string[],
  extensions: readonly string[],
): string | null {
  if (extensions.length === 0) return null;
  const blocked = new Set(extensions.map((e) => e.toLowerCase()));
  for (const file of files) {
    const base = file.split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    if (dot === -1 || dot === base.length - 1) continue;
    if (blocked.has(base.slice(dot + 1).toLowerCase())) return file;
  }
  return null;
}

export function statsOf(t: NormalizedTorrent): SeedStats {
  return { ratio: t.ratio, seedingTimeSecs: t.seedingTimeSecs, upSpeed: t.upSpeed, sizeBytes: t.sizeBytes };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && bun test test/seedPolicy.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/seeding/seedPolicy.ts apps/api/test/seedPolicy.test.ts
git commit -m "feat(seeding): pure seed-rule, ownership, orphan and blocked-file policy"
```

---

### Task 4: Indexer privacy lookup

**Files:**
- Create: `apps/api/src/services/seeding/indexerPrivacy.ts`
- Test: `apps/api/test/indexerPrivacy.test.ts`

**Interfaces:**
- Consumes: `getActiveIndexerManager()` from `@rawkoon/api/services/indexerManager` (`getIndexers(): Promise<NormalizedIndexer[]>`, with `name` and `privacy`), and `getJsonCache` / `setJsonCache` from `@rawkoon/api/services/cache`.
- Produces:

```ts
export interface PrivacyDeps {
  getCache: () => Promise<Array<[string, boolean]> | null>;
  setCache: (entries: Array<[string, boolean]>) => Promise<void>;
  listIndexers: () => Promise<Array<{ name: string; privacy: string }> | null>;
}
export async function loadIndexerPrivacy(deps?: PrivacyDeps): Promise<Map<string, boolean>>;
export async function listKnownIndexers(deps?: PrivacyDeps): Promise<Array<{ name: string; isPrivate: boolean }>>;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, mock } from "bun:test";
import { loadIndexerPrivacy, type PrivacyDeps } from "@rawkoon/api/services/seeding/indexerPrivacy";

function deps(o: Partial<PrivacyDeps> = {}): PrivacyDeps {
  return {
    getCache: async () => null,
    setCache: mock(async () => {}),
    listIndexers: async () => [
      { name: "Nimbus", privacy: "private" },
      { name: "Harbor", privacy: "public" },
      { name: "Semi", privacy: "semiPrivate" },
    ],
    ...o,
  };
}

describe("loadIndexerPrivacy", () => {
  it("maps names case-insensitively and treats anything not public as private", async () => {
    const d = deps();
    const map = await loadIndexerPrivacy(d);
    expect(map.get("nimbus")).toBe(true);
    expect(map.get("harbor")).toBe(false);
    expect(map.get("semi")).toBe(true);
    expect(d.setCache).toHaveBeenCalledTimes(1);
  });
  it("serves the cache without listing indexers", async () => {
    const listIndexers = mock(async () => []);
    const map = await loadIndexerPrivacy(deps({ getCache: async () => [["x", false]], listIndexers }));
    expect(map.get("x")).toBe(false);
    expect(listIndexers).not.toHaveBeenCalled();
  });
  it("returns an empty map when the indexer manager is unreachable", async () => {
    const map = await loadIndexerPrivacy(deps({ listIndexers: async () => { throw new Error("down"); } }));
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/indexerPrivacy.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";

const CACHE_KEY = "seeding:indexer-privacy:v1";
const CACHE_TTL_SECS = 3600;

export interface PrivacyDeps {
  getCache: () => Promise<Array<[string, boolean]> | null>;
  setCache: (entries: Array<[string, boolean]>) => Promise<void>;
  listIndexers: () => Promise<Array<{ name: string; privacy: string }> | null>;
}

const defaultDeps: PrivacyDeps = {
  getCache: () => getJsonCache<Array<[string, boolean]>>(CACHE_KEY),
  setCache: (entries) => setJsonCache(CACHE_KEY, entries, CACHE_TTL_SECS),
  listIndexers: async () => {
    const { getActiveIndexerManager } = await import("@rawkoon/api/services/indexerManager");
    const manager = await getActiveIndexerManager();
    return manager ? manager.getIndexers() : null;
  },
};

/** Indexer name (trimmed, lowercased) → isPrivate. Empty when unknown; callers treat absent as private. */
export async function loadIndexerPrivacy(deps: PrivacyDeps = defaultDeps): Promise<Map<string, boolean>> {
  const cached = await deps.getCache().catch(() => null);
  if (cached) return new Map(cached);
  try {
    const list = await deps.listIndexers();
    if (!list) return new Map();
    const entries = list.map(
      (i) => [i.name.trim().toLowerCase(), i.privacy !== "public"] as [string, boolean],
    );
    await deps.setCache(entries).catch(() => {});
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/** Display names for the per-indexer rules table; empty when the manager is unreachable. */
export async function listKnownIndexers(
  deps: PrivacyDeps = defaultDeps,
): Promise<Array<{ name: string; isPrivate: boolean }>> {
  try {
    const list = (await deps.listIndexers()) ?? [];
    return list.map((i) => ({ name: i.name.trim(), isPrivate: i.privacy !== "public" }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && bun test test/indexerPrivacy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/seeding/indexerPrivacy.ts apps/api/test/indexerPrivacy.test.ts
git commit -m "feat(seeding): cached indexer privacy lookup"
```

---

### Task 5: `rejectRelease` janitor

**Files:**
- Create: `apps/api/src/services/downloadJanitor.ts`
- Test: `apps/api/test/downloadJanitor.test.ts`

**Interfaces:**
- Consumes: `failDownload` and `DownloadRef` from `@rawkoon/api/services/downloadOutcome`; `resolveActiveAdapter`; and `isRawkoonOwned`, `sharesContentPath` and `findBlockedFile` from `seedPolicy`.
- Produces:

```ts
export type RejectKind = "stalled" | "malware" | "import_rejected";
export type RejectableDownload = DownloadRef & { torrentHash: string | null; releaseTitle: string; indexer: string | null };
export interface JanitorDeps {
  failDownload: (dh: DownloadRef, reason: string) => Promise<void>;
  createBlocklist: (data: { torrentHash: string | null; releaseTitle: string; indexer: string | null; mediaId: number | null; episodeId: number | null; kind: RejectKind; reason: string }) => Promise<void>;
  hashInUseByOthers: (hash: string, excludeId: number) => Promise<boolean>;
  stampReleased: (id: number, reason: SeedReleaseReason, bytes: bigint | null) => Promise<void>;
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
}
export async function rejectRelease(dh: RejectableDownload, kind: RejectKind, reason: string, deps?: JanitorDeps): Promise<void>;
export async function findBlockedFileInTorrent(hash: string, extensions: readonly string[], adapter: Pick<DownloadClientAdapter, "listFiles">): Promise<string | null>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { DownloadClientAdapter, NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import { rejectRelease, type JanitorDeps } from "@rawkoon/api/services/downloadJanitor";

const HASH = "ab".repeat(20);
function t(o: Partial<NormalizedTorrent> = {}): NormalizedTorrent {
  return { hash: HASH, name: "R", state: "stalled", progress: 0.1, savePath: "/dl", contentPath: "/dl/R",
    seeds: 0, peers: 0, dlSpeed: 0, upSpeed: 0, seedingTimeSecs: null, category: "rawkoon-movies",
    sizeBytes: 1000, labels: [], ratio: 0, ...o };
}

let torrents: NormalizedTorrent[];
let removed: Array<[string, boolean]>;
let deps: JanitorDeps & { calls: string[] };

function adapter(): DownloadClientAdapter {
  return {
    type: "qbittorrent",
    testConnection: async () => ({ ok: true }),
    addTorrent: async () => ({ hash: null }),
    listTorrents: async () => torrents,
    getTorrent: async () => null,
    listFiles: async () => null,
    pause: async () => {},
    resume: async () => {},
    remove: async (h, d) => { removed.push([h, d]); },
  };
}

const dh = { id: 7, mediaId: 3, episodeId: null, torrentHash: HASH.toUpperCase(), releaseTitle: "R", indexer: "Nimbus" };

beforeEach(() => {
  torrents = [t()];
  removed = [];
  const calls: string[] = [];
  deps = {
    calls,
    failDownload: mock(async () => { calls.push("fail"); }),
    createBlocklist: mock(async () => { calls.push("blocklist"); }),
    hashInUseByOthers: mock(async () => false),
    stampReleased: mock(async () => { calls.push("stamp"); }),
    resolveAdapter: async () => adapter(),
  };
});

describe("rejectRelease", () => {
  it("fails, blocklists with its kind, removes with data, and stamps", async () => {
    await rejectRelease(dh, "stalled", "stalled - no progress", deps);
    expect(deps.calls).toEqual(["fail", "blocklist", "stamp"]);
    expect(deps.createBlocklist).toHaveBeenCalledWith(expect.objectContaining({ kind: "stalled", torrentHash: HASH, mediaId: 3 }));
    expect(removed).toEqual([[HASH, true]]);
    expect(deps.stampReleased).toHaveBeenCalledWith(7, "stalled", 1000n);
  });

  it("keeps data when another torrent shares the content path", async () => {
    torrents = [t(), t({ hash: "cd".repeat(20) })];
    await rejectRelease(dh, "malware", "blocked file", deps);
    expect(removed).toEqual([[HASH, false]]);
  });

  it("does not remove a torrent another live row still uses", async () => {
    deps.hashInUseByOthers = mock(async () => true);
    await rejectRelease(dh, "import_rejected", "no video", deps);
    expect(removed).toEqual([]);
    expect(deps.stampReleased).not.toHaveBeenCalled();
    expect(deps.calls).toEqual(["fail", "blocklist"]);
  });

  it("leaves a torrent Rawkoon did not add, stamping it adopted", async () => {
    torrents = [t({ category: "radarr", labels: [] })];
    await rejectRelease(dh, "stalled", "x", deps);
    expect(removed).toEqual([]);
    expect(deps.stampReleased).toHaveBeenCalledWith(7, "adopted", null);
  });

  it("stamps without bytes when the torrent is already gone", async () => {
    torrents = [];
    await rejectRelease(dh, "stalled", "x", deps);
    expect(deps.stampReleased).toHaveBeenCalledWith(7, "stalled", null);
  });

  it("leaves the row unstamped when remove throws", async () => {
    const a = adapter();
    a.remove = async () => { throw new Error("client down"); };
    deps.resolveAdapter = async () => a;
    await rejectRelease(dh, "stalled", "x", deps);
    expect(deps.stampReleased).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/downloadJanitor.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import { type DownloadRef, failDownload } from "@rawkoon/api/services/downloadOutcome";
import {
  findBlockedFile,
  isRawkoonOwned,
  sharesContentPath,
} from "@rawkoon/api/services/seeding/seedPolicy";
import type { SeedReleaseReason } from "@rawkoon/shared/types";

export type RejectKind = "stalled" | "malware" | "import_rejected";
export type RejectableDownload = DownloadRef & {
  torrentHash: string | null;
  releaseTitle: string;
  indexer: string | null;
};

export interface JanitorDeps {
  failDownload: (dh: DownloadRef, reason: string) => Promise<void>;
  createBlocklist: (data: {
    torrentHash: string | null;
    releaseTitle: string;
    indexer: string | null;
    mediaId: number | null;
    episodeId: number | null;
    kind: RejectKind;
    reason: string;
  }) => Promise<void>;
  hashInUseByOthers: (hash: string, excludeId: number) => Promise<boolean>;
  stampReleased: (id: number, reason: SeedReleaseReason, bytes: bigint | null) => Promise<void>;
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
}

const defaultDeps: JanitorDeps = {
  failDownload,
  createBlocklist: async (data) => {
    await prisma.grabBlocklist.create({ data });
  },
  hashInUseByOthers: async (hash, excludeId) =>
    (await prisma.downloadHistory.count({
      where: {
        torrentHash: { equals: hash, mode: "insensitive" },
        id: { not: excludeId },
        failed: false,
        seedReleasedAt: null,
      },
    })) > 0,
  stampReleased: async (id, reason, bytes) => {
    await prisma.downloadHistory.update({
      where: { id },
      data: { seedReleasedAt: new Date(), seedReleaseReason: reason, seedReleasedBytes: bytes },
    });
  },
  resolveAdapter: async () => (await resolveActiveAdapter())?.adapter ?? null,
};

/** Condemn a release: fail the row, blocklist it so search skips it, and clear it from the client. */
export async function rejectRelease(
  dh: RejectableDownload,
  kind: RejectKind,
  reason: string,
  deps: JanitorDeps = defaultDeps,
): Promise<void> {
  const hash = dh.torrentHash?.trim().toLowerCase() || null;
  await deps.failDownload(dh, reason);
  await deps.createBlocklist({
    torrentHash: hash,
    releaseTitle: dh.releaseTitle,
    indexer: dh.indexer,
    mediaId: dh.mediaId,
    episodeId: dh.episodeId,
    kind,
    reason: `auto: ${kind} — ${reason}`,
  });
  if (!hash) return;
  // A season pack re-grabbed as episodes can share one torrent; never pull it from a live row.
  if (await deps.hashInUseByOthers(hash, dh.id)) return;
  const adapter = await deps.resolveAdapter();
  if (!adapter) return;
  try {
    const torrents = await adapter.listTorrents();
    const torrent = torrents.find((t) => t.hash.toLowerCase() === hash);
    if (!torrent) {
      await deps.stampReleased(dh.id, kind, null);
      return;
    }
    if (!isRawkoonOwned(torrent)) {
      await deps.stampReleased(dh.id, "adopted", null);
      return;
    }
    await adapter.remove(torrent.hash, !sharesContentPath(torrent, torrents));
    await deps.stampReleased(dh.id, kind, BigInt(torrent.sizeBytes));
  } catch (error) {
    console.warn(`[downloadJanitor] could not remove rejected torrent ${hash}:`, error);
  }
}

/** The first blocked file in a torrent, or null when clean or metadata is not known yet. */
export async function findBlockedFileInTorrent(
  hash: string,
  extensions: readonly string[],
  adapter: Pick<DownloadClientAdapter, "listFiles">,
): Promise<string | null> {
  if (extensions.length === 0) return null;
  const files = await adapter.listFiles(hash).catch(() => null);
  return files ? findBlockedFile(files, extensions) : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && bun test test/downloadJanitor.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/downloadJanitor.ts apps/api/test/downloadJanitor.test.ts
git commit -m "feat(janitor): rejectRelease fails, blocklists and clears a condemned release"
```

---

### Task 6: Reconcile loop: typed fail kind, rejection, malware pre-check

**Files:**
- Modify: `apps/api/src/workers/checkDownloadCompletion.ts`
- Test: `apps/api/test/reconcilePendingDownloads.test.ts`

**Interfaces:**
- Consumes: `rejectRelease` and `RejectKind` (Task 5), `findBlockedFile` (Task 3), `listFiles` (Task 2).
- Produces:
  - `PendingOutcome` fail becomes `{ outcome: "fail"; reason: string; failKind: "stalled" | "error" }`.
  - `DownloadOutcomeHandlers` gains `rejectRelease: typeof rejectRelease`.
  - `ReconcileState` gains `filesChecked: Set<number>`.
  - `reconcilePendingDownloads` opts gain `listFiles?: (hash: string) => Promise<string[] | null>` and `blockedExtensions?: string[]`.
  - Pending rows gain optional `releaseTitle?: string`, `indexer?: string | null` and `bookEditionId?: number | null`.

- [ ] **Step 1: Update and extend the tests**

In `reconcilePendingDownloads.test.ts`:
- Add `rejected: Array<{ id: number; kind: string; reason: string }>` to `state`, and reset it in `beforeEach`.
- Add to `outcome`:

```ts
  rejectRelease: (dh: { id: number }, kind: string, reason: string) => {
    state.rejected.push({ id: dh.id, kind, reason });
    return Promise.resolve();
  },
```

- Existing tests that expect a stall or max-age timeout to land in `state.failed` now expect `state.rejected` with `kind: "stalled"` instead. The client-error-state test still expects `state.failed`.
- Add these tests inside the `describe`:

```ts
  it("rejects a torrent carrying a blocked file before completing it", async () => {
    state.torrents = [torrent({ state: "completed", progress: 1 })];
    const result = await reconcilePendingDownloads([pendingRow], {
      settings, state: createReconcileState(), listTorrents, outcome,
      listFiles: async () => ["Example/Example.mkv", "Example/Setup.exe"],
      blockedExtensions: ["exe"],
    });
    expect(state.rejected).toEqual([{ id: 1, kind: "malware", reason: "blocked file type: Example/Setup.exe" }]);
    expect(state.completed).toEqual([]);
    expect(result.failed).toBe(1);
  });

  it("retries the file check while metadata is unknown instead of recording it clean", async () => {
    const reconcileState = createReconcileState();
    let calls = 0;
    const listFiles = async () => { calls += 1; return null; };
    state.torrents = [torrent()];
    await reconcilePendingDownloads([pendingRow], { settings, state: reconcileState, listTorrents, outcome, listFiles, blockedExtensions: ["exe"] });
    await reconcilePendingDownloads([pendingRow], { settings, state: reconcileState, listTorrents, outcome, listFiles, blockedExtensions: ["exe"] });
    expect(calls).toBe(2);
    expect(reconcileState.filesChecked.has(1)).toBe(false);
  });

  it("checks a clean torrent's files only once", async () => {
    const reconcileState = createReconcileState();
    let calls = 0;
    const listFiles = async () => { calls += 1; return ["Example/Example.mkv"]; };
    state.torrents = [torrent()];
    await reconcilePendingDownloads([pendingRow], { settings, state: reconcileState, listTorrents, outcome, listFiles, blockedExtensions: ["exe"] });
    await reconcilePendingDownloads([pendingRow], { settings, state: reconcileState, listTorrents, outcome, listFiles, blockedExtensions: ["exe"] });
    expect(calls).toBe(1);
  });

  it("skips the file check when no extensions are blocked", async () => {
    let calls = 0;
    state.torrents = [torrent()];
    await reconcilePendingDownloads([pendingRow], {
      settings, state: createReconcileState(), listTorrents, outcome,
      listFiles: async () => { calls += 1; return ["a.exe"]; }, blockedExtensions: [],
    });
    expect(calls).toBe(0);
  });
```

Add a `classifyPendingAgainstTorrent` assertion wherever the test file already imports it; otherwise import it:

```ts
  it("tags a stall as stalled and a client error as error", () => {
    const track = { createdAtMs: 0, lastProgress: 0.5, lastProgressAtMs: 0 };
    expect(classifyPendingAgainstTorrent(torrent({ state: "stalled" }), track, 120_000, settings)).toMatchObject({ outcome: "fail", failKind: "stalled" });
    expect(classifyPendingAgainstTorrent(torrent({ state: "error" }), track, 1, settings)).toMatchObject({ outcome: "fail", failKind: "error" });
    expect(classifyPendingAgainstTorrent(torrent(), track, 3_600_001, settings)).toMatchObject({ outcome: "fail", failKind: "stalled" });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/reconcilePendingDownloads.test.ts`
Expected: FAIL. There is no `failKind`, no `rejectRelease` path, and no `filesChecked`.

- [ ] **Step 3: Implement in `checkDownloadCompletion.ts`**

1. Add the imports:
```ts
import { rejectRelease } from "@rawkoon/api/services/downloadJanitor";
import { findBlockedFile } from "@rawkoon/api/services/seeding/seedPolicy";
```
2. `DownloadOutcomeHandlers` gains `rejectRelease: typeof rejectRelease;`, and `defaultOutcome` gains `rejectRelease,`.
3. Change `PendingOutcome` to `| { outcome: "fail"; reason: string; failKind: "stalled" | "error" }`. In `classifyPendingAgainstTorrent`, the max-age and stall returns get `failKind: "stalled"`, and the `error` return gets `failKind: "error"`.
4. `ReconcileState` gains:
```ts
  /** Rows whose file list was already checked clean, so the client is asked once. */
  filesChecked: Set<number>;
```
   and `createReconcileState` returns `filesChecked: new Set()`.
5. Widen the `pending` element type:
```ts
    releaseTitle?: string;
    indexer?: string | null;
    bookEditionId?: number | null;
```
   and the `opts` type:
```ts
    listFiles?: (hash: string) => Promise<string[] | null>;
    blockedExtensions?: string[];
```
6. Where the default `listTorrents` is built from `resolveActiveAdapter()`, also build `listFiles` from the same adapter when `opts.listFiles` is undefined:
```ts
  let listFiles = opts.listFiles;
  if (!listTorrents) {
    const active = await resolveActiveAdapter();
    if (!active) return result;
    listTorrents = () => active.adapter.listTorrents();
    listFiles ??= (hash) => active.adapter.listFiles(hash);
  }
  const blocked = opts.blockedExtensions ?? [];
```
7. In the loop, right after the `torrentHash` backfill block and **before** `getOrInitTrack`:
```ts
      if (blocked.length > 0 && listFiles && !state.filesChecked.has(dh.id)) {
        const files = await listFiles(match.hash).catch(() => null);
        if (files) {
          const bad = findBlockedFile(files, blocked);
          if (bad) {
            await outcome.rejectRelease(rejectable(dh), "malware", `blocked file type: ${bad}`);
            state.stallTracks.delete(dh.id);
            result.failed += 1;
            continue;
          }
          state.filesChecked.add(dh.id);
        }
      }
```
   and add this helper above `reconcilePendingDownloads`:
```ts
function rejectable(dh: {
  id: number; mediaId: number | null; episodeId: number | null; torrentHash: string | null;
  releaseTitle?: string; indexer?: string | null; bookEditionId?: number | null;
}) {
  return {
    id: dh.id, mediaId: dh.mediaId, episodeId: dh.episodeId, bookEditionId: dh.bookEditionId ?? null,
    torrentHash: dh.torrentHash, releaseTitle: dh.releaseTitle ?? "", indexer: dh.indexer ?? null,
  };
}
```
8. Replace the `verdict.outcome === "fail"` body:
```ts
      if (verdict.outcome === "fail") {
        if (verdict.failKind === "stalled") {
          await outcome.rejectRelease(rejectable(dh), "stalled", verdict.reason);
        } else {
          await outcome.failDownload(dh, verdict.reason);
        }
        state.stallTracks.delete(dh.id);
        state.filesChecked.delete(dh.id);
        result.failed += 1;
        continue;
      }
```
   Also call `state.filesChecked.delete(dh.id)` next to each other `state.stallTracks.delete(dh.id)` (on missing and on complete).
9. In `runDownloadCompletionPass`, select the fields `rejectable` needs. This also fixes book stall-fails, which never reverted the edition because `bookEditionId` was not selected:
```ts
      select: {
        id: true, mediaId: true, episodeId: true, bookEditionId: true,
        torrentHash: true, grabbedAt: true, releaseTitle: true, indexer: true,
      },
```
   and pass `blockedExtensions: settings?.blockedExtensions ?? []` to `reconcilePendingDownloads`.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && bun test test/reconcilePendingDownloads.test.ts test/reconcileNormalized.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/checkDownloadCompletion.ts apps/api/test/reconcilePendingDownloads.test.ts
git commit -m "feat(janitor): blocklist stalled releases and reject blocked file types before import"
```

---
### Task 7: Seed sweep: planner, runner, manual release, scheduled job

**Files:**
- Create: `apps/api/src/services/seeding/seedSweep.ts`
- Modify: `apps/api/src/services/libraryEvents.ts` (add `emitSeedState`)
- Modify: `apps/api/src/services/queueService.ts`, `apps/api/src/services/jobs/scheduledTasksWorker.ts`, `apps/api/src/routes/admin/adminJobRoutes.ts`
- Test: `apps/api/test/seedSweep.test.ts`

**Interfaces:**
- Consumes: the Task 3 policy, `loadIndexerPrivacy` (Task 4), and the adapter from Task 2.
- Produces:

```ts
// libraryEvents.ts
export interface SeedStateUpdateEvent { torrents: SeedStateItem[]; ts: number }
export function emitSeedState(torrents: SeedStateItem[]): void; // bus event name "seed-state"

// seedSweep.ts
export interface SweepRow { id: number; torrentHash: string; indexer: string | null }
export interface SweepContext extends RuleContext { moveMode: boolean; pendingHashes: ReadonlySet<string> }
export type SweepDecision =
  | { hash: string; action: "stamp"; reason: "manual" | "adopted"; rowIds: number[] }
  | { hash: string; action: "skip"; why: "pending" | "downloading" | "not_met"; rowIds: number[]; torrent: NormalizedTorrent; progress: SeedProgress }
  | { hash: string; action: "release"; reason: "target_met" | "move_mode"; rowIds: number[]; deleteData: boolean; torrent: NormalizedTorrent; progress: SeedProgress };
export interface SweepDeps {
  isEnabled: () => Promise<boolean>;
  loadContext: () => Promise<RuleContext & { moveMode: boolean }>;
  loadRows: (hash?: string) => Promise<SweepRow[]>;
  loadPendingHashes: () => Promise<Set<string>>;
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
  stamp: (rowIds: number[], reason: SeedReleaseReason, bytes: bigint | null) => Promise<void>;
  emit: (items: SeedStateItem[]) => void;
}
export function planSeedReleases(rows: SweepRow[], torrents: NormalizedTorrent[], ctx: SweepContext): SweepDecision[];
export async function loadSeedContext(): Promise<RuleContext & { moveMode: boolean }>;
export const defaultSweepDeps: SweepDeps;
export async function runSeedSweep(deps?: SweepDeps, opts?: { hash?: string }): Promise<SweepDecision[]>;
export async function evaluateSeedRelease(hash: string): Promise<void>;
export type ManualReleaseResult =
  | { status: "released"; freedBytes: number | null }
  | { status: "pending" } | { status: "adopted" } | { status: "not_found" } | { status: "unavailable" };
export async function releaseTorrentNow(hash: string, deps?: SweepDeps): Promise<ManualReleaseResult>;
```

- [ ] **Step 1: Add `emitSeedState` to `libraryEvents.ts`**

```ts
import type { DownloadProgressItem, SeedStateItem } from "@rawkoon/shared/types";

export interface SeedStateUpdateEvent {
  torrents: SeedStateItem[];
  ts: number;
}

/** Live seeding numbers and releases for the admin Seeding view. */
export function emitSeedState(torrents: SeedStateItem[]): void {
  if (torrents.length === 0) return;
  libraryEventBus.emit("seed-state", {
    torrents,
    ts: Date.now(),
  } satisfies SeedStateUpdateEvent);
}
```

Then find every test that mocks this module: `grep -rln 'mock.module("@rawkoon/api/services/libraryEvents"' apps/api/test apps/api/src`. Add `emitSeedState: () => {},` to each factory, so modules importing it still link.

- [ ] **Step 2: Write the failing tests**

`apps/api/test/seedSweep.test.ts`:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { DownloadClientAdapter, NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  planSeedReleases,
  releaseTorrentNow,
  runSeedSweep,
  type SweepContext,
  type SweepDeps,
} from "@rawkoon/api/services/seeding/seedSweep";

const H1 = "11".repeat(20);
const H2 = "22".repeat(20);
const GB = 1024 ** 3;

function t(o: Partial<NormalizedTorrent> = {}): NormalizedTorrent {
  return { hash: H1, name: "T", state: "completed", progress: 1, savePath: "/dl", contentPath: `/dl/${o.hash ?? H1}`,
    seeds: 0, peers: 0, dlSpeed: 0, upSpeed: 0, seedingTimeSecs: 0, category: "rawkoon-movies",
    sizeBytes: GB, labels: [], ratio: 0, ...o };
}

const baseCtx: SweepContext = {
  defaults: { publicRule: { ratio: 1, seedTimeMins: null }, privateRule: { ratio: 1, seedTimeMins: 4320 } },
  overrides: new Map(),
  privacy: new Map([["harbor", false], ["nimbus", true]]),
  moveMode: false,
  pendingHashes: new Set(),
};

describe("planSeedReleases", () => {
  it("stamps rows whose torrent left the client", () => {
    expect(planSeedReleases([{ id: 1, torrentHash: H1, indexer: "Harbor" }], [], baseCtx))
      .toEqual([{ hash: H1, action: "stamp", reason: "manual", rowIds: [1] }]);
  });
  it("matches an uppercase DB hash to a lowercase client hash", () => {
    const [d] = planSeedReleases([{ id: 1, torrentHash: H1.toUpperCase(), indexer: "Harbor" }], [t({ ratio: 1.2 })], baseCtx);
    expect(d).toMatchObject({ action: "release", reason: "target_met", rowIds: [1] });
  });
  it("skips while a sibling row on the hash is still downloading", () => {
    const [d] = planSeedReleases([{ id: 1, torrentHash: H1, indexer: "Harbor" }], [t({ ratio: 5 })], { ...baseCtx, pendingHashes: new Set([H1]) });
    expect(d).toMatchObject({ action: "skip", why: "pending" });
  });
  it("marks torrents Rawkoon did not add as adopted", () => {
    const [d] = planSeedReleases([{ id: 1, torrentHash: H1, indexer: "Harbor" }], [t({ category: "radarr", ratio: 5 })], baseCtx);
    expect(d).toMatchObject({ action: "stamp", reason: "adopted" });
  });
  it("releases immediately in move mode", () => {
    const [d] = planSeedReleases([{ id: 1, torrentHash: H1, indexer: "Nimbus" }], [t()], { ...baseCtx, moveMode: true });
    expect(d).toMatchObject({ action: "release", reason: "move_mode" });
  });
  it("holds a private torrent until its seed time", () => {
    const [d] = planSeedReleases([{ id: 1, torrentHash: H1, indexer: "Nimbus" }], [t({ ratio: 0.2, seedingTimeSecs: 3600 })], baseCtx);
    expect(d).toMatchObject({ action: "skip", why: "not_met" });
  });
  it("requires every owning row's rule to be met", () => {
    const rows = [{ id: 1, torrentHash: H1, indexer: "Harbor" }, { id: 2, torrentHash: H1, indexer: "Nimbus" }];
    const [d] = planSeedReleases(rows, [t({ ratio: 0.5, seedingTimeSecs: 60 })], baseCtx);
    expect(d).toMatchObject({ action: "skip", why: "not_met", rowIds: [1, 2] });
  });
  it("keeps the data of a cross-seeded torrent", () => {
    const shared = [t({ ratio: 2, contentPath: "/dl/Film" }), t({ hash: H2, contentPath: "/dl/Film" })];
    const [d] = planSeedReleases([{ id: 1, torrentHash: H1, indexer: "Harbor" }], shared, baseCtx);
    expect(d).toMatchObject({ action: "release", deleteData: false });
  });
});

describe("runSeedSweep", () => {
  let torrents: NormalizedTorrent[];
  let removed: string[];
  let deps: SweepDeps;
  let adapter: DownloadClientAdapter;

  beforeEach(() => {
    torrents = [t({ ratio: 2 })];
    removed = [];
    adapter = {
      type: "qbittorrent", testConnection: async () => ({ ok: true }), addTorrent: async () => ({ hash: null }),
      listTorrents: async () => torrents, getTorrent: async () => null, listFiles: async () => null,
      pause: async () => {}, resume: async () => {}, remove: async (h) => { removed.push(h); },
    };
    deps = {
      isEnabled: async () => true,
      loadContext: async () => ({ defaults: baseCtx.defaults, overrides: baseCtx.overrides, privacy: baseCtx.privacy, moveMode: false }),
      loadRows: async () => [{ id: 1, torrentHash: H1, indexer: "Harbor" }],
      loadPendingHashes: async () => new Set(),
      resolveAdapter: async () => adapter,
      stamp: mock(async () => {}),
      emit: mock(() => {}),
    };
  });

  it("does nothing while disabled", async () => {
    deps.isEnabled = async () => false;
    expect(await runSeedSweep(deps)).toEqual([]);
    expect(removed).toEqual([]);
  });
  it("releases, stamps with the size, and emits the release", async () => {
    await runSeedSweep(deps);
    expect(removed).toEqual([H1]);
    expect(deps.stamp).toHaveBeenCalledWith([1], "target_met", BigInt(GB));
    expect(deps.emit).toHaveBeenCalledTimes(1);
  });
  it("stamps nothing when the client is unreachable", async () => {
    adapter.listTorrents = async () => { throw new Error("down"); };
    expect(await runSeedSweep(deps)).toEqual([]);
    expect(deps.stamp).not.toHaveBeenCalled();
  });
  it("leaves rows unstamped when remove throws, so the next pass retries", async () => {
    adapter.remove = async () => { throw new Error("busy"); };
    await runSeedSweep(deps);
    expect(deps.stamp).not.toHaveBeenCalled();
  });
});

describe("releaseTorrentNow", () => {
  const adapterWith = (list: NormalizedTorrent[], removed: string[]): DownloadClientAdapter => ({
    type: "qbittorrent", testConnection: async () => ({ ok: true }), addTorrent: async () => ({ hash: null }),
    listTorrents: async () => list, getTorrent: async () => null, listFiles: async () => null,
    pause: async () => {}, resume: async () => {}, remove: async (h) => { removed.push(h); },
  });
  const deps = (o: Partial<SweepDeps>): SweepDeps => ({
    isEnabled: async () => false, // manual release ignores the switch
    loadContext: async () => ({ ...baseCtx }),
    loadRows: async () => [{ id: 9, torrentHash: H1, indexer: "Nimbus" }],
    loadPendingHashes: async () => new Set(),
    resolveAdapter: async () => null,
    stamp: mock(async () => {}),
    emit: () => {},
    ...o,
  });

  it("removes regardless of target and stamps manual", async () => {
    const removed: string[] = [];
    const d = deps({ resolveAdapter: async () => adapterWith([t({ ratio: 0 })], removed) });
    expect(await releaseTorrentNow(H1.toUpperCase(), d)).toEqual({ status: "released", freedBytes: GB });
    expect(removed).toEqual([H1]);
    expect(d.stamp).toHaveBeenCalledWith([9], "manual", BigInt(GB));
  });
  it("refuses while still downloading", async () => {
    expect(await releaseTorrentNow(H1, deps({ loadPendingHashes: async () => new Set([H1]) }))).toEqual({ status: "pending" });
  });
  it("reports unknown hashes", async () => {
    expect(await releaseTorrentNow(H1, deps({ loadRows: async () => [] }))).toEqual({ status: "not_found" });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/api && bun test test/seedSweep.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `seedSweep.ts`**

```ts
import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { DownloadClientAdapter, NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import { emitSeedState } from "@rawkoon/api/services/libraryEvents";
import { loadIndexerPrivacy } from "@rawkoon/api/services/seeding/indexerPrivacy";
import {
  governingProgress,
  isRawkoonOwned,
  resolveIndexerRule,
  type RuleContext,
  type SeedProgress,
  sharesContentPath,
  statsOf,
} from "@rawkoon/api/services/seeding/seedPolicy";
import type { SeedReleaseReason, SeedStateItem } from "@rawkoon/shared/types";

export interface SweepRow {
  id: number;
  torrentHash: string;
  indexer: string | null;
}
export interface SweepContext extends RuleContext {
  moveMode: boolean;
  pendingHashes: ReadonlySet<string>;
}
export type SweepDecision =
  | { hash: string; action: "stamp"; reason: "manual" | "adopted"; rowIds: number[] }
  | { hash: string; action: "skip"; why: "pending" | "downloading" | "not_met"; rowIds: number[]; torrent: NormalizedTorrent; progress: SeedProgress }
  | { hash: string; action: "release"; reason: "target_met" | "move_mode"; rowIds: number[]; deleteData: boolean; torrent: NormalizedTorrent; progress: SeedProgress };

export interface SweepDeps {
  isEnabled: () => Promise<boolean>;
  loadContext: () => Promise<RuleContext & { moveMode: boolean }>;
  loadRows: (hash?: string) => Promise<SweepRow[]>;
  loadPendingHashes: () => Promise<Set<string>>;
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
  stamp: (rowIds: number[], reason: SeedReleaseReason, bytes: bigint | null) => Promise<void>;
  emit: (items: SeedStateItem[]) => void;
}

function groupByHash(rows: SweepRow[]): Map<string, SweepRow[]> {
  const groups = new Map<string, SweepRow[]>();
  for (const row of rows) {
    const key = row.torrentHash.trim().toLowerCase();
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function planSeedReleases(
  rows: SweepRow[],
  torrents: NormalizedTorrent[],
  ctx: SweepContext,
): SweepDecision[] {
  const byHash = new Map(torrents.map((t) => [t.hash.toLowerCase(), t]));
  const decisions: SweepDecision[] = [];
  for (const [hash, group] of groupByHash(rows)) {
    const rowIds = group.map((r) => r.id);
    const torrent = byHash.get(hash);
    if (!torrent) {
      decisions.push({ hash, action: "stamp", reason: "manual", rowIds });
      continue;
    }
    const progress = governingProgress(
      statsOf(torrent),
      group.map((r) => resolveIndexerRule(r.indexer, ctx).rule),
    );
    if (ctx.pendingHashes.has(hash)) {
      decisions.push({ hash, action: "skip", why: "pending", rowIds, torrent, progress });
    } else if (torrent.progress < 1) {
      decisions.push({ hash, action: "skip", why: "downloading", rowIds, torrent, progress });
    } else if (!isRawkoonOwned(torrent)) {
      decisions.push({ hash, action: "stamp", reason: "adopted", rowIds });
    } else if (ctx.moveMode || progress.met) {
      decisions.push({
        hash, action: "release", reason: ctx.moveMode ? "move_mode" : "target_met", rowIds,
        deleteData: !sharesContentPath(torrent, torrents), torrent, progress,
      });
    } else {
      decisions.push({ hash, action: "skip", why: "not_met", rowIds, torrent, progress });
    }
  }
  return decisions;
}

export async function loadSeedContext(): Promise<RuleContext & { moveMode: boolean }> {
  const [settings, overrides, privacy] = await Promise.all([
    prisma.mediaSettings.findUnique({ where: { id: 1 } }),
    prisma.indexerSeedRule.findMany(),
    loadIndexerPrivacy(),
  ]);
  return {
    defaults: {
      // minSeedRatio <= 0 already meant "no ratio target" before this release.
      publicRule: {
        ratio: settings ? (settings.minSeedRatio > 0 ? settings.minSeedRatio : null) : 1,
        seedTimeMins: settings?.publicSeedTimeMins ?? null,
      },
      privateRule: {
        ratio: settings ? settings.privateSeedRatio : 1,
        seedTimeMins: settings ? settings.privateSeedTimeMins : 4320,
      },
    },
    overrides: new Map(
      overrides.map((o) => [o.indexerName.trim().toLowerCase(), { ratio: o.ratio, seedTimeMins: o.seedTimeMins }]),
    ),
    privacy,
    moveMode: settings?.fileOperation === "move",
  };
}

export const defaultSweepDeps: SweepDeps = {
  isEnabled: async () =>
    (await prisma.mediaSettings.findUnique({ where: { id: 1 }, select: { seedSweepEnabled: true } }))
      ?.seedSweepEnabled ?? false,
  loadContext: loadSeedContext,
  loadRows: async (hash) => {
    const rows = await prisma.downloadHistory.findMany({
      where: {
        completedAt: { not: null },
        failed: false,
        seedReleasedAt: null,
        torrentHash: hash ? { equals: hash, mode: "insensitive" } : { not: null },
      },
      select: { id: true, torrentHash: true, indexer: true },
    });
    return rows.flatMap((r) => (r.torrentHash ? [{ id: r.id, torrentHash: r.torrentHash, indexer: r.indexer }] : []));
  },
  loadPendingHashes: async () => {
    const rows = await prisma.downloadHistory.findMany({
      where: { completedAt: null, failed: false, torrentHash: { not: null } },
      select: { torrentHash: true },
    });
    return new Set(rows.flatMap((r) => (r.torrentHash ? [r.torrentHash.toLowerCase()] : [])));
  },
  resolveAdapter: async () => (await resolveActiveAdapter())?.adapter ?? null,
  stamp: async (rowIds, reason, bytes) => {
    await prisma.downloadHistory.updateMany({
      where: { id: { in: rowIds } },
      data: { seedReleasedAt: new Date(), seedReleaseReason: reason, seedReleasedBytes: bytes },
    });
  },
  emit: emitSeedState,
};

function liveItem(torrent: NormalizedTorrent, progress: SeedProgress): SeedStateItem {
  return {
    hash: torrent.hash.toLowerCase(),
    ratio: torrent.ratio,
    seedingTimeSecs: torrent.seedingTimeSecs,
    upSpeed: torrent.upSpeed,
    etaSecs: progress.etaSecs,
  };
}

export async function runSeedSweep(
  deps: SweepDeps = defaultSweepDeps,
  opts: { hash?: string } = {},
): Promise<SweepDecision[]> {
  if (!(await deps.isEnabled())) return [];
  const adapter = await deps.resolveAdapter();
  if (!adapter) return [];
  let torrents: NormalizedTorrent[];
  try {
    torrents = await adapter.listTorrents();
  } catch (error) {
    console.warn("[seedSweep] listTorrents failed, retrying next pass:", error);
    return [];
  }
  const [rows, pendingHashes, base] = await Promise.all([
    deps.loadRows(opts.hash?.toLowerCase()),
    deps.loadPendingHashes(),
    deps.loadContext(),
  ]);
  const decisions = planSeedReleases(rows, torrents, { ...base, pendingHashes });
  const items: SeedStateItem[] = [];
  for (const d of decisions) {
    if (d.action === "stamp") {
      await deps.stamp(d.rowIds, d.reason, null);
    } else if (d.action === "skip") {
      items.push(liveItem(d.torrent, d.progress));
    } else {
      try {
        await adapter.remove(d.torrent.hash, d.deleteData);
        await deps.stamp(d.rowIds, d.reason, BigInt(d.torrent.sizeBytes));
        items.push({
          ...liveItem(d.torrent, d.progress),
          released: { reason: d.reason, at: new Date().toISOString(), freedBytes: d.deleteData ? d.torrent.sizeBytes : null },
        });
      } catch (error) {
        console.warn(`[seedSweep] could not release ${d.hash}, retrying next pass:`, error);
      }
    }
  }
  deps.emit(items);
  return decisions;
}

/** Post-import hook: release right away if the target is already met (or move mode). */
export async function evaluateSeedRelease(hash: string): Promise<void> {
  await runSeedSweep(defaultSweepDeps, { hash });
}

export type ManualReleaseResult =
  | { status: "released"; freedBytes: number | null }
  | { status: "pending" }
  | { status: "adopted" }
  | { status: "not_found" }
  | { status: "unavailable" };

/** "Remove now": an explicit admin action, so it ignores both the target and the sweep switch. */
export async function releaseTorrentNow(
  hash: string,
  deps: SweepDeps = defaultSweepDeps,
): Promise<ManualReleaseResult> {
  const key = hash.trim().toLowerCase();
  const [rows, pending] = await Promise.all([deps.loadRows(key), deps.loadPendingHashes()]);
  if (rows.length === 0) return { status: "not_found" };
  if (pending.has(key)) return { status: "pending" };
  const adapter = await deps.resolveAdapter();
  if (!adapter) return { status: "unavailable" };
  const rowIds = rows.map((r) => r.id);
  const torrents = await adapter.listTorrents();
  const torrent = torrents.find((t) => t.hash.toLowerCase() === key);
  if (!torrent) {
    await deps.stamp(rowIds, "manual", null);
    return { status: "released", freedBytes: null };
  }
  if (!isRawkoonOwned(torrent)) {
    await deps.stamp(rowIds, "adopted", null);
    return { status: "adopted" };
  }
  const deleteData = !sharesContentPath(torrent, torrents);
  await adapter.remove(torrent.hash, deleteData);
  await deps.stamp(rowIds, "manual", BigInt(torrent.sizeBytes));
  const freedBytes = deleteData ? torrent.sizeBytes : null;
  deps.emit([{
    hash: key, ratio: torrent.ratio, seedingTimeSecs: torrent.seedingTimeSecs, upSpeed: torrent.upSpeed, etaSecs: 0,
    released: { reason: "manual", at: new Date().toISOString(), freedBytes },
  }]);
  return { status: "released", freedBytes };
}
```

- [ ] **Step 5: Wire the scheduled job**

In `queueService.ts`, `SCHEDULED_JOB_NAMES` gains:

```ts
  SWEEP_SEEDING_TORRENTS: "sweep-seeding-torrents",
```

In `setupScheduledJobs`, add this `jobs` entry:

```ts
    {
      name: SCHEDULED_JOB_NAMES.SWEEP_SEEDING_TORRENTS,
      // Offset off the RSS poll's :07/:22/... ticks; both list the client's torrents.
      pattern: "3-59/15 * * * *",
    },
```

In `scheduledTasksWorker.ts`, add a case before `default:`:

```ts
      case SCHEDULED_JOB_NAMES.SWEEP_SEEDING_TORRENTS: {
        const { runSeedSweep } = await import("../seeding/seedSweep");
        await runSeedSweep();
        break;
      }
```

In `adminJobRoutes.ts`, `actionMap` gains `sweep_seeding_torrents: SCHEDULED_JOB_NAMES.SWEEP_SEEDING_TORRENTS,`.

- [ ] **Step 6: Run to verify pass**

Run: `cd apps/api && bun test test/seedSweep.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/seeding/seedSweep.ts apps/api/src/services/libraryEvents.ts apps/api/src/services/queueService.ts apps/api/src/services/jobs/scheduledTasksWorker.ts apps/api/src/routes/admin/adminJobRoutes.ts apps/api/test
git commit -m "feat(seeding): sweep releases torrents once every owning rule is met"
```

---

### Task 8: Post-processing: typed rejects, malware gate, post-import release

**Files:**
- Create: `apps/api/src/services/postProcessFailure.ts`
- Modify: `apps/api/src/services/downloadOutcome.ts` (`PostProcessOutcome`, `finishPostProcess`)
- Modify: `apps/api/src/services/postProcessorSingle.ts`, `postProcessorSeasonPack.ts`, `postProcessorBook.ts`
- Test: `apps/api/test/finishPostProcessReject.test.ts` (new); update `apps/api/test/finishPostProcessSkip.test.ts` mocks.

**Interfaces:**
- Consumes: `rejectRelease` and `findBlockedFileInTorrent` (Task 5), and `evaluateSeedRelease` (Task 7). Both are loaded lazily inside `finishPostProcess`, because `downloadJanitor` imports `downloadOutcome`.
- Produces:
  - `export type PostProcessRejectKind = "no_content" | "pack_mismatch";`
  - `export type PostProcessFailure = { success: false; reason: string; rejectKind?: PostProcessRejectKind };`

- [ ] **Step 1: Write the failing test**

`apps/api/test/finishPostProcessReject.test.ts`. It follows the `mock.module` pattern of `finishPostProcessSkip.test.ts`; the preload runs each file isolated.

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test";

const state = {
  rejected: [] as Array<{ id: number; kind: string; reason: string }>,
  postProcessFailedCalls: 0,
  evaluated: [] as string[],
  files: null as string[] | null,
  result: { success: false, reason: "No video file found", rejectKind: "no_content" } as Record<string, unknown>,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findUnique: async () => ({
        mediaId: 42, episodeId: null, season: null, bookEditionId: null, isUpgrade: false,
        torrentHash: "ab".repeat(20), releaseTitle: "Some.Release", indexer: "Nimbus",
      }),
      update: async () => ({ id: 1 }),
    },
    mediaSettings: { findUnique: async () => ({ blockedExtensions: ["exe"] }) },
  },
}));
mock.module("@rawkoon/api/services/postProcessorSingle", () => ({ postProcess: async () => state.result }));
mock.module("@rawkoon/api/services/postProcessorBook", () => ({ postProcessBookDownload: async () => ({ success: false, reason: "unused" }) }));
mock.module("@rawkoon/api/services/libraryEvents", () => ({ emitLibraryUpdate: () => {}, emitBookUpdate: () => {}, emitSeedState: () => {} }));
mock.module("@rawkoon/api/services/jellyfinLibraryRefresh", () => ({ triggerJellyfinLibraryScan: async () => {} }));
mock.module("@rawkoon/api/services/mediaRequests", () => ({ notifyRequestAvailable: async () => {} }));
mock.module("@rawkoon/api/workers/notifyMediaDownloaded", () => ({ notifyAdminsMediaDownloaded: async () => {} }));
mock.module("@rawkoon/api/workers/notifyLibraryEvents", () => ({
  notifyAdminsPostProcessFailed: async () => { state.postProcessFailedCalls += 1; },
  notifyAdminsLibraryDownloadFailed: async () => {},
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => ({ adapter: { listFiles: async () => state.files } }),
}));
mock.module("@rawkoon/api/services/downloadJanitor", () => ({
  rejectRelease: async (dh: { id: number }, kind: string, reason: string) => { state.rejected.push({ id: dh.id, kind, reason }); },
  findBlockedFileInTorrent: async (_h: string, exts: string[], a: { listFiles: () => Promise<string[] | null> }) => {
    const files = await a.listFiles();
    return files?.find((f) => exts.some((e) => f.endsWith(`.${e}`))) ?? null;
  },
}));
mock.module("@rawkoon/api/services/seeding/seedSweep", () => ({
  evaluateSeedRelease: async (hash: string) => { state.evaluated.push(hash); },
}));

const { finishPostProcess } = await import("@rawkoon/api/services/downloadOutcome");

beforeEach(() => {
  state.rejected = [];
  state.postProcessFailedCalls = 0;
  state.evaluated = [];
  state.files = ["Some/Some.mkv"];
  state.result = { success: false, reason: "No video file found", rejectKind: "no_content" };
});

describe("finishPostProcess rejects", () => {
  it("routes a content failure to rejectRelease instead of a post-process-failed notice", async () => {
    await finishPostProcess(1);
    expect(state.rejected).toEqual([{ id: 1, kind: "import_rejected", reason: "No video file found" }]);
    expect(state.postProcessFailedCalls).toBe(0);
  });
  it("keeps environmental failures retryable", async () => {
    state.result = { success: false, reason: "Movies library path not configured" };
    await finishPostProcess(1);
    expect(state.rejected).toEqual([]);
    expect(state.postProcessFailedCalls).toBe(1);
  });
  it("rejects a blocked file before importing anything", async () => {
    state.files = ["Some/Some.mkv", "Some/setup.exe"];
    const out = await finishPostProcess(1);
    expect(out.success).toBe(false);
    expect(state.rejected[0]).toMatchObject({ kind: "malware" });
  });
  it("evaluates the seed release after a successful import", async () => {
    state.result = { success: true, destinationPath: "/m/Some.mkv" };
    await finishPostProcess(1);
    expect(state.evaluated).toEqual(["ab".repeat(20)]);
  });
});
```

In `finishPostProcessSkip.test.ts`, add `emitSeedState: () => {}` to its `libraryEvents` mock. Also add these to that file:

```ts
mock.module("@rawkoon/api/services/seeding/seedSweep", () => ({ evaluateSeedRelease: async () => {} }));
mock.module("@rawkoon/api/services/downloadJanitor", () => ({ rejectRelease: async () => {}, findBlockedFileInTorrent: async () => null }));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({ resolveActiveAdapter: async () => null }));
```

Its `prisma` mock also needs `mediaSettings: { findUnique: async () => null }`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/finishPostProcessReject.test.ts`
Expected: FAIL. The content failure still notifies and is never rejected.

- [ ] **Step 3: Create `postProcessFailure.ts`**

```ts
/** Content failures are the release's fault and get it blocklisted; anything else is retryable. */
export type PostProcessRejectKind = "no_content" | "pack_mismatch";

export type PostProcessFailure = {
  success: false;
  reason: string;
  rejectKind?: PostProcessRejectKind;
};
```

- [ ] **Step 4: Thread `rejectKind` through the post-processors**

- **`postProcessorSingle.ts`:** in `postProcess`'s return type, replace `| { success: false; reason: string }` with `| PostProcessFailure`, importing it from `@rawkoon/api/services/postProcessFailure`. Change `return { success: false, reason: "No video file found" };` to `return { success: false, reason: "No video file found", rejectKind: "no_content" };`. Gate the import-time removal so the sweep owns it once enabled: `if (shouldRemove && !settings.seedSweepEnabled) {`.
- **`postProcessorSeasonPack.ts`:**
  - Replace the failure arm of the return type with `| PostProcessFailure`.
  - Add `seedSweepEnabled: boolean;` to the `settings` parameter type.
  - The "No video files found in torrent folder" return gains `rejectKind: "no_content"`.
  - In `refusePack`, **delete** the `prisma.grabBlocklist.create(...)` call and return `{ success: false as const, reason, rejectKind: "pack_mismatch" as const }`.
  - Update its doc comment: "Abandon the whole pack: record why and return a pack_mismatch reject; finishPostProcess blocklists it through rejectRelease so auto-search does not loop on the same pack."
  - Gate the import-time removal with `&& !settings.seedSweepEnabled`.
- **`postProcessorBook.ts`:**
  - `BookImportResult` gains `rejectKind?: "no_content";`.
  - The "No files found in completed download" and "No importable files in completed download" returns gain `rejectKind: "no_content"`.
  - In `postProcessBookDownload`, replace the failure arm with `| PostProcessFailure` and return `{ success: false, reason: result.error ?? "Import produced no files", ...(result.rejectKind ? { rejectKind: result.rejectKind } : {}) }`.

- [ ] **Step 5: Update `finishPostProcess` in `downloadOutcome.ts`**

1. `PostProcessOutcome`'s failure arm becomes `| PostProcessFailure`.
2. Add `torrentHash: true, releaseTitle: true, indexer: true` to its `findUnique` select.
3. Add this helper above `finishPostProcess`:

```ts
function rejectableFrom(
  id: number,
  dh: { mediaId: number | null; episodeId: number | null; bookEditionId: number | null; torrentHash: string | null; releaseTitle: string; indexer: string | null },
) {
  return { id, mediaId: dh.mediaId, episodeId: dh.episodeId, bookEditionId: dh.bookEditionId, torrentHash: dh.torrentHash, releaseTitle: dh.releaseTitle, indexer: dh.indexer };
}
```

4. Right after the `isUpgrade` line, and **before** the post-processor dispatch:

```ts
    if (dh?.torrentHash) {
      const [{ findBlockedFileInTorrent, rejectRelease }, { resolveActiveAdapter }] = await Promise.all([
        import("@rawkoon/api/services/downloadJanitor"),
        import("@rawkoon/api/services/downloadClient/registry"),
      ]);
      const [active, settings] = await Promise.all([
        resolveActiveAdapter(),
        prisma.mediaSettings.findUnique({ where: { id: 1 }, select: { blockedExtensions: true } }),
      ]);
      const bad = active
        ? await findBlockedFileInTorrent(dh.torrentHash, settings?.blockedExtensions ?? [], active.adapter)
        : null;
      if (bad) {
        const reason = `blocked file type: ${bad}`;
        await prisma.downloadHistory.update({ where: { id: downloadHistoryId }, data: { postProcessError: reason } });
        await rejectRelease(rejectableFrom(downloadHistoryId, dh), "malware", reason);
        return { success: false, reason };
      }
    }
```

5. In `if (!result.success) {`, directly after the `postProcessError` update:

```ts
      if (result.rejectKind && dh) {
        const { rejectRelease } = await import("@rawkoon/api/services/downloadJanitor");
        // rejectRelease → failDownload already notifies admins for media rows.
        await rejectRelease(rejectableFrom(downloadHistoryId, dh), "import_rejected", result.reason);
        if (bookEditionId != null) {
          const { notifyAdminsBookImportFailed } = await import("@rawkoon/api/workers/notifyBookEvents");
          await notifyAdminsBookImportFailed(bookEditionId, result.reason);
        }
        return result;
      }
```

6. Just before `await triggerJellyfinLibraryScan();` on the success path:

```ts
    if (dh?.torrentHash) {
      const { evaluateSeedRelease } = await import("@rawkoon/api/services/seeding/seedSweep");
      await evaluateSeedRelease(dh.torrentHash).catch((e) =>
        console.warn(`[downloadOutcome] seed release check failed dh=${downloadHistoryId}:`, e),
      );
    }
```

- [ ] **Step 6: Run to verify pass**

Run: `cd apps/api && bun test test/finishPostProcessReject.test.ts test/finishPostProcessSkip.test.ts test/postProcessDuplicateSkip.test.ts test/postProcessBookUpgrade.test.ts test/postProcessJobId.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services apps/api/test
git commit -m "feat(janitor): blocklist releases with no importable content and gate blocked files at import"
```

---

### Task 9: `library.seed-state` SSE event (admin-only), plus the iOS contract stub

**Files:**
- Modify: `apps/shared/contracts/sse-contract.v1.json`, `apps/api/src/contracts/sseContract.ts`, `apps/api/src/routes/library/libraryJobWorkerRoutes.ts`
- Modify: `apps/ios/Rawkoon/ServerState/SSEEventRegistry.swift`, `apps/ios/RawkoonTests/LibraryEventMappingTests.swift`
- Test: `apps/api/src/contracts/sseContract.test.ts` (existing; must stay green)

**Interfaces:**
- Consumes: the `"seed-state"` bus event (Task 7).
- Produces: the SSE data frame `{"kind":"seed-state","ts":…,"torrents":[SeedStateItem…]}`, sent **only** to connections whose `c.get("user").is_admin` is true.

- [ ] **Step 1: Add the contract entry**

Append to the array in `apps/shared/contracts/sse-contract.v1.json`:

```json
  {
    "id": "library.seed-state",
    "path": "/api/library/events",
    "routing": { "type": "payload-field", "field": "kind", "value": "seed-state" },
    "payload": { "torrents": "array", "ts": "number" },
    "ios_policy": "invalidate"
  }
```

In `sseContract.ts`, add `"library.seed-state"` to `SSE_ROUTE_DECLARATIONS.libraryEvents.ids`, after `"library.download-progress"`.

- [ ] **Step 2: Run the contract test**

Run: `cd apps/api && bun test src/contracts/sseContract.test.ts`
Expected: PASS. Both the artifact and the declarations list the id.

- [ ] **Step 3: Subscribe admin connections in `libraryJobWorkerRoutes.ts`**

Inside the `/events` handler, next to `onDownloadProgress`:

```ts
    function onSeedState(payload: { torrents: unknown[]; ts: number }) {
      send(`data: ${JSON.stringify({ kind: "seed-state", ...payload })}\n\n`);
    }
    // Seeding data is admin-only; other users never receive it.
    const receivesSeedState = c.get("user")?.is_admin === true;
```

Register it with `if (receivesSeedState) libraryEventBus.on("seed-state", onSeedState);` and unregister it in the abort listener with `libraryEventBus.off("seed-state", onSeedState);` (`off` is a no-op when it was never registered).

- [ ] **Step 4: Add the iOS stub**

In `SSEEventRegistry.swift`, `enum SSEContractID` gains:

```swift
    case librarySeedState = "library.seed-state"
```

No `SSEContractEvent` case is needed. The payload has no `mediaId`, so `LibraryEvent.from` returns nil and the event is ignored on iOS.

In `LibraryEventMappingTests.swift`, add a test next to the existing mapping tests:

```swift
    @Test func seedStateEventIsIgnored() throws {
        let dto = try decode(#"{"kind":"seed-state","ts":1,"torrents":[]}"#)
        #expect(LibraryEvent.from(dto) == nil)
    }
```

`== nil` compiles for any `Optional`, whether or not `LibraryEvent` is `Equatable`.

- [ ] **Step 5: Verify iOS on macbuild**

Push the branch, then run this from **outside** the worktree (the guard blocks remote commands issued from inside it):

```bash
git push -u origin feat/cleanup-release
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH; cd ~/rawkoon && git fetch -q origin \
  && git checkout -q -f -B feat/cleanup-release origin/feat/cleanup-release \
  && git log --oneline -1 && git branch --show-current \
  && cd apps/ios && python3 scripts/check-l10n.py && python3 scripts/check-env-inject.py \
  && swiftformat Rawkoon RawkoonTests Sources Tests --lint && swiftlint lint --quiet | tail -3 \
  && xcodegen generate >/dev/null && rm -rf /tmp/rawkoon-dd-fresh \
  && xcodebuild test -project Rawkoon.xcodeproj -scheme Rawkoon \
     -destination "platform=iOS Simulator,name=iPhone 17" -derivedDataPath /tmp/rawkoon-dd-fresh \
     -only-testing:RawkoonTests/SSEEventRegistryTests -only-testing:RawkoonTests/LibraryEventMappingTests \
     CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|TEST (SUCCEEDED|FAILED)|Executed"'
```

Expected:
- The printed sha is this branch's HEAD, and `git branch --show-current` prints `feat/cleanup-release`.
- Every lint step is clean, and the output ends with `** TEST SUCCEEDED **`.
- If the simulator name is unavailable, list simulators with `xcrun simctl list devices available | grep iPhone` and substitute one.

**Never `git pull` in `macbuild:~/rawkoon`**, because its `main` has diverged. Use `checkout -f -B` as above.

- [ ] **Step 6: Commit**

```bash
git add apps/shared/contracts apps/api/src/contracts apps/api/src/routes/library/libraryJobWorkerRoutes.ts apps/ios
git commit -m "feat(sse): admin-only seed-state event, with an iOS contract stub"
```

---

### Task 10: Library delete keeps seeding rows; null-target audit

**Files:**
- Modify: `apps/api/src/routes/library/libraryListRoutes.ts` (`DELETE /:id`)
- Modify: `apps/api/src/services/seeding/seedSweep.ts` (add `abandonPendingDownloads`)
- Test: `apps/api/test/seedSweep.test.ts` (extend)
- Audit: every `downloadHistory` reader in `apps/api/src`

**Interfaces:**
- Produces:

```ts
export interface AbandonDeps {
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
  markAbandoned: (ids: number[]) => Promise<void>; // failed=true, failReason, seedReleasedAt, reason "manual"
}
export async function abandonPendingDownloads(rows: Array<{ id: number; torrentHash: string | null }>, deps?: AbandonDeps): Promise<void>;
```

- `DELETE /api/library/:id?delete_files=…&release_torrents=true` returns `{ success: true, released: number }`.

- [ ] **Step 1: Write the failing test (Review Focus 2)**

Append to `apps/api/test/seedSweep.test.ts`:

```ts
import { abandonPendingDownloads } from "@rawkoon/api/services/seeding/seedSweep";

describe("abandonPendingDownloads", () => {
  it("fails pending rows and removes their owned torrents with data", async () => {
    const removed: Array<[string, boolean]> = [];
    const marked: number[][] = [];
    await abandonPendingDownloads(
      [{ id: 5, torrentHash: H1.toUpperCase() }, { id: 6, torrentHash: null }],
      {
        resolveAdapter: async () => ({
          type: "qbittorrent", testConnection: async () => ({ ok: true }), addTorrent: async () => ({ hash: null }),
          listTorrents: async () => [t({ progress: 0.3, state: "downloading" })], getTorrent: async () => null,
          listFiles: async () => null, pause: async () => {}, resume: async () => {},
          remove: async (h, d) => { removed.push([h, d]); },
        }),
        markAbandoned: async (ids) => { marked.push(ids); },
      },
    );
    expect(marked).toEqual([[5, 6]]);
    expect(removed).toEqual([[H1, true]]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/seedSweep.test.ts`
Expected: FAIL, `abandonPendingDownloads` is not exported.

- [ ] **Step 3: Implement `abandonPendingDownloads` in `seedSweep.ts`**

```ts
export interface AbandonDeps {
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
  markAbandoned: (ids: number[]) => Promise<void>;
}

const defaultAbandonDeps: AbandonDeps = {
  resolveAdapter: async () => (await resolveActiveAdapter())?.adapter ?? null,
  markAbandoned: async (ids) => {
    await prisma.downloadHistory.updateMany({
      where: { id: { in: ids } },
      data: { failed: true, failReason: "Removed from library", seedReleasedAt: new Date(), seedReleaseReason: "manual" },
    });
  },
};

/** A grab still downloading when its title is removed can never import; stop it instead of letting it finish. */
export async function abandonPendingDownloads(
  rows: Array<{ id: number; torrentHash: string | null }>,
  deps: AbandonDeps = defaultAbandonDeps,
): Promise<void> {
  if (rows.length === 0) return;
  await deps.markAbandoned(rows.map((r) => r.id));
  const hashes = new Set(rows.flatMap((r) => (r.torrentHash ? [r.torrentHash.trim().toLowerCase()] : [])));
  if (hashes.size === 0) return;
  const adapter = await deps.resolveAdapter();
  if (!adapter) return;
  try {
    const torrents = await adapter.listTorrents();
    for (const torrent of torrents) {
      if (!hashes.has(torrent.hash.toLowerCase()) || !isRawkoonOwned(torrent)) continue;
      await adapter.remove(torrent.hash, !sharesContentPath(torrent, torrents));
    }
  } catch (error) {
    console.warn("[seedSweep] could not remove abandoned torrents:", error);
  }
}
```

- [ ] **Step 4: Change `DELETE /:id` in `libraryListRoutes.ts`**

- Extend the query validator to `z.object({ delete_files: z.string().optional(), release_torrents: z.string().optional() })`.
- Change the `downloadHistories` include to select `id`, `torrentHash`, `completedAt`, `failed`, `seedReleasedAt` and `postProcessDestinationPath`.
- Replace the transaction with:

```ts
        const pending = existing.downloadHistories.filter((dh) => dh.completedAt == null && !dh.failed);
        const { abandonPendingDownloads, releaseTorrentNow } = await import("@rawkoon/api/services/seeding/seedSweep");
        await abandonPendingDownloads(pending);

        let released = 0;
        if (c.req.valid("query").release_torrents === "true") {
          const held = new Set(
            existing.downloadHistories
              .filter((dh) => dh.completedAt != null && !dh.failed && dh.seedReleasedAt == null && dh.torrentHash)
              .map((dh) => (dh.torrentHash as string).toLowerCase()),
          );
          for (const hash of held) {
            const result = await releaseTorrentNow(hash).catch(() => null);
            if (result?.status === "released") released += 1;
          }
        }

        // DownloadHistory rows are kept (media_id → NULL) so their torrents keep seeding to target.
        await prisma.libraryMedia.delete({ where: { id } });
        return ok({ success: true, released });
```

- Update the route's leading comment to `// ?release_torrents=true removes still-seeding torrents now instead of at their target`.

- [ ] **Step 5: Audit the null-target readers**

Run: `grep -rn "downloadHistory\.\(findMany\|findFirst\|findUnique\|groupBy\|count\)" apps/api/src | grep -v "\.test\."`

For each hit, confirm one of the following, and fix any that fail:
- It filters by `mediaId`, `episodeId` or `bookEditionId` equal to a concrete id, which excludes null-target rows automatically.
- It already tolerates `media`, `episode` and `bookEdition` being null (look for `!.` non-null assertions on `dh.media` and `dh.bookEdition`).
- It is global. `libraryJobStatsRoutes.ts` (the global download history, whose `media_id`, `media_title` and `media_type` are already nullable) and the SSE broadcaster (which skips `mediaId === null`) are known-good.

Record the list of files checked, and which ones changed, in the task's commit message body.

- [ ] **Step 6: Run to verify pass**

Run: `cd apps/api && bun test test/seedSweep.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat(library): removing a title keeps its torrents seeding to target

Pending grabs for the removed title are failed and their torrents removed, so
they cannot complete later without a target. Audited downloadHistory readers
for null-target rows: <list>."
```

---

### Task 11: `/api/downloads` route domain

**Files:**
- Create: `apps/api/src/services/seeding/seedingView.ts`, `apps/api/src/routes/downloads/index.ts`
- Modify: `apps/api/src/index.ts` (mount)
- Create: `apps/api/e2e/fixtures/downloads.ts`; modify `apps/api/e2e/fixtures/index.ts` and `apps/api/e2e/routes.manifest.json` (regenerated)
- Test: `apps/api/test/seedingView.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4 and 7.
- Produces:
  - Routes, each `requireAdmin`:
    - `GET /api/downloads/seeding?preview=1` returns `SeedingResponse`.
    - `POST /api/downloads/seeding/:hash/release` returns `{ released: true; freed_bytes: number | null }`.
    - `GET /api/downloads/orphans` returns `OrphansResponse`.
    - `POST /api/downloads/orphans/remove` takes `RemoveOrphansRequest` and returns `RemoveOrphansResponse`.
    - `GET /api/downloads/seed-rules` returns `SeedRulesResponse`.
    - `PUT /api/downloads/seed-rules/:indexer` takes `UpsertSeedRuleRequest`.
    - `DELETE /api/downloads/seed-rules/:indexer`.
    - `GET /api/downloads/janitor-stats` returns `JanitorStats`.
  - Pure builders in `seedingView.ts`:

```ts
export interface HeldRow {
  id: number; torrentHash: string; indexer: string | null; grabbedAt: Date;
  mediaId: number | null; episodeId: number | null; bookEditionId: number | null;
  media: { id: number; title: string; year: number | null; posterUrl: string | null; type: string } | null;
  book: { id: number; title: string; coverUrl: string | null; kind: string } | null;
}
export interface CompletedTarget { id: number; mediaId: number | null; episodeId: number | null; bookEditionId: number | null; grabbedAt: Date }
export function supersededIds(held: HeldRow[], completed: CompletedTarget[]): Set<number>;
export function buildSeedingTorrents(rows: HeldRow[], torrents: NormalizedTorrent[], ctx: RuleContext, superseded: ReadonlySet<number>): SeedingTorrent[];
export function buildOrphans(torrents: NormalizedTorrent[], ownedHashes: ReadonlySet<string>): OrphansResponse;
export function buildSeedRuleRows(indexers: Array<{ name: string; isPrivate: boolean }>, overrides: Array<{ indexerName: string; ratio: number | null; seedTimeMins: number | null }>, heldByIndexer: ReadonlyMap<string, number>, ctx: RuleContext): IndexerSeedRuleRow[];
export function toApiRule(rule: Rule): SeedRule;
export function seedStateForRow(row: { failed: boolean; completedAt: Date | null; seedReleasedAt: Date | null; seedReleaseReason: string | null }, torrent: NormalizedTorrent | undefined): DownloadSeedState | null;
```

- [ ] **Step 1: Write the failing view tests**

`apps/api/test/seedingView.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import type { RuleContext } from "@rawkoon/api/services/seeding/seedPolicy";
import {
  buildOrphans, buildSeedRuleRows, buildSeedingTorrents, seedStateForRow, supersededIds, type HeldRow,
} from "@rawkoon/api/services/seeding/seedingView";

const H = "aa".repeat(20);
const GB = 1024 ** 3;
const t = (o: Partial<NormalizedTorrent> = {}): NormalizedTorrent => ({
  hash: H, name: "Film.2160p", state: "completed", progress: 1, savePath: "/dl", contentPath: "/dl/Film",
  seeds: 0, peers: 0, dlSpeed: 0, upSpeed: 1024 ** 2, seedingTimeSecs: 3600, category: "rawkoon-movies",
  sizeBytes: GB, labels: [], ratio: 0.5, ...o,
});
const ctx: RuleContext = {
  defaults: { publicRule: { ratio: 1, seedTimeMins: null }, privateRule: { ratio: 1, seedTimeMins: 4320 } },
  overrides: new Map(), privacy: new Map([["nimbus", true]]),
};
const row = (o: Partial<HeldRow> = {}): HeldRow => ({
  id: 1, torrentHash: H, indexer: "Nimbus", grabbedAt: new Date("2026-01-01"),
  mediaId: 3, episodeId: null, bookEditionId: null,
  media: { id: 3, title: "Film", year: 1922, posterUrl: null, type: "movie" }, book: null, ...o,
});

describe("buildSeedingTorrents", () => {
  it("builds a held row with progress, the lead target and the private flag", () => {
    const [s] = buildSeedingTorrents([row()], [t()], ctx, new Set());
    expect(s).toMatchObject({ title: "Film", year: 1922, kind_label: "movie", is_private: true, owes_seed_time: true, lead: "ratio", eta_secs: 512, target_met: false, rule_source: "private_default" });
    expect(s.rule).toEqual({ ratio: 1, seed_time_mins: 4320 });
  });
  it("badges removed titles and superseded grabs", () => {
    const [s] = buildSeedingTorrents([row({ mediaId: null, media: null })], [t()], ctx, new Set([1]));
    expect(s.badges).toEqual(["removed_from_library", "replaced_by_upgrade"]);
    expect(s.title).toBe("Film.2160p");
  });
  it("omits hashes the client no longer has", () => {
    expect(buildSeedingTorrents([row()], [], ctx, new Set())).toEqual([]);
  });
});

describe("supersededIds", () => {
  it("flags a grab replaced by a newer completed grab for the same target", () => {
    const held = [row({ id: 1, grabbedAt: new Date("2026-01-01") })];
    const completed = [{ id: 2, mediaId: 3, episodeId: null, bookEditionId: null, grabbedAt: new Date("2026-02-01") }];
    expect([...supersededIds(held, completed)]).toEqual([1]);
  });
});

describe("buildOrphans", () => {
  it("lists unowned rawkoon torrents with totals and a shared-data flag", () => {
    const orphan = t({ hash: "bb".repeat(20), contentPath: "/dl/X" });
    const twin = t({ hash: "cc".repeat(20), category: "radarr", contentPath: "/dl/X" });
    const res = buildOrphans([t(), orphan, twin], new Set([H]));
    expect(res.orphans.map((o) => o.hash)).toEqual(["bb".repeat(20)]);
    expect(res.orphans[0].shares_data).toBe(true);
    expect(res.total_bytes).toBe(GB);
  });
});

describe("buildSeedRuleRows", () => {
  it("shows inherited and overridden rules with held counts, including override-only indexers", () => {
    const rows = buildSeedRuleRows(
      [{ name: "Nimbus", isPrivate: true }, { name: "Harbor", isPrivate: false }],
      [{ indexerName: "Gone", ratio: 3, seedTimeMins: null }],
      new Map([["nimbus", 2]]),
      { ...ctx, privacy: new Map([["nimbus", true], ["harbor", false]]) },
    );
    expect(rows.find((r) => r.indexer === "Nimbus")).toMatchObject({ source: "private_default", held_count: 2, override: null });
    expect(rows.find((r) => r.indexer === "Harbor")).toMatchObject({ source: "public_default", held_count: 0 });
    expect(rows.find((r) => r.indexer === "Gone")?.override).toEqual({ ratio: 3, seed_time_mins: null });
  });
});

describe("seedStateForRow", () => {
  const base = { failed: false, completedAt: new Date(), seedReleasedAt: null, seedReleaseReason: null };
  it("is seeding while owned and present", () => {
    expect(seedStateForRow(base, t())).toEqual({ state: "seeding", reason: null, ratio: 0.5, seeding_time_secs: 3600 });
  });
  it("is blocklisted for janitor reasons and released otherwise", () => {
    expect(seedStateForRow({ ...base, failed: true, seedReleasedAt: new Date(), seedReleaseReason: "stalled" }, undefined)?.state).toBe("blocklisted");
    expect(seedStateForRow({ ...base, seedReleasedAt: new Date(), seedReleaseReason: "target_met" }, undefined)?.state).toBe("released");
  });
  it("is null for in-flight rows", () => {
    expect(seedStateForRow({ ...base, completedAt: null }, t({ progress: 0.2 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/seedingView.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `seedingView.ts`**

```ts
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  classifyOrphans, governingProgress, indexerKey, resolveIndexerRule, sharesContentPath, statsOf,
  type Rule, type RuleContext,
} from "@rawkoon/api/services/seeding/seedPolicy";
import type {
  DownloadSeedState, IndexerSeedRuleRow, OrphansResponse, SeedRule, SeedingBadge, SeedingTorrent, SeedReleaseReason,
} from "@rawkoon/shared/types";

export interface HeldRow {
  id: number;
  torrentHash: string;
  indexer: string | null;
  grabbedAt: Date;
  mediaId: number | null;
  episodeId: number | null;
  bookEditionId: number | null;
  media: { id: number; title: string; year: number | null; posterUrl: string | null; type: string } | null;
  book: { id: number; title: string; coverUrl: string | null; kind: string } | null;
}
export interface CompletedTarget {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  bookEditionId: number | null;
  grabbedAt: Date;
}

export const toApiRule = (rule: Rule): SeedRule => ({ ratio: rule.ratio, seed_time_mins: rule.seedTimeMins });

const targetKey = (r: { mediaId: number | null; episodeId: number | null; bookEditionId: number | null }) =>
  r.bookEditionId != null ? `b:${r.bookEditionId}` : r.mediaId != null ? `m:${r.mediaId}:${r.episodeId ?? "-"}` : null;

export function supersededIds(held: HeldRow[], completed: CompletedTarget[]): Set<number> {
  const newest = new Map<string, number>();
  for (const c of completed) {
    const key = targetKey(c);
    if (key) newest.set(key, Math.max(newest.get(key) ?? 0, c.grabbedAt.getTime()));
  }
  const out = new Set<number>();
  for (const h of held) {
    const key = targetKey(h);
    if (key && (newest.get(key) ?? 0) > h.grabbedAt.getTime()) out.add(h.id);
  }
  return out;
}

export function buildSeedingTorrents(
  rows: HeldRow[],
  torrents: NormalizedTorrent[],
  ctx: RuleContext,
  superseded: ReadonlySet<number>,
): SeedingTorrent[] {
  const byHash = new Map(torrents.map((t) => [t.hash.toLowerCase(), t]));
  const groups = new Map<string, HeldRow[]>();
  for (const r of rows) {
    const key = r.torrentHash.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: SeedingTorrent[] = [];
  for (const [hash, group] of groups) {
    const t = byHash.get(hash);
    if (!t) continue;
    const resolved = group.map((r) => resolveIndexerRule(r.indexer, ctx));
    const g = governingProgress(statsOf(t), resolved.map((x) => x.rule));
    const governing = resolved.find((x) => x.rule === g.rule) ?? resolved[0];
    const named = group.find((r) => r.media || r.book) ?? group[0];
    const isPrivate = resolved.some((x) => x.isPrivate);
    const badges: SeedingBadge[] = [];
    if (group.every((r) => r.mediaId == null && r.bookEditionId == null)) badges.push("removed_from_library");
    if (group.some((r) => superseded.has(r.id))) badges.push("replaced_by_upgrade");
    out.push({
      hash,
      name: t.name,
      title: named.media?.title ?? named.book?.title ?? t.name,
      year: named.media?.year ?? null,
      kind_label: named.media
        ? named.media.type === "show" ? "show" : "movie"
        : named.book ? (named.book.kind === "audiobook" ? "audiobook" : "ebook") : null,
      media_id: named.media?.id ?? null,
      book_id: named.book?.id ?? null,
      poster_url: named.media?.posterUrl ?? named.book?.coverUrl ?? null,
      indexer: named.indexer,
      is_private: isPrivate,
      badges,
      rule: toApiRule(g.rule),
      rule_source: governing?.source ?? "private_default",
      ratio: t.ratio,
      seeding_time_secs: t.seedingTimeSecs,
      up_speed: t.upSpeed,
      size_bytes: t.sizeBytes,
      ratio_pct: g.ratioPct,
      time_pct: g.timePct,
      lead: g.lead,
      eta_secs: g.etaSecs,
      target_met: g.met,
      owes_seed_time: isPrivate && !g.met,
    });
  }
  // Soonest release first; unreachable (null ETA) last.
  return out.sort((a, b) => (a.eta_secs ?? Number.POSITIVE_INFINITY) - (b.eta_secs ?? Number.POSITIVE_INFINITY));
}

export function buildOrphans(torrents: NormalizedTorrent[], ownedHashes: ReadonlySet<string>): OrphansResponse {
  const orphans = classifyOrphans(torrents, ownedHashes).map((t) => ({
    hash: t.hash.toLowerCase(),
    name: t.name,
    category: t.category,
    size_bytes: t.sizeBytes,
    ratio: t.ratio,
    seeding_time_secs: t.seedingTimeSecs,
    content_path: t.contentPath,
    shares_data: sharesContentPath(t, torrents),
  }));
  return { orphans, total_bytes: orphans.reduce((sum, o) => sum + o.size_bytes, 0) };
}

export function buildSeedRuleRows(
  indexers: Array<{ name: string; isPrivate: boolean }>,
  overrides: Array<{ indexerName: string; ratio: number | null; seedTimeMins: number | null }>,
  heldByIndexer: ReadonlyMap<string, number>,
  ctx: RuleContext,
): IndexerSeedRuleRow[] {
  const names = new Map<string, string>();
  for (const i of indexers) names.set(i.name.toLowerCase(), i.name);
  for (const o of overrides) if (!names.has(o.indexerName.toLowerCase())) names.set(o.indexerName.toLowerCase(), o.indexerName);
  const overrideByKey = new Map(overrides.map((o) => [o.indexerName.toLowerCase(), o]));
  const privacy = new Map(ctx.privacy);
  for (const i of indexers) privacy.set(i.name.toLowerCase(), i.isPrivate);
  return [...names.entries()]
    .map(([key, name]) => {
      const o = overrideByKey.get(key);
      const resolved = resolveIndexerRule(name, {
        ...ctx,
        privacy,
        overrides: o ? new Map([[key, { ratio: o.ratio, seedTimeMins: o.seedTimeMins }]]) : new Map(),
      });
      return {
        indexer: name,
        is_private: resolved.isPrivate,
        override: o ? { ratio: o.ratio, seed_time_mins: o.seedTimeMins } : null,
        effective: toApiRule(resolved.rule),
        source: resolved.source,
        held_count: heldByIndexer.get(indexerKey(name) ?? "") ?? 0,
      };
    })
    .sort((a, b) => a.indexer.localeCompare(b.indexer));
}

const BLOCKLIST_REASONS = new Set(["stalled", "malware", "import_rejected"]);

export function seedStateForRow(
  row: { failed: boolean; completedAt: Date | null; seedReleasedAt: Date | null; seedReleaseReason: string | null },
  torrent: NormalizedTorrent | undefined,
): DownloadSeedState | null {
  const reason = (row.seedReleaseReason as SeedReleaseReason | null) ?? null;
  if (reason && BLOCKLIST_REASONS.has(reason)) {
    return { state: "blocklisted", reason, ratio: null, seeding_time_secs: null };
  }
  if (row.seedReleasedAt) return { state: "released", reason, ratio: null, seeding_time_secs: null };
  if (row.completedAt && !row.failed && torrent) {
    return { state: "seeding", reason: null, ratio: torrent.ratio, seeding_time_secs: torrent.seedingTimeSecs };
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && bun test test/seedingView.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `routes/downloads/index.ts`**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError, serviceUnavailable } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import { listKnownIndexers } from "@rawkoon/api/services/seeding/indexerPrivacy";
import { indexerKey } from "@rawkoon/api/services/seeding/seedPolicy";
import { defaultSweepDeps, loadSeedContext, planSeedReleases, releaseTorrentNow } from "@rawkoon/api/services/seeding/seedSweep";
import { buildOrphans, buildSeedRuleRows, buildSeedingTorrents, supersededIds } from "@rawkoon/api/services/seeding/seedingView";
import type { ReleasedTorrent, SeedReleaseReason } from "@rawkoon/shared/types";

const RELEASE_REASONS_SHOWN: SeedReleaseReason[] = ["target_met", "manual", "move_mode"];

async function listClientTorrents(): Promise<NormalizedTorrent[] | null> {
  const active = await resolveActiveAdapter();
  if (!active) return [];
  return active.adapter.listTorrents().catch(() => null);
}

async function ownedHashes(): Promise<Set<string>> {
  const rows = await prisma.downloadHistory.findMany({
    where: { failed: false, torrentHash: { not: null } },
    select: { torrentHash: true },
    distinct: ["torrentHash"],
  });
  return new Set(rows.flatMap((r) => (r.torrentHash ? [r.torrentHash.toLowerCase()] : [])));
}

const hashParam = z.object({ hash: z.string().regex(/^[0-9a-fA-F]{40}$/) });
const indexerParam = z.object({ indexer: z.string().min(1).max(200) });
const ruleBody = z.object({
  ratio: z.number().min(0).max(100).nullable(),
  seed_time_mins: z.number().int().min(0).max(525_600).nullable(),
});

// Mounted at /api/downloads. Every route guards itself: a .use('*') guard leaks across .route() merges.
export const downloadsRoutes = new Hono<Env>()
  .get("/seeding", requireAdmin, queryV(z.object({ preview: z.string().optional() })), async (c) => {
    try {
      const torrents = await listClientTorrents();
      if (torrents === null) return serviceUnavailable("Download client is unreachable");
      const [enabled, ctx, rows] = await Promise.all([
        defaultSweepDeps.isEnabled(),
        loadSeedContext(),
        prisma.downloadHistory.findMany({
          where: { completedAt: { not: null }, failed: false, seedReleasedAt: null, torrentHash: { not: null } },
          select: {
            id: true, torrentHash: true, indexer: true, grabbedAt: true, mediaId: true, episodeId: true, bookEditionId: true,
            media: { select: { id: true, title: true, year: true, posterUrl: true, type: true } },
            bookEdition: { select: { kind: true, book: { select: { id: true, title: true, coverUrl: true } } } },
          },
        }),
      ]);
      const held = rows.flatMap((r) =>
        r.torrentHash
          ? [{
              id: r.id, torrentHash: r.torrentHash, indexer: r.indexer, grabbedAt: r.grabbedAt,
              mediaId: r.mediaId, episodeId: r.episodeId, bookEditionId: r.bookEditionId, media: r.media,
              book: r.bookEdition ? { ...r.bookEdition.book, kind: r.bookEdition.kind } : null,
            }]
          : [],
      );
      const mediaIds = [...new Set(held.flatMap((h) => (h.mediaId != null ? [h.mediaId] : [])))];
      const editionIds = [...new Set(held.flatMap((h) => (h.bookEditionId != null ? [h.bookEditionId] : [])))];
      const completed = await prisma.downloadHistory.findMany({
        where: { completedAt: { not: null }, failed: false, OR: [{ mediaId: { in: mediaIds } }, { bookEditionId: { in: editionIds } }] },
        select: { id: true, mediaId: true, episodeId: true, bookEditionId: true, grabbedAt: true },
      });
      const torrentsView = buildSeedingTorrents(held, torrents, ctx, supersededIds(held, completed));

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const releasedRows = await prisma.downloadHistory.findMany({
        where: { seedReleasedAt: { gte: startOfDay }, seedReleaseReason: { in: RELEASE_REASONS_SHOWN } },
        select: {
          torrentHash: true, releaseTitle: true, seedReleaseReason: true, seedReleasedAt: true, seedReleasedBytes: true,
          media: { select: { title: true } }, bookEdition: { select: { book: { select: { title: true } } } },
        },
        orderBy: { seedReleasedAt: "desc" },
      });
      const releasedByHash = new Map<string, ReleasedTorrent>();
      for (const r of releasedRows) {
        const hash = r.torrentHash?.toLowerCase();
        if (!hash || releasedByHash.has(hash) || !r.seedReleasedAt) continue;
        releasedByHash.set(hash, {
          hash,
          title: r.media?.title ?? r.bookEdition?.book.title ?? r.releaseTitle,
          reason: r.seedReleaseReason as SeedReleaseReason,
          released_at: r.seedReleasedAt.toISOString(),
          size_bytes: r.seedReleasedBytes != null ? Number(r.seedReleasedBytes) : null,
        });
      }

      let wouldReleaseNow: { count: number; bytes: number } | undefined;
      if (c.req.valid("query").preview === "1") {
        const pendingHashes = await defaultSweepDeps.loadPendingHashes();
        const plan = planSeedReleases(
          held.map((h) => ({ id: h.id, torrentHash: h.torrentHash, indexer: h.indexer })),
          torrents,
          { ...ctx, pendingHashes },
        );
        const releases = plan.filter((d) => d.action === "release");
        wouldReleaseNow = {
          count: releases.length,
          bytes: releases.reduce((sum, d) => sum + (d.action === "release" ? d.torrent.sizeBytes : 0), 0),
        };
      }

      return ok({
        enabled,
        torrents: torrentsView,
        released_today: [...releasedByHash.values()],
        ...(wouldReleaseNow ? { would_release_now: wouldReleaseNow } : {}),
      });
    } catch (e) {
      console.error("[downloads] seeding list failed:", e);
      return serverError("Failed to load seeding torrents");
    }
  })
  .post("/seeding/:hash/release", requireAdmin, paramV(hashParam), async (c) => {
    try {
      const result = await releaseTorrentNow(c.req.valid("param").hash);
      switch (result.status) {
        case "released":
          return ok({ released: true, freed_bytes: result.freedBytes });
        case "pending":
          return badRequest("Torrent is still downloading");
        case "adopted":
          return badRequest("Rawkoon did not add this torrent; remove it in your download client");
        case "unavailable":
          return serviceUnavailable("Download client is not configured");
        default:
          return notFound("No seeding torrent with that hash");
      }
    } catch (e) {
      console.error("[downloads] release failed:", e);
      return serverError("Failed to remove torrent");
    }
  })
  .get("/orphans", requireAdmin, async () => {
    try {
      const torrents = await listClientTorrents();
      if (torrents === null) return serviceUnavailable("Download client is unreachable");
      return ok(buildOrphans(torrents, await ownedHashes()));
    } catch {
      return serverError("Failed to load orphaned torrents");
    }
  })
  .post(
    "/orphans/remove",
    requireAdmin,
    jsonV(z.object({ hashes: z.array(z.string().regex(/^[0-9a-fA-F]{40}$/)).min(1).max(500), delete_data: z.boolean() })),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const active = await resolveActiveAdapter();
        if (!active) return serviceUnavailable("Download client is not configured");
        const torrents = await active.adapter.listTorrents();
        // Re-classify server-side so this route can never remove a torrent Rawkoon owns.
        const { orphans } = buildOrphans(torrents, await ownedHashes());
        const byHash = new Map(orphans.map((o) => [o.hash, o]));
        const removed: string[] = [];
        const refused: string[] = [];
        let freed = 0;
        for (const raw of body.hashes) {
          const orphan = byHash.get(raw.toLowerCase());
          const torrent = torrents.find((t) => t.hash.toLowerCase() === raw.toLowerCase());
          if (!orphan || !torrent) {
            refused.push(raw.toLowerCase());
            continue;
          }
          const deleteData = body.delete_data && !orphan.shares_data;
          await active.adapter.remove(torrent.hash, deleteData);
          removed.push(orphan.hash);
          if (deleteData) freed += orphan.size_bytes;
        }
        return ok({ removed, refused, freed_bytes: freed });
      } catch {
        return serverError("Failed to remove orphaned torrents");
      }
    },
  )
  .get("/seed-rules", requireAdmin, async () => {
    try {
      const [indexers, overrides, ctx, held] = await Promise.all([
        listKnownIndexers(),
        prisma.indexerSeedRule.findMany(),
        loadSeedContext(),
        prisma.downloadHistory.findMany({
          where: { completedAt: { not: null }, failed: false, seedReleasedAt: null, torrentHash: { not: null } },
          select: { indexer: true, torrentHash: true },
          distinct: ["torrentHash"],
        }),
      ]);
      const heldByIndexer = new Map<string, number>();
      for (const h of held) {
        const key = indexerKey(h.indexer);
        if (key) heldByIndexer.set(key, (heldByIndexer.get(key) ?? 0) + 1);
      }
      return ok({ indexers: buildSeedRuleRows(indexers, overrides, heldByIndexer, ctx) });
    } catch {
      return serverError("Failed to load seed rules");
    }
  })
  .put("/seed-rules/:indexer", requireAdmin, paramV(indexerParam), jsonV(ruleBody), async (c) => {
    const name = c.req.valid("param").indexer.trim();
    const body = c.req.valid("json");
    try {
      const existing = await prisma.indexerSeedRule.findFirst({ where: { indexerName: { equals: name, mode: "insensitive" } } });
      const data = { ratio: body.ratio, seedTimeMins: body.seed_time_mins };
      const rule = existing
        ? await prisma.indexerSeedRule.update({ where: { id: existing.id }, data })
        : await prisma.indexerSeedRule.create({ data: { indexerName: name, ...data } });
      return ok({ rule: { indexer: rule.indexerName, ratio: rule.ratio, seed_time_mins: rule.seedTimeMins } });
    } catch {
      return serverError("Failed to save seed rule");
    }
  })
  .delete("/seed-rules/:indexer", requireAdmin, paramV(indexerParam), async (c) => {
    const name = c.req.valid("param").indexer.trim();
    try {
      const res = await prisma.indexerSeedRule.deleteMany({ where: { indexerName: { equals: name, mode: "insensitive" } } });
      return ok({ deleted: res.count });
    } catch {
      return serverError("Failed to delete seed rule");
    }
  })
  .get("/janitor-stats", requireAdmin, async () => {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const groups = await prisma.grabBlocklist.groupBy({
        by: ["kind"],
        where: { blockedAt: { gte: since }, kind: { not: null } },
        _count: { _all: true },
      });
      const count = (kind: string) => groups.find((g) => g.kind === kind)?._count._all ?? 0;
      return ok({ days: 30, stalled: count("stalled"), malware: count("malware"), import_rejected: count("import_rejected") });
    } catch {
      return serverError("Failed to load janitor stats");
    }
  });
```

In `src/index.ts`:
- Add `import { downloadsRoutes } from "./routes/downloads";` next to the other route imports.
- Add `.route("/api/downloads", downloadsRoutes)` to the chain after `.route("/api/medias", mediasRoutes)`.

- [ ] **Step 6: Add the e2e fixtures and regenerate the manifest**

Run: `cd apps/api && bun run e2e:manifest`
Expected: `e2e/routes.manifest.json` gains the eight `/api/downloads` routes.

Create `apps/api/e2e/fixtures/downloads.ts`:

```ts
import type { FixtureRegistry } from "./types";

const SAMPLE_HASH = "0123456789abcdef0123456789abcdef01234567";

// The download client may or may not be configured when these run (fixture order), so reads
// accept 503 "unreachable" alongside 200, and the write paths accept their not-found/refused outcomes.
export const downloadsFixtures: FixtureRegistry = {
  "GET /api/downloads/seeding": { phase: "read", admin: true, query: { preview: "1" }, expectedStatus: [200, 503], negativeBody: null },
  "POST /api/downloads/seeding/:hash/release": {
    phase: "delete", admin: true, pathParams: () => ({ hash: SAMPLE_HASH }), expectedStatus: 404, negativeBody: null,
  },
  "GET /api/downloads/orphans": { phase: "read", admin: true, expectedStatus: [200, 503], negativeBody: null },
  "POST /api/downloads/orphans/remove": {
    phase: "delete", admin: true, body: () => ({ hashes: [SAMPLE_HASH], delete_data: false }),
    expectedStatus: [200, 503], negativeBody: { hashes: "nope", delete_data: "x" },
  },
  "GET /api/downloads/seed-rules": { phase: "read", admin: true, negativeBody: null },
  "PUT /api/downloads/seed-rules/:indexer": {
    phase: "bootstrap", admin: true, pathParams: () => ({ indexer: "e2e-indexer" }),
    body: () => ({ ratio: 1.5, seed_time_mins: 120 }), negativeBody: { ratio: "high" },
  },
  "DELETE /api/downloads/seed-rules/:indexer": {
    phase: "delete", admin: true, pathParams: () => ({ indexer: "e2e-indexer" }), negativeBody: null,
  },
  "GET /api/downloads/janitor-stats": { phase: "read", admin: true, negativeBody: null },
};
```

Register `downloadsFixtures` in `e2e/fixtures/index.ts` exactly as `mediasFixtures` is imported and spread there.

Run: `cd apps/api && bun test e2e/fixtures/coverage.test.ts`
Expected: PASS. Every manifest route has a fixture.

- [ ] **Step 7: Typecheck and commit**

Run: `bun run typecheck && cd apps/api && bun test test/seedingView.test.ts`
Expected: PASS.

```bash
git add apps/api
git commit -m "feat(api): admin downloads domain for seeding, orphans, seed rules and janitor stats"
```

---

### Task 12: Settings fields, blocklist kind/source, download history seed chip

**Files:**
- Modify: `apps/api/src/routes/library/libraryMediaAdmin.ts` (`mapSettings`, PATCH)
- Modify: `apps/api/src/routes/medias/blocklist/index.ts`
- Modify: `apps/api/src/routes/library/libraryFilesRoutes.ts` (`GET /:id/downloads`)
- Modify: `apps/shared/src/types/library.ts`, `apps/shared/src/types/media.ts`
- Test: `apps/api/test/mapSettings.test.ts` (extend)

**Interfaces:**
- Produces:
  - `MediaPostProcessingSettings` gains `public_seed_time_mins: number | null`, `private_seed_ratio: number | null`, `private_seed_time_mins: number | null`, `seed_sweep_enabled: boolean` and `blocked_extensions: string[]`. `UpdateMediaPostProcessingSettingsRequest` gains the same fields, each optional.
  - `BlocklistEntry` gains `kind: BlocklistKind | null`.
  - `GET /api/medias/blocklist?source=auto|manual`.
  - `LibraryDownloadHistoryItem` gains `seed?: DownloadSeedState | null`.

- [ ] **Step 1: Write the failing `mapSettings` test**

Append to `apps/api/test/mapSettings.test.ts`:

```ts
  it("maps the seeding and download-safety settings", () => {
    const mapped = mapSettings({
      moviesLibraryPath: null, showsLibraryPath: null, downloadsPath: null, fileOperation: "hardlink",
      movieTemplate: "", episodeTemplate: "", minSeedRatio: 1, postProcessingEnabled: true,
      publicSeedTimeMins: null, privateSeedRatio: 1, privateSeedTimeMins: 4320,
      seedSweepEnabled: false, blockedExtensions: ["exe", "lnk"], updatedAt: new Date(0),
    });
    expect(mapped).toMatchObject({
      public_seed_time_mins: null, private_seed_ratio: 1, private_seed_time_mins: 4320,
      seed_sweep_enabled: false, blocked_extensions: ["exe", "lnk"],
    });
  });
```

If the existing tests call `mapSettings` without these fields, make the new parameters optional in the signature (`publicSeedTimeMins?: number | null`, …) and map them as `row.publicSeedTimeMins ?? null`, `row.privateSeedRatio ?? 1`, `row.privateSeedTimeMins ?? 4320`, `row.seedSweepEnabled ?? false` and `row.blockedExtensions ?? []`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && bun test test/mapSettings.test.ts`
Expected: FAIL. The new keys are missing.

- [ ] **Step 3: Implement the settings changes**

In `mapSettings`, add those optional params and the output keys:

```ts
    public_seed_time_mins: row.publicSeedTimeMins ?? null,
    private_seed_ratio: row.privateSeedRatio === undefined ? 1 : row.privateSeedRatio,
    private_seed_time_mins: row.privateSeedTimeMins === undefined ? 4320 : row.privateSeedTimeMins,
    seed_sweep_enabled: row.seedSweepEnabled ?? false,
    blocked_extensions: row.blockedExtensions ?? [],
```

In the PATCH validator, add:

```ts
        public_seed_time_mins: z.number().int().min(0).max(525_600).nullable().optional(),
        private_seed_ratio: z.number().min(0).max(100).nullable().optional(),
        private_seed_time_mins: z.number().int().min(0).max(525_600).nullable().optional(),
        seed_sweep_enabled: z.boolean().optional(),
        blocked_extensions: z.array(z.string().max(12)).max(100).optional(),
```

Extend the `update` type with `publicSeedTimeMins?`, `privateSeedRatio?`, `privateSeedTimeMins?`, `seedSweepEnabled?` and `blockedExtensions?: string[]`, then map each:

```ts
        if (body.public_seed_time_mins !== undefined) update.publicSeedTimeMins = body.public_seed_time_mins;
        if (body.private_seed_ratio !== undefined) update.privateSeedRatio = body.private_seed_ratio;
        if (body.private_seed_time_mins !== undefined) update.privateSeedTimeMins = body.private_seed_time_mins;
        if (body.seed_sweep_enabled !== undefined) update.seedSweepEnabled = body.seed_sweep_enabled;
        if (body.blocked_extensions !== undefined) {
          const normalized = body.blocked_extensions.map(normalizeExtension);
          if (normalized.some((e) => e === null)) {
            return badRequest("blocked_extensions must be file extensions like exe or .lnk");
          }
          update.blockedExtensions = [...new Set(normalized as string[])];
        }
```

Import `normalizeExtension` from `@rawkoon/api/services/seeding/seedPolicy`.

Update the shared `MediaPostProcessingSettings` and `UpdateMediaPostProcessingSettingsRequest` in `apps/shared/src/types/library.ts` with the five fields (optional in the request).

- [ ] **Step 4: Blocklist kind and source**

- In `apps/shared/src/types/media.ts`, `BlocklistEntry` gains `kind: BlocklistKind | null;`, importing `BlocklistKind` from `./seeding`.
- In `routes/medias/blocklist/index.ts`:
  - `formatEntry` takes `kind: string | null` and outputs `kind: e.kind`.
  - The GET becomes:

```ts
  .get("/blocklist", requireAdmin, queryV(z.object({ source: z.enum(["auto", "manual"]).optional() })), async (c) => {
    const source = c.req.valid("query").source;
    try {
      const entries = await prisma.grabBlocklist.findMany({
        where: source === "auto" ? { kind: { not: null } } : source === "manual" ? { kind: null } : {},
        orderBy: { blockedAt: "desc" },
        take: BLOCKLIST_LIMIT,
      });
      return ok({ entries: entries.map(formatEntry) });
    } catch {
      return serverError("Failed to fetch blocklist");
    }
  })
```

  Import `queryV` too. The manual POST keeps `kind` null.

- [ ] **Step 5: Seed chip on the download history**

In `libraryFilesRoutes.ts` `GET /:id/downloads`, the query loads whole rows, so `seedReleasedAt` and `seedReleaseReason` are already on `h`. Change the live-progress block so one `listTorrents()` call serves both the live progress and the seed chip:

```ts
      // Best-effort live numbers: progress for in-flight rows, ratio/seed time for held ones.
      const activeHashes = items
        .filter((h) => !h.completedAt && !h.failed && h.torrentHash)
        .map((h) => h.torrentHash as string);
      const heldHashes = items
        .filter((h) => h.completedAt && !h.failed && !h.seedReleasedAt && h.torrentHash)
        .map((h) => h.torrentHash as string);
      const torrentByHash = new Map<string, NormalizedTorrent>();
```

- Change the guard from `if (activeHashes.length > 0)` to `if (activeHashes.length + heldHashes.length > 0)`.
- Build `wanted` from both lists.
- Inside the `for (const torrent of torrents)` loop, after the `wanted` check, add `torrentByHash.set(torrent.hash.toLowerCase(), torrent);`.
- Fill `liveByHash` only when the torrent's hash is in `activeHashes` (lowercased).
- Import `type NormalizedTorrent` from `@rawkoon/api/services/downloadClient/types`.

Then add to each mapped item:

```ts
          seed: seedStateForRow(h, h.torrentHash ? torrentByHash.get(h.torrentHash.toLowerCase()) : undefined),
```

Import `seedStateForRow` from `@rawkoon/api/services/seeding/seedingView`, and add `seed?: DownloadSeedState | null;` to `LibraryDownloadHistoryItem` in shared `library.ts`.

- [ ] **Step 6: Run to verify pass**

Run: `cd apps/api && bun test test/mapSettings.test.ts test/libraryDownloadsLive.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api apps/shared
git commit -m "feat(api): seeding settings, blocklist kind filter, seed state on download history"
```

---
### Task 13: Web data layer: endpoints, keys, hooks, formatters, SSE merge, locale strings

**Files:**
- Modify: `apps/web/src/lib/endpoints/downloads.ts`, `apps/web/src/lib/queryKeys.ts`, `apps/web/src/features/medias/hooks/useLibraryEvents.ts`, `apps/web/src/features/medias/hooks/useBlocklist.ts`
- Create: `apps/web/src/features/seeding/lib/seedFormat.ts`, `ruleDraft.ts`, `mergeSeedState.ts`
- Create: `apps/web/src/features/seeding/hooks/useSeeding.ts`, `useOrphans.ts`, `useSeedRules.ts`, `useJanitorStats.ts`
- Modify: `apps/web/src/locales/en/common.json`, `apps/web/src/locales/fr/common.json`
- Test: `apps/web/src/features/seeding/lib/seedFormat.test.ts`, `ruleDraft.test.ts`, `mergeSeedState.test.ts`

**Interfaces:**
- Produces:

```ts
// seedFormat.ts
type T = (key: string, opts?: Record<string, unknown>) => string;
export function formatSeedDuration(secs: number, t: T): string;       // "45 min" | "31 h" | "3.1 days"
export function meterTimeLabel(seededSecs: number, targetMins: number, t: T): string; // "41 h / 72 h" | "3.1 / 7 d"
// ruleDraft.ts
export type TimeUnit = "hours" | "days";
export interface RuleDraft { ratio: string; time: string; unit: TimeUnit }
export function draftFromRule(rule: SeedRule): RuleDraft;
export function ruleFromDraft(draft: RuleDraft): SeedRule | null; // null = invalid input
export function ruleSentence(rule: SeedRule, t: T): string;
export function formatTargetTime(mins: number, t: T): string;
// mergeSeedState.ts
export function mergeSeedState(current: SeedingResponse | undefined, event: SeedStateEvent): SeedingResponse | undefined;
// hooks
export function useSeeding(opts?: { preview?: boolean; enabled?: boolean }): UseQueryResult<SeedingResponse>;
export function useReleaseTorrent(): UseMutationResult<{ released: true; freed_bytes: number | null }, Error, string>;
export function useOrphans(opts?: { enabled?: boolean }): UseQueryResult<OrphansResponse>;
export function useRemoveOrphans(): UseMutationResult<RemoveOrphansResponse, Error, RemoveOrphansRequest>;
export function useSeedRules(): UseQueryResult<SeedRulesResponse>;
export function useUpsertSeedRule(): UseMutationResult<unknown, Error, { indexer: string; rule: UpsertSeedRuleRequest }>;
export function useDeleteSeedRule(): UseMutationResult<unknown, Error, string>;
export function useJanitorStats(): UseQueryResult<JanitorStats>;
// queryKeys.downloads
seeding: (preview?: boolean) => readonly ["downloads", "seeding", boolean];
orphans: () => readonly ["downloads", "orphans"];
seedRules: () => readonly ["downloads", "seed-rules"];
janitorStats: () => readonly ["downloads", "janitor-stats"];
// queryKeys.blocklist.list(source?: "auto" | "manual")
```

- [ ] **Step 1: Write the failing pure-function tests**

`seedFormat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatSeedDuration, meterTimeLabel } from "./seedFormat";

const t = (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.count ?? ""}`;

describe("formatSeedDuration", () => {
  it("uses minutes, hours, then days", () => {
    expect(formatSeedDuration(45 * 60, t)).toBe("seeding.duration.minutes:45");
    expect(formatSeedDuration(31 * 3600, t)).toBe("seeding.duration.hours:31");
    expect(formatSeedDuration(3.1 * 86400, t)).toBe("seeding.duration.days:3.1");
  });
  it("never shows zero minutes", () => {
    expect(formatSeedDuration(10, t)).toBe("seeding.duration.minutes:1");
  });
});

describe("meterTimeLabel", () => {
  it("shows hours for targets under four days, days above", () => {
    const u = (key: string) => (key === "seeding.units.hours" ? "h" : "d");
    expect(meterTimeLabel(41 * 3600 + 59, 4320, u)).toBe("41 h / 72 h");
    expect(meterTimeLabel(3.1 * 86400, 10080, u)).toBe("3.1 / 7 d");
  });
});
```

`ruleDraft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { draftFromRule, ruleFromDraft, ruleSentence } from "./ruleDraft";

const t = (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ""}`;

describe("rule drafts", () => {
  it("prefers days when the minutes divide evenly", () => {
    expect(draftFromRule({ ratio: 1, seed_time_mins: 4320 })).toEqual({ ratio: "1", time: "3", unit: "days" });
    expect(draftFromRule({ ratio: null, seed_time_mins: 90 })).toEqual({ ratio: "", time: "1.5", unit: "hours" });
  });
  it("parses empty fields as no target and rejects garbage", () => {
    expect(ruleFromDraft({ ratio: "", time: "", unit: "days" })).toEqual({ ratio: null, seed_time_mins: null });
    expect(ruleFromDraft({ ratio: "1.5", time: "2", unit: "days" })).toEqual({ ratio: 1.5, seed_time_mins: 2880 });
    expect(ruleFromDraft({ ratio: "abc", time: "", unit: "days" })).toBeNull();
    expect(ruleFromDraft({ ratio: "-1", time: "", unit: "days" })).toBeNull();
  });
});

describe("ruleSentence", () => {
  it("covers all four combinations", () => {
    expect(ruleSentence({ ratio: 1, seed_time_mins: 4320 }, t)).toContain("settings.seeding.sentence.both");
    expect(ruleSentence({ ratio: 1, seed_time_mins: null }, t)).toContain("settings.seeding.sentence.ratio");
    expect(ruleSentence({ ratio: null, seed_time_mins: 60 }, t)).toContain("settings.seeding.sentence.time");
    expect(ruleSentence({ ratio: null, seed_time_mins: null }, t)).toBe("settings.seeding.sentence.none");
  });
});
```

`mergeSeedState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SeedingResponse, SeedingTorrent } from "@rawkoon/shared/types";
import { mergeSeedState } from "./mergeSeedState";

const row = (o: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash: "aa", name: "n", title: "Film", year: 1922, kind_label: "movie", media_id: 1, book_id: null, poster_url: null,
  indexer: "Nimbus", is_private: true, badges: [], rule: { ratio: 1, seed_time_mins: 4320 }, rule_source: "private_default",
  ratio: 0.5, seeding_time_secs: 3600, up_speed: 10, size_bytes: 100, ratio_pct: 0.5, time_pct: 1 / 72,
  lead: "ratio", eta_secs: 50, target_met: false, owes_seed_time: true, ...o,
});
const base: SeedingResponse = { enabled: true, torrents: [row(), row({ hash: "bb", eta_secs: 10 })], released_today: [] };

describe("mergeSeedState", () => {
  it("patches live numbers and recomputes progress", () => {
    const next = mergeSeedState(base, { kind: "seed-state", ts: 1, torrents: [{ hash: "aa", ratio: 0.75, seedingTimeSecs: 7200, upSpeed: 5, etaSecs: 20 }] });
    const aa = next?.torrents.find((t) => t.hash === "aa");
    expect(aa).toMatchObject({ ratio: 0.75, ratio_pct: 0.75, seeding_time_secs: 7200, up_speed: 5, eta_secs: 20 });
  });
  it("moves a released torrent into released_today", () => {
    const next = mergeSeedState(base, {
      kind: "seed-state", ts: 1,
      torrents: [{ hash: "bb", ratio: 1, seedingTimeSecs: 1, upSpeed: 0, etaSecs: 0, released: { reason: "target_met", at: "2026-01-01T00:00:00.000Z", freedBytes: 100 } }],
    });
    expect(next?.torrents.map((t) => t.hash)).toEqual(["aa"]);
    expect(next?.released_today[0]).toMatchObject({ hash: "bb", title: "Film", reason: "target_met", size_bytes: 100 });
  });
  it("leaves an unknown cache untouched", () => {
    expect(mergeSeedState(undefined, { kind: "seed-state", ts: 1, torrents: [] })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/seeding/lib`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the pure modules**

`seedFormat.ts`:

```ts
type T = (key: string, opts?: Record<string, unknown>) => string;

export function formatSeedDuration(secs: number, t: T): string {
  if (secs < 3600) return t("seeding.duration.minutes", { count: Math.max(1, Math.round(secs / 60)) });
  if (secs < 48 * 3600) return t("seeding.duration.hours", { count: Math.round(secs / 3600) });
  return t("seeding.duration.days", { count: Math.round((secs / 86400) * 10) / 10 });
}

/** Same unit on both sides, so "3 days / 3 days" can never hide the last hour. */
export function meterTimeLabel(seededSecs: number, targetMins: number, t: T): string {
  if (targetMins < 96 * 60) {
    return `${Math.floor(seededSecs / 3600)} ${t("seeding.units.hours")} / ${Math.round(targetMins / 60)} ${t("seeding.units.hours")}`;
  }
  return `${(seededSecs / 86400).toFixed(1)} / ${Math.round(targetMins / 1440)} ${t("seeding.units.days")}`;
}
```

`ruleDraft.ts`:

```ts
import type { SeedRule } from "@rawkoon/shared/types";

type T = (key: string, opts?: Record<string, unknown>) => string;
export type TimeUnit = "hours" | "days";
export interface RuleDraft {
  ratio: string;
  time: string;
  unit: TimeUnit;
}

export function draftFromRule(rule: SeedRule): RuleDraft {
  const mins = rule.seed_time_mins;
  const days = mins != null && mins % 1440 === 0;
  return {
    ratio: rule.ratio == null ? "" : String(rule.ratio),
    time: mins == null ? "" : String(days ? mins / 1440 : mins / 60),
    unit: mins == null || days ? "days" : "hours",
  };
}

const parse = (raw: string): number | null | undefined => {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function ruleFromDraft(draft: RuleDraft): SeedRule | null {
  const ratio = parse(draft.ratio);
  const time = parse(draft.time);
  if (ratio === undefined || time === undefined) return null;
  return {
    ratio,
    seed_time_mins: time == null ? null : Math.round(time * (draft.unit === "days" ? 1440 : 60)),
  };
}

export function formatTargetTime(mins: number, t: T): string {
  return mins % 1440 === 0
    ? t("settings.seeding.days", { count: mins / 1440 })
    : t("settings.seeding.hours", { count: Math.round((mins / 60) * 10) / 10 });
}

export function ruleSentence(rule: SeedRule, t: T): string {
  const ratio = rule.ratio == null ? null : rule.ratio.toFixed(1);
  const time = rule.seed_time_mins == null ? null : formatTargetTime(rule.seed_time_mins, t);
  if (ratio && time) return t("settings.seeding.sentence.both", { ratio, time });
  if (ratio) return t("settings.seeding.sentence.ratio", { ratio });
  if (time) return t("settings.seeding.sentence.time", { time });
  return t("settings.seeding.sentence.none");
}
```

`mergeSeedState.ts`:

```ts
import type { ReleasedTorrent, SeedingResponse, SeedStateEvent } from "@rawkoon/shared/types";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Fold a seed-state push into the cached Seeding list without a refetch. */
export function mergeSeedState(
  current: SeedingResponse | undefined,
  event: SeedStateEvent,
): SeedingResponse | undefined {
  if (!current) return current;
  const updates = new Map(event.torrents.map((i) => [i.hash, i]));
  const released: ReleasedTorrent[] = [];
  const torrents = current.torrents.flatMap((row) => {
    const item = updates.get(row.hash);
    if (!item) return [row];
    if (item.released) {
      released.push({
        hash: row.hash, title: row.title, reason: item.released.reason,
        released_at: item.released.at, size_bytes: item.released.freedBytes ?? row.size_bytes,
      });
      return [];
    }
    const ratio_pct = row.rule.ratio ? clamp01((item.ratio ?? 0) / row.rule.ratio) : null;
    const time_pct = row.rule.seed_time_mins ? clamp01((item.seedingTimeSecs ?? 0) / (row.rule.seed_time_mins * 60)) : null;
    const target_met = row.target_met || item.etaSecs === 0;
    return [{
      ...row, ratio: item.ratio, seeding_time_secs: item.seedingTimeSecs, up_speed: item.upSpeed,
      eta_secs: item.etaSecs, ratio_pct, time_pct, target_met, owes_seed_time: row.is_private && !target_met,
    }];
  });
  torrents.sort((a, b) => (a.eta_secs ?? Number.POSITIVE_INFINITY) - (b.eta_secs ?? Number.POSITIVE_INFINITY));
  const seen = new Set(released.map((r) => r.hash));
  return {
    ...current,
    torrents,
    released_today: [...released, ...current.released_today.filter((r) => !seen.has(r.hash))],
  };
}
```

- [ ] **Step 4: Endpoints, keys and hooks**

`lib/endpoints/downloads.ts`:

```ts
export const DOWNLOADS_ENDPOINTS = {
  SPEED: "/api/dashboard/downloads/speed",
  SEEDING: "/api/downloads/seeding",
  RELEASE: (hash: string) => `/api/downloads/seeding/${hash}/release`,
  ORPHANS: "/api/downloads/orphans",
  REMOVE_ORPHANS: "/api/downloads/orphans/remove",
  SEED_RULES: "/api/downloads/seed-rules",
  SEED_RULE: (indexer: string) => `/api/downloads/seed-rules/${encodeURIComponent(indexer)}`,
  JANITOR_STATS: "/api/downloads/janitor-stats",
} as const;
```

`queryKeys.downloads` becomes:

```ts
  downloads: {
    all: ["downloads"] as const,
    speed: () => [...queryKeys.downloads.all, "speed"] as const,
    seeding: (preview?: boolean) => [...queryKeys.downloads.all, "seeding", preview ?? false] as const,
    orphans: () => [...queryKeys.downloads.all, "orphans"] as const,
    seedRules: () => [...queryKeys.downloads.all, "seed-rules"] as const,
    janitorStats: () => [...queryKeys.downloads.all, "janitor-stats"] as const,
  },
```

and `queryKeys.blocklist.list` becomes `(source?: "auto" | "manual") => [...queryKeys.blocklist.all, "list", source ?? "all"] as const`.

`hooks/useSeeding.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SeedingResponse } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useSeeding(opts: { preview?: boolean; enabled?: boolean } = {}) {
  const fetcher = useFetcher();
  const preview = opts.preview ?? false;
  return useQuery({
    queryKey: queryKeys.downloads.seeding(preview),
    queryFn: () => fetcher<SeedingResponse>(`${DOWNLOADS_ENDPOINTS.SEEDING}${preview ? "?preview=1" : ""}`),
    enabled: opts.enabled ?? true,
    // Seed-state pushes patch this cache; the slow poll only catches drift between sweeps.
    refetchInterval: 60_000,
  });
}

export function useReleaseTorrent() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hash: string) =>
      fetcher<{ released: true; freed_bytes: number | null }>(DOWNLOADS_ENDPOINTS.RELEASE(hash), { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.downloads.all }),
  });
}
```

`hooks/useOrphans.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrphansResponse, RemoveOrphansRequest, RemoveOrphansResponse } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useOrphans(opts: { enabled?: boolean } = {}) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.downloads.orphans(),
    queryFn: () => fetcher<OrphansResponse>(DOWNLOADS_ENDPOINTS.ORPHANS),
    enabled: opts.enabled ?? true,
  });
}

export function useRemoveOrphans() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RemoveOrphansRequest) =>
      fetcher<RemoveOrphansResponse>(DOWNLOADS_ENDPOINTS.REMOVE_ORPHANS, { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.downloads.orphans() }),
  });
}
```

`hooks/useSeedRules.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SeedRulesResponse, UpsertSeedRuleRequest } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useSeedRules() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.downloads.seedRules(),
    queryFn: () => fetcher<SeedRulesResponse>(DOWNLOADS_ENDPOINTS.SEED_RULES),
  });
}

function useInvalidateSeeding() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.downloads.all });
}

export function useUpsertSeedRule() {
  const fetcher = useFetcher();
  const invalidate = useInvalidateSeeding();
  return useMutation({
    mutationFn: ({ indexer, rule }: { indexer: string; rule: UpsertSeedRuleRequest }) =>
      fetcher(DOWNLOADS_ENDPOINTS.SEED_RULE(indexer), { method: "PUT", body: rule }),
    onSuccess: invalidate,
  });
}

export function useDeleteSeedRule() {
  const fetcher = useFetcher();
  const invalidate = useInvalidateSeeding();
  return useMutation({
    mutationFn: (indexer: string) => fetcher(DOWNLOADS_ENDPOINTS.SEED_RULE(indexer), { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
```

`hooks/useJanitorStats.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import type { JanitorStats } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useJanitorStats() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.downloads.janitorStats(),
    queryFn: () => fetcher<JanitorStats>(DOWNLOADS_ENDPOINTS.JANITOR_STATS),
  });
}
```

`useBlocklist.ts`: extend the options with `source?: "auto" | "manual"`. Use `queryKey: queryKeys.blocklist.list(options?.source)` and `queryFn: () => fetcher<BlocklistListResponse>(options?.source ? `${MEDIAS_ENDPOINTS.BLOCKLIST}?source=${options.source}` : MEDIAS_ENDPOINTS.BLOCKLIST)`. Destructure `source` out before spreading the rest into `useQuery`. Mutations already invalidate `queryKeys.blocklist.all`, which covers every source.

- [ ] **Step 5: SSE merge in `useLibraryEvents.ts`**

- Widen the payload type: `kind?: "media" | "book" | "download-progress" | "seed-state"; torrents?: SeedStateItem[]; ts?: number;`.
- Before the `payload.kind === "book"` branch, add:

```ts
        if (payload.kind === "seed-state" && payload.torrents) {
          const event: SeedStateEvent = { kind: "seed-state", ts: payload.ts ?? Date.now(), torrents: payload.torrents };
          queryClient.setQueriesData<SeedingResponse>(
            { queryKey: [...queryKeys.downloads.all, "seeding"] },
            (current) => mergeSeedState(current, event),
          );
          if (payload.torrents.some((i) => i.released)) {
            queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
          }
          return;
        }
```

  Import `SeedingResponse`, `SeedStateEvent` and `SeedStateItem` from `@rawkoon/shared/types`, and `mergeSeedState` from `@/features/seeding/lib/mergeSeedState`.
- Add a case to the existing `useLibraryEvents` test file, if one exists (search for `useLibraryEvents` in `*.test.ts*`). The case dispatches a `seed-state` message and asserts that `setQueriesData` updated a seeded `seeding(false)` cache.

- [ ] **Step 6: Locale strings**

Run this once from the repo root. It deep-merges into both files and keeps key order; then run Biome to format:

```bash
python3 - <<'EOF'
import json
EN = {
 "downloadsPage": {"title": "Downloads", "subtitle": "What's in your download client, and what Rawkoon still needs from it.",
   "tabs": {"import": "Import", "seeding": "Seeding", "orphans": "Orphans"}},
 "seeding": {
   "summary_one": "Holding {{count}} torrent ({{size}}) until it meets its seed target.",
   "summary_other": "Holding {{count}} torrents ({{size}}) until they meet their seed targets.",
   "summaryOwed": "{{count}} still owe seed time on private trackers.",
   "summaryNext": "The next one releases in about {{time}}.",
   "live": "Live",
   "filters": {"all": "All", "owed": "Owes seed time", "removed": "From removed titles", "idle": "Not uploading"},
   "badges": {"removed_from_library": "Removed from library", "replaced_by_upgrade": "Replaced by an upgrade", "owes": "Owes seed time"},
   "meter": {"ratio": "Ratio", "time": "Time", "noTarget": "no target"},
   "units": {"hours": "h", "days": "d"},
   "eta": {"met": "Target met. Removing on the next check.", "idle": "Not uploading, so it can't reach its ratio.",
     "ratio": "Releases in about {{time}}, on ratio", "time": "Releases in about {{time}}, on seed time"},
   "idleHint": "Nobody is downloading from it, so it can't reach its ratio.",
   "idleHintLink": "Add a seed-time target",
   "removeNow": "Remove now",
   "confirmTitle": "Remove {{title}} from the download client?",
   "confirmBody": "The torrent and its downloaded files are removed. Your library copy stays.",
   "confirmHnr": "{{indexer}} is a private tracker and this torrent hasn't met its target. Removing it now can count as a hit-and-run.",
   "confirmLabel": "Remove now",
   "removed": "Removed {{title}} from the download client.",
   "removeError": "Couldn't remove the torrent.",
   "releasedToday": "Released today: {{count}}",
   "freed": "{{size}} freed",
   "releasedReason": {"target_met": "Target met", "manual": "Removed by you", "move_mode": "Move mode"},
   "empty": {"title": "Nothing is seeding", "description": "Torrents appear here after import, while they seed toward their targets."},
   "disabled": {"title": "Automatic release is off", "description": "Torrents stay in your download client until you remove them.", "action": "Turn it on in settings"},
   "unreachable": "The download client isn't reachable, so seeding numbers can't be shown.",
   "duration": {"minutes_one": "{{count}} min", "minutes_other": "{{count}} min", "hours_one": "{{count}} h", "hours_other": "{{count}} h",
     "days_one": "{{count}} day", "days_other": "{{count}} days"},
   "kind": {"ebook": "Ebook", "audiobook": "Audiobook"}},
 "orphans": {
   "explain": "These torrents are in Rawkoon's categories, but no download in Rawkoon owns them, so Rawkoon won't remove them on its own. They're usually left over from a reset database or a torrent added by hand.",
   "columns": {"torrent": "Torrent", "category": "Category", "size": "Size", "ratio": "Ratio", "seeding": "Seeding"},
   "selectAll": "Select all", "select": "Select {{name}}",
   "shares": "Shares files with another torrent",
   "selected": "{{count}} selected, {{size}}",
   "deleteData": "Delete downloaded files",
   "sharedNote": "Torrents that share files keep them.",
   "remove_one": "Remove torrent", "remove_other": "Remove {{count}} torrents",
   "removed_one": "Removed {{count}} torrent.", "removed_other": "Removed {{count}} torrents.",
   "freed": "{{size}} freed.",
   "removeError": "Couldn't remove the selected torrents.",
   "empty": {"title": "No orphaned torrents", "description": "Every torrent in Rawkoon's categories belongs to a download Rawkoon tracks."},
   "health": {"title_one": "{{count}} orphaned torrent, {{size}}", "title_other": "{{count}} orphaned torrents, {{size}}",
     "description": "In Rawkoon's categories, but no download owns them.", "action": "Review orphans"}},
 "settings": {
   "seeding": {
     "title": "Seeding",
     "description": "After import, Rawkoon keeps each torrent seeding until it reaches a target, then removes it from the client. Your library copy is a hardlink, so it stays.",
     "enable": "Release torrents automatically",
     "enableHint": "When off, a torrent is only removed at import if it already meets the public ratio.",
     "preview_one": "{{count}} torrent would be released now, {{size}}.",
     "preview_other": "{{count}} torrents would be released now, {{size}}.",
     "publicTitle": "Public trackers", "privateTitle": "Private trackers",
     "ratio": "Ratio", "seedTime": "Seed time", "none": "none",
     "unitHours": "hours", "unitDays": "days",
     "hours_one": "{{count}} hour", "hours_other": "{{count}} hours", "days_one": "{{count}} day", "days_other": "{{count}} days",
     "sentence": {"both": "Release at ratio {{ratio}} or after {{time}} of seeding, whichever comes first.",
       "ratio": "Release once it reaches ratio {{ratio}}.", "time": "Release after {{time}} of seeding.",
       "none": "Release right after import. Nothing is seeded."},
     "unknownPrivate": "An indexer Rawkoon can't reach counts as private, so a torrent is never removed early by mistake.",
     "moveMode": "Imports move files out of the client, so torrents are released right after import. Switch to hardlink to seed.",
     "invalid": "Use a number of zero or more, or leave the field empty.",
     "indexers": {"indexer": "Indexer", "rule": "Rule", "held": "Seeding now", "inherited": "{{rule}}, from the {{source}} default",
       "sourcePrivate": "private", "sourcePublic": "public", "customize": "Customize", "useDefault": "Use default",
       "save": "Save", "cancel": "Cancel", "empty": "No indexers found. Connect Prowlarr or Jackett first."},
     "save": "Save seeding rules", "saved": "Seeding rules saved.", "saveError": "Couldn't save seeding rules."},
   "downloadSafety": {
     "title": "Download safety",
     "description": "Reject a release as soon as its file list contains one of these types. It's blocklisted and removed with its files, and Rawkoon searches again.",
     "add": "Add a file type, like .iso", "remove": "Remove .{{ext}}", "invalid": "Use a file extension like exe or .iso.",
     "stats": "Last 30 days: {{malware}} rejected for blocked files, {{stalled}} for stalling, {{imports}} for unusable content.",
     "statsLink": "View them in the blocklist",
     "save": "Save file types", "saved": "File types saved.", "saveError": "Couldn't save file types."},
   "blocklist": {"filter": {"all": "All", "auto": "Added automatically", "manual": "Added by you"},
     "kind": {"stalled": "Stalled", "malware": "Blocked file", "import_rejected": "Import rejected"}},
   "jobs": {"actions": {"sweepSeedingTorrents": {"label": "Release seeded torrents",
     "description": "Remove torrents from the download client once their seed target is met."}}}},
 "library": {
   "management": {"seedingTitle_one": "1 torrent is still seeding", "seedingTitle_other": "{{count}} torrents are still seeding",
     "keepSeeding": "Keep seeding until its target is met", "keepSeedingHint": "Rawkoon removes it from the client once its seed target is met.",
     "releaseNow": "Remove the torrent now", "releaseNowHint": "Frees the space right away.",
     "hnrWarning": "A private tracker still expects seed time for this torrent. Removing it now can count as a hit-and-run."},
   "download": {"seed": {"seeding": "Seeding", "seedingDetail": "ratio {{ratio}}, {{time}} seeded", "released": "Released", "blocklisted": "Blocklisted",
     "reason": {"target_met": "target met", "manual": "removed by you", "move_mode": "move mode", "adopted": "not added by Rawkoon",
       "stalled": "stalled", "malware": "blocked file", "import_rejected": "import rejected"}}}}
}
FR = {
 "downloadsPage": {"title": "Téléchargements", "subtitle": "Ce qui se trouve dans votre client de téléchargement, et ce dont Rawkoon a encore besoin.",
   "tabs": {"import": "Importer", "seeding": "Partage", "orphans": "Orphelins"}},
 "seeding": {
   "summary_one": "{{count}} torrent ({{size}}) est conservé jusqu'à ce qu'il atteigne son objectif de partage.",
   "summary_other": "{{count}} torrents ({{size}}) sont conservés jusqu'à ce qu'ils atteignent leur objectif de partage.",
   "summaryOwed": "{{count}} doivent encore du temps de partage sur des trackers privés.",
   "summaryNext": "Le prochain sera libéré dans environ {{time}}.",
   "live": "En direct",
   "filters": {"all": "Tous", "owed": "Temps de partage dû", "removed": "Titres retirés", "idle": "Sans envoi"},
   "badges": {"removed_from_library": "Retiré de la bibliothèque", "replaced_by_upgrade": "Remplacé par une amélioration", "owes": "Temps de partage dû"},
   "meter": {"ratio": "Ratio", "time": "Temps", "noTarget": "aucun objectif"},
   "units": {"hours": "h", "days": "j"},
   "eta": {"met": "Objectif atteint. Retrait à la prochaine vérification.", "idle": "Aucun envoi, il ne peut donc pas atteindre son ratio.",
     "ratio": "Libéré dans environ {{time}}, au ratio", "time": "Libéré dans environ {{time}}, au temps de partage"},
   "idleHint": "Personne ne télécharge depuis ce torrent, il ne peut donc pas atteindre son ratio.",
   "idleHintLink": "Ajouter un objectif de temps",
   "removeNow": "Retirer maintenant",
   "confirmTitle": "Retirer {{title}} du client de téléchargement?",
   "confirmBody": "Le torrent et ses fichiers téléchargés sont supprimés. La copie dans votre bibliothèque reste.",
   "confirmHnr": "{{indexer}} est un tracker privé et ce torrent n'a pas atteint son objectif. Le retirer maintenant peut compter comme un hit-and-run.",
   "confirmLabel": "Retirer maintenant",
   "removed": "{{title}} a été retiré du client de téléchargement.",
   "removeError": "Impossible de retirer le torrent.",
   "releasedToday": "Libérés aujourd'hui : {{count}}",
   "freed": "{{size}} libérés",
   "releasedReason": {"target_met": "Objectif atteint", "manual": "Retiré par vous", "move_mode": "Mode déplacement"},
   "empty": {"title": "Rien en partage", "description": "Les torrents apparaissent ici après l'import, pendant qu'ils partagent vers leur objectif."},
   "disabled": {"title": "La libération automatique est désactivée", "description": "Les torrents restent dans votre client jusqu'à ce que vous les retiriez.", "action": "L'activer dans les réglages"},
   "unreachable": "Le client de téléchargement est injoignable, les données de partage ne peuvent pas être affichées.",
   "duration": {"minutes_one": "{{count}} min", "minutes_other": "{{count}} min", "hours_one": "{{count}} h", "hours_other": "{{count}} h",
     "days_one": "{{count}} jour", "days_other": "{{count}} jours"},
   "kind": {"ebook": "Livre numérique", "audiobook": "Livre audio"}},
 "orphans": {
   "explain": "Ces torrents sont dans les catégories de Rawkoon, mais aucun téléchargement de Rawkoon ne leur correspond, donc Rawkoon ne les retirera pas de lui-même. Ils restent souvent d'une base de données réinitialisée ou d'un torrent ajouté à la main.",
   "columns": {"torrent": "Torrent", "category": "Catégorie", "size": "Taille", "ratio": "Ratio", "seeding": "Partage"},
   "selectAll": "Tout sélectionner", "select": "Sélectionner {{name}}",
   "shares": "Partage des fichiers avec un autre torrent",
   "selected": "{{count}} sélectionnés, {{size}}",
   "deleteData": "Supprimer les fichiers téléchargés",
   "sharedNote": "Les torrents qui partagent des fichiers les conservent.",
   "remove_one": "Retirer le torrent", "remove_other": "Retirer {{count}} torrents",
   "removed_one": "{{count}} torrent retiré.", "removed_other": "{{count}} torrents retirés.",
   "freed": "{{size}} libérés.",
   "removeError": "Impossible de retirer les torrents sélectionnés.",
   "empty": {"title": "Aucun torrent orphelin", "description": "Chaque torrent des catégories de Rawkoon correspond à un téléchargement suivi par Rawkoon."},
   "health": {"title_one": "{{count}} torrent orphelin, {{size}}", "title_other": "{{count}} torrents orphelins, {{size}}",
     "description": "Dans les catégories de Rawkoon, mais aucun téléchargement ne leur correspond.", "action": "Voir les orphelins"}},
 "settings": {
   "seeding": {
     "title": "Partage",
     "description": "Après l'import, Rawkoon garde chaque torrent en partage jusqu'à ce qu'il atteigne un objectif, puis le retire du client. La copie de votre bibliothèque est un lien physique, elle reste donc en place.",
     "enable": "Libérer les torrents automatiquement",
     "enableHint": "Désactivé, un torrent n'est retiré à l'import que s'il atteint déjà le ratio public.",
     "preview_one": "{{count}} torrent serait libéré maintenant, {{size}}.",
     "preview_other": "{{count}} torrents seraient libérés maintenant, {{size}}.",
     "publicTitle": "Trackers publics", "privateTitle": "Trackers privés",
     "ratio": "Ratio", "seedTime": "Temps de partage", "none": "aucun",
     "unitHours": "heures", "unitDays": "jours",
     "hours_one": "{{count}} heure", "hours_other": "{{count}} heures", "days_one": "{{count}} jour", "days_other": "{{count}} jours",
     "sentence": {"both": "Libérer au ratio {{ratio}} ou après {{time}} de partage, selon ce qui arrive en premier.",
       "ratio": "Libérer une fois le ratio {{ratio}} atteint.", "time": "Libérer après {{time}} de partage.",
       "none": "Libérer dès l'import. Rien n'est partagé."},
     "unknownPrivate": "Un indexeur que Rawkoon ne peut pas joindre est considéré comme privé, pour qu'aucun torrent ne soit retiré trop tôt par erreur.",
     "moveMode": "Les imports déplacent les fichiers hors du client, donc les torrents sont libérés dès l'import. Passez aux liens physiques pour partager.",
     "invalid": "Entrez un nombre positif ou nul, ou laissez le champ vide.",
     "indexers": {"indexer": "Indexeur", "rule": "Règle", "held": "En partage", "inherited": "{{rule}}, selon le défaut {{source}}",
       "sourcePrivate": "privé", "sourcePublic": "public", "customize": "Personnaliser", "useDefault": "Utiliser le défaut",
       "save": "Enregistrer", "cancel": "Annuler", "empty": "Aucun indexeur trouvé. Connectez d'abord Prowlarr ou Jackett."},
     "save": "Enregistrer les règles de partage", "saved": "Règles de partage enregistrées.", "saveError": "Impossible d'enregistrer les règles de partage."},
   "downloadSafety": {
     "title": "Sécurité des téléchargements",
     "description": "Rejeter une version dès que sa liste de fichiers contient l'un de ces types. Elle est ajoutée à la liste de blocage et supprimée avec ses fichiers, puis Rawkoon relance la recherche.",
     "add": "Ajouter un type de fichier, comme .iso", "remove": "Retirer .{{ext}}", "invalid": "Utilisez une extension de fichier comme exe ou .iso.",
     "stats": "30 derniers jours : {{malware}} rejetées pour fichiers bloqués, {{stalled}} pour blocage, {{imports}} pour contenu inutilisable.",
     "statsLink": "Les voir dans la liste de blocage",
     "save": "Enregistrer les types de fichiers", "saved": "Types de fichiers enregistrés.", "saveError": "Impossible d'enregistrer les types de fichiers."},
   "blocklist": {"filter": {"all": "Toutes", "auto": "Ajoutées automatiquement", "manual": "Ajoutées par vous"},
     "kind": {"stalled": "Bloqué", "malware": "Fichier bloqué", "import_rejected": "Import rejeté"}},
   "jobs": {"actions": {"sweepSeedingTorrents": {"label": "Libérer les torrents partagés",
     "description": "Retirer les torrents du client de téléchargement une fois leur objectif de partage atteint."}}}},
 "library": {
   "management": {"seedingTitle_one": "1 torrent est encore en partage", "seedingTitle_other": "{{count}} torrents sont encore en partage",
     "keepSeeding": "Continuer le partage jusqu'à l'objectif", "keepSeedingHint": "Rawkoon le retire du client une fois son objectif de partage atteint.",
     "releaseNow": "Retirer le torrent maintenant", "releaseNowHint": "Libère l'espace tout de suite.",
     "hnrWarning": "Un tracker privé attend encore du temps de partage pour ce torrent. Le retirer maintenant peut compter comme un hit-and-run."},
   "download": {"seed": {"seeding": "En partage", "seedingDetail": "ratio {{ratio}}, {{time}} de partage", "released": "Libéré", "blocklisted": "Bloqué",
     "reason": {"target_met": "objectif atteint", "manual": "retiré par vous", "move_mode": "mode déplacement", "adopted": "non ajouté par Rawkoon",
       "stalled": "bloqué", "malware": "fichier bloqué", "import_rejected": "import rejeté"}}}}
}
def merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            merge(dst[k], v)
        else:
            assert k not in dst, f"key collision: {k}"
            dst[k] = v
for lang, data in (("en", EN), ("fr", FR)):
    path = f"apps/web/src/locales/{lang}/common.json"
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    merge(doc, data)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")
EOF
bun run format && git diff --stat apps/web/src/locales
```

Expected: both locale files change **only** by additions. If the `git diff` shows reordering or reformatting of existing lines, revert both files and add the same keys by hand-editing instead. If the script hits a `key collision` assertion, rename the colliding key in both the script and the components that use it.

- [ ] **Step 7: Run tests and typecheck**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/seeding/lib && cd ../.. && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): seeding data layer, formatters, seed-state merge and strings"
```

---

### Task 14: Downloads page tabs and the Seeding view

**Files:**
- Modify: `apps/web/src/pages/library/downloads.tsx`
- Modify: `apps/web/src/features/downloadsImport/DownloadsImportPage.tsx` (split into `DownloadsImportView`)
- Create: `apps/web/src/features/seeding/components/DownloadsPage.tsx`, `SeedingView.tsx`, `SeedingRow.tsx`, `ReleaseMeter.tsx`
- Test: `apps/web/src/features/seeding/components/ReleaseMeter.test.tsx`, `SeedingRow.test.tsx`, `SeedingView.test.tsx`

**Interfaces:**
- Consumes: the Task 13 hooks and formatters, `useConfirm`, `SegmentedTabs`, `EmptyState` (`icon`, `title` and `description` are all required), `Button`, and `formatBytes` from `@/lib/utils/format`.
- Produces: `export type DownloadsView = "import" | "seeding" | "orphans"`, `export function DownloadsPage({ view }: { view: DownloadsView })`, `export function filterSeeding(list: SeedingTorrent[], f: SeedingFilter): SeedingTorrent[]`, and `export type SeedingFilter = "all" | "owed" | "removed" | "idle"`.

- [ ] **Step 1: Write the failing tests**

`ReleaseMeter.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { ReleaseMeter } from "./ReleaseMeter";

const base: SeedingTorrent = {
  hash: "aa", name: "n", title: "Film", year: 1922, kind_label: "movie", media_id: 1, book_id: null, poster_url: null,
  indexer: "Harbor", is_private: false, badges: [], rule: { ratio: 1, seed_time_mins: null }, rule_source: "public_default",
  ratio: 0.63, seeding_time_secs: 3600, up_speed: 10, size_bytes: 100, ratio_pct: 0.63, time_pct: null,
  lead: "ratio", eta_secs: 120, target_met: false, owes_seed_time: false,
};

describe("ReleaseMeter", () => {
  it("renders the ratio bar with its value and a dashed no-target time row", () => {
    render(<ReleaseMeter torrent={base} />);
    expect(screen.getByRole("progressbar", { name: "seeding.meter.ratio" })).toHaveAttribute("aria-valuenow", "63");
    expect(screen.getByText("0.63 / 1.0")).toBeInTheDocument();
    expect(screen.getByText("seeding.meter.noTarget")).toBeInTheDocument();
  });
  it("explains an unreachable ratio target", () => {
    render(<ReleaseMeter torrent={{ ...base, up_speed: 0, eta_secs: null }} />);
    expect(screen.getByText("seeding.eta.idle")).toBeInTheDocument();
  });
  it("announces a met target", () => {
    render(<ReleaseMeter torrent={{ ...base, target_met: true, eta_secs: 0 }} />);
    expect(screen.getByText("seeding.eta.met")).toBeInTheDocument();
  });
});
```

`SeedingRow.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SeedingTorrent } from "@rawkoon/shared/types";

const confirmMock = vi.fn();
vi.mock("@/components/confirm/ConfirmContext", () => ({ useConfirm: () => ({ confirm: confirmMock }) }));
vi.mock("@/features/seeding/hooks/useSeeding", () => ({ useReleaseTorrent: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

import { SeedingRow } from "./SeedingRow";

const row = (o: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash: "aa", name: "n", title: "Film", year: 1922, kind_label: "movie", media_id: 1, book_id: null, poster_url: null,
  indexer: "Nimbus", is_private: true, badges: ["removed_from_library"], rule: { ratio: 1, seed_time_mins: 4320 },
  rule_source: "private_default", ratio: 0.2, seeding_time_secs: 3600, up_speed: 10, size_bytes: 100,
  ratio_pct: 0.2, time_pct: 1 / 72, lead: "time", eta_secs: 3600, target_met: false, owes_seed_time: true, ...o,
});

function openedDescription(): ReactNode {
  fireEvent.click(screen.getByRole("button", { name: "seeding.removeNow" }));
  return confirmMock.mock.calls[0][0].description as ReactNode;
}

describe("SeedingRow", () => {
  beforeEach(() => confirmMock.mockClear());

  it("shows badges and warns about a hit-and-run when seed time is owed", () => {
    render(<ul><SeedingRow torrent={row()} /></ul>);
    expect(screen.getByText("seeding.badges.removed_from_library")).toBeInTheDocument();
    expect(screen.getByText("seeding.badges.owes")).toBeInTheDocument();
    render(<>{openedDescription()}</>);
    expect(screen.getByText("seeding.confirmHnr")).toBeInTheDocument();
  });

  it("omits the warning once nothing is owed", () => {
    render(<ul><SeedingRow torrent={row({ owes_seed_time: false, is_private: false })} /></ul>);
    render(<>{openedDescription()}</>);
    expect(screen.queryByText("seeding.confirmHnr")).toBeNull();
  });

  it("offers a seed-time target when an idle torrent only has a ratio target", () => {
    render(<ul><SeedingRow torrent={row({ up_speed: 0, eta_secs: null, rule: { ratio: 1, seed_time_mins: null }, owes_seed_time: false })} /></ul>);
    expect(screen.getByRole("link", { name: "seeding.idleHintLink" })).toHaveAttribute("href", expect.stringContaining("/settings"));
  });
});
```

`SeedingView.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const useSeedingMock = vi.fn();
vi.mock("@/features/seeding/hooks/useSeeding", () => ({
  useSeeding: () => useSeedingMock(),
  useReleaseTorrent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/confirm/ConfirmContext", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));

import { SeedingView, filterSeeding } from "./SeedingView";
import type { SeedingTorrent } from "@rawkoon/shared/types";

const r = (hash: string, o: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash, name: hash, title: `Title ${hash}`, year: null, kind_label: "movie", media_id: 1, book_id: null, poster_url: null,
  indexer: "Harbor", is_private: false, badges: [], rule: { ratio: 1, seed_time_mins: null }, rule_source: "public_default",
  ratio: 0.5, seeding_time_secs: 10, up_speed: 5, size_bytes: 10, ratio_pct: 0.5, time_pct: null, lead: "ratio",
  eta_secs: 10, target_met: false, owes_seed_time: false, ...o,
});

describe("filterSeeding", () => {
  it("filters by owed, removed and idle", () => {
    const list = [r("a", { owes_seed_time: true }), r("b", { badges: ["removed_from_library"] }), r("c", { up_speed: 0 })];
    expect(filterSeeding(list, "owed").map((x) => x.hash)).toEqual(["a"]);
    expect(filterSeeding(list, "removed").map((x) => x.hash)).toEqual(["b"]);
    expect(filterSeeding(list, "idle").map((x) => x.hash)).toEqual(["c"]);
    expect(filterSeeding(list, "all")).toHaveLength(3);
  });
});

describe("SeedingView", () => {
  it("shows the off banner, the rows, and the released footer", () => {
    useSeedingMock.mockReturnValue({
      isLoading: false, error: null,
      data: { enabled: false, torrents: [r("a")], released_today: [{ hash: "z", title: "Old", reason: "target_met", released_at: "2026-01-01T00:00:00Z", size_bytes: 1024 }] },
    });
    render(<SeedingView />);
    expect(screen.getByText("seeding.disabled.title")).toBeInTheDocument();
    expect(screen.getByText("Title a")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
  });
  it("switches filters", () => {
    useSeedingMock.mockReturnValue({ isLoading: false, error: null, data: { enabled: true, torrents: [r("a"), r("b", { up_speed: 0 })], released_today: [] } });
    render(<SeedingView />);
    fireEvent.click(screen.getByRole("tab", { name: "seeding.filters.idle" }));
    expect(screen.queryByText("Title a")).toBeNull();
    expect(screen.getByText("Title b")).toBeInTheDocument();
  });
  it("shows the empty state", () => {
    useSeedingMock.mockReturnValue({ isLoading: false, error: null, data: { enabled: true, torrents: [], released_today: [] } });
    render(<SeedingView />);
    expect(screen.getByText("seeding.empty.title")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/seeding/components`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `ReleaseMeter.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { formatSeedDuration, meterTimeLabel } from "@/features/seeding/lib/seedFormat";

function MeterBar({ label, pct, lead, value, noTarget }: {
  label: string; pct: number | null; lead: boolean; value: string | null; noTarget: string;
}) {
  if (pct == null || value == null) {
    return (
      <div className="grid grid-cols-[52px_1fr_auto] items-center gap-2 text-xs text-neutral-500">
        <span>{label}</span>
        <span className="h-px border-t border-dashed border-neutral-700" aria-hidden />
        <span>{noTarget}</span>
      </div>
    );
  }
  return (
    <div className={cn("grid grid-cols-[52px_1fr_auto] items-center gap-2 text-xs tabular-nums", lead ? "text-neutral-100" : "text-neutral-500")}>
      <span>{label}</span>
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        className="block h-1.5 overflow-hidden rounded-full bg-neutral-950 ring-1 ring-inset ring-neutral-700"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
            lead ? "bg-gradient-to-r from-primary-600 to-primary-400" : "bg-neutral-600",
          )}
          style={{ width: `${pct * 100}%` }}
        />
      </span>
      <span>{value}</span>
    </div>
  );
}

export function ReleaseMeter({ torrent, className }: { torrent: SeedingTorrent; className?: string }) {
  const { t } = useTranslation("common");
  const noTarget = t("seeding.meter.noTarget");
  const eta = torrent.target_met
    ? <p className="text-xs text-emerald-200">{t("seeding.eta.met")}</p>
    : torrent.eta_secs == null
      ? <p className="text-xs text-neutral-400">{t("seeding.eta.idle")}</p>
      : (
        <p className="text-xs text-neutral-400">
          {t(torrent.lead === "time" ? "seeding.eta.time" : "seeding.eta.ratio", { time: formatSeedDuration(torrent.eta_secs, t) })}
        </p>
      );
  return (
    <div className={cn("grid gap-1.5", className)}>
      <MeterBar
        label={t("seeding.meter.ratio")}
        pct={torrent.ratio_pct}
        lead={torrent.lead === "ratio"}
        value={torrent.rule.ratio != null ? `${(torrent.ratio ?? 0).toFixed(2)} / ${torrent.rule.ratio.toFixed(1)}` : null}
        noTarget={noTarget}
      />
      <MeterBar
        label={t("seeding.meter.time")}
        pct={torrent.time_pct}
        lead={torrent.lead === "time"}
        value={torrent.rule.seed_time_mins != null ? meterTimeLabel(torrent.seeding_time_secs ?? 0, torrent.rule.seed_time_mins, t) : null}
        noTarget={noTarget}
      />
      {eta}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SeedingRow.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { useReleaseTorrent } from "@/features/seeding/hooks/useSeeding";
import { formatBytes } from "@/lib/utils/format";
import { ReleaseMeter } from "./ReleaseMeter";

const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold";

export function SeedingRow({ torrent }: { torrent: SeedingTorrent }) {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const release = useReleaseTorrent();
  const idleRatioOnly = torrent.up_speed === 0 && torrent.rule.seed_time_mins == null && !torrent.target_met;

  const onRemove = () =>
    confirm({
      variant: "destructive",
      title: t("seeding.confirmTitle", { title: torrent.title }),
      description: (
        <div className="space-y-2">
          <p>{t("seeding.confirmBody")}</p>
          {torrent.owes_seed_time && (
            <p className="rounded-lg border border-amber-900/70 bg-amber-950/40 px-3 py-2 text-amber-200">
              {t("seeding.confirmHnr", { indexer: torrent.indexer ?? "" })}
            </p>
          )}
        </div>
      ),
      confirmLabel: t("seeding.confirmLabel"),
      onConfirm: async () => {
        try {
          await release.mutateAsync(torrent.hash);
          toast.success(t("seeding.removed", { title: torrent.title }));
        } catch {
          toast.error(t("seeding.removeError"));
        }
      },
    });

  return (
    <li className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-3.5 md:grid-cols-[44px_minmax(0,1fr)_minmax(250px,320px)_auto] md:items-center">
      {torrent.poster_url ? (
        <img src={torrent.poster_url} alt="" loading="lazy" className="h-16 w-11 rounded object-cover" />
      ) : (
        <div aria-hidden className="grid h-16 w-11 place-items-center rounded bg-neutral-700 font-display text-lg text-neutral-400">
          {torrent.title.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate font-semibold text-neutral-50">
          {torrent.title}{" "}
          <span className="font-normal text-neutral-500">
            {torrent.kind_label === "ebook" || torrent.kind_label === "audiobook" ? t(`seeding.kind.${torrent.kind_label}`) : torrent.year}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-neutral-400">
          <span className="inline-flex items-center gap-1">
            {torrent.is_private && <Lock size={12} aria-label="private" />}
            {torrent.indexer}
          </span>
          <span>{formatBytes(torrent.size_bytes)}</span>
          <span>{torrent.up_speed > 0 ? `↑ ${formatBytes(torrent.up_speed)}/s` : t("seeding.filters.idle")}</span>
          {torrent.badges.map((b) => (
            <span key={b} className={`${BADGE} border-neutral-700 bg-white/5 text-neutral-400`}>{t(`seeding.badges.${b}`)}</span>
          ))}
          {torrent.owes_seed_time && (
            <span className={`${BADGE} border-amber-900/70 bg-amber-950/40 text-amber-200`}>{t("seeding.badges.owes")}</span>
          )}
        </div>
        {idleRatioOnly && (
          <p className="mt-1.5 max-w-[52ch] text-xs text-amber-200">
            {t("seeding.idleHint")}{" "}
            <a href="/settings?tab=media" className="text-primary-400 underline underline-offset-2">{t("seeding.idleHintLink")}</a>
          </p>
        )}
      </div>
      <ReleaseMeter torrent={torrent} className="col-span-2 md:col-span-1" />
      <div className="col-span-2 md:col-span-1 md:text-right">
        <Button type="button" variant="ghost" size="sm" disabled={release.isPending} onClick={onRemove} className="whitespace-nowrap">
          {t("seeding.removeNow")}
        </Button>
      </div>
    </li>
  );
}
```

- [ ] **Step 5: Implement `SeedingView.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sprout } from "lucide-react";
import type { SeedingTorrent } from "@rawkoon/shared/types";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
import { formatSeedDuration } from "@/features/seeding/lib/seedFormat";
import { formatBytes } from "@/lib/utils/format";
import { SeedingRow } from "./SeedingRow";

export type SeedingFilter = "all" | "owed" | "removed" | "idle";
const FILTERS: SeedingFilter[] = ["all", "owed", "removed", "idle"];

export function filterSeeding(list: SeedingTorrent[], f: SeedingFilter): SeedingTorrent[] {
  switch (f) {
    case "owed": return list.filter((s) => s.owes_seed_time);
    case "removed": return list.filter((s) => s.badges.includes("removed_from_library"));
    case "idle": return list.filter((s) => s.up_speed === 0);
    default: return list;
  }
}

export function SeedingView() {
  const { t } = useTranslation("common");
  const { data, isLoading, error } = useSeeding();
  const [filter, setFilter] = useState<SeedingFilter>("all");

  if (isLoading) return <LoadingState />;
  if (error || !data) return <p className="text-sm text-amber-200">{t("seeding.unreachable")}</p>;

  const total = data.torrents.reduce((sum, s) => sum + s.size_bytes, 0);
  const owed = data.torrents.filter((s) => s.owes_seed_time).length;
  const next = data.torrents.find((s) => s.eta_secs != null)?.eta_secs ?? null;
  const visible = filterSeeding(data.torrents, filter);
  const freed = data.released_today.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);

  return (
    <div className="space-y-4">
      {!data.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-neutral-100">{t("seeding.disabled.title")}</p>
            <p className="text-xs text-neutral-400">{t("seeding.disabled.description")}</p>
          </div>
          <a href="/settings?tab=media" className="text-sm text-primary-400 underline underline-offset-2">{t("seeding.disabled.action")}</a>
        </div>
      )}
      {data.torrents.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[68ch] text-[15px] text-neutral-100">
            {t("seeding.summary", { count: data.torrents.length, size: formatBytes(total) })}{" "}
            {owed > 0 && t("seeding.summaryOwed", { count: owed })}{" "}
            {next != null && t("seeding.summaryNext", { time: formatSeedDuration(next, t) })}
          </p>
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500" aria-live="polite">
            <span className="size-1.5 rounded-full bg-emerald-300 motion-safe:animate-pulse" aria-hidden />
            {t("seeding.live")}
          </span>
        </div>
      )}
      <SegmentedTabs
        variant="chips"
        items={FILTERS.map((f) => ({ id: f, label: t(`seeding.filters.${f}`) }))}
        value={filter}
        onChange={setFilter}
        ariaLabel={t("seeding.filters.all")}
      />
      {data.torrents.length === 0 ? (
        <EmptyState icon={Sprout} title={t("seeding.empty.title")} description={t("seeding.empty.description")} />
      ) : (
        <ul className="divide-y divide-neutral-700 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
          {visible.map((s) => <SeedingRow key={s.hash} torrent={s} />)}
        </ul>
      )}
      {data.released_today.length > 0 && (
        <details open className="rounded-xl border border-dashed border-neutral-600 px-4 py-2.5 text-sm text-neutral-400">
          <summary className="flex cursor-pointer list-none justify-between gap-3">
            <span className="font-semibold text-neutral-200">{t("seeding.releasedToday", { count: data.released_today.length })}</span>
            <span>{t("seeding.freed", { size: formatBytes(freed) })}</span>
          </summary>
          <ul className="mt-2.5 grid gap-1.5">
            {data.released_today.map((r) => (
              <li key={r.hash} className="flex justify-between gap-3 text-xs motion-safe:animate-in motion-safe:fade-in">
                <span>{r.title}</span>
                <span className="text-neutral-500">
                  {t(`seeding.releasedReason.${r.reason}`, { defaultValue: r.reason })}
                  {r.size_bytes != null && <span className="ml-3 inline-block min-w-16 text-right">{formatBytes(r.size_bytes)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Split the import page and add `DownloadsPage.tsx` and the route**

In `DownloadsImportPage.tsx`:
- Rename the component to `DownloadsImportView`.
- Remove the `PageLayout` and `PageHeader` wrappers, returning a fragment instead.
- Move the Refresh `Button` into `<div className="mb-3 flex justify-end">…</div>` at the top of the returned fragment.
- Remove the now-unused `PageLayout`, `PageHeader` and `Search` imports.

Create `DownloadsPage.tsx`:

```tsx
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HardDriveDownload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { DownloadsImportView } from "@/features/downloadsImport/DownloadsImportPage";
import { useOrphans } from "@/features/seeding/hooks/useOrphans";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
import { OrphansView } from "./OrphansView";
import { SeedingView } from "./SeedingView";

export type DownloadsView = "import" | "seeding" | "orphans";

export function DownloadsPage({ view }: { view: DownloadsView }) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const seeding = useSeeding();
  const orphans = useOrphans();
  const orphanCount = orphans.data?.orphans.length ?? 0;
  return (
    <PageLayout className="pb-28">
      <PageHeader icon={HardDriveDownload} title={t("downloadsPage.title")} subtitle={t("downloadsPage.subtitle")} />
      <SegmentedTabs
        items={[
          { id: "import", label: t("downloadsPage.tabs.import") },
          { id: "seeding", label: t("downloadsPage.tabs.seeding"), badge: seeding.data?.torrents.length },
          { id: "orphans", label: t("downloadsPage.tabs.orphans"), badge: orphanCount > 0 ? orphanCount : undefined },
        ]}
        value={view}
        onChange={(next) =>
          navigate({ to: "/library/downloads", search: { view: next === "import" ? undefined : next } })
        }
        ariaLabel={t("downloadsPage.title")}
      />
      <div className="mt-5">
        {view === "import" && <DownloadsImportView />}
        {view === "seeding" && <SeedingView />}
        {view === "orphans" && <OrphansView />}
      </div>
    </PageLayout>
  );
}
```

`OrphansView` is created in Task 15. Until then, add a temporary one-line `export function OrphansView() { return null; }` in `OrphansView.tsx` so this task typechecks. Task 15 replaces the file.

`pages/library/downloads.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { DownloadsPage } from "@/features/seeding/components/DownloadsPage";

type DownloadsSearch = { view?: "seeding" | "orphans" };

export const Route = createFileRoute("/library/downloads")({
  validateSearch: (search: Record<string, unknown>): DownloadsSearch => ({
    view: search.view === "seeding" || search.view === "orphans" ? search.view : undefined,
  }),
  beforeLoad: async () => {
    try {
      const user = await getCurrentUser();
      if (!user) throw redirect({ to: "/login" });
      if (!user.is_admin) throw redirect({ to: "/library", replace: true });
      return { user };
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 429) return { user: null };
      throw e;
    }
  },
  component: DownloadsRoute,
});

function DownloadsRoute() {
  const { view } = Route.useSearch();
  return <DownloadsPage view={view ?? "import"} />;
}
```

Then run `cd apps/web && bunx @tanstack/router-cli generate`.

- [ ] **Step 7: Run tests, typecheck and lint**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/seeding src/features/downloadsImport && cd ../.. && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Downloads page with a live Seeding view and release meters"
```

---

### Task 15: Orphans view

**Files:**
- Create (replacing the stub): `apps/web/src/features/seeding/components/OrphansView.tsx`
- Test: `apps/web/src/features/seeding/components/OrphansView.test.tsx`

**Interfaces:**
- Consumes: `useOrphans` and `useRemoveOrphans` (Task 13).

- [ ] **Step 1: Write the failing test**

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const useOrphansMock = vi.fn();
const mutateAsync = vi.fn(async () => ({ removed: ["aa"], refused: [], freed_bytes: 100 }));
vi.mock("@/features/seeding/hooks/useOrphans", () => ({
  useOrphans: () => useOrphansMock(),
  useRemoveOrphans: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrphansView } from "./OrphansView";

const orphan = (hash: string, shares = false) => ({
  hash, name: `Name.${hash}`, category: "rawkoon-movies", size_bytes: 100, ratio: 1, seeding_time_secs: 3600,
  content_path: `/dl/${hash}`, shares_data: shares,
});

describe("OrphansView", () => {
  beforeEach(() => mutateAsync.mockClear());

  it("shows the action bar with totals once rows are selected", () => {
    useOrphansMock.mockReturnValue({ isLoading: false, error: null, data: { orphans: [orphan("aa"), orphan("bb", true)], total_bytes: 200 } });
    render(<OrphansView />);
    expect(screen.queryByRole("region", { name: "orphans.selectAll" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "orphans.selectAll" }));
    expect(screen.getByText("orphans.selected")).toBeInTheDocument();
    expect(screen.getByText("orphans.sharedNote")).toBeInTheDocument();
  });

  it("removes the selected torrents with the delete-data choice", async () => {
    useOrphansMock.mockReturnValue({ isLoading: false, error: null, data: { orphans: [orphan("aa")], total_bytes: 100 } });
    render(<OrphansView />);
    fireEvent.click(screen.getByRole("checkbox", { name: "orphans.select" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "orphans.deleteData" }));
    fireEvent.click(screen.getByRole("button", { name: "orphans.remove" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ hashes: ["aa"], delete_data: false }));
  });

  it("explains an empty list", () => {
    useOrphansMock.mockReturnValue({ isLoading: false, error: null, data: { orphans: [], total_bytes: 0 } });
    render(<OrphansView />);
    expect(screen.getByText("orphans.empty.title")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/seeding/components/OrphansView.test.tsx`
Expected: FAIL. The stub renders nothing.

- [ ] **Step 3: Implement `OrphansView.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ghost } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/button";
import { useOrphans, useRemoveOrphans } from "@/features/seeding/hooks/useOrphans";
import { formatSeedDuration } from "@/features/seeding/lib/seedFormat";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format";

export function OrphansView() {
  const { t } = useTranslation("common");
  const { data, isLoading, error } = useOrphans();
  const remove = useRemoveOrphans();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteData, setDeleteData] = useState(true);

  if (isLoading) return <LoadingState />;
  if (error || !data) return <p className="text-sm text-amber-200">{t("seeding.unreachable")}</p>;

  const orphans = data.orphans;
  const chosen = orphans.filter((o) => selected.has(o.hash));
  const bytes = chosen.reduce((sum, o) => sum + o.size_bytes, 0);
  const toggle = (hash: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });

  const onRemove = async () => {
    try {
      const res = await remove.mutateAsync({ hashes: chosen.map((o) => o.hash), delete_data: deleteData });
      const msg = t("orphans.removed", { count: res.removed.length });
      toast.success(res.freed_bytes > 0 ? `${msg} ${t("orphans.freed", { size: formatBytes(res.freed_bytes) })}` : msg);
      setSelected(new Set());
    } catch {
      toast.error(t("orphans.removeError"));
    }
  };

  if (orphans.length === 0) {
    return <EmptyState icon={Ghost} title={t("orphans.empty.title")} description={t("orphans.empty.description")} />;
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-neutral-400">{t("orphans.explain")}</p>
      <div className="overflow-x-auto rounded-xl border border-neutral-700 bg-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="border-b border-neutral-700">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={t("orphans.selectAll")}
                  className="accent-primary-500"
                  checked={chosen.length === orphans.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(orphans.map((o) => o.hash)) : new Set())}
                />
              </th>
              <th className="px-3 py-2.5 font-medium">{t("orphans.columns.torrent")}</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">{t("orphans.columns.category")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t("orphans.columns.size")}</th>
              <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">{t("orphans.columns.ratio")}</th>
              <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">{t("orphans.columns.seeding")}</th>
            </tr>
          </thead>
          <tbody>
            {orphans.map((o) => (
              <tr key={o.hash} className={cn("border-b border-neutral-700 last:border-0", selected.has(o.hash) && "bg-primary-400/5")}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={t("orphans.select", { name: o.name })}
                    className="accent-primary-500"
                    checked={selected.has(o.hash)}
                    onChange={() => toggle(o.hash)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <span className="break-all font-mono text-xs text-neutral-200">{o.name}</span>
                  {o.shares_data && (
                    <span className="mt-1 block w-fit rounded-full border border-neutral-600 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-neutral-400">
                      {t("orphans.shares")}
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-neutral-400 md:table-cell">{o.category}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatBytes(o.size_bytes)}</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{o.ratio?.toFixed(2) ?? "—"}</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                  {o.seeding_time_secs != null ? formatSeedDuration(o.seeding_time_secs, t) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chosen.length > 0 && (
        <div
          role="region"
          aria-label={t("orphans.selected", { count: chosen.length, size: formatBytes(bytes) })}
          className="fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center gap-3.5 rounded-2xl border border-neutral-600 bg-neutral-800 py-2.5 pl-4 pr-3 shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4"
        >
          <span className="font-semibold tabular-nums text-neutral-50">
            {t("orphans.selected", { count: chosen.length, size: formatBytes(bytes) })}
          </span>
          <label className="flex items-center gap-2 text-sm text-neutral-400">
            <input type="checkbox" className="accent-primary-500" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} aria-label={t("orphans.deleteData")} />
            {t("orphans.deleteData")}
          </label>
          {deleteData && chosen.some((o) => o.shares_data) && (
            <span className="rounded-full border border-amber-900/70 bg-amber-950/40 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
              {t("orphans.sharedNote")}
            </span>
          )}
          <Button type="button" size="sm" disabled={remove.isPending} onClick={onRemove}>
            {t("orphans.remove", { count: chosen.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/seeding/components && cd ../.. && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/seeding
git commit -m "feat(web): Orphans view with a selection action bar"
```

---

### Task 16: Settings: Seeding and Download safety sections

**Files:**
- Create: `apps/web/src/pages/settings/_component/SeedingSettingsSection.tsx`, `DownloadSafetySection.tsx`, `ExtensionChipInput.tsx`
- Modify: `apps/web/src/pages/settings/_component/MediaPostProcessingTab.tsx`, `MediaPostProcessingSettingsBody.tsx`
- Test: `apps/web/src/pages/settings/_component/SeedingSettingsSection.test.tsx`, `ExtensionChipInput.test.tsx`

**Interfaces:**
- Consumes: `useUpdateMediaPostProcessingSettings`, `useSeeding({ preview: true, enabled })`, `useSeedRules`, `useUpsertSeedRule`, `useDeleteSeedRule`, `useJanitorStats`, the `ruleDraft` helpers, and `Switch` (`checked` / `onCheckedChange`).
- Produces: `SeedingSettingsSection({ settings })`, `DownloadSafetySection({ settings })`, and `ExtensionChipInput({ value, onChange })`.

- [ ] **Step 1: Write the failing tests**

`ExtensionChipInput.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExtensionChipInput } from "./ExtensionChipInput";

describe("ExtensionChipInput", () => {
  it("adds on Enter or comma, normalizing and de-duplicating", () => {
    const onChange = vi.fn();
    render(<ExtensionChipInput value={["exe"]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: ".ISO" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["exe", "iso"]);
    fireEvent.change(input, { target: { value: "exe" } });
    fireEvent.keyDown(input, { key: "," });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("removes with the chip button and with Backspace on an empty input", () => {
    const onChange = vi.fn();
    render(<ExtensionChipInput value={["exe", "lnk"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.downloadSafety.remove" }));
    expect(onChange).toHaveBeenLastCalledWith(["lnk"]);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["exe"]);
  });
  it("flags invalid input instead of adding it", () => {
    const onChange = vi.fn();
    render(<ExtensionChipInput value={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "tar.gz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("settings.downloadSafety.invalid")).toBeInTheDocument();
  });
});
```

The "removes with the chip button" test expects the first chip button to remove `exe`, so query by `getAllByRole(...)[0]` if the i18n mock collapses both labels to the same key.

`SeedingSettingsSection.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaPostProcessingSettings } from "@rawkoon/shared/types";

const mutateAsync = vi.fn(async () => ({}));
vi.mock("@/features/medias/hooks/useUpdateMediaPostProcessingSettings", () => ({
  useUpdateMediaPostProcessingSettings: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/features/seeding/hooks/useSeeding", () => ({
  useSeeding: () => ({ data: { enabled: false, torrents: [], released_today: [], would_release_now: { count: 4, bytes: 1024 } } }),
}));
vi.mock("@/features/seeding/hooks/useSeedRules", () => ({
  useSeedRules: () => ({ data: { indexers: [] }, isLoading: false }),
  useUpsertSeedRule: () => ({ mutateAsync: vi.fn() }),
  useDeleteSeedRule: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SeedingSettingsSection } from "./SeedingSettingsSection";

const settings = {
  min_seed_ratio: 1, public_seed_time_mins: null, private_seed_ratio: 1, private_seed_time_mins: 4320,
  seed_sweep_enabled: false, file_operation: "hardlink", blocked_extensions: [],
} as unknown as MediaPostProcessingSettings;

describe("SeedingSettingsSection", () => {
  it("previews what enabling would release while it is off", () => {
    render(<SeedingSettingsSection settings={settings} />);
    expect(screen.getByText("settings.seeding.preview")).toBeInTheDocument();
  });
  it("saves the rules as minutes, with an empty public ratio meaning 0", async () => {
    render(<SeedingSettingsSection settings={settings} />);
    fireEvent.change(screen.getAllByLabelText("settings.seeding.ratio")[0], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.seeding.save" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        seed_sweep_enabled: false, min_seed_ratio: 0, public_seed_time_mins: null,
        private_seed_ratio: 1, private_seed_time_mins: 4320,
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/pages/settings/_component/ExtensionChipInput.test.tsx src/pages/settings/_component/SeedingSettingsSection.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `ExtensionChipInput.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

const normalize = (raw: string) => {
  const ext = raw.trim().toLowerCase().replace(/^\.+/, "");
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
};

export function ExtensionChipInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useTranslation("common");
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (draft.trim() === "") return;
    const ext = normalize(draft);
    if (!ext) {
      setInvalid(true);
      return;
    }
    if (!value.includes(ext)) onChange([...value, ext]);
    setDraft("");
    setInvalid(false);
  };

  return (
    <div>
      <div className="focus-within:ring-primary-400 flex flex-wrap gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 p-2 focus-within:ring-2">
        {value.map((ext) => (
          <span key={ext} className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800 py-0.5 pl-2 pr-1 font-mono text-xs">
            .{ext}
            <button
              type="button"
              aria-label={t("settings.downloadSafety.remove", { ext })}
              className="rounded px-0.5 text-neutral-500 hover:text-neutral-100"
              onClick={() => onChange(value.filter((v) => v !== ext))}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={draft}
          aria-label={t("settings.downloadSafety.add")}
          placeholder={t("settings.downloadSafety.add")}
          aria-invalid={invalid}
          className="min-w-32 flex-1 bg-transparent px-1 font-mono text-xs outline-none"
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
      </div>
      {invalid && <p className="mt-1 text-xs text-red-400">{t("settings.downloadSafety.invalid")}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SeedingSettingsSection.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import type { IndexerSeedRuleRow, MediaPostProcessingSettings, SeedRule } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUpdateMediaPostProcessingSettings } from "@/features/medias/hooks/useUpdateMediaPostProcessingSettings";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
import { useDeleteSeedRule, useSeedRules, useUpsertSeedRule } from "@/features/seeding/hooks/useSeedRules";
import { draftFromRule, type RuleDraft, ruleFromDraft, ruleSentence } from "@/features/seeding/lib/ruleDraft";
import { formatBytes } from "@/lib/utils/format";

const FIELD = "focus-ring w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm tabular-nums";

function RuleFields({ draft, onChange }: { draft: RuleDraft; onChange: (d: RuleDraft) => void }) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-wrap gap-2.5">
      <label className="grid gap-1 text-xs text-neutral-500">
        {t("settings.seeding.ratio")}
        <input inputMode="decimal" className={FIELD} placeholder={t("settings.seeding.none")} value={draft.ratio}
          aria-label={t("settings.seeding.ratio")} onChange={(e) => onChange({ ...draft, ratio: e.target.value })} />
      </label>
      <label className="grid gap-1 text-xs text-neutral-500">
        {t("settings.seeding.seedTime")}
        <span className="flex">
          <input inputMode="decimal" className={`${FIELD} rounded-r-none`} placeholder={t("settings.seeding.none")} value={draft.time}
            aria-label={t("settings.seeding.seedTime")} onChange={(e) => onChange({ ...draft, time: e.target.value })} />
          <select className="rounded-r-lg border border-l-0 border-neutral-700 bg-neutral-800 px-2 text-sm" value={draft.unit}
            aria-label={t("settings.seeding.seedTime")} onChange={(e) => onChange({ ...draft, unit: e.target.value as RuleDraft["unit"] })}>
            <option value="hours">{t("settings.seeding.unitHours")}</option>
            <option value="days">{t("settings.seeding.unitDays")}</option>
          </select>
        </span>
      </label>
    </div>
  );
}

function RuleCard({ title, isPrivate, draft, onChange }: { title: string; isPrivate?: boolean; draft: RuleDraft; onChange: (d: RuleDraft) => void }) {
  const { t } = useTranslation("common");
  const rule = ruleFromDraft(draft);
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-800 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 font-sans text-sm font-semibold text-neutral-100">
        {isPrivate && <Lock size={13} aria-hidden />}
        {title}
      </h3>
      <RuleFields draft={draft} onChange={onChange} />
      <p className="mt-2.5 min-h-5 text-sm text-neutral-200" aria-live="polite">
        {rule ? ruleSentence(rule, t) : <span className="text-red-400">{t("settings.seeding.invalid")}</span>}
      </p>
    </div>
  );
}

function IndexerRuleRow({ row }: { row: IndexerSeedRuleRow }) {
  const { t } = useTranslation("common");
  const upsert = useUpsertSeedRule();
  const remove = useDeleteSeedRule();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const parsed = editing ? ruleFromDraft(editing) : null;
  const inheritedFrom = t(row.is_private ? "settings.seeding.indexers.sourcePrivate" : "settings.seeding.indexers.sourcePublic");
  return (
    <tr className="border-b border-neutral-700 last:border-0">
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">{row.is_private && <Lock size={12} aria-hidden />}{row.indexer}</span>
      </td>
      <td className="px-3 py-2.5">
        {editing ? (
          <RuleFields draft={editing} onChange={setEditing} />
        ) : row.override ? (
          <span className="text-primary-300">{ruleSentence(row.effective, t)}</span>
        ) : (
          <span className="text-neutral-500">
            {t("settings.seeding.indexers.inherited", { rule: ruleSentence(row.effective, t), source: inheritedFrom })}
          </span>
        )}
      </td>
      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{row.held_count}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        {editing ? (
          <>
            <Button type="button" size="sm" disabled={!parsed} onClick={async () => {
              if (!parsed) return;
              await upsert.mutateAsync({ indexer: row.indexer, rule: parsed });
              setEditing(null);
            }}>{t("settings.seeding.indexers.save")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("settings.seeding.indexers.cancel")}</Button>
          </>
        ) : row.override ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => remove.mutateAsync(row.indexer)}>{t("settings.seeding.indexers.useDefault")}</Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(draftFromRule(row.effective))}>{t("settings.seeding.indexers.customize")}</Button>
        )}
      </td>
    </tr>
  );
}

export function SeedingSettingsSection({ settings }: { settings: MediaPostProcessingSettings }) {
  const { t } = useTranslation("common");
  const update = useUpdateMediaPostProcessingSettings();
  const [enabled, setEnabled] = useState(settings.seed_sweep_enabled);
  const [pub, setPub] = useState<RuleDraft>(() =>
    draftFromRule({ ratio: settings.min_seed_ratio > 0 ? settings.min_seed_ratio : null, seed_time_mins: settings.public_seed_time_mins }),
  );
  const [priv, setPriv] = useState<RuleDraft>(() =>
    draftFromRule({ ratio: settings.private_seed_ratio, seed_time_mins: settings.private_seed_time_mins }),
  );
  const preview = useSeeding({ preview: true, enabled: !enabled });
  const rules = useSeedRules();
  const wouldRelease = preview.data?.would_release_now;

  const onSave = async () => {
    const p: SeedRule | null = ruleFromDraft(pub);
    const q: SeedRule | null = ruleFromDraft(priv);
    if (!p || !q) return;
    try {
      await update.mutateAsync({
        seed_sweep_enabled: enabled,
        // min_seed_ratio 0 is the existing "no public ratio target".
        min_seed_ratio: p.ratio ?? 0,
        public_seed_time_mins: p.seed_time_mins,
        private_seed_ratio: q.ratio,
        private_seed_time_mins: q.seed_time_mins,
      });
      toast.success(t("settings.seeding.saved"));
    } catch {
      toast.error(t("settings.seeding.saveError"));
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-neutral-700 bg-neutral-900/50 p-5">
      <div>
        <h2 className="text-xl">{t("settings.seeding.title")}</h2>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-400">{t("settings.seeding.description")}</p>
      </div>
      <label className="flex items-start gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("settings.seeding.enable")} />
        <span>
          <span className="block text-sm font-medium text-neutral-100">{t("settings.seeding.enable")}</span>
          <span className="block text-xs text-neutral-500">{t("settings.seeding.enableHint")}</span>
        </span>
      </label>
      {!enabled && wouldRelease && wouldRelease.count > 0 && (
        <p className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200">
          {t("settings.seeding.preview", { count: wouldRelease.count, size: formatBytes(wouldRelease.bytes) })}
        </p>
      )}
      {settings.file_operation === "move" && <p className="text-sm text-amber-200">{t("settings.seeding.moveMode")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <RuleCard title={t("settings.seeding.publicTitle")} draft={pub} onChange={setPub} />
        <RuleCard title={t("settings.seeding.privateTitle")} isPrivate draft={priv} onChange={setPriv} />
      </div>
      <p className="text-xs text-neutral-500">{t("settings.seeding.unknownPrivate")}</p>
      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={update.isPending || !ruleFromDraft(pub) || !ruleFromDraft(priv)}>
          {t("settings.seeding.save")}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-700 bg-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="border-b border-neutral-700">
              <th className="px-3 py-2.5 font-medium">{t("settings.seeding.indexers.indexer")}</th>
              <th className="px-3 py-2.5 font-medium">{t("settings.seeding.indexers.rule")}</th>
              <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">{t("settings.seeding.indexers.held")}</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {(rules.data?.indexers ?? []).map((row) => <IndexerRuleRow key={row.indexer} row={row} />)}
          </tbody>
        </table>
        {rules.data && rules.data.indexers.length === 0 && (
          <p className="px-3 py-4 text-sm text-neutral-500">{t("settings.seeding.indexers.empty")}</p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Implement `DownloadSafetySection.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { MediaPostProcessingSettings } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { useUpdateMediaPostProcessingSettings } from "@/features/medias/hooks/useUpdateMediaPostProcessingSettings";
import { useJanitorStats } from "@/features/seeding/hooks/useJanitorStats";
import { ExtensionChipInput } from "./ExtensionChipInput";

export function DownloadSafetySection({ settings }: { settings: MediaPostProcessingSettings }) {
  const { t } = useTranslation("common");
  const update = useUpdateMediaPostProcessingSettings();
  const stats = useJanitorStats();
  const [exts, setExts] = useState(settings.blocked_extensions);

  const onSave = async () => {
    try {
      await update.mutateAsync({ blocked_extensions: exts });
      toast.success(t("settings.downloadSafety.saved"));
    } catch {
      toast.error(t("settings.downloadSafety.saveError"));
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-neutral-700 bg-neutral-900/50 p-5">
      <div>
        <h2 className="text-xl">{t("settings.downloadSafety.title")}</h2>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-400">{t("settings.downloadSafety.description")}</p>
      </div>
      <ExtensionChipInput value={exts} onChange={setExts} />
      {stats.data && (
        <p className="text-sm text-neutral-400">
          {t("settings.downloadSafety.stats", { malware: stats.data.malware, stalled: stats.data.stalled, imports: stats.data.import_rejected })}{" "}
          <a href="/settings?tab=blocklist" className="text-primary-400 underline underline-offset-2">{t("settings.downloadSafety.statsLink")}</a>
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={update.isPending}>{t("settings.downloadSafety.save")}</Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Wire the sections into the tab and retire the old ratio field**

- **`MediaPostProcessingTab.tsx`:** replace the returned `<MediaPostProcessingSettingsBody …/>` with:

```tsx
    <div className="space-y-6">
      <MediaPostProcessingSettingsBody key={settings.updated_at} settings={settings} profilesData={profilesData} />
      <SeedingSettingsSection key={`seed-${settings.updated_at}`} settings={settings} />
      <DownloadSafetySection key={`safety-${settings.updated_at}`} settings={settings} />
    </div>
```

  and import both sections from `./SeedingSettingsSection` and `./DownloadSafetySection`.
- **`MediaPostProcessingSettingsBody.tsx`:**
  - Delete the `<FormInput label={t("settings.mediaLibrary.minSeedRatio")} … />` block.
  - Delete the `minSeedRatio` key from `mediaSettingsSchema` and from `defaultValues`.
  - Delete the `min_seed_ratio: data.minSeedRatio,` line in `onSubmit`, because the Seeding section owns that value now.
  - Leave the `settings.mediaLibrary.minSeedRatio` locale key alone unless `knip` or the l10n check flags it as unused; if flagged, remove it from both locales.

- [ ] **Step 7: Run tests, typecheck and lint**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/pages/settings && cd ../.. && bun run typecheck && bun run lint`
Expected: PASS. Existing settings tests that asserted the ratio field are updated to expect it absent.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): seeding rules and download safety settings with live rule sentences"
```

---

### Task 17: Blocklist kinds, health-card orphan line, history seed chip, remove dialog, jobs entry

**Files:**
- Modify: `apps/web/src/pages/settings/_component/BlocklistTab.tsx` (+ `BlocklistTab.test.tsx`)
- Modify: `apps/web/src/pages/settings/_component/LibraryHealthCard.tsx`
- Modify: `apps/web/src/pages/medias/_component/LibraryDownloadHistorySection.tsx`
- Modify: `apps/web/src/pages/medias/_component/LibraryActionsSection.tsx`, `apps/web/src/features/medias/hooks/useRemoveFromLibrary.ts`
- Modify: `apps/web/src/pages/settings/_component/jobsConfig.ts`
- Create: `apps/web/src/features/seeding/components/SeedChip.tsx` (+ `SeedChip.test.tsx`)
- Test: `apps/web/src/pages/medias/_component/LibraryActionsSection.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing tests**

Add to `BlocklistTab.test.tsx`: an `ENTRY_A` variant with `kind: "malware"` (give the existing `ENTRY_A` `kind: null` so it still type-checks), then:

```tsx
  it("badges automatic entries by kind and filters by source", () => {
    useBlocklistMock.mockReturnValue({ data: { entries: [{ ...ENTRY_A, kind: "malware" }] }, isLoading: false, error: null });
    render(<BlocklistTab />);
    expect(screen.getAllByText("settings.blocklist.kind.malware").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "settings.blocklist.filter.auto" }));
    expect(useBlocklistMock).toHaveBeenLastCalledWith({ source: "auto" });
  });
```

Change the hook mock to `useBlocklist: (opts?: unknown) => useBlocklistMock(opts)`, and import `fireEvent`.

`SeedChip.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeedChip } from "./SeedChip";

describe("SeedChip", () => {
  it("renders nothing without seed state", () => {
    const { container } = render(<SeedChip seed={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("labels each state", () => {
    render(<SeedChip seed={{ state: "blocklisted", reason: "malware", ratio: null, seeding_time_secs: null }} />);
    expect(screen.getByText("library.download.seed.blocklisted")).toBeInTheDocument();
    expect(screen.getByText("library.download.seed.reason.malware")).toBeInTheDocument();
  });
});
```

`LibraryActionsSection.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const removeMutateAsync = vi.fn(async () => ({ success: true }));
const downloadsMock = vi.fn();
const seedingMock = vi.fn();
vi.mock("@/features/medias/hooks/useRemoveFromLibrary", () => ({ useRemoveFromLibrary: () => ({ mutateAsync: removeMutateAsync, isPending: false }) }));
vi.mock("@/features/medias/hooks/useRetrySkippedMedia", () => ({ useRetrySkippedMedia: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/features/medias/hooks/useToggleMediaMonitored", () => ({ useToggleMediaMonitored: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/features/medias/hooks/useLibraryDownloads", () => ({ useLibraryDownloads: () => downloadsMock() }));
vi.mock("@/features/seeding/hooks/useSeeding", () => ({ useSeeding: () => seedingMock() }));

import { LibraryActionsSection } from "./LibraryActionsSection";

const HELD = { items: [{ id: 1, torrent_hash: "AA", seed: { state: "seeding", reason: null, ratio: 0.2, seeding_time_secs: 10 } }] };

describe("LibraryActionsSection remove", () => {
  beforeEach(() => {
    removeMutateAsync.mockClear();
    seedingMock.mockReturnValue({ data: { torrents: [{ hash: "aa", owes_seed_time: true }] } });
  });

  const openConfirm = () => fireEvent.click(screen.getByRole("button", { name: "library.management.delete" }));

  it("offers keep-seeding vs remove-now when torrents are held, warning about a hit-and-run", async () => {
    downloadsMock.mockReturnValue({ data: HELD });
    render(<LibraryActionsSection libraryId={5} />);
    openConfirm();
    expect(screen.getByText("library.management.seedingTitle")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/library.management.releaseNow/));
    expect(screen.getByText("library.management.hnrWarning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /library.management.deleteConfirm/ }));
    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalledWith({ id: 5, deleteFiles: true, releaseTorrents: true }));
  });

  it("shows no seeding choice when nothing is held", () => {
    downloadsMock.mockReturnValue({ data: { items: [] } });
    render(<LibraryActionsSection libraryId={5} />);
    openConfirm();
    expect(screen.queryByText("library.management.seedingTitle")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/pages/settings/_component/BlocklistTab.test.tsx src/features/seeding/components/SeedChip.test.tsx src/pages/medias/_component/LibraryActionsSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `SeedChip.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import type { DownloadSeedState } from "@rawkoon/shared/types";
import { formatSeedDuration } from "@/features/seeding/lib/seedFormat";
import { cn } from "@/lib/utils";

const TONE: Record<DownloadSeedState["state"], string> = {
  seeding: "border-emerald-900/60 bg-emerald-950/40 text-emerald-200",
  released: "border-neutral-700 bg-white/5 text-neutral-400",
  blocklisted: "border-amber-900/70 bg-amber-950/40 text-amber-200",
};

export function SeedChip({ seed }: { seed: DownloadSeedState | null | undefined }) {
  const { t } = useTranslation("common");
  if (!seed) return null;
  const tone = seed.state === "blocklisted" && seed.reason === "malware" ? "border-red-900 bg-red-950/40 text-red-300" : TONE[seed.state];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
      <span className={cn("rounded-full border px-2 py-0.5 font-semibold", tone)}>{t(`library.download.seed.${seed.state}`)}</span>
      {seed.state === "seeding" ? (
        <span>{t("library.download.seed.seedingDetail", { ratio: (seed.ratio ?? 0).toFixed(2), time: formatSeedDuration(seed.seeding_time_secs ?? 0, t) })}</span>
      ) : seed.reason ? (
        <span>{t(`library.download.seed.reason.${seed.reason}`)}</span>
      ) : null}
    </span>
  );
}
```

In `LibraryDownloadHistorySection.tsx`, directly after the closing `</div>` of the row's first `flex items-start justify-between` line (the release-title row), render `<SeedChip seed={row.seed} />`. Import it from `@/features/seeding/components/SeedChip`.

- [ ] **Step 4: Blocklist tab filters and badge**

In `BlocklistTab.tsx`:
- Add `const [source, setSource] = useState<"all" | "auto" | "manual">("all");`.
- Change the hook call to `useBlocklist(source === "all" ? undefined : { source })`.
- Render a `SegmentedTabs variant="chips"` with the items `all`, `auto` and `manual`, labelled `t(\`settings.blocklist.filter.${id}\`)`, in the card header under the description.
- In both the desktop and mobile row renderings, before the reason text, render the kind badge when `entry.kind` is set:

```tsx
{entry.kind && (
  <span className={cn(
    "mr-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
    entry.kind === "malware" ? "border-red-900 bg-red-950/40 text-red-300"
      : entry.kind === "stalled" ? "border-amber-900/70 bg-amber-950/40 text-amber-200"
      : "border-neutral-700 bg-white/5 text-neutral-400",
  )}>
    {t(`settings.blocklist.kind.${entry.kind}`)}
  </span>
)}
```

Import `useState`, `cn` and `SegmentedTabs`.

- [ ] **Step 5: Health card orphan line**

In `LibraryHealthCard.tsx`, add a component and render `<OrphanHealthRow />` as the last child of the card's outer `<section>`:

```tsx
function OrphanHealthRow() {
  const { t } = useTranslation("common");
  const { data } = useOrphans();
  if (!data || data.orphans.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-700 pt-3">
      <div>
        <p className="text-sm font-semibold text-neutral-100">
          {t("orphans.health.title", { count: data.orphans.length, size: formatBytes(data.total_bytes) })}
        </p>
        <p className="text-xs text-neutral-400">{t("orphans.health.description")}</p>
      </div>
      <a href="/library/downloads?view=orphans" className="text-sm text-primary-400 underline underline-offset-2">
        {t("orphans.health.action")}
      </a>
    </div>
  );
}
```

Import `useTranslation`, `useOrphans` and `formatBytes`. The card already receives `t` as a prop; the row uses its own hook, so it can render anywhere.

- [ ] **Step 6: Remove dialog and mutation**

`useRemoveFromLibrary.ts`: add a `releaseTorrents?: boolean` argument and build the URL with `URLSearchParams`:

```ts
    mutationFn: ({ id, deleteFiles, releaseTorrents }: { id: number; deleteFiles?: boolean; releaseTorrents?: boolean }) => {
      const params = new URLSearchParams();
      if (deleteFiles) params.set("delete_files", "true");
      if (releaseTorrents) params.set("release_torrents", "true");
      const qs = params.toString();
      return fetcher<{ success: boolean; released?: number }>(
        qs ? `${LIBRARY_ENDPOINTS.REMOVE(id)}?${qs}` : LIBRARY_ENDPOINTS.REMOVE(id),
        { method: "DELETE" },
      );
    },
```

Also add `queryClient.invalidateQueries({ queryKey: queryKeys.downloads.all });` to `onSuccess`.

`LibraryActionsSection.tsx`:
- Import `useLibraryDownloads` and `useSeeding`.
- After the existing `useState` calls, add:

```tsx
  const confirming = deleteConfirm === "confirm";
  const { data: downloads } = useLibraryDownloads(confirming ? libraryId : null);
  const heldHashes = new Set(
    (downloads?.items ?? [])
      .filter((i) => i.seed?.state === "seeding" && i.torrent_hash)
      .map((i) => (i.torrent_hash as string).toLowerCase()),
  );
  const { data: seeding } = useSeeding({ enabled: confirming && heldHashes.size > 0 });
  const owesSeedTime = (seeding?.torrents ?? []).some((s) => heldHashes.has(s.hash) && s.owes_seed_time);
  const [releaseNow, setReleaseNow] = useState(false);
```

- Inside the confirm card, after the delete-files `<label>`, add:

```tsx
          {heldHashes.size > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-[11px] text-red-300/80">
                {t("library.management.seedingTitle", { count: heldHashes.size })}
              </legend>
              {[
                { value: false, label: t("library.management.keepSeeding"), hint: t("library.management.keepSeedingHint") },
                { value: true, label: t("library.management.releaseNow"), hint: t("library.management.releaseNowHint") },
              ].map((opt) => (
                <label key={String(opt.value)} className="flex cursor-pointer items-start gap-2 text-xs text-red-200">
                  <input type="radio" name={`release-${libraryId}`} className="mt-0.5" checked={releaseNow === opt.value}
                    onChange={() => setReleaseNow(opt.value)} aria-label={opt.label} />
                  <span><span className="block font-semibold">{opt.label}</span><span className="text-red-300/70">{opt.hint}</span></span>
                </label>
              ))}
              {releaseNow && owesSeedTime && (
                <p className="rounded-md border border-amber-900/70 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200">
                  {t("library.management.hnrWarning")}
                </p>
              )}
            </fieldset>
          )}
```

- Pass `releaseTorrents: releaseNow && heldHashes.size > 0` in the `mutateAsync` call.

- [ ] **Step 7: Jobs tab entry**

In `jobsConfig.ts`:
- Add `| "sweep_seeding_torrents"` to `JobAction`.
- Add `Sprout` to the lucide import.
- Append:

```ts
  {
    action: "sweep_seeding_torrents",
    jobNames: ["sweep-seeding-torrents"],
    Icon: Sprout,
    labelKey: "settings.jobs.actions.sweepSeedingTorrents.label",
    descriptionKey: "settings.jobs.actions.sweepSeedingTorrents.description",
  },
```

- [ ] **Step 8: Run tests, typecheck and lint**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run && cd ../.. && bun run typecheck && bun run lint`
Expected: PASS. That is the full web suite.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): blocklist kinds, orphan health line, seed chips and a seeding-aware remove dialog"
```

---

### Task 18: Full gates and a manual check against the dev client

**Files:** none new. This task verifies and fixes only.

- [ ] **Step 1: Full suites against `main`**

```bash
cd ~/sites/rawkoon-cleanup-spec
bun run typecheck && bun run lint && bun run formatCheck && bun run knip
(cd apps/api && bun test) 2>&1 | tail -5
(cd apps/web && env -u NODE_ENV bunx vitest run) 2>&1 | tail -5
(cd apps/shared && bun test) 2>&1 | tail -3
git stash -u 2>/dev/null; git switch -q main && (cd apps/api && bun test) 2>&1 | tail -5; git switch -q feat/cleanup-release; git stash pop 2>/dev/null || true
```

Expected:
- typecheck, lint, format and knip are all clean. If knip flags an export, remove the export or the file it points to.
- The API fail count on the branch is **≤** the count on `main`. Any extra failure is ours: fix it, never skip it.
- Web and shared are green.

- [ ] **Step 2: e2e endpoint sweep**

```bash
cd apps/api
env -u BASE_URL -u NODE_ENV DATABASE_URL="postgresql://<dev-user>:<dev-pass>@localhost:5433/rawkoon_e2e" \
  SECRET_KEY=e2e-secret-key-that-is-at-least-32-chars BETTER_AUTH_SECRET=e2e-auth-secret-that-is-at-least-32-chars \
  bash -c 'bunx prisma migrate deploy && bun run e2e:endpoints'
```

Take the credentials from the root `.env`'s `DATABASE_URL`, pointed at the `rawkoon_e2e` database.

Expected: every route passes, including the eight `/api/downloads` routes and their non-admin 403 checks.

- [ ] **Step 3: Manual check against the dev download client only**

With `bun run dev:services`, `bun run dev:api` and `bun run dev:web` running, and a **dev** qBittorrent configured, never the production one:

1. In Settings › Media, enable seeding and set the public rule to ratio `0.01`. Add a small, legal public torrent through a library grab. After import, the Seeding tab shows it and the release meter moves. Within 15 minutes, or immediately via Settings › Jobs › "Release seeded torrents", it folds into "Released today" **without a page reload**.
2. Build a local torrent containing a dummy `setup.exe` next to an `.mkv` (`mktorrent` or `transmission-create`), add it through a grab, and confirm it is rejected before import. Check that it appears in the blocklist as *Blocked file* and that its data is gone from the downloads folder.
3. Add a torrent by hand in qBittorrent with category `rawkoon-movies`. It appears under Orphans and on the Settings › Jobs health card, and "Remove" clears it.
4. Add a second torrent with the same content path, as a cross-seed. Removing the first keeps the files on disk.
5. Remove a title while its grab is still downloading. The torrent disappears from the client, and no "post-processing failed" notification arrives afterwards.

Record each of the five outcomes, pass or fail, in the PR description. Record any failure as a bug fixed in this branch, not as a follow-up.

- [ ] **Step 4: iOS re-check**

If any iOS file changed after Task 9, repeat Task 9 Step 5 on the final HEAD.

- [ ] **Step 5: Open the PR, and do not release**

```bash
git push -u origin feat/cleanup-release
gh pr create --title "Queue janitor and seeding lifecycle" --body-file <(cat <<'EOF'
## What
- Stalled, blocked-file and no-content releases are blocklisted and removed, so search moves on to another release.
- Torrents are released from the download client once their seed target is met: public and private defaults plus per-indexer overrides. This includes titles later removed or upgraded.
- Orphaned torrents in Rawkoon's categories are listed and can be removed.
- A new Downloads page (Import / Seeding / Orphans) updates live over the `library.seed-state` SSE event.
- The seeding sweep is **off by default** and previews what it would release before it is enabled.

## Verification
- Full API / web / shared suites compared against main; typecheck, lint, format, knip.
- e2e endpoint sweep.
- iOS contract stub verified on macbuild.
- Manual check against a dev download client: <five outcomes>.
EOF
)
```

Never tag, bump the version or publish a release from this branch. Releasing is a separate, explicitly requested step.

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task.

| Spec section | Task |
|---|---|
| Data model | 1 |
| Seed rules | 3, 4 |
| Adapters | 2 |
| Janitor | 5, 6, 8 |
| Seed sweep | 7, 10 |
| Orphans | 3, 11 |
| API surface | 11, 12 |
| Live updates | 9, 13 |
| UI | 14–17 |
| Rollout | 1 (flag default), 10 (audit) |
| Testing | every task, plus 18 |

- **Deviations the executor should know about**, all reflected in the spec's amended sections:
  - Malware detection returns the offending path (`findBlockedFile`), rather than a boolean `hasBlockedFile`.
  - "Strictest rule wins" is implemented as "every owning rule must be met" (`governingProgress`). Merging targets is wrong under either-target semantics.
  - `DownloadHistory.seedReleasedBytes` is added to back the "GB freed" line.
  - The pending-download select in reconcile now includes `bookEditionId`. This also fixes book stall-fails never reverting the edition.
