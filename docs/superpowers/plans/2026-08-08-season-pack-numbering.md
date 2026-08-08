# Season-Pack Numbering Guard + Inode Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the season-pack importer from silently shifting a whole season when a release numbers episodes differently than the metadata provider, and fix the inode overflow that aborts every rescan on mergerfs storage.

**Architecture:** A pure `seasonPackMapping` module owns all numbering decisions and can refuse; `postProcessorSeasonPack` becomes an executor of what it returns. Inode identity moves from `bigint` columns to `text` so unsigned 64-bit inodes survive intact. A duration-based integrity collector flags seasons already imported wrong.

**Tech Stack:** Bun, TypeScript, Elysia, Prisma 7 + Postgres, `bun:test`, mkvtoolnix (already in the image), mediainfo.

**Spec:** `docs/superpowers/specs/2026-08-08-season-pack-numbering-design.md`

## Global Constraints

- Runtime is Bun. Run tests with `bun test`, never `npm`/`jest`/`vitest`.
- API tests run from `apps/api` via `bun test src/` (see `apps/api/package.json:14`).
- Imports use the `@rawkoon/api/...` and `@rawkoon/shared` aliases, never deep relative paths across directories.
- Prisma migrations are hand-written SQL directories under `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`.
- `sizeBytes` and `mtimeMs` stay `bigint` — they are compared numerically in `fileUnchanged`. Only `dev`/`ino` become strings.
- Merge detection must be conservative: a false merge destroys two episodes, a false refusal costs one notification.
- Do not reformat untouched code. The repo uses Biome; run `bun run format` only on files you changed.

---

### Task 1: Inode fingerprints become lossless strings

**Files:**
- Modify: `apps/api/src/utils/medias/fileFingerprint.ts`
- Test: `apps/api/src/utils/medias/fileFingerprint.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type FileFingerprint = { sizeBytes: bigint; mtimeMs: bigint; dev: string; ino: string }`
  - `type StoredFileFingerprint = { sizeBytes: bigint; fileMtimeMs: bigint | null; fileDev?: string | null; fileIno?: string | null }`
  - `fingerprintFromStats(st: { size: bigint; mtimeMs: bigint; dev: bigint; ino: bigint }): FileFingerprint`
  - `fingerprintDbFields(fp): { sizeBytes: bigint; fileMtimeMs: bigint; fileDev: string; fileIno: string }`
  - `statFileFingerprint(mappedPath: string): Promise<FileFingerprint | null>` — now uses `stat(path, { bigint: true })`
  - `inodeKeyFromParts(dev: string | number | bigint, ino: string | number | bigint): string` (unchanged behaviour)

Note: `fingerprintFromStats` deliberately accepts **only** bigint fields. That makes the compiler flag every caller still using a lossy `stat()`, which is how Task 2 finds them all.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/utils/medias/fileFingerprint.test.ts`:

```ts
it("preserves an unsigned 64-bit inode exactly", () => {
  const fp = fingerprintFromStats({
    size: 100n,
    mtimeMs: 1n,
    dev: 39n,
    ino: 13255269450503840684n,
  });
  expect(fp.ino).toBe("13255269450503840684");
  expect(fp.dev).toBe("39");
});

it("statFileFingerprint returns an inode matching the filesystem", async () => {
  const { mkdtemp, writeFile, stat: statFs } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "fp-"));
  const path = join(dir, "a.mkv");
  await writeFile(path, "x");

  const fp = await statFileFingerprint(path);
  const st = await statFs(path, { bigint: true });
  expect(fp?.ino).toBe(st.ino.toString());
});

it("gives a hardlink the same inode key and a copy a different one", async () => {
  const { mkdtemp, writeFile, link } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "fp-"));
  const a = join(dir, "a.mkv");
  const b = join(dir, "b.mkv");
  const c = join(dir, "c.mkv");
  await writeFile(a, "x");
  await link(a, b);
  await writeFile(c, "x");

  const fpA = (await statFileFingerprint(a))!;
  const fpB = (await statFileFingerprint(b))!;
  const fpC = (await statFileFingerprint(c))!;
  expect(inodeKeyFromParts(fpB.dev, fpB.ino)).toBe(
    inodeKeyFromParts(fpA.dev, fpA.ino),
  );
  expect(inodeKeyFromParts(fpC.dev, fpC.ino)).not.toBe(
    inodeKeyFromParts(fpA.dev, fpA.ino),
  );
});
```

Delete the existing `"fingerprintFromStats normalizes number and bigint fields"` test — passing plain numbers is exactly what this task makes impossible. Update the existing `fingerprintDbFields` and `fileUnchanged` tests to use bigint inputs and expect string `fileDev`/`fileIno`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && bun test src/utils/medias/fileFingerprint.test.ts`
Expected: FAIL — `fp.ino` is `13255269450503841000` (a rounded number) rather than the exact string.

- [ ] **Step 3: Implement**

In `apps/api/src/utils/medias/fileFingerprint.ts`:

