# Cleanup release: queue janitor and seeding lifecycle

Date: 2026-09-22 · Status: design approved, pending spec review
Research: [feature hunt](../research/2026-09-22-feature-hunt.md), Tier 1 items 1 and 2
Mockup: [`2026-09-22-cleanup-release-mockup/index.html`](2026-09-22-cleanup-release-mockup/index.html), opened in a browser. Views are switched with `?view=seeding|orphans|settings|media|remove`.

## Goal

Stop dead and fake releases from wasting grabs. Stop the download client from filling with torrents that Rawkoon has forgotten about. Do both without breaking private-tracker seeding obligations.

**Success criteria**

1. A release that fails by stalling, by containing a blocked file type, or by holding no importable content is never grabbed again. The next search moves on to another release.
2. A torrent containing an executable is rejected before import. Its data is removed from the client.
3. After import, every torrent Rawkoon added is removed from the client once its seed target is met. That includes torrents for titles later deleted or upgraded. A torrent is never removed before its target unless an admin explicitly chooses to.
4. Torrents in Rawkoon's categories that no download owns are visible, and can be removed in one action.
5. An admin can see, live, what Rawkoon is holding and when each torrent will be released.

**Non-goals**
- Minimum-speed and strike rules. The existing stall timeout is enough.
- Rules keyed by tracker URL. Rules are keyed by indexer.
- iOS surfaces. The API contract supports them later.
- Usenet.

## Current behaviour (verified in code)

- **Stall and max-age timeouts.** `checkDownloadCompletion` → `failDownload` (`services/downloadOutcome.ts`) marks the row failed and calls `revertToWantedIfNoActiveGrabs`. It does **not** blocklist the release and does **not** remove the torrent. Search already skips blocklisted titles (`mediaGrabberSearch.ts`, pre-filter) and grab checks blocklisted hashes (`mediaGrabberGrab.ts` → `checkBlocklist`). Writing the blocklist entry is therefore enough to break the re-grab loop.
- **Seeding after import.** Post-processing (`postProcessorSingle.ts`, `postProcessorSeasonPack.ts`) removes the torrent with `remove(hash, false)` only if `ratio >= MediaSettings.minSeedRatio` **at import time**, or if `minSeedRatio <= 0`. A torrent below the ratio at import is never revisited. There is no seed-time target.
- **Library delete.** `DELETE /api/library/:id` deletes the media's `DownloadHistory` rows and never touches the client, so the torrent is orphaned permanently.
- **Upgrade.** The old library files are deleted, but the old grab's torrent is left in the client.
- **Adapters.** `DownloadClientAdapter` has `remove(hash, deleteData)` but no file listing, and `NormalizedTorrent` has no seed time.
- **File operations.** Only `hardlink` and `move` exist. With a hardlink, the library keeps its own inode after the client data is deleted. With move, the files have already left the client, so the torrent can't seed.
- **Constraint.** `ck_download_history_single_target` forbids *both* `media_id` and `book_edition_id` being set, but allows both to be null. So `DownloadHistory` rows can outlive their media (`onDelete: SetNull`).

## Decisions

| Question | Decision |
|---|---|
| Seeding obligations | Private trackers are in use, so hit-and-run avoidance is a hard requirement |
| Where seed targets come from | Rawkoon-owned rules: a public default, a private default, and per-indexer overrides |
| Slow-download rules | None beyond the existing stall timeout and max age |
| Orphans | Report, plus one-click remove. Never removed automatically |
| Ownership ledger | `DownloadHistory` (approach A). No separate seeding table |

## 1. Data model

One additive migration.

