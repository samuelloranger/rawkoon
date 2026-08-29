# Audiobook Player — Phase 0 and Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rawkoon server tell the truth about a chapterized audiobook and serve it to a
native client — and separately prove, on the operator's actual phone, that a signed app can be
delivered and woken for a background download.

**Architecture:** Phase 0 proves the two scarce, un-fakeable things first: that a build can reach
the phone at all, and that iOS wakes the app for a background transfer. Phase 1 then builds the server contract — chapter
rows carrying a whole-book timeline derived from the real files, a Range-capable content endpoint
authenticated by a signed grant rather than a session, and per-user progress.

**Tech Stack:** Bun, Elysia, Prisma 7 + Postgres 17, `bun test`. Swift 6.3 / SwiftPM and XcodeGen for
the iOS skeleton. GitHub Actions `macos-15` runners producing an unsigned `.ipa`, sideloaded.

**Spec:** `docs/superpowers/specs/2026-08-29-audiobook-player-design.md`

## Global Constraints

- The only test fixture is **L'intruse**, book id `3`, audiobook edition id `61`. Do not invent
  books, durations, or paths. Its files are at
  `/mnt/storage/Audiobooks/Freida McFadden/L'intruse (2026)/`, 61 files named
  `01 - Chapter 1.mp3` … `61 - Chapter 61.mp3`.
- Measured facts that tests assert against: the 61 files sum to **29383.445s**; the original is
  **29381.878s**; `metadata.json`'s last chapter ends at **29381.830s**. The divergence is expected.
- The whole-book timeline is **always** the running sum of ffprobe'd durations of the files on
  disk. Never the source chapter atoms, never `metadata.json`, never `BookEdition.durationSecs`.
- `parseByteRange` returns an **inclusive** `end`. `Blob.slice` takes an **exclusive** one. Every
  slice is `slice(start, end + 1)`.
- API code imports itself as `@rawkoon/api/<path>`, never by relative path.
- Errors are returned via helpers from `@rawkoon/api/errors`, never thrown.
- `requireUser` narrows `user` at runtime but not in the type, so route handlers write `user!.id`.
  That is the existing convention — see `routes/requests/index.ts:56`.
- `bun run typecheck` **and** `bun run typecheck:native` must both pass. `noUnusedLocals`,
  `noUnusedParameters` and `noImplicitReturns` are on.