```ts
/** On-disk identity used to skip unchanged MediaInfo scans and cache inodes. */
export type FileFingerprint = {
  sizeBytes: bigint;
  mtimeMs: bigint;
  /**
   * dev/ino are stored as decimal strings, not bigint. They are only ever an
   * opaque identity key (see inodeKeyFromParts) and mergerfs synthesizes
   * unsigned 64-bit inodes that overflow a signed Postgres bigint.
   */
  dev: string;
  ino: string;
};

export type StoredFileFingerprint = {
  sizeBytes: bigint;
  fileMtimeMs: bigint | null;
  fileDev?: string | null;
  fileIno?: string | null;
};

export function toBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value));
}

/**
 * Requires bigint stat fields on purpose: a plain stat() narrows the inode
 * through a lossy JS number before we ever see it.
 */
export function fingerprintFromStats(st: {
  size: bigint;
  mtimeMs: bigint;
  dev: bigint;
  ino: bigint;
}): FileFingerprint {
  return {
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
    dev: st.dev.toString(),
    ino: st.ino.toString(),
  };
}
```

Update `fingerprintDbFields` to return `fileDev: string; fileIno: string`, widen `inodeKeyFromParts` to accept `string | number | bigint`, and change `statFileFingerprint`:

```ts
export async function statFileFingerprint(
  mappedPath: string,
): Promise<FileFingerprint | null> {
  try {
    const st = await stat(mappedPath, { bigint: true });
    if (!st.isFile()) return null;
    return fingerprintFromStats(st);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && bun test src/utils/medias/fileFingerprint.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/medias/fileFingerprint.ts apps/api/src/utils/medias/fileFingerprint.test.ts
git commit -m "fix(library): keep inodes exact by fingerprinting them as strings"
```

---

### Task 2: Migrate the inode columns to text and update every call site

**Files:**
- Modify: `apps/api/prisma/schema.prisma:593-595`
- Create: `apps/api/prisma/migrations/20260808120000_media_file_inode_text/migration.sql`
- Modify: `apps/api/src/services/library/rescan.ts:141,264,408`
- Modify: `apps/api/src/services/postProcessorSingle.ts:213`
- Modify: `apps/api/src/services/postProcessorSeasonPack.ts:157-158`
- Modify: `apps/api/src/services/downloadsAssign.ts:163`
- Modify: `apps/api/src/services/downloadsScanner.ts:67`
- Modify: `apps/api/src/services/jobs/libraryRemuxWorker.ts:155`
- Modify: `apps/api/src/services/jobs/libraryReindexLanguagesWorker.ts:107`

**Interfaces:**
- Consumes: `fingerprintFromStats`, `statFileFingerprint` from Task 1.
- Produces: `MediaFile.fileDev` and `MediaFile.fileIno` typed `String?` in Prisma.

- [ ] **Step 1: Write the migration**

Create `apps/api/prisma/migrations/20260808120000_media_file_inode_text/migration.sql`:

```sql
-- dev/ino are identity keys, never numbers. mergerfs synthesizes unsigned
-- 64-bit inodes that overflow a signed bigint, which aborted every rescan.
DROP INDEX IF EXISTS "ix_media_files_file_dev_ino";

ALTER TABLE "media_files"
  ALTER COLUMN "file_dev" TYPE text USING "file_dev"::text,
  ALTER COLUMN "file_ino" TYPE text USING "file_ino"::text;

-- Every pre-existing value went through the lossy BigInt(Math.trunc(number))
-- path, so it is an approximation. Two files whose inodes rounded together
-- would look like hardlinks to downloadsScanner. Discard them; the next scan
-- writes exact values through the existing backfill branch.
UPDATE "media_files" SET "file_dev" = NULL, "file_ino" = NULL;

CREATE INDEX "ix_media_files_file_dev_ino" ON "media_files" ("file_dev", "file_ino");
```

- [ ] **Step 2: Update the Prisma schema**

In `apps/api/prisma/schema.prisma`, replace lines 592-595:

```prisma
  /// Filesystem device id from last successful stat (hardlink / skip-scan cache).
  /// Stored as text: identity key only, and mergerfs inodes exceed signed bigint.
  fileDev        String?  @map("file_dev")
  /// Inode from last successful stat.
  fileIno        String?  @map("file_ino")
```

- [ ] **Step 3: Regenerate the client and find every broken call site**

Run: `cd apps/api && bunx prisma generate && bun run typecheck`
Expected: type errors at each `fingerprintFromStats(st)` call listed in **Files** — they pass a non-bigint `Stats`.

- [ ] **Step 4: Fix each call site**

At every location, change the `stat` call to request bigint and leave the rest alone. Pattern:

```ts
// before
const destStat = await stat(destMapped);
const fp = fingerprintFromStats(destStat);

// after
const destStat = await stat(destMapped, { bigint: true });
const fp = fingerprintFromStats(destStat);
```