```prisma
model DownloadHistory {
  // … existing fields
  /// When Rawkoon removed (or stopped tracking) this row's torrent. Null = still owned.
  seedReleasedAt    DateTime? @map("seed_released_at")
  /// target_met | stalled | malware | import_rejected | manual | move_mode | adopted
  seedReleaseReason String?   @map("seed_release_reason")
  /// Torrent size at release, for the "GB freed" line; null when unknown.
  seedReleasedBytes BigInt?   @map("seed_released_bytes")
}

model GrabBlocklist {
  // … existing fields
  /// stalled | malware | import_rejected; null = added by a user.
  kind String?
}

model IndexerSeedRule {
  id           Int      @id @default(autoincrement())
  indexerName  String   @unique @map("indexer_name")
  ratio        Float?
  seedTimeMins Int?     @map("seed_time_mins")
  updatedAt    DateTime @updatedAt @map("updated_at")
  @@map("indexer_seed_rule")
}

model MediaSettings {
  // … existing fields; minSeedRatio is kept and becomes the public ratio default
  publicSeedTimeMins  Int?     @map("public_seed_time_mins")
  privateSeedRatio    Float?   @default(1)    @map("private_seed_ratio")
  privateSeedTimeMins Int?     @default(4320) @map("private_seed_time_mins")
  /// Off until an admin enables it (see Rollout).
  seedSweepEnabled    Boolean  @default(false) @map("seed_sweep_enabled")
  blockedExtensions   String[] @default(["exe","scr","lnk","bat","cmd","com","msi","pif","vbs","ps1","jar","apk"]) @map("blocked_extensions")
}
```

The `ix_download_history_seed_pending` index on `(torrent_hash)` is created in the migration SQL only, and documented in a schema comment: Prisma can't express partial indexes and ignores them in drift detection. It is partial (`WHERE seed_released_at IS NULL AND completed_at IS NOT NULL AND failed = false`). It serves the sweep query on a table that only grows, following the precedent of `ix_download_history_active_grabbed_at`.

## 2. Seed rules

`resolveSeedRule(indexerNames[], ctx) → { ratio: number | null, seedTimeMins: number | null }` is a pure function, in `services/seeding/seedRules.ts`.

- **Per indexer**, the first match wins:
  1. The `IndexerSeedRule` override.
  2. The private default, if the indexer is private.
  3. The public default: `minSeedRatio` and `publicSeedTimeMins`.
- **Privacy** comes from the indexer manager's `privacy` field, cached for 1 hour. An indexer that is unknown, unreachable, or recorded as null on the row is treated as **private**.
- **A hash owned by several rows with different indexers** takes the **strictest** rule: the maximum of each non-null target.
- **Target met:** `(ratio != null && torrent.ratio >= ratio) || (seedTimeMins != null && torrent.seedingTimeSecs >= seedTimeMins * 60)`.
- **Both targets null** means the torrent is met right after import. This matches today's `minSeedRatio <= 0`.
- **Move mode** always counts as met, with reason `move_mode`.

## 3. Adapter changes

Applied to all three adapters (`services/downloadClient/*`).

- `NormalizedTorrent.seedingTimeSecs: number | null`. It maps to qBittorrent `seeding_time`, Transmission `secondsSeeding`, and Deluge `seeding_time`.
- `NormalizedTorrent.upSpeed: number` (bytes/s), for the release estimate.
- `NormalizedTorrent.category: string | null`. This is the qBittorrent category and is `null` for Transmission and Deluge; those two prove ownership through the `rawkoon-dh-N` label alone.
- `listFiles(hash): Promise<string[] | null>` returns relative paths, or `null` while metadata is unknown. All three clients report an empty file list before metadata arrives, so an empty list maps to `null`. It maps to qBittorrent `/api/v2/torrents/files`, Transmission `torrent-get ["files"]`, and Deluge `core.get_torrent_status(hash, ["files"])`.

## 4. Queue janitor

The new `services/downloadJanitor.ts` exposes one condemning entry point:

```ts
rejectRelease(dh: DownloadRef & { torrentHash: string | null; releaseTitle: string; indexer: string | null },
              kind: "stalled" | "malware" | "import_rejected",
              reason: string): Promise<void>
```