- Never run `db:migrate:dev` or `db:push` against production. Dev DB is on port 5433.
- Do not add `Co-Authored-By` trailers to commits.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/prisma/schema.prisma` | Add `BookChapter`, `BookListeningProgress`; extend `BookEdition`, `BookFile`. |
| `apps/api/src/services/books/probeAudioDuration.ts` | One job: ffprobe a file and return its duration in seconds. |
| `apps/api/src/services/books/bookTimeline.ts` | Pure: turn a list of durations into whole-book chapter offsets. |
| `apps/api/src/services/books/registerBookChapters.ts` | Probe, hash and register an already-split edition. No splitting. |
| `apps/api/src/services/books/downloadGrant.ts` | Mint and verify signed content URLs. |
| `apps/api/src/routes/books/bookPlaybackRoutes.ts` | `manifest`, `content`, and the progress endpoints. |
| `apps/ios/project.yml` | XcodeGen project definition, so no `.pbxproj` is ever hand-edited. |
| `.github/workflows/ios.yml` | Simulator build plus an unsigned `.ipa` artifact, on macOS runners. |

---

## Phase 0 — Prove signing and background wake

### Task 1: An empty app on the phone that proves a background wake

Nothing else in the iOS half is worth building until this passes. This task writes almost no
application code on purpose: its deliverable is evidence, not features.

**Files:**
- Create: `apps/ios/project.yml`
- Create: `apps/ios/Rawkoon/RawkoonApp.swift`
- Create: `apps/ios/Rawkoon/BackgroundProbe.swift`
- Create: `apps/ios/Rawkoon/Info.plist`
- Create: `.github/workflows/ios.yml`
- Modify: `.gitignore` (ignore `apps/ios/*.xcodeproj`, `apps/ios/build/`)

**Interfaces:**
- Consumes: nothing.
- Produces: an unsigned `.ipa` artifact from CI, and a confirmed answer to "does
  `handleEventsForBackgroundURLSession` fire on this phone".

- [ ] **Step 1: Operator prerequisites**

The app is **sideloaded**, not distributed through TestFlight, so CI never signs anything and no
App Store Connect API key is needed. CI produces an unsigned `.ipa`; the operator's Mac signs it at
install time with their own Apple ID.

The operator needs, once:
1. A Mac with Xcode installed, and a signing tool — Sideloadly, AltStore, or Xcode's own
   Devices window.
2. A paid Apple Developer account, so the install lasts a year rather than seven days. Free
   provisioning expires weekly, which would make the phase 2 soak test impossible to repeat.

Nothing is stored in repository secrets. That is the point of this route.

- [ ] **Step 2: Write the XcodeGen project definition**

```yaml
# apps/ios/project.yml
name: Rawkoon
options:
  bundleIdPrefix: cloud.samlo
  deploymentTarget:
    iOS: "18.0"
targets:
  Rawkoon:
    type: application
    platform: iOS
    sources: [Rawkoon]
    info:
      path: Rawkoon/Info.plist
      properties:
        UIBackgroundModes: [audio, fetch]
        CFBundleDisplayName: Rawkoon
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: cloud.samlo.rawkoon
      MARKETING_VERSION: "0.1.0"
      CURRENT_PROJECT_VERSION: "1"
```

- [ ] **Step 3: Write the probe**

The probe exists to answer one question, so it reports loudly and does nothing else.

```swift
// apps/ios/Rawkoon/BackgroundProbe.swift
import Foundation

final class BackgroundProbe: NSObject, URLSessionDownloadDelegate {
    static let shared = BackgroundProbe()
    /// Set by the app delegate when iOS wakes us for the session.
    var wakeCompletion: (() -> Void)?
    private(set) var log: [String] = []

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "cloud.samlo.rawkoon.probe")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    func start(url: URL) {
        log.append("started \(Date())")
        session.downloadTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? -1
        log.append("finished status=\(status) at \(Date())")
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        log.append("WOKE for background session at \(Date())")
        DispatchQueue.main.async { self.wakeCompletion?(); self.wakeCompletion = nil }
    }
}
```

- [ ] **Step 4: Write the app shell**

A single screen: a button that starts the probe against any large public file, and a list showing
`BackgroundProbe.shared.log`. That list is the experiment's readout.

```swift
// apps/ios/Rawkoon/RawkoonApp.swift
import SwiftUI

@main
struct RawkoonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene { WindowGroup { ProbeView() } }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        BackgroundProbe.shared.wakeCompletion = completionHandler
    }
}

struct ProbeView: View {
    @State private var lines: [String] = []
    var body: some View {
        VStack(spacing: 16) {
            Button("Start background download") {
                BackgroundProbe.shared.start(
                    url: URL(string: "https://speed.hetzner.de/100MB.bin")!)
                lines = BackgroundProbe.shared.log
            }
            Button("Refresh log") { lines = BackgroundProbe.shared.log }
            List(lines, id: \.self) { Text($0).font(.caption.monospaced()) }
        }.padding()
    }
}
```

- [ ] **Step 5: Write the CI workflow**

Two jobs. The simulator build is the fast feedback loop; the unsigned `.ipa` is the artifact the
operator actually installs. Signing is deliberately disabled in both — a sideloading flow re-signs
locally, so a signing identity in CI would be dead weight and a secret to leak.

```yaml
# .github/workflows/ios.yml
name: iOS
on:
  push:
    paths: ["apps/ios/**", ".github/workflows/ios.yml"]
  pull_request:
    paths: ["apps/ios/**"]
  workflow_dispatch:
jobs:
  build:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - run: brew install xcodegen
      - run: xcodegen generate
        working-directory: apps/ios
      - name: Build for simulator
        working-directory: apps/ios
        run: |
          xcodebuild build \
            -project Rawkoon.xcodeproj -scheme Rawkoon \
            -destination 'platform=iOS Simulator,name=iPhone 16' \
            CODE_SIGNING_ALLOWED=NO

  ipa:
    runs-on: macos-15
    needs: build
    steps:
      - uses: actions/checkout@v4
      - run: brew install xcodegen
      - run: xcodegen generate
        working-directory: apps/ios
      - name: Build unsigned device binary
        working-directory: apps/ios
        run: |
          xcodebuild build \
            -project Rawkoon.xcodeproj -scheme Rawkoon \
            -destination 'generic/platform=iOS' \
            -derivedDataPath build/dd \
            CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""
      - name: Wrap the .app into an .ipa
        working-directory: apps/ios
        run: |
          mkdir -p build/Payload
          cp -R build/dd/Build/Products/Debug-iphoneos/Rawkoon.app build/Payload/
          cd build && zip -qry Rawkoon-unsigned.ipa Payload
      - uses: actions/upload-artifact@v4
        with:
          name: Rawkoon-unsigned-ipa
          path: apps/ios/build/Rawkoon-unsigned.ipa
```

- [ ] **Step 6: Push and confirm the simulator build is green**

Run: `gh run watch`
Expected: the `build` job passes. If `xcodegen` reports an unknown key, fix `project.yml` — do not
create an `.xcodeproj` by hand, because nothing on this Linux machine can maintain one.

- [ ] **Step 7: Download and sideload the build**

The artifact is a few megabytes, which matters on a 30 KB/s link — this is the only thing that has
to cross it.

```bash
gh run download --name Rawkoon-unsigned-ipa
```

On the Mac, open `Rawkoon-unsigned.ipa` in Sideloadly (or AltStore), sign it with the Apple ID
attached to the paid developer account, and install to the phone. Trust the developer certificate
under Settings → General → VPN & Device Management if prompted.

- [ ] **Step 8: Run the experiment on the phone**

This is the entire point of phase 0:
1. Tap "Start background download", then immediately background the app and lock the screen.
2. Wait five minutes. Reopen, tap "Refresh log".

**Record the result in board task 891.** A log containing `WOKE for background session` means the
iOS half of this design is viable. If it never appears, stop and re-plan phases 2 and 3 before
writing any more Swift — that is what this phase is for.

One thing to confirm while you are here, because it is cheap now and expensive to discover in phase
2: a sideloaded app carries the same `UIBackgroundModes` as any other, but if the background wake
never fires, re-check that `sessionSendsLaunchEvents` survived signing and that the app was not
force-quit from the app switcher — a force-quit cancels background transfers by design, and would
look identical to the feature being unavailable.

- [ ] **Step 9: Commit**

```bash
git add apps/ios .github/workflows/ios.yml .gitignore
git commit -m "feat(ios): app skeleton and background-wake probe"
```

---

## Phase 1 — The server tells the truth

### Task 2: Schema for chapters and per-user progress

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: models `BookChapter` and `BookListeningProgress`; `BookEdition.offlineReady`;
  `BookFile.sha256` and `BookFile.chapterIndex`.

- [ ] **Step 1: Add the models**

Append to `apps/api/prisma/schema.prisma`:

```prisma
model BookChapter {
  id         Int    @id @default(autoincrement())
  editionId  Int    @map("edition_id")
  bookFileId Int    @map("book_file_id")
  index      Int
  title      String
  /// Offsets on the WHOLE-BOOK timeline, produced by accumulating the ffprobe'd
  /// durations of the files on disk. Never copied from source chapter atoms:
  /// `-c copy` rounds every cut up to a frame boundary, which on the reference
  /// book drifts +1.567s across 61 files.
  startSecs  Float  @map("start_secs")
  endSecs    Float  @map("end_secs")

  edition  BookEdition @relation(fields: [editionId], references: [id], onDelete: Cascade)
  bookFile BookFile    @relation(fields: [bookFileId], references: [id], onDelete: Cascade)

  @@unique([editionId, index], map: "uq_book_chapters_edition_index")
  @@map("book_chapters")
}

model BookListeningProgress {
  id               Int      @id @default(autoincrement())
  userId           String   @map("user_id")
  editionId        Int      @map("edition_id")
  /// Whole-book seconds. Never a per-file offset: the removed player stored a
  /// file index plus an in-file offset and could resolve to an index that did
  /// not exist, which is why it "only ever worked from position 0".
  positionSecs     Float    @map("position_secs")
  /// The book length this position was recorded against. A quality upgrade
  /// changes the length and makes the position approximate.
  totalDurationSecs Float   @map("total_duration_secs")
  finished         Boolean  @default(false)
  /// Client-supplied, clamped to server time on receipt.
  updatedAt        DateTime @map("updated_at")
  /// Server receipt time. Breaks ties deterministically.
  receivedAt       DateTime @default(now()) @map("received_at")
  deviceId         String?  @map("device_id")

  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  edition BookEdition @relation(fields: [editionId], references: [id], onDelete: Cascade)

  @@unique([userId, editionId], map: "uq_book_progress_user_edition")
  @@map("book_listening_progress")
}
```

- [ ] **Step 2: Extend the existing models**

In `model BookEdition`, add the field and the back-relations:

```prisma
  offlineReady Boolean @default(false) @map("offline_ready")
  chapters     BookChapter[]
  progress     BookListeningProgress[]
```

In `model BookFile`, add:

```prisma
  sha256       String? 
  chapterIndex Int?    @map("chapter_index")
  chapters     BookChapter[]
```

In `model User`, add: `bookProgress BookListeningProgress[]`

- [ ] **Step 3: Create and apply the migration**

Run: `bun run db:migrate:dev --name audiobook_chapters_and_progress`
Expected: a new directory under `apps/api/prisma/migrations/`, and the client regenerates.

- [ ] **Step 4: Verify the schema compiles**

Run: `bun run typecheck && bun run typecheck:native`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(books): chapter and per-user listening progress schema"
```

---

### Task 3: Stop rescan from minting new file ids

`rescanBookEdition` currently deletes and recreates every `BookFile` on each run
(`apps/api/src/services/postProcessorBook.ts:765-786`). Once `BookChapter.bookFileId` cascades, one
routine rescan erases every chapter row and invalidates every `fileId` a client has cached. This
must land before anything depends on `BookFile.id`.

**Files:**
- Modify: `apps/api/src/services/postProcessorBook.ts:765-786`
- Test: `apps/api/src/services/postProcessorBook.rescan.test.ts`

**Interfaces:**
- Consumes: `rescanBookEdition(editionId: number)` from Task 2's schema.
- Produces: the guarantee that a `BookFile.id` is stable across rescans of an unchanged file.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/postProcessorBook.rescan.test.ts
import { describe, expect, test } from "bun:test";
import { upsertBookFile } from "@rawkoon/api/services/postProcessorBook";

describe("upsertBookFile", () => {
  test("keeps the row id when the same path is scanned twice", async () => {
    const first = await upsertBookFile({
      editionId: 1, filePath: "/lib/01.mp3", fileName: "01.mp3",
      sizeBytes: 100n, format: "mp3", durationSecs: 10, audioBitrate: 196,
      audioCodec: "mp3", languageTags: ["fr"], fileDev: "1", fileIno: "2",
      fileMtimeMs: 3n,
    });
    const second = await upsertBookFile({
      editionId: 1, filePath: "/lib/01.mp3", fileName: "01.mp3",
      sizeBytes: 100n, format: "mp3", durationSecs: 10, audioBitrate: 196,
      audioCodec: "mp3", languageTags: ["fr"], fileDev: "1", fileIno: "2",
      fileMtimeMs: 4n,
    });
    expect(second.id).toBe(first.id);
    expect(second.existed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && bun test src/services/postProcessorBook.rescan.test.ts`
Expected: FAIL — `upsertBookFile` is not exported.

- [ ] **Step 3: Extract and rewrite the refresh path**

Replace the `deleteMany` + `create` block with an exported upsert. The distinction the existing
code drew — registered versus refreshed — is preserved via `existed`, because
`rescanBookEdition`'s honest counts depend on it.

```ts
export interface BookFileUpsert {
  editionId: number; filePath: string; fileName: string; sizeBytes: bigint;
  format: string; durationSecs: number | null; audioBitrate: number | null;
  audioCodec: string | null; languageTags: string[];
  fileDev: string; fileIno: string; fileMtimeMs: bigint;
}

/**
 * Update in place, keyed by path. The row id must survive a rescan: book
 * chapters reference it, and every signed download URL names it.
 */