`libraryRemuxWorker.ts:155` guards on `st.isFile()` — `BigIntStats` has `isFile()`, so that line is unchanged apart from its `stat` call. Where a site also reads `st.size` or `st.mtimeMs` as a number for something other than the fingerprint, convert explicitly at that use with `Number(st.size)` rather than reverting the stat.

- [ ] **Step 5: Verify typecheck and tests pass**

Run: `cd apps/api && bun run typecheck && bun test src/`
Expected: PASS, zero type errors.

- [ ] **Step 6: Apply the migration and confirm the original crash is gone**

```bash
cd apps/api && bunx prisma migrate deploy
```

Then confirm the exact failure from the bug report no longer reproduces:

```bash
docker exec rawkoon sh -c 'cd /app/apps/api && bun -e "
import { rescanLibraryItem } from \"@rawkoon/api/services/library/rescan\";
console.log(JSON.stringify(await rescanLibraryItem(2376)));
process.exit(0);
"'
```

Expected: a `RescanResult` JSON object, **not** `P2020 Value out of range for the type`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src
git commit -m "fix(library): store file_dev/file_ino as text so mergerfs inodes fit"
```

---

### Task 3: The season-pack mapping module

**Files:**
- Create: `apps/api/src/services/library/seasonPackMapping.ts`
- Test: `apps/api/src/services/library/seasonPackMapping.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this module is pure and does no I/O.
- Produces:

```ts
export type ParsedSourceFile = {
  path: string;
  fileName: string;
  season: number;
  episode: number;
  part: number | null;
  ext: string;
};

export type ProviderEpisode = {
  id: number;
  season: number;
  episode: number;
  title: string | null;
};

export type Placement =
  | { kind: "direct"; sources: [ParsedSourceFile]; episode: ProviderEpisode }
  | { kind: "merge"; sources: [ParsedSourceFile, ParsedSourceFile]; episode: ProviderEpisode };

export type MappingResult =
  | { ok: true; placements: Placement[] }
  | { ok: false; reason: string; unmatched: string[] };

export function parsePartMarker(fileName: string): number | null;
export function resolveSeasonPackMapping(
  sources: ParsedSourceFile[],
  providerEpisodes: ProviderEpisode[],
): MappingResult;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/library/seasonPackMapping.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  parsePartMarker,
  resolveSeasonPackMapping,
  type ParsedSourceFile,
  type ProviderEpisode,
} from "./seasonPackMapping";

function src(
  episode: number,
  fileName: string,
  ext = ".mkv",
): ParsedSourceFile {
  return {
    path: `/dl/${fileName}`,
    fileName,
    season: 6,
    episode,
    part: parsePartMarker(fileName),
    ext,
  };
}

function providerSeason(count: number): ProviderEpisode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i + 1,
    season: 6,
    episode: i + 1,
    title: `Episode ${i + 1}`,
  }));
}

describe("parsePartMarker", () => {
  it("recognises the common part spellings", () => {
    expect(parsePartMarker("House.S06E01.Broken.Part.1.mkv")).toBe(1);
    expect(parsePartMarker("House - S06E02 - Broken Part 2.mkv")).toBe(2);
    expect(parsePartMarker("Show.S01E01.Pilot.Pt1.mkv")).toBe(1);
    expect(parsePartMarker("Show.S01E02.Pilot (2).mkv")).toBe(2);
  });

  it("returns null when no marker is present", () => {
    expect(parsePartMarker("House.S06E03.Epic.Fail.mkv")).toBeNull();
    expect(parsePartMarker("Show.S01E05.Apartment 4.mkv")).toBeNull();
  });
});

describe("resolveSeasonPackMapping", () => {
  it("maps a normal pack directly", () => {
    const sources = [src(1, "S06E01.A.mkv"), src(2, "S06E02.B.mkv")];
    const result = resolveSeasonPackMapping(sources, providerSeason(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements).toHaveLength(2);
    expect(result.placements.every((p) => p.kind === "direct")).toBe(true);
  });

  it("still imports a partial pack", () => {
    const sources = [src(3, "S06E03.C.mkv"), src(7, "S06E07.G.mkv")];
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements).toHaveLength(2);
    expect(result.placements[0]!.episode.episode).toBe(3);
    expect(result.placements[1]!.episode.episode).toBe(7);
  });

  it("collapses a split premiere and renumbers the rest (House S6)", () => {
    const sources = [
      src(1, "House.S06E01.Broken.Part.1.mkv"),
      src(2, "House.S06E02.Broken.Part.2.mkv"),
      ...Array.from({ length: 20 }, (_, i) =>
        src(i + 3, `House.S06E${String(i + 3).padStart(2, "0")}.Ep.mkv`),
      ),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.placements).toHaveLength(21);

    const first = result.placements[0]!;
    expect(first.kind).toBe("merge");
    expect(first.episode.episode).toBe(1);
    expect(first.sources.map((s) => s.fileName)).toEqual([
      "House.S06E01.Broken.Part.1.mkv",
      "House.S06E02.Broken.Part.2.mkv",
    ]);

    // Source E03 must land on provider E02, and the finale must not be lost.
    const second = result.placements[1]!;
    expect(second.kind).toBe("direct");
    expect(second.sources[0]!.episode).toBe(3);
    expect(second.episode.episode).toBe(2);

    const last = result.placements[20]!;
    expect(last.sources[0]!.episode).toBe(22);
    expect(last.episode.episode).toBe(21);
  });

  it("refuses a stray file that matches no episode", () => {
    const sources = [src(1, "S06E01.A.mkv"), src(99, "S06E99.Sample.mkv")];
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unmatched).toEqual(["S06E99.Sample.mkv"]);
  });

  it("refuses when part markers exist but the count still does not reconcile", () => {
    const sources = [
      src(1, "S06E01.Broken.Part.1.mkv"),
      src(2, "S06E02.Broken.Part.2.mkv"),
      src(3, "S06E03.C.mkv"),
      src(4, "S06E04.D.mkv"),
    ];
    // Collapsing yields 3 episodes, provider says 21 — the pack is incomplete
    // AND split, so we cannot safely renumber it.
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(false);
  });

  it("refuses to merge non-consecutive part markers", () => {
    const sources = [
      src(1, "S06E01.Broken.Part.1.mkv"),
      src(5, "S06E05.Other.Part.2.mkv"),
      src(2, "S06E02.B.mkv"),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(2));
    expect(result.ok).toBe(false);
  });

  it("refuses to merge when a part is not an mkv", () => {
    const sources = [
      src(1, "S06E01.Broken.Part.1.mp4", ".mp4"),
      src(2, "S06E02.Broken.Part.2.mp4", ".mp4"),
      src(3, "S06E03.C.mp4", ".mp4"),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(2));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("mkv");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && bun test src/services/library/seasonPackMapping.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `apps/api/src/services/library/seasonPackMapping.ts`:

```ts
/**
 * Decides which source files belong on which provider episodes for a season
 * pack, and refuses when it cannot be sure.
 *
 * Streaming platforms split double-length episodes into "Part 1" / "Part 2"
 * and number them separately, while TMDb and TVDB count them as one episode.
 * A pack built that way has one more file than the provider has episodes, and
 * naive SxxExx matching shifts every later episode onto the wrong metadata and
 * drops the finale entirely.
 *
 * This module is pure: no filesystem, no database, no mediainfo. Track-layout
 * compatibility between two merge candidates is I/O and is verified by the
 * caller before the merge runs.
 */