1. Calls `failDownload(dh, reason)`, which is unchanged. That marks the row failed, reverts the title to wanted, and notifies admins.
2. Creates a `GrabBlocklist` entry: `{ torrentHash, releaseTitle, indexer, mediaId, episodeId, kind, reason }`. Book grabs leave `mediaId` and `episodeId` null. The blocklist is keyed by title and hash, so it still applies, and the blocklist tab shows them by release title.
3. If the torrent passes the ownership safeguards (§5), calls `remove(hash, true)`. It also stamps `seedReleasedAt = now()` and `seedReleaseReason = kind`.

**Triggers**

| Trigger | Source | Action |
|---|---|---|
| Stall timeout | `classifyPendingAgainstTorrent` verdict `fail` with a stall reason | `rejectRelease("stalled")` |
| Max age exceeded | same | `rejectRelease("stalled")` |
| Blocked file type | reconcile pre-check | `rejectRelease("malware")` |
| No importable content | post-processor result `rejectKind: "no_content"` | `rejectRelease("import_rejected")` |
| Season-pack numbering mismatch | post-processor result `rejectKind: "pack_mismatch"`. This replaces the direct `grabBlocklist.create` in `postProcessorSeasonPack.ts` | `rejectRelease("import_rejected")` |
| Client `error` state | verdict `fail`, error reason | plain `failDownload`, no blocklist |
| Torrent missing (rescan) | `treatMissingAsFailed` | plain `failDownload` |
| Environmental import failure (paths, client unreachable, post-processing disabled) | post-processor | unchanged, retryable |

**Typed failure.** The verdict carries a typed `failKind: "stalled" | "error"` instead of callers matching reason strings. Post-processor results gain an optional `rejectKind`. Content failures in `postProcessorSingle` ("No video file found"), `postProcessorSeasonPack` ("No video files found", mapping mismatch) and `postProcessorBook` (an import that produced no book files) set it. Environmental failures never set it.

**Malware pre-check** (`hasBlockedFile(files, exts)`, a pure function):
- It matches on the final path segment's extension, case-insensitive, and nothing else.
- It runs in `reconcilePendingDownloads` on every pending row not yet in `ReconcileState.filesChecked`, **before** the verdict. A small torrent that finished between passes is still caught before completion is recorded.
- `null` (no metadata yet) means retry on the next pass.
- A clean result adds the row id to `filesChecked`.
- A second check in `finishPostProcess`, before it dispatches to a post-processor, covers completions from the download hook that bypass the pass.
- An empty `blockedExtensions` list disables it.

## 5. Seed sweep

`services/seeding/seedSweep.ts` exposes `evaluateSeedRelease(hash)` and `runSeedSweep()`. The scheduled job `sweep-seeding-torrents` runs every 15 minutes. It gets entries in `SCHEDULED_JOB_NAMES`, `setupScheduledJobs`, and a handler in `src/workers/`. The job does nothing while `seedSweepEnabled` is false.

**Pass**

1. Load the rows where `completedAt != null AND failed = false AND torrentHash != null AND seedReleasedAt IS NULL`, group them by hash, and call `listTorrents()` once. If the client is unreachable, end the pass with nothing stamped.
2. For each hash, the first applicable step wins:
   1. **Absent from the client:** stamp all rows `manual`.
   2. **Another row on the hash is still pending** (`completedAt IS NULL AND failed = false`): skip.
   3. **Torrent not in a completed or seeding state:** skip.
   4. **Not owned:** the category isn't `rawkoon-*` and there's no `rawkoon-dh-N` tag. Stamp `adopted` and leave the torrent in the client.
   5. **Target not met** (§2): skip.
   6. **Otherwise release it:**
      - `deleteData = !sharesContentPath(torrent, allTorrents)`, where another torrent has the same `contentPath` (cross-seed).
      - Call `remove(hash, deleteData)`, then stamp all rows `target_met` (or `move_mode`).
      - If `remove` throws, leave the rows unstamped so the next pass retries, and log.
3. Broadcast a `seed-state` SSE event (§8) for every hash that was evaluated.

