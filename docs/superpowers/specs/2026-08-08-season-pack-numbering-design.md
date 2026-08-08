# Season-pack episode numbering — design

**Date:** 2026-08-08

**Status:** Approved design, ready for implementation planning

**Goal:** Stop the season-pack importer from silently shifting a whole season
when the release numbers its episodes differently than the metadata provider,
and fix the inode overflow that makes `rescan` abort on mergerfs storage.

## Problem

Three defects, discovered together while investigating a season of *House* whose
episodes played out of order in Jellyfin.

### 1. The importer trusts the release's `SxxExx` and drops what doesn't match

Netflix splits double-length episodes into `Part 1` / `Part 2` and numbers them
separately. Rippers keep that numbering. *House* season 6 therefore ships as 22
files, while both TMDb and TVDB list 21 episodes with "Broken" as a single
90-minute `S06E01`.

`apps/api/src/services/postProcessorSeasonPack.ts:126` looks up each parsed
`SxxExx` in a map built from `LibraryEpisode` rows:

```ts
const ep = epMap.get(`${se.season}x${se.episode}`);
if (!ep) {
  console.warn(`[postProcess/pack] No LibraryEpisode for S${se.season}E${se.episode} ... skipping`);
  return null;
}
```

`6x22` matches nothing, so the season finale is dropped with nothing but a
console warning. Worse, the 21 files that *did* match were renamed to the
**matched episode's** title via `renderEpisodeTemplate`, so the file containing
"Epic Fail" (release `S06E03`) became `S06E03 - The Tyrant` on disk. Every
episode from the split onward carried the wrong title, wrong overview, and wrong
air date, and the real finale was absent from the library.

Nothing surfaced this. It is not an error path — it is the success path with a
warning.

This is not a provider data issue. TVDB and TMDb agree with each other (21
episodes, "Broken" single at 90 minutes, "Epic Fail" at E02) and disagree with
the release. Switching providers changes nothing.

### 2. `episode_number_mismatch` structurally cannot catch it

`apps/api/src/services/libraryIntegrityCollectors.ts:319` already compares
`LibraryEpisode` rows against TMDb. Those rows were always correct — E2 really is
"Epic Fail". What was wrong is *which file sat on which row*, and no check
validates file content against the episode it is attached to.

### 3. `file_ino` overflows `bigint`, so `rescan` aborts

`rescanLibraryItem()` dies with:

```
PrismaClientKnownRequestError P2020
Value out of range for the type: value "9223372036854775808" is out of range for type bigint
```

mergerfs synthesizes unsigned 64-bit inodes (observed:
`13255269450503840684`). Postgres `bigint` is signed, max 2^63-1.

`fileFingerprint.ts:18` does `BigInt(Math.trunc(value))` on `st.ino`, which is
already a lossy JS number by the time it arrives — it rounds to exactly 2^63 and
the column rejects it.

Blast radius exceeds one show: **17 of 5403** `media_files` rows have a
non-null `file_ino`. The size+mtime fast path almost never applies, every rescan
re-runs MediaInfo across the whole item, and any rescan touching a high-inode
file aborts the entire run. This is why the rescan button appears to do nothing.

## Design

### Fix 1 — lossless, in-range inode fingerprints

In `apps/api/src/utils/medias/fileFingerprint.ts`, add:

```ts
export async function statFingerprint(path: string): Promise<FileFingerprint>
```

It calls `stat(path, { bigint: true })` so the inode is never narrowed through a
JS number, then stores `BigInt.asIntN(64, st.ino)`.

Signed wrapping is safe here because `dev`/`ino` are only ever an identity key
(`inodeKeyFromParts`), never compared for magnitude or ordering. Wrapping is
injective over 64 bits, so distinct inodes stay distinct.

Call sites in `services/library/rescan.ts` switch to the helper. Columns stay
`bigint` — no migration. Existing NULL rows backfill on the next scan through
the already-present backfill branch.

Rejected: migrating `file_dev`/`file_ino` to `NUMERIC(20,0)`. Semantically
truer, but it costs a migration and Prisma type churn for a value that is only
ever an opaque key.

### Fix 2 — a season-pack mapping module that can refuse

New pure module `apps/api/src/services/library/seasonPackMapping.ts`:

```ts
type Placement = { sources: string[]; targetEpisode: LibraryEpisode };
type MappingResult =
  | { ok: true; placements: Placement[] }
  | { ok: false; reason: string; unmatched: string[] };

export function resolveSeasonPackMapping(
  sources: ParsedSourceFile[],
  providerEpisodes: LibraryEpisode[],
): MappingResult;
```

It owns every numbering decision and touches no filesystem, so it is testable in
isolation. `postProcessorSeasonPack` becomes an executor of what it returns.

**Merge detection requires all of:**

1. Both files are `.mkv` (mkvmerge cannot output mp4/avi, and ffmpeg is not in
   the image).
2. Explicit part markers — `Part.1` / `Part 1` / `Pt1` / `(1)` and the matching
   `2` — on consecutive episode numbers n and n+1.
3. Identical track layout (codec, track count, languages) via mediainfo.
4. After collapsing every detected pair, the resulting episode count equals the
   provider's count for that season and maps 1:1 onto the provider's numbers.

Any failure returns `ok: false`. Detection is deliberately conservative: a
false merge silently destroys two episodes, while a false refusal costs one
notification.

**On refusal**, `postProcessorSeasonPack` places nothing, raises a new
`pack_numbering_mismatch` attention alert naming the unmatched files, leaves the
episodes `wanted`, and marks the `download_history` row failed with the reason.
Importing a partially-correct season is worse than importing none: the files
that "work" carry wrong titles and look fine until you watch them.

The refused release is also added to `grab_blocklist`. Without this, the
episodes return to `wanted`, auto-search finds the same highest-scoring pack,
grabs it, refuses it again, and loops — burning tracker ratio and generating an
alert per cycle. The blocklist entry records the numbering mismatch as its
reason so the UI can explain why that release is excluded.

**Fewer files than the provider stays legal.** Partial packs are normal and must
keep importing — only files matching *no* episode trigger refusal.

### Fix 3 — merge execution

New `apps/api/src/utils/medias/mkvMerge.ts`, a `Bun.spawn` wrapper shaped like
the existing `runMediaInfo`: same timeout-and-kill pattern, returns null rather
than throwing.

```ts
export async function mkvAppend(parts: string[], outPath: string): Promise<boolean>
```

It runs `mkvmerge -o out part1 + part2` and verifies the output duration is
within tolerance of the sum of the parts before reporting success.

`mkvtoolnix` is already installed in the image (`Dockerfile:40`) — no image
change needed.

The merged file is a real file written to the library target path; it cannot be
a hardlink. In `hardlink` mode the source parts are left untouched so seeding
survives. In `move` mode the parts are deleted after a verified successful
merge, consistent with what move already means.

### Fix 4 — a detector for seasons already imported wrong

In `libraryIntegrityCollectors.ts`, add `runtime` to the `TmdbEpisode` type. The
season endpoint is already fetched in that pass, so this costs no extra API
calls.

New issue kind `episode_duration_mismatch`: flag downloaded episodes whose
stored `media_files.duration_secs` differs from TMDb's runtime by more than 15
minutes.

*House* S6 E01 was 44 minutes against a 90-minute provider runtime — caught on
the first pass. The shifted 44-vs-43-minute episodes will not trip individually,
but the double-episode anchor always does, and one flag is enough to identify
the season as shifted.

Reporting only. No auto-repair — the operator decides.

## Testing

`seasonPackMapping` carries the weight, since it is pure:

- 22-file *House* S6 fixture → correct 21-placement mapping with E01 merged
- partial pack (18 of 21 files) → imports, no refusal
- stray sample/extra file matching no episode → refusal
- part markers present but count still fails to reconcile → refusal
- part markers on non-consecutive numbers → refusal

`mkvAppend` is tested with the spawn boundary stubbed. `statFingerprint` is
tested against a real temp file, asserting the result is within signed-64 range
and that two distinct files produce distinct keys.

## Out of scope

- **Switching metadata provider to TVDB.** Verified: TVDB reports 21 episodes,
  "Broken" single at 90 minutes, "Epic Fail" at E02 — identical to TMDb. The
  release is what disagrees.
- **Auto-repairing already-broken seasons.** The detector reports; repair stays
  manual.
- **The single-episode import path** (`postProcessorSingle.ts`), which derives
  its episode from the grab rather than the filename and has a different failure
  mode.
- **`library_media.total_size_bytes` being exactly 2x the real sum on every
  show.** Real, pre-existing, unrelated to this work.