export type ParsedSourceFile = {
  path: string;
  fileName: string;
  season: number;
  episode: number;
  part: number | null;
  ext: string;
};

export type ProviderEpisode = {
  id: number;
  season: number;
  episode: number;
  title: string | null;
};

export type Placement =
  | { kind: "direct"; sources: [ParsedSourceFile]; episode: ProviderEpisode }
  | {
      kind: "merge";
      sources: [ParsedSourceFile, ParsedSourceFile];
      episode: ProviderEpisode;
    };

export type MappingResult =
  | { ok: true; placements: Placement[] }
  | { ok: false; reason: string; unmatched: string[] };

const PART_PATTERNS: RegExp[] = [
  /\bpart[\s._-]?([12])\b/i,
  /\bpt[\s._-]?([12])\b/i,
  /\(([12])\)/,
];

/** Returns 1 or 2 when the filename carries an explicit part marker. */
export function parsePartMarker(fileName: string): number | null {
  for (const re of PART_PATTERNS) {
    const m = fileName.match(re);
    if (m) return parseInt(m[1] as string, 10);
  }
  return null;
}

function refuse(reason: string, unmatched: string[] = []): MappingResult {
  return { ok: false, reason, unmatched };
}

export function resolveSeasonPackMapping(
  sources: ParsedSourceFile[],
  providerEpisodes: ProviderEpisode[],
): MappingResult {
  if (sources.length === 0) return refuse("No parsable source files", []);

  const bySeason = new Map<number, ParsedSourceFile[]>();
  for (const s of sources) {
    const list = bySeason.get(s.season) ?? [];
    list.push(s);
    bySeason.set(s.season, list);
  }

  const placements: Placement[] = [];

  for (const [season, seasonSources] of bySeason) {
    const provider = providerEpisodes
      .filter((e) => e.season === season)
      .sort((a, b) => a.episode - b.episode);

    if (provider.length === 0) {
      return refuse(
        `No provider episodes for season ${season}`,
        seasonSources.map((s) => s.fileName),
      );
    }

    const ordered = [...seasonSources].sort((a, b) => a.episode - b.episode);
    const providerByNumber = new Map(provider.map((e) => [e.episode, e]));
    const unmatched = ordered.filter((s) => !providerByNumber.has(s.episode));

    // Happy path — every file lines up, including partial packs.
    if (unmatched.length === 0) {
      for (const s of ordered) {
        placements.push({
          kind: "direct",
          sources: [s],
          episode: providerByNumber.get(s.episode) as ProviderEpisode,
        });
      }
      continue;
    }

    // Something does not line up. The only shape we will repair is a split
    // episode, and only when repairing it explains the discrepancy exactly.
    const groups: ParsedSourceFile[][] = [];
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i] as ParsedSourceFile;
      const b = ordered[i + 1];
      const isPair =
        a.part === 1 &&
        b != null &&
        b.part === 2 &&
        b.episode === a.episode + 1;
      if (isPair) {
        if (a.ext.toLowerCase() !== ".mkv" || b.ext.toLowerCase() !== ".mkv") {
          return refuse(
            `Split episode detected but "${a.fileName}" and "${b.fileName}" are not mkv — cannot merge`,
            unmatched.map((s) => s.fileName),
          );
        }
        groups.push([a, b]);
        i++;
      } else {
        groups.push([a]);
      }
    }

    const merged = groups.filter((g) => g.length === 2).length;
    if (merged === 0) {
      return refuse(
        `${unmatched.length} file(s) match no episode of season ${season} and no split episode was found`,
        unmatched.map((s) => s.fileName),
      );
    }

    if (groups.length !== provider.length) {
      return refuse(
        `Season ${season}: ${groups.length} episode(s) after collapsing ${merged} split pair(s), but the provider lists ${provider.length}`,
        unmatched.map((s) => s.fileName),
      );
    }

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i] as ParsedSourceFile[];
      const episode = provider[i] as ProviderEpisode;
      if (group.length === 2) {
        placements.push({
          kind: "merge",
          sources: [group[0] as ParsedSourceFile, group[1] as ParsedSourceFile],
          episode,
        });
      } else {
        placements.push({
          kind: "direct",
          sources: [group[0] as ParsedSourceFile],
          episode,
        });
      }
    }
  }

  return { ok: true, placements };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && bun test src/services/library/seasonPackMapping.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/library/seasonPackMapping.ts apps/api/src/services/library/seasonPackMapping.test.ts