**Post-import**
- `postProcessorSingle`, `postProcessorSeasonPack` and `postProcessorBook` replace their inline ratio check with `evaluateSeedRelease(hash)` when `seedSweepEnabled` is on.
- When it's off, the existing inline behaviour stays exactly as it is, so there is no regression before an admin opts in.

**Library delete** (`DELETE /api/library/:id`)
- It no longer calls `downloadHistory.deleteMany`. `onDelete: SetNull` keeps the rows, which then keep seeding until their target.
- The new optional query `release_torrents=true` evaluates each owned hash with the target treated as met. It removes the torrent (subject to the same ownership and shared-data safeguards) and stamps it `manual`.
- Book delete already keeps its rows (the edition cascade sets `book_edition_id` to null), so book torrents also seed to target. Releasing a book torrent early is done from the Seeding view's "Remove now".

**Upgrade.** No new code. The replaced row stays completed and unreleased, so the sweep picks it up.

**Manual release.** `POST /api/downloads/seeding/:hash/release` is the "Remove now" action. It removes the torrent regardless of target and stamps it `manual`.

## 6. Orphans

`classifyOrphans(torrents, knownHashes)` is a pure function. An orphan is a torrent in a `rawkoon-*` category, or tagged `rawkoon-dh-N`, whose hash appears in no **non-failed** `DownloadHistory` row. So a torrent left behind by a failed download (a client error state, or a rejected release whose removal failed) shows up as an orphan instead of lingering invisibly. A completed, non-failed row whose torrent is still present counts as owned; the sweep handles it.

- `GET /api/downloads/orphans` returns, for each orphan: hash, name, category, size, ratio, `seedingTimeSecs`, `contentPath`, and `sharesData`. The list is computed live, with no table.
- `POST /api/downloads/orphans/remove { hashes: string[], deleteData: boolean }`:
  - The server **re-classifies** every hash and removes only confirmed orphans.
  - It forces `deleteData = false` for any orphan whose `sharesData` is true.
  - It returns what was removed and what was refused.
- The library health card (`LibraryHealthCard`, Settings › Jobs) reads `GET /orphans` and adds "N orphaned torrents, X GB", linked to `/library/downloads?view=orphans`. `healthCheck.ts` is the infrastructure probe behind `/api/health` and is not touched.

## 7. API surface

This is a new `downloads` route domain (`routes/downloads/index.ts`, mounted at `/api/downloads`). Every route is **admin-only, guarded per route with `requireAdmin`**, not with a `.use('*')` guard, which leaks across `.route()` merges.

| Route | Purpose |
|---|---|
| `GET /seeding` | Held torrents. Each has title, media or book link, badges (removed / upgraded), indexer and privacy, the resolved rule, ratio, `seedingTimeSecs`, upload speed, size, a per-target percentage, `etaSecs` for the leading target (`null` when not uploading and ratio-only), plus the list of torrents released today. `?preview=1` also returns `wouldReleaseNow: { count, bytes }`, meaning what one sweep would release if enabled, and works while the sweep is off |
| `POST /seeding/:hash/release` | Remove now (manual) |
| `GET /orphans`, `POST /orphans/remove` | See §6 |
| `GET /seed-rules`, `PUT /seed-rules/:indexerName`, `DELETE /seed-rules/:indexerName` | Per-indexer overrides. The GET lists every known indexer with its privacy, override or inherited rule, and held count |
| `GET /janitor-stats` | 30-day counts of automatic blocklist entries by `kind` |

**Existing routes that change:**
- The media settings GET/PATCH (`libraryMediaAdmin.ts`) gains `public_seed_time_mins`, `private_seed_ratio`, `private_seed_time_mins`, `seed_sweep_enabled` and `blocked_extensions`. The PATCH validates each extension (`^[a-z0-9]{1,10}$`, with any leading dot stripped).
- `DELETE /api/library/:id` gains `release_torrents`.
- The blocklist list returns `kind` and accepts `?source=auto|manual`.
- Media and book download history rows return `seed_released_at`, `seed_release_reason` and a compact live seed state.