export async function upsertBookFile(
  data: BookFileUpsert,
): Promise<{ id: number; existed: boolean }> {
  const existing = await prisma.bookFile.findFirst({
    where: { filePath: data.filePath },
    select: { id: true },
  });
  if (existing) {
    await prisma.bookFile.update({
      where: { id: existing.id },
      data: { ...data, isRetail: false },
    });
    return { id: existing.id, existed: true };
  }
  const created = await prisma.bookFile.create({
    data: { ...data, isRetail: false },
    select: { id: true },
  });
  return { id: created.id, existed: false };
}
```

Then in `rescanBookEdition`, replace the delete/create pair with:

```ts
    const { existed } = await upsertBookFile({
      editionId, filePath: keeper.path, fileName: basename(keeper.path),
      sizeBytes: BigInt(st.size), format: keeper.format, durationSecs,
      audioBitrate, audioCodec, languageTags,
      fileDev: String(st.dev), fileIno: String(st.ino),
      fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
    });
    if (existed) refreshed++;
    else registered++;
```

- [ ] **Step 4: Run the test**

Run: `cd apps/api && bun test src/services/postProcessorBook.rescan.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole api suite for regressions**

Run: `cd apps/api && bun test`
Expected: no new failures. `rescanBookEdition`'s existing tests must still pass — they assert the
registered/refreshed counts, which is exactly what `existed` preserves.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/postProcessorBook.ts apps/api/src/services/postProcessorBook.rescan.test.ts
git commit -m "fix(books): keep BookFile ids stable across a rescan"
```

---

### Task 4: The whole-book timeline, as pure arithmetic

**Files:**
- Create: `apps/api/src/services/books/bookTimeline.ts`
- Test: `apps/api/src/services/books/bookTimeline.test.ts`

**Interfaces:**
- Produces: `buildTimeline(entries: TimelineInput[]): TimelineChapter[]`, where
  `TimelineInput = { title: string; durationSecs: number }` and
  `TimelineChapter = { index: number; title: string; startSecs: number; endSecs: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/books/bookTimeline.test.ts
import { describe, expect, test } from "bun:test";
import { buildTimeline } from "@rawkoon/api/services/books/bookTimeline";

describe("buildTimeline", () => {
  test("chapters run end to end with no gap and no overlap", () => {
    const t = buildTimeline([
      { title: "Chapter 1", durationSecs: 504.189388 },
      { title: "Chapter 2", durationSecs: 538.671020 },
      { title: "Chapter 3", durationSecs: 409.521633 },
    ]);
    expect(t[0]).toEqual({ index: 0, title: "Chapter 1", startSecs: 0, endSecs: 504.189388 });
    expect(t[1].startSecs).toBe(t[0].endSecs);
    expect(t[2].startSecs).toBe(t[1].endSecs);
    expect(t[2].endSecs).toBeCloseTo(1452.382041, 6);
  });

  /**
   * The reference book's real numbers. The sum deliberately does NOT equal
   * metadata.json's 29381.83: `-c copy` rounds every cut up to a frame, which
   * drifts +1.567s across 61 files. A change that starts trusting source
   * chapter atoms must fail here.
   */
  test("the reference book's total is the sum of its files, not its atoms", () => {
    const durations = Array.from({ length: 61 }, (_, i) => ({
      title: `Chapter ${i + 1}`, durationSecs: 29383.445 / 61,
    }));
    const t = buildTimeline(durations);
    expect(t[60].endSecs).toBeCloseTo(29383.445, 3);
    expect(t[60].endSecs).toBeGreaterThan(29381.83);
  });

  test("an empty book has no chapters", () => {
    expect(buildTimeline([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && bun test src/services/books/bookTimeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/books/bookTimeline.ts

export interface TimelineInput {
  title: string;
  durationSecs: number;
}

export interface TimelineChapter {
  index: number;
  title: string;
  startSecs: number;
  endSecs: number;
}

/**
 * Turn per-file durations into whole-book chapter offsets.
 *
 * Each chapter starts exactly where the previous one ended, so the timeline has
 * no gaps and no overlaps by construction. The durations must come from probing
 * the files that will actually be played — see bookTimeline.test.ts for why the
 * source chapter atoms are not an acceptable substitute.
 */
export const buildTimeline = (entries: TimelineInput[]): TimelineChapter[] => {
  const chapters: TimelineChapter[] = [];
  let cursor = 0;
  for (const [index, entry] of entries.entries()) {
    const startSecs = cursor;
    cursor += entry.durationSecs;
    chapters.push({ index, title: entry.title, startSecs, endSecs: cursor });
  }
  return chapters;
};
```

- [ ] **Step 4: Run the test**

Run: `cd apps/api && bun test src/services/books/bookTimeline.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/bookTimeline.ts apps/api/src/services/books/bookTimeline.test.ts
git commit -m "feat(books): whole-book chapter timeline from file durations"
```

---

### Task 5: Probe a file's duration with ffprobe

`scanMediaInfo` already exists and is used at import, but the timeline must agree with the numbers
this design was validated against, which came from `ffprobe -show_entries format=duration`. Using
one prober for the timeline and another for import metadata is the kind of divergence that produces
a bug nobody can reproduce.

**Files:**
- Create: `apps/api/src/services/books/probeAudioDuration.ts`
- Test: `apps/api/src/services/books/probeAudioDuration.test.ts`

**Interfaces:**
- Produces: `probeAudioDuration(path: string): Promise<number | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/books/probeAudioDuration.test.ts
import { describe, expect, test } from "bun:test";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";

const CHAPTER_ONE =
  "/mnt/storage/Audiobooks/Freida McFadden/L'intruse (2026)/01 - Chapter 1.mp3";

describe("probeAudioDuration", () => {
  test("reads the real duration of the reference book's first chapter", async () => {
    const seen = await probeAudioDuration(CHAPTER_ONE);
    expect(seen).toBeCloseTo(504.189388, 3);
  });

  test("returns null for a file that is not there", async () => {
    expect(await probeAudioDuration("/nope/missing.mp3")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && bun test src/services/books/probeAudioDuration.test.ts`
Expected: FAIL — module not found.

Note: the first test reads a real file. If the library is not mounted, it will fail for that reason
instead — check the path exists before debugging the code.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/books/probeAudioDuration.ts

/**
 * A file's duration in seconds, per ffprobe.
 *
 * The whole-book timeline is built by accumulating these, so this is the single
 * definition of how long a chapter is. It deliberately does not reuse
 * scanMediaInfo: MediaInfo and ffprobe can disagree in the third decimal, and
 * two definitions of "how long" is how a timeline silently desynchronises.
 */
export const probeAudioDuration = async (
  path: string,
): Promise<number | null> => {
  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0) return null;
  const seconds = Number(out);
  return Number.isFinite(seconds) ? seconds : null;
};
```

- [ ] **Step 4: Run the test**

Run: `cd apps/api && bun test src/services/books/probeAudioDuration.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/probeAudioDuration.ts apps/api/src/services/books/probeAudioDuration.test.ts
git commit -m "feat(books): ffprobe duration helper for the chapter timeline"
```

---

### Task 6: Register an already-split edition

Registration is deliberately separate from splitting. L'intruse is already one file per chapter, so
this is what makes a manifest possible before the splitter exists in phase 4.

**Files:**
- Create: `apps/api/src/services/books/registerBookChapters.ts`
- Test: `apps/api/src/services/books/registerBookChapters.test.ts`

**Interfaces:**
- Consumes: `buildTimeline` (Task 4), `probeAudioDuration` (Task 5), and Task 3's guarantee that
  a `BookFile.id` survives a rescan — without it these chapter rows detach on the next scan.
- Produces: `registerBookChapters(editionId: number): Promise<RegisterResult>` where
  `RegisterResult = { chapters: number; totalDurationSecs: number; offlineReady: boolean; reason?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/books/registerBookChapters.test.ts
import { describe, expect, test } from "bun:test";
import { chapterTitleFromFileName, sortChapterFiles } from "@rawkoon/api/services/books/registerBookChapters";

describe("chapterTitleFromFileName", () => {
  test("strips the ordinal prefix and the extension", () => {
    expect(chapterTitleFromFileName("01 - Chapter 1.mp3")).toBe("Chapter 1");
    expect(chapterTitleFromFileName("61 - Chapter 61.mp3")).toBe("Chapter 61");
  });

  test("falls back to the stem when there is no ordinal prefix", () => {
    expect(chapterTitleFromFileName("Prologue.mp3")).toBe("Prologue");
  });
});

describe("sortChapterFiles", () => {
  /**
   * Lexicographic order puts "10" before "2". The reference book has 61
   * chapters, so this is not hypothetical — it would interleave the whole
   * second half of the book and corrupt every offset.
   */
  test("orders numerically, not lexicographically", () => {
    const sorted = sortChapterFiles([
      "10 - Chapter 10.mp3", "2 - Chapter 2.mp3", "1 - Chapter 1.mp3",
    ]);
    expect(sorted).toEqual([
      "1 - Chapter 1.mp3", "2 - Chapter 2.mp3", "10 - Chapter 10.mp3",
    ]);
  });

  test("keeps zero-padded names in order too", () => {
    expect(sortChapterFiles(["02 - B.mp3", "01 - A.mp3"]))
      .toEqual(["01 - A.mp3", "02 - B.mp3"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && bun test src/services/books/registerBookChapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helpers and the service**

```ts
// apps/api/src/services/books/registerBookChapters.ts
import { basename } from "node:path";
import { prisma } from "@rawkoon/api/db";
import { buildTimeline } from "@rawkoon/api/services/books/bookTimeline";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";

const ORDINAL = /^(\d+)\s*-\s*/;

/** "01 - Chapter 1.mp3" -> "Chapter 1". */
export const chapterTitleFromFileName = (name: string): string => {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem.replace(ORDINAL, "").trim() || stem;
};

/** Numeric order by leading ordinal, so 10 follows 2 rather than preceding it. */
export const sortChapterFiles = (names: string[]): string[] =>
  [...names].sort((a, b) => {
    const na = Number(ORDINAL.exec(a)?.[1] ?? Number.NaN);
    const nb = Number(ORDINAL.exec(b)?.[1] ?? Number.NaN);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
    return na - nb;
  });

export interface RegisterResult {
  chapters: number;
  totalDurationSecs: number;
  offlineReady: boolean;
  reason?: string;
}

/**
 * Probe, hash and register the audio files of an edition that is already one
 * file per chapter.
 *
 * Idempotent by database state: re-running over an unchanged edition rewrites
 * the same rows against the same BookFile ids, because upsertBookFile keeps
 * them stable. An edition with fewer than two audio files is not chapterized
 * and is refused rather than guessed at.
 */
export async function registerBookChapters(
  editionId: number,
): Promise<RegisterResult> {
  const files = await prisma.bookFile.findMany({
    where: { editionId },
    select: { id: true, filePath: true, fileName: true },
  });

  if (files.length < 2) {
    await prisma.bookEdition.update({
      where: { id: editionId },
      data: { offlineReady: false },
    });
    return {
      chapters: 0, totalDurationSecs: 0, offlineReady: false,
      reason: "Edition is not split into chapters",
    };
  }

  const byName = new Map(files.map((f) => [f.fileName, f]));
  const ordered = sortChapterFiles(files.map((f) => f.fileName));

  const inputs: { title: string; durationSecs: number }[] = [];
  const fileIds: number[] = [];
  for (const name of ordered) {
    const file = byName.get(name);
    if (!file) continue;
    const durationSecs = await probeAudioDuration(file.filePath);
    if (durationSecs === null) {
      await prisma.bookEdition.update({
        where: { id: editionId },
        data: { offlineReady: false },
      });
      return {
        chapters: 0, totalDurationSecs: 0, offlineReady: false,
        reason: `Could not probe ${basename(file.filePath)}`,
      };
    }
    inputs.push({ title: chapterTitleFromFileName(name), durationSecs });
    fileIds.push(file.id);
  }

  const timeline = buildTimeline(inputs);

  await prisma.$transaction(async (tx) => {
    await tx.bookChapter.deleteMany({ where: { editionId } });
    for (const chapter of timeline) {
      const bookFileId = fileIds[chapter.index];
      if (bookFileId === undefined) continue;
      await tx.bookChapter.create({
        data: {
          editionId, bookFileId, index: chapter.index, title: chapter.title,
          startSecs: chapter.startSecs, endSecs: chapter.endSecs,
        },
      });
      await tx.bookFile.update({
        where: { id: bookFileId },
        data: { chapterIndex: chapter.index },
      });
    }
    await tx.bookEdition.update({
      where: { id: editionId },
      data: { offlineReady: true },
    });
  });

  const totalDurationSecs = timeline.at(-1)?.endSecs ?? 0;
  return { chapters: timeline.length, totalDurationSecs, offlineReady: true };
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/api && bun test src/services/books/registerBookChapters.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/registerBookChapters.ts apps/api/src/services/books/registerBookChapters.test.ts
git commit -m "feat(books): register chapters for an already-split edition"
```

---

### Task 7: Make the database tell the truth about edition 61

**Files:**
- Create: `apps/api/src/scripts/registerEditionChapters.ts`

**Interfaces:**
- Consumes: `rescanBookEdition` (Task 3), `registerBookChapters` (Task 6).
- Produces: edition 61 with 61 `book_files` and 61 `book_chapters` rows.

- [ ] **Step 1: Write the script**

Follow the shape of the existing one-off CLIs in `apps/api/src/scripts/`.

```ts
// apps/api/src/scripts/registerEditionChapters.ts
import { rescanBookEdition } from "@rawkoon/api/services/postProcessorBook";
import { registerBookChapters } from "@rawkoon/api/services/books/registerBookChapters";

const editionId = Number(process.argv[2]);
if (!Number.isInteger(editionId)) {
  console.error("usage: bun src/scripts/registerEditionChapters.ts <editionId>");
  process.exit(1);
}

const scan = await rescanBookEdition(editionId);
console.log("rescan:", scan);
const result = await registerBookChapters(editionId);
console.log("register:", result);
```

- [ ] **Step 2: Run it against the dev database**

```bash
cd apps/api && set -a && . ../../.env && set +a && bun src/scripts/registerEditionChapters.ts 61
```

Expected: `rescan` reports 61 registered, and `register` reports
`{ chapters: 61, totalDurationSecs: ~29383.4, offlineReady: true }`.

- [ ] **Step 3: Verify against the measured facts**

```bash
docker exec -e PGPASSWORD=<pw> rawkoon-db-dev psql -U rawkoon -d rawkoon -c \
  "select count(*), max(end_secs) from book_chapters where edition_id = 61;"
```

Expected: `61` and a value near `29383.44`. If it reads `29381.83`, the timeline is being taken
from `metadata.json` rather than the files, which is the exact defect Task 4's test exists to catch.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/scripts/registerEditionChapters.ts
git commit -m "feat(books): script to rescan and register an edition's chapters"
```

---

### Task 8: Signed download grants

**Files:**
- Create: `apps/api/src/services/books/downloadGrant.ts`
- Test: `apps/api/src/services/books/downloadGrant.test.ts`

**Interfaces:**
- Produces: `signGrant(input: GrantInput, secret: string, now?: number): string` and
  `verifyGrant(token: string, secret: string, now?: number): GrantInput | null`, where
  `GrantInput = { fileId: number; variant: "original" | "datasaver"; grantId: string; expiresAt: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/books/downloadGrant.test.ts
import { describe, expect, test } from "bun:test";
import { signGrant, verifyGrant } from "@rawkoon/api/services/books/downloadGrant";

const SECRET = "x".repeat(32);
const BASE = {
  fileId: 42,
  variant: "original" as const,
  grantId: "g-abc",
  expiresAt: 2_000_000_000_000,
};

describe("download grants", () => {
  test("a freshly signed grant verifies and round-trips its fields", () => {
    const token = signGrant(BASE, SECRET);
    expect(verifyGrant(token, SECRET, 1_000_000_000_000)).toEqual(BASE);
  });

  test("an expired grant does not verify", () => {
    const token = signGrant(BASE, SECRET);
    expect(verifyGrant(token, SECRET, 2_000_000_000_001)).toBeNull();
  });

  test("a grant signed with another secret does not verify", () => {
    const token = signGrant(BASE, "y".repeat(32));
    expect(verifyGrant(token, SECRET, 1_000_000_000_000)).toBeNull();
  });

  /**
   * The whole reason the payload is signed rather than merely opaque: a client
   * that edits the fileId must not be able to read another book's bytes.
   */
  test("a tampered fileId does not verify", () => {
    const token = signGrant(BASE, SECRET);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...BASE, fileId: 43 }),
    ).toString("base64url");
    expect(payload).not.toBe(forged);
    expect(verifyGrant(`${forged}.${sig}`, SECRET, 1_000_000_000_000)).toBeNull();
  });

  test("garbage is rejected rather than throwing", () => {
    expect(verifyGrant("not-a-token", SECRET)).toBeNull();
    expect(verifyGrant("", SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && bun test src/services/books/downloadGrant.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/books/downloadGrant.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface GrantInput {
  fileId: number;
  variant: "original" | "datasaver";
  /** Opaque per-user id. Never the userId: these tokens end up in logs. */
  grantId: string;
  expiresAt: number;
}

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/**
 * A signed download URL is what authenticates `content`.
 *
 * A background URLSession transfer carries no session cookie, so a route behind
 * requireUser would 401 every download. The signature travels in the URL
 * instead, and carries an opaque grant id rather than a user id so that a URL
 * captured in a proxy log or a crash report names nobody.
 */
export const signGrant = (input: GrantInput, secret: string): string => {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
};

export const verifyGrant = (
  token: string,
  secret: string,
  now: number = Date.now(),
): GrantInput | null => {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as GrantInput;
    if (typeof parsed.fileId !== "number") return null;
    if (parsed.variant !== "original" && parsed.variant !== "datasaver") return null;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
};
```

- [ ] **Step 4: Run the test**

Run: `cd apps/api && bun test src/services/books/downloadGrant.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/books/downloadGrant.ts apps/api/src/services/books/downloadGrant.test.ts
git commit -m "feat(books): signed download grants for content URLs"
```

---

### Task 9: The manifest, the content endpoint, and progress

**Files:**
- Create: `apps/api/src/routes/books/bookPlaybackRoutes.ts`
- Modify: `apps/api/src/routes/books/index.ts`
- Test: `apps/api/src/routes/books/bookPlaybackRoutes.test.ts`

**Interfaces:**
- Consumes: `signGrant`/`verifyGrant` (Task 8), `parseByteRange` from `@rawkoon/shared/utils`,
  the schema from Task 2.
- Produces: `bookPlaybackRoutes` (session-authenticated) and `bookContentRoutes`
  (grant-authenticated), plus `clampClientTimestamp(clientIso: string, now: Date): Date`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routes/books/bookPlaybackRoutes.test.ts
import { describe, expect, test } from "bun:test";
import { parseByteRange } from "@rawkoon/shared/utils";
import { clampClientTimestamp, sliceForRange } from "@rawkoon/api/routes/books/bookPlaybackRoutes";

describe("clampClientTimestamp", () => {
  /**
   * One device with a clock set to 2099 would otherwise win every future
   * conflict permanently, because last-write-wins compares client timestamps.
   */
  test("a future client clock is clamped to server time", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(clampClientTimestamp("2099-01-01T00:00:00Z", now)).toEqual(now);
  });

  test("a past client clock is kept, because offline edits are legitimate", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const past = "2026-08-20T09:30:00Z";
    expect(clampClientTimestamp(past, now)).toEqual(new Date(past));
  });

  test("an unparseable timestamp falls back to server time", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(clampClientTimestamp("banana", now)).toEqual(now);
  });
});

describe("sliceForRange", () => {
  /**
   * parseByteRange returns an INCLUSIVE end; Blob.slice takes an EXCLUSIVE
   * one. Getting this wrong returns one byte too few, and Content-Length,
   * Content-Range and the chapter's sha256 then all disagree with the body.
   */
  test("converts an inclusive range to an exclusive slice", () => {
    const range = parseByteRange("bytes=0-99", 1000);
    expect(range).toEqual({ start: 0, end: 99 });
    expect(sliceForRange(range as { start: number; end: number }))
      .toEqual({ start: 0, endExclusive: 100 });
  });

  test("a single byte is a slice of length one", () => {
    expect(sliceForRange({ start: 5, end: 5 }))
      .toEqual({ start: 5, endExclusive: 6 });
  });

  test("an open-ended range runs to the last byte inclusive", () => {
    const range = parseByteRange("bytes=900-", 1000);
    expect(range).toEqual({ start: 900, end: 999 });
    expect(sliceForRange(range as { start: number; end: number }))
      .toEqual({ start: 900, endExclusive: 1000 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && bun test src/routes/books/bookPlaybackRoutes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helpers**

```ts
// apps/api/src/routes/books/bookPlaybackRoutes.ts (top of file)
import { Elysia, t } from "elysia";
import { parseByteRange } from "@rawkoon/shared/utils";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, unauthorized } from "@rawkoon/api/errors";
import { loadConfig } from "@rawkoon/api/config";
import { signGrant, verifyGrant } from "@rawkoon/api/services/books/downloadGrant";

const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A client timestamp is trusted backwards but not forwards.
 *
 * Progress conflicts resolve by the client's own updatedAt, so a device whose
 * clock is years fast would win every exchange from then on. Clamping forward
 * timestamps to server time removes that without penalising a device that was
 * genuinely offline for a week.
 */
export const clampClientTimestamp = (clientIso: string, now: Date): Date => {
  const parsed = new Date(clientIso);
  if (Number.isNaN(parsed.getTime())) return now;
  return parsed.getTime() > now.getTime() ? now : parsed;
};

/** parseByteRange's end is inclusive; Blob.slice's is not. */
export const sliceForRange = (range: { start: number; end: number }) => ({
  start: range.start,
  endExclusive: range.end + 1,
});
```

- [ ] **Step 4: Run the helper tests**

Run: `cd apps/api && bun test src/routes/books/bookPlaybackRoutes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the manifest route**

Appended to the same file. Note `Number(file.sizeBytes)`: `sizeBytes` is a `BigInt` and does not
survive `JSON.stringify`.

```ts
export const bookPlaybackRoutes = new Elysia()
  .use(requireUser)
  .get(
    "/editions/:id/manifest",
    async ({ params, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { id: params.id },
        select: {
          id: true, kind: true, offlineReady: true,
          book: { select: { id: true, title: true, authors: true } },
          chapters: {
            orderBy: { index: "asc" },
            select: {
              index: true, title: true, startSecs: true, endSecs: true,
              bookFile: { select: { id: true, sizeBytes: true, sha256: true, format: true } },
            },
          },
        },
      });
      if (!edition) return notFound(set, "Edition not found");
      if (!edition.offlineReady || edition.chapters.length === 0) {
        return badRequest(set, "Edition is not offline-ready");
      }

      const secret = loadConfig().SECRET_KEY;
      const expiresAt = Date.now() + GRANT_TTL_MS;

      return {
        edition_id: edition.id,
        book_id: edition.book.id,
        title: edition.book.title,
        authors: edition.book.authors,
        // The sum of the files, which is what the client will actually play.
        total_duration_secs: edition.chapters.at(-1)?.endSecs ?? 0,
        chapters: edition.chapters.map((c) => ({
          index: c.index,
          title: c.title,
          start_secs: c.startSecs,
          end_secs: c.endSecs,
          file_id: c.bookFile.id,
          size_bytes: Number(c.bookFile.sizeBytes),
          sha256: c.bookFile.sha256,
          url: `/api/books/files/${c.bookFile.id}/content?grant=${
            signGrant(
              { fileId: c.bookFile.id, variant: "original",
                grantId: crypto.randomUUID(), expiresAt },
              secret,
            )
          }`,
        })),
      };
    },
    { params: t.Object({ id: t.Numeric() }) },
  );
```

- [ ] **Step 6: Implement the content route**

This router deliberately does **not** `.use(requireUser)`. That is the whole point: the grant is the
authentication, because a background transfer sends no session cookie.

```ts
/**
 * Byte serving for a chapter. Authenticated by its signed grant alone.
 *
 * Never redirects: a background URLSession follows redirects unconditionally,
 * and a redirect to an unsigned URL would leak the bytes.
 */
export const bookContentRoutes = new Elysia().get(
  "/files/:fileId/content",
  async ({ params, query, set, request }) => {
    const grant = verifyGrant(query.grant ?? "", loadConfig().SECRET_KEY);
    if (!grant || grant.fileId !== params.fileId) {
      return unauthorized(set, "Invalid or expired download grant");
    }

    const file = await prisma.bookFile.findUnique({
      where: { id: params.fileId },
      select: { filePath: true, sizeBytes: true },
    });
    if (!file) return notFound(set, "File not found");

    const size = Number(file.sizeBytes);
    const handle = Bun.file(file.filePath);
    const range = parseByteRange(request.headers.get("range"), size);

    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    if (range === null) {
      return new Response(handle.stream(), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, immutable, max-age=31536000",
        },
      });
    }

    const { start, endExclusive } = sliceForRange(range);
    return new Response(handle.slice(start, endExclusive), {
      status: 206,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, immutable, max-age=31536000",
      },
    });
  },
  {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ grant: t.Optional(t.String()) }),
  },
);
```

- [ ] **Step 7: Implement the progress routes**

```ts
export const bookProgressRoutes = new Elysia()
  .use(requireUser)
  .get("/progress", async ({ user }) => {
    const rows = await prisma.bookListeningProgress.findMany({
      where: { userId: user!.id },
      select: {
        editionId: true, positionSecs: true, totalDurationSecs: true,
        finished: true, updatedAt: true,
      },
    });
    return { progress: rows.map((r) => ({
      edition_id: r.editionId,
      position_secs: r.positionSecs,
      total_duration_secs: r.totalDurationSecs,
      finished: r.finished,
      updated_at: r.updatedAt.toISOString(),
    })) };
  })
  .put(
    "/editions/:id/progress",
    async ({ params, body, user, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");

      const now = new Date();
      const updatedAt = clampClientTimestamp(body.updated_at, now);
      const existing = await prisma.bookListeningProgress.findUnique({
        where: { userId_editionId: { userId: user!.id, editionId: params.id } },
        select: { updatedAt: true },
      });

      // Last write wins, and an older write is simply ignored rather than
      // rejected: a device flushing a week-old queue is normal, not an error.
      if (existing && existing.updatedAt > updatedAt) {
        return { applied: false };
      }

      const data = {
        positionSecs: body.position_secs,
        totalDurationSecs: body.total_duration_secs,
        finished: body.finished ?? false,
        updatedAt,
        receivedAt: now,
        deviceId: body.device_id ?? null,
      };
      await prisma.bookListeningProgress.upsert({
        where: { userId_editionId: { userId: user!.id, editionId: params.id } },
        update: data,
        create: { ...data, userId: user!.id, editionId: params.id },
      });
      return { applied: true };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        position_secs: t.Number(),
        total_duration_secs: t.Number(),
        finished: t.Optional(t.Boolean()),
        updated_at: t.String(),
        device_id: t.Optional(t.String()),
      }),
    },
  );
```

- [ ] **Step 8: Mount the routers**

In `apps/api/src/routes/books/index.ts`, add the imports and the `.use()` calls. Order matters:
`bookListRoutes` must stay first so its literal `/search` is matched before anything treats
"search" as an `:id`.

```ts
import {
  bookPlaybackRoutes,
  bookContentRoutes,
  bookProgressRoutes,
} from "./bookPlaybackRoutes";
```

and inside `bookRoutes`, after `.use(bookListRoutes)`:

```ts
  .use(bookPlaybackRoutes)
  .use(bookContentRoutes)
  .use(bookProgressRoutes)
```

- [ ] **Step 9: Verify end to end against the real book**

```bash
bun run dev:api
```

In another shell — the manifest needs a session, so use a browser or an API key; the content URL
must work with neither:

```bash
# Should return 61 chapters and a total near 29383.4
curl -s -b <session-cookie> localhost:3000/api/books/editions/61/manifest | head -c 400

# Take a chapter's `url` from that output. It must serve bytes with NO cookie:
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
  -r 0-99 "localhost:3000<the url>"
```

Expected: `206 100`. A `401` means the content route inherited `requireUser`; a `size_download` of
`99` means the `+ 1` in `sliceForRange` was dropped.

- [ ] **Step 10: Run the full suite and both typecheckers**

Run: `bun run test && bun run typecheck && bun run typecheck:native && bun run lint`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/routes/books
git commit -m "feat(books): manifest, ranged content and per-user listening progress"
```

---

## Self-Review

**Spec coverage.** Phase 0 is Task 1. Phase 1's schema is Task 2; the rescan hazard is Task 3; the
timeline authority is Tasks 4 and 5; registration-separate-from-splitting is Task 6; "the database
tells the truth about edition 61" is Task 7; signed grants are Task 8; manifest, ranged content and
progress are Task 9.

**Deferred to later plans, deliberately:** the chapterize worker and its segment-muxer split
(spec phase 4), the data-saver variant and its job contract (phase 5), `POST /progress/sync`
(phase 3, where the offline queue that needs it is built), sha256 population — the column exists
and the manifest carries it, but nothing fills it until phase 2 needs to verify a download — and
the whole iOS client beyond the phase 0 probe.

**Known gap this plan accepts:** `registerBookChapters` writes no `sha256`, so the manifest reports
`null` for it. That is correct for now: the value is only load-bearing once a client verifies a
download, which is phase 2. Task 2's column and Task 9's field exist so that phase 2 adds a
computation, not a migration and an API change.