git commit -m "feat(library): add season-pack mapping that can refuse ambiguous packs"
```

---

### Task 4: The mkvmerge wrapper

**Files:**
- Create: `apps/api/src/utils/medias/mkvMerge.ts`
- Test: `apps/api/src/utils/medias/mkvMerge.test.ts`

**Interfaces:**
- Consumes: `scanMediaInfo` from `@rawkoon/api/utils/medias/mediainfoScanner`.
- Produces:
  - `tracksCompatible(a: MediaFileData, b: MediaFileData): boolean`
  - `mkvAppend(parts: string[], outPath: string): Promise<boolean>`

`mkvtoolnix` is already installed in the image (`Dockerfile:40`) — no image change.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/utils/medias/mkvMerge.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { tracksCompatible } from "./mkvMerge";

type Tracks = Parameters<typeof tracksCompatible>[0];

function file(audio: string[], subs: string[], codec = "AV1"): Tracks {
  return {
    videoCodec: codec,
    audioTracks: audio.map((language) => ({ language, codec: "EAC3" })),
    subtitleTracks: subs.map((language) => ({ language })),
  } as unknown as Tracks;
}

describe("tracksCompatible", () => {
  it("accepts identical layouts", () => {
    expect(
      tracksCompatible(
        file(["fre", "eng"], ["fre", "fre", "eng"]),
        file(["fre", "eng"], ["fre", "fre", "eng"]),
      ),
    ).toBe(true);
  });

  it("rejects a differing video codec", () => {
    expect(
      tracksCompatible(
        file(["fre", "eng"], [], "AV1"),
        file(["fre", "eng"], [], "H264"),
      ),
    ).toBe(false);
  });

  it("rejects a differing audio track count", () => {
    expect(
      tracksCompatible(file(["fre", "eng"], []), file(["fre"], [])),
    ).toBe(false);
  });

  it("rejects differing audio languages", () => {
    expect(
      tracksCompatible(file(["fre", "eng"], []), file(["eng", "spa"], [])),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/utils/medias/mkvMerge.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `apps/api/src/utils/medias/mkvMerge.ts`:

```ts
import { scanMediaInfo } from "@rawkoon/api/utils/medias/mediainfoScanner";
import type { MediaFileData } from "@rawkoon/api/utils/medias/mediainfoParser";

const MERGE_TIMEOUT_MS = 600_000;
/** Appending is lossless, so the result should equal the sum of the parts. */
const DURATION_TOLERANCE_SECS = 5;

type TrackShape = Pick<
  MediaFileData,
  "videoCodec" | "audioTracks" | "subtitleTracks"
>;

/**
 * True when two files can be appended without silently dropping a track.
 * mkvmerge appends by track order, so a differing layout would produce a file
 * whose second half is missing audio or subtitles.
 */