**Shared types.** The new types go in `@rawkoon/shared/types`: `SeedingTorrent`, `SeedRule`, `IndexerSeedRuleRow`, `OrphanTorrent`, `SeedStateEvent`, `BlocklistKind`, `JanitorStats`. They are the contract for both sides and for iOS later.

## 8. Live updates

`seed-state` is a new event (contract id `library.seed-state`, `ios_policy: "invalidate"`) on the same `/api/library/events` stream as download progress (see `2026-09-16-sse-download-progress-push-design.md`). **Only admin connections subscribe to it.** Its payload is `{ kind: "seed-state", ts, torrents: [{ hash, ratio, seedingTimeSecs, upSpeed, etaSecs, released?: { reason, at, freedBytes } }] }`. It deliberately carries no `mediaId`, so the iOS decoder's `LibraryEvent.from` returns nil for it. iOS gets a no-op `SSEEventRegistry` case so its contract test stays green; this requires a macbuild gate.
- It is emitted by each sweep pass, by post-import evaluation, and by manual and orphan removals.
- The web merges it into the `seeding` and `orphans` query caches (keys in `lib/queryKeys.ts`).
- A released hash animates out of the list into the "Released today" footer.
- Between sweeps, the Seeding view refetches every 60 s while visible, so ratio and time keep moving without an SSE event per torrent every few seconds.

## 9. UI (web)

The mockup is authoritative for layout and copy. It stays inside Cozy Dusk (existing tokens, Fraunces, Hanken Grotesk and Fira Code), reuses `segmented-tabs`, and uses the `StatusBadge` colour language.

**Downloads page** (`/library/downloads`, admin only)
- The header is "Downloads", with tabs Import (the existing page, unchanged), Seeding and Orphans, held in `?view=`.
- **Seeding view:**
  - A one-sentence summary: held count and GB, how many owe seed time on private trackers, and the next release. A live indicator sits beside it.
  - Filter chips: All, Owes seed time, From removed titles, Not uploading.
  - Rows ordered by soonest release. Each row has:
    - a poster, the title, and the indexer with a lock icon for private;
    - badges: *Removed from library*, *Replaced by an upgrade*, *Owes seed time*;
    - a **release meter**: one bar per target, with the leading target in the accent gradient and an absent target shown dashed as "no target", plus the estimate copy ("Releases in about 31 h, on seed time");
    - a "Remove now" button.
  - An idle torrent whose only target is a ratio shows a hint linking to Settings, to add a seed-time target.
  - "Remove now" opens a confirmation. It shows the hit-and-run warning only when a private target is unmet.
  - Released torrents fold into a collapsible "Released today: N, X GB freed" footer.
- **Orphans view:**
  - A plain-language explanation, then a table with a checkbox, name (mono), category, size, ratio and seed time. Shared-data rows get a *Shares files with another torrent* badge.
  - Selecting rows shows a floating action bar: count and GB, a "Delete downloaded files" toggle (on by default), a note when a shared-data row is selected, and "Remove N torrents".
  - The empty state explains why it's empty.

**Settings › Media**
- A **Seeding** section:
  - An enable switch bound to `seedSweepEnabled`. While it's off, a banner previews "N torrents would be released now, X GB" (from `GET /seeding?preview=1`).
  - Public and private rule cards (ratio, plus seed time in hours or days). Each card has a live sentence: "Release at ratio 1.0 or after 3 days of seeding, whichever comes first", "Release once it reaches ratio 1.0", "Release after …", or "Release right after import. Nothing is seeded."
  - A note that an unreachable indexer counts as private.
  - The per-indexer table: lock icon, rule (inherited in muted text as "…, from the private default", or custom in the accent), held count, and Customize / Use default buttons. Customize edits inline.
  - When `fileOperation = move`, a note explains that torrents are released right after import.
- A **Download safety** section: a blocked-extension chip input (Enter or comma adds one, Backspace removes the last, × removes one) and a 30-day stats line linking to the blocklist.
- **Blocklist tab:** filters All / Added automatically / Added by you, and a kind badge per row: *Blocked file* in red, *Stalled* in amber, *Import rejected* neutral.
- **Health card:** the orphan line with a "Review orphans" link.

**Media detail**
- Each download history row gets a seed-state chip:
  - *Seeding* with its progress;
  - *Released*, with the reason;
  - *Blocklisted*, with its kind.
- The remove-from-library dialog:
  - It keeps "Delete files from disk".
  - When torrents are still held, it adds a choice between **Keep seeding until its target is met** (the default, stating what's owed and roughly when it ends) and **Remove the torrent now** (stating the GB freed).
  - Choosing "now" with an unmet private target shows the amber hit-and-run warning.

All new strings go in both `en` and `fr` locales.

## 10. Rollout

- The migration is additive. `seedSweepEnabled` defaults to **false**, so upgrading changes nothing about seeding until an admin opts in after seeing the preview. Without that, the first sweep on an existing install would release every old completed torrent past its target at once.
- The janitor (rejecting releases, blocklisting them, and malware checks) is on from the start. Blocking file types can be disabled by emptying the list.
- Existing rows start with `seedReleasedAt = null`. The first enabled sweep adopts them: it stamps `manual` for torrents already gone from the client and `adopted` for torrents Rawkoon didn't add.
- **Audit before merge:** list every query that reads `DownloadHistory` and assumes `mediaId` or `bookEditionId` is non-null. That covers activity, stats, attention alerts, history sections and `revertToWantedIfNoActiveGrabs`. Each one either filters null-target rows or handles them.

## 11. Testing

**API (`bun test`)**
- **Pure functions:** `resolveSeedRule` (precedence, unknown-as-private, strictest-wins, nulls), `isSeedTargetMet` (either or both, move mode), `classifyOrphans`, `hasBlockedFile` (case, nested paths, `.exe` inside a folder named `.mkv`).
- **Reconcile loop,** through the existing injected `outcome` handlers:
  - A stall verdict leads to `rejectRelease`.
  - The pre-check runs before a complete verdict.
  - A `null` file list is retried.
  - `filesChecked` stops repeat calls.
  - The `error` state stays on `failDownload`.
- **`rejectRelease` and the sweep,** with the DB mocked:
  - the blocklist row and its `kind`;
  - `remove(hash, true)` and the row stamping;
  - the ownership, shared-data, pending-sibling and gone-from-client safeguards;
  - a thrown `remove` leaves the row unstamped;
  - the disabled flag means no removals.
- **Adapter fixtures:** `seedingTimeSecs`, `category` and `listFiles` for each client.
- **Routes:** every downloads route refuses a non-admin, probed with an authenticated non-admin session. Orphan remove refuses non-orphans and forces keeping data for shared ones. Library delete keeps its rows, and `release_torrents` removes the torrents. Add the new routes to the `apps/api/e2e` endpoint sweep.

**Web (vitest, run with `env -u NODE_ENV`)**
- Seeding view: leading-target selection, estimate copy including not-uploading, filters, the hit-and-run warning only for an unmet private target, and the `seed-state` merge.
- Orphans: selection totals, the shared-data note, the empty state.
- The rule sentence, across all four set/empty combinations.

**Gates**
- The full `bun run test` compared against `main`, not single files, because the API suite is order-dependent.
- `typecheck`, `lint`, `knip`, and `db:migrate:dev` on a fresh dev database.

**Manual check against a dev download client only:**
1. A legal public torrent seeds to a tiny target, releases, and the row folds away live.
2. A locally built torrent containing a dummy `.exe` is rejected before import, blocklisted, and has its data removed.
3. A torrent added by hand in a `rawkoon-*` category appears as an orphan and can be removed.
4. A duplicate that shares a content path keeps its data.