export function tracksCompatible(a: TrackShape, b: TrackShape): boolean {
  if (a.videoCodec !== b.videoCodec) return false;
  if (a.audioTracks.length !== b.audioTracks.length) return false;
  if (a.subtitleTracks.length !== b.subtitleTracks.length) return false;

  const langs = (tracks: Array<{ language?: string | null }>) =>
    tracks.map((t) => t.language ?? "").join(",");

  if (langs(a.audioTracks) !== langs(b.audioTracks)) return false;
  if (langs(a.subtitleTracks) !== langs(b.subtitleTracks)) return false;
  return true;
}

/**
 * Append `parts` into `outPath` with mkvmerge, then verify the output runtime
 * equals the sum of the inputs. Returns false rather than throwing, matching
 * scanMediaInfo's contract.
 */
export async function mkvAppend(
  parts: string[],
  outPath: string,
): Promise<boolean> {
  if (parts.length < 2) return false;
  const bin = Bun.which("mkvmerge");
  if (!bin) {
    console.warn("[mkvMerge] mkvmerge binary not found — cannot merge");
    return false;
  }

  const expected: number[] = [];
  for (const part of parts) {
    const mi = await scanMediaInfo(part);
    if (!mi?.durationSecs) {
      console.warn(`[mkvMerge] Could not read duration of "${part}"`);
      return false;
    }
    expected.push(mi.durationSecs);
  }

  // mkvmerge's append syntax: mkvmerge -o out first + second [+ third...]
  const args = [bin, "-o", outPath, parts[0] as string];
  for (const part of parts.slice(1)) args.push("+", part);

  const proc = Bun.spawn(args, { stderr: "ignore", stdout: "ignore" });
  const timeoutId = setTimeout(() => proc.kill(), MERGE_TIMEOUT_MS);
  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  if (exitCode !== 0) {
    console.warn(`[mkvMerge] mkvmerge exited ${exitCode} for "${outPath}"`);
    return false;
  }

  const out = await scanMediaInfo(outPath);
  const want = expected.reduce((sum, d) => sum + d, 0);
  if (!out?.durationSecs || Math.abs(out.durationSecs - want) > DURATION_TOLERANCE_SECS) {
    console.warn(
      `[mkvMerge] "${outPath}" is ${out?.durationSecs ?? "unknown"}s, expected ~${want}s — rejecting merge`,
    );
    return false;
  }

  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/utils/medias/mkvMerge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/medias/mkvMerge.ts apps/api/src/utils/medias/mkvMerge.test.ts
git commit -m "feat(library): add verified mkvmerge append helper"
```

---

### Task 5: Wire the guard into the season-pack post-processor

**Files:**
- Modify: `apps/api/src/services/postProcessorSeasonPack.ts:84-132`

**Interfaces:**
- Consumes: `resolveSeasonPackMapping`, `parsePartMarker`, `Placement` (Task 3); `mkvAppend`, `tracksCompatible` (Task 4); `parseSeasonEpisode` from `@rawkoon/api/services/postProcessorHelpers`.
- Produces: no new exports. `postProcessSeasonPack` keeps its existing signature and return type.

**Execution context:** this code already runs inside the BullMQ `LIBRARY_POST_PROCESS` worker (`queueService.ts:202-211`) at concurrency 1 with `attempts: 1`, so the merge runs there too — no new queue, no new job type. Three consequences worth knowing:

- A merge blocks every other post-process job while it runs (concurrency 1, by design — the queue comment already calls it "fs-heavy, one file at a time"). `libraryRemuxWorker` sets the precedent for long media work in this pattern.
- `attempts: 1` means no auto-retry, which is what we want: a half-merged file must surface on the row rather than be retried blindly.
- `await proc.exited` yields to the event loop, so BullMQ's lock renewal keeps firing and a multi-minute merge will not be declared stalled. Do not switch to a synchronous spawn.

**Deviation from the spec, deliberate:** the spec called for a new `pack_numbering_mismatch` attention kind. Attention alerts in this codebase are *derived* from state, not inserted — `post_process_error` already derives from `downloadHistory.postProcessError` (`libraryAttentionCandidates.ts:249`). Writing that field surfaces the refusal through the existing pipeline with the full reason text, and needs no shared type, candidate query, or UI change. Reuse it.

- [ ] **Step 1: Replace the per-file episode lookup with the mapping module**

Delete the `epMap` construction (lines 88, 126-132) and the dedupe block (98-106) — `resolveSeasonPackMapping` subsumes both, since it groups by episode number itself. Replace with:

```ts
const episodes = await prisma.libraryEpisode.findMany({
  where: { mediaId: dh.media.id },
});

const parsedSources = allVideos.flatMap((srcVideo) => {
  const fileName = basename(srcVideo);
  const se = parseSeasonEpisode(fileName);
  if (!se) {
    console.warn(
      `[postProcess/pack] Could not parse SxxExx from "${fileName}", skipping`,
    );
    return [];
  }
  return [
    {
      path: srcVideo,
      fileName,
      season: se.season,
      episode: se.episode,
      part: parsePartMarker(fileName),
      ext: extname(srcVideo) || ".mkv",
    },
  ];
});

const mapping = resolveSeasonPackMapping(parsedSources, episodes);

if (!mapping.ok) {
  // Import nothing. A partially-correct season is worse than none: the files
  // that "work" get renamed to the wrong episode's title and look fine until
  // someone watches them.
  const reason = `Season pack numbering does not match the provider — nothing imported. ${mapping.reason}${
    mapping.unmatched.length > 0
      ? ` Unmatched: ${mapping.unmatched.join(", ")}`
      : ""
  }`;

  await prisma.downloadHistory.update({
    where: { id: downloadHistoryId },
    data: { postProcessError: reason },
  });

  // Without this the episodes stay "wanted", auto-search finds the same
  // highest-scoring pack, and the whole cycle repeats forever.
  await prisma.grabBlocklist.create({
    data: {
      torrentHash: hash,
      releaseTitle: dh.releaseTitle,
      mediaId: dh.media.id,
      reason,
    },
  });

  console.warn(`[postProcess/pack] ${dh.media.title}: ${reason}`);
  return { success: false, reason };
}
```

Add to the imports at the top of the file:

```ts
import {
  parsePartMarker,
  resolveSeasonPackMapping,
} from "@rawkoon/api/services/library/seasonPackMapping";
import { mkvAppend, tracksCompatible } from "@rawkoon/api/utils/medias/mkvMerge";
```

- [ ] **Step 2: Drive the placement loop from `mapping.placements`**

Change the chunk loop to iterate `mapping.placements` instead of `dedupedVideos`. Inside the worker, replace the `se`/`ep` lookup preamble with:

```ts
const ep = placement.episode;
const primary = placement.sources[0];
const fn = primary.fileName;
const ext = primary.ext;
```

The `epStem` / `destinationPath` construction below it is unchanged.

Then replace the single `placeFile` call with a branch on placement kind:

```ts
if (placement.kind === "merge") {
  const [a, b] = placement.sources;
  const [miA, miB] = await Promise.all([
    scanMediaInfo(a.path),
    scanMediaInfo(b.path),
  ]);
  if (!miA || !miB || !tracksCompatible(miA, miB)) {
    return {
      ok: false,
      error: `S${ep.season}E${ep.episode}: "${a.fileName}" and "${b.fileName}" have different track layouts — refusing to merge`,
    };
  }
  if (!(await mkvAppend([a.path, b.path], destinationPath))) {
    return {
      ok: false,
      error: `S${ep.season}E${ep.episode}: merging "${a.fileName}" + "${b.fileName}" failed`,
    };
  }
  // The merged file is new content, never a hardlink to the source parts.
  // In move mode the parts are consumed; in hardlink mode they stay put so
  // the torrent keeps seeding.
  if (op === "move") {
    await Promise.all(
      [a.path, b.path].map((p) =>
        rm(p).catch((e) =>
          console.warn(`[postProcess/pack] Could not remove part ${p}:`, e),
        ),
      ),
    );
  }
} else {
  try {
    await placeFile(primary.path, destinationPath, op);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `S${ep.season}E${ep.episode}: ${msg}` };
  }
}
```

Add `rm` to the `node:fs/promises` import on line 2, and `scanMediaInfo` is already imported on line 12.

- [ ] **Step 3: Verify typecheck and the full API suite pass**

Run: `cd apps/api && bun run typecheck && bun test src/ && bun test test/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/postProcessorSeasonPack.ts
git commit -m "fix(library): refuse season packs whose numbering does not match the provider"
```

---

### Task 6: Flag seasons already imported wrong

**Files:**
- Modify: `apps/shared/src/types/admin.ts:32-48`
- Modify: `apps/api/src/services/libraryIntegritySummary.ts:17-45`
- Modify: `apps/api/src/services/libraryIntegrityCollectors.ts:18-21` and the show loop around line 335
- Modify: `apps/web/src/locales/en/common.json`, `apps/web/src/locales/fr/common.json`
- Test: `apps/api/src/services/libraryIntegrity.test.ts`

**Interfaces:**
- Consumes: `LibraryHealthIssue` from `@rawkoon/shared`.
- Produces: new issue kind `"episode_duration_mismatch"` and summary counter `episode_duration_mismatches`.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/services/libraryIntegrity.test.ts`, add `episode_duration_mismatches: 0` to both expected-summary literals, and add:

```ts
it("counts episode_duration_mismatch issues", () => {
  const issues: LibraryHealthIssue[] = [
    { kind: "episode_duration_mismatch", detail: "44 min vs 90 min" },
  ];
  const summary = summarizeLibraryHealthIssues(issues);
  expect(summary.episode_duration_mismatches).toBe(1);
  expect(summary.total_issues).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/services/libraryIntegrity.test.ts`
Expected: FAIL — `episode_duration_mismatches` is not a property of `LibraryHealthSummary`.

- [ ] **Step 3: Extend the shared types**

In `apps/shared/src/types/admin.ts`, add `episode_duration_mismatches: number;` to `LibraryHealthSummary` and `| "episode_duration_mismatch"` to the `LibraryHealthIssue["kind"]` union.

- [ ] **Step 4: Extend the summary**

In `apps/api/src/services/libraryIntegritySummary.ts`, add `episode_duration_mismatches: 0` to `libraryHealthEmptySummary()` and this branch to `summarizeLibraryHealthIssues`:

```ts
} else if (issue.kind === "episode_duration_mismatch") {
  summary.episode_duration_mismatches += 1;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && bun test src/services/libraryIntegrity.test.ts`
Expected: PASS

- [ ] **Step 6: Collect the issue**

In `apps/api/src/services/libraryIntegrityCollectors.ts`, add `runtime` to the TMDb episode type (line 18) — the season endpoint already returns it, so this costs no extra API calls:

```ts
type TmdbEpisode = {
  id: number;
  episode_number: number;
  runtime?: number | null;
};
```

Store runtimes alongside the existing maps while looping `seasonData.episodes`:

```ts
const tmdbRuntimeById = new Map<number, number>();
// ...inside the episode loop:
if (typeof episode.runtime === "number" && episode.runtime > 0) {
  tmdbRuntimeById.set(episode.id, episode.runtime);
}
```

The show query must also load file durations. Add to the `episodes` select for that query:

```ts
files: { select: { durationSecs: true } },
```

Then, in the `for (const episode of show.episodes)` loop, after the existing number-mismatch checks:

```ts
// A file whose runtime is wildly off from the provider's is the signature of
// a season imported against a different numbering scheme — a 44-minute file
// sitting on a 90-minute double episode. The shifted 44-vs-43-minute episodes
// around it will not trip individually, but this anchor identifies the season.
const providerRuntime = episode.tmdbEpisodeId
  ? tmdbRuntimeById.get(episode.tmdbEpisodeId)
  : undefined;
const fileDuration = episode.files[0]?.durationSecs;

if (providerRuntime != null && fileDuration != null) {
  const fileMinutes = fileDuration / 60;
  if (Math.abs(fileMinutes - providerRuntime) > 15) {
    issues.push({
      kind: "episode_duration_mismatch",
      media_id: show.id,
      episode_id: episode.id,
      tmdb_id: show.tmdbId,
      tmdb_episode_id: episode.tmdbEpisodeId ?? undefined,
      title: show.title,
      media_type: "show",
      season: episode.season,
      episode: episode.episode,
      detail: `"${show.title}" S${episode.season}E${episode.episode} runs ${Math.round(fileMinutes)} min but the provider says ${providerRuntime} min — the season may be numbered against a different scheme.`,
    });
  }
}
```

- [ ] **Step 7: Add the UI labels**

In `apps/web/src/locales/en/common.json`, beside the existing `episode_number_mismatches` / `episode_number_mismatch` keys:

```json
"episode_duration_mismatches": "Runtime mismatches"
```
```json
"episode_duration_mismatch": "Episode runtime mismatch"
```

In `apps/web/src/locales/fr/common.json`, same two keys:

```json
"episode_duration_mismatches": "Durées incohérentes"
```
```json
"episode_duration_mismatch": "Durée d'épisode incohérente"
```

In `apps/web/src/pages/settings/_component/LibraryHealthCard.tsx:28`, add to the summary tuple list:

```tsx
["episode_duration_mismatches", latest.summary.episode_duration_mismatches],
```

- [ ] **Step 8: Verify the whole suite and typecheck pass**

Run: `cd apps/api && bun run typecheck && bun test src/`
Then: `cd ../.. && bun run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/shared/src/types/admin.ts apps/api/src/services apps/web/src
git commit -m "feat(library): flag episodes whose runtime disagrees with the provider"
```

---

### Task 7: Verify against the real library

**Files:** none — verification only.

- [ ] **Step 1: Build and deploy the image, then run an integrity pass**

Trigger the library health job from the admin UI (Settings → Library health) and read the resulting `library_health_log` row.

Expected: zero `episode_duration_mismatch` issues for *House* season 6, because it was repaired by hand on 2026-08-08. Any other show reporting one is a genuine find — record it rather than fixing it here.

- [ ] **Step 2: Confirm rescan completes on mergerfs paths**

```bash
docker exec rawkoon sh -c 'cd /app/apps/api && bun -e "
import { rescanLibraryItem } from \"@rawkoon/api/services/library/rescan\";
console.log(JSON.stringify(await rescanLibraryItem(2376)));
process.exit(0);
"'
```

Expected: a `RescanResult` with non-zero `skipped` or `rescanned`, and no `P2020`.

- [ ] **Step 3: Confirm fingerprints now persist**

```sql
SELECT count(*) AS total, count(file_ino) AS with_ino FROM media_files;
```

Expected: `with_ino` is now a large fraction of `total`, where it was 17 of 5403 before. That is the size+mtime fast path becoming usable.

- [ ] **Step 4: Commit any notes**

No code change expected. If the integrity pass surfaced other shifted shows, add them to the board rather than to this branch.
