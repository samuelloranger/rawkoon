# Single-file audiobook download + playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one-file audiobooks (a single `.m4b`/`.mp3` with many embedded chapters) download and play correctly on iOS and web, by modelling the physical FILE as the download+playback unit and the chapter as a timeline marker.

**Architecture:** The server manifest gains an explicit `files[]` array (one entry per physical file, with its whole-book start offset), while per-chapter fields stay for backward compat. iOS (`DownloadPlan`, `ChapterDownloader`, `AudiobookPlayer`) and web (`PlayerProvider`) switch their download/seek/offset math from chapter to file; chapters remain the UI/timeline markers. Multi-file books have one file per chapter and must be byte-for-byte unchanged.

**Tech Stack:** Bun + Elysia + Zod (API), TypeScript + React (web, vitest), Swift 6 / RawkoonKit (XCTest on Linux), Prisma/Postgres.

**Spec:** `docs/superpowers/specs/2026-09-09-ios-single-file-audiobook-design.md`

## Global Constraints

- No behavior change for multi-file books — regression-covered on both clients (`file.start_secs == chapter.start_secs`, `files.length == chapters.length`).
- On-device downloaded library must survive the update: legacy persisted manifests (no `files`) synthesize one file per chapter; `FileStore` paths stay keyed by `fileId`.
- Additive manifest change: per-chapter `size_bytes`/`sha256`/`url` remain so Android-TV compiles and behaves unchanged. No Android-TV edits.
- No new third-party dependencies.
- iOS shippability is proven by `lint` + `kit` + `build` green on `main` (macbuild) — never by a release. Do not bump the version, tag, or publish.
- iOS build settings live in `project.yml`, never a generated `.xcodeproj`.
- Web tests must run with `env -u NODE_ENV` (this shell exports `NODE_ENV=production`, which breaks React act/vitest).
- `files[]` is ordered by `start_secs`; each chapter's `file_id` matches exactly one file `id`; a file's `[start_secs, start_secs+duration_secs)` covers all its chapters.

---

### Task 1: Shared manifest type

**Files:**
- Modify: `apps/shared/src/types/books.ts` (after `BookManifestChapter`, before `BookManifest`)

**Interfaces:**
- Produces: `interface BookManifestFile { id: number; start_secs: number; duration_secs: number; size_bytes: number; sha256: string | null; url: string }`, and `BookManifest.files: BookManifestFile[]`.

- [ ] **Step 1: Add the type and field**

In `apps/shared/src/types/books.ts`, add above `export interface BookManifest`:

```ts
export interface BookManifestFile {
  id: number;
  /** Whole-book position (secs) where this file's t=0 sits. */
  start_secs: number;
  /** Playable length of the file in secs. */
  duration_secs: number;
  size_bytes: number;
  sha256: string | null;
  url: string;
}
```

Then add `files` to `BookManifest`, above `chapters`:

```ts
export interface BookManifest {
  edition_id: number;
  book_id: number;
  title: string;
  authors: string[];
  total_duration_secs: number;
  files: BookManifestFile[];
  chapters: BookManifestChapter[];
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/shared && bun run --filter @rawkoon/shared typecheck` (or root `bun run typecheck`)
Expected: PASS (shared is source-only; downstream tasks fill in producers/consumers).

- [ ] **Step 3: Commit**

```bash
git add apps/shared/src/types/books.ts
git commit -m "feat(shared): add BookManifestFile + BookManifest.files"
```

---

### Task 2: Server manifest emits `files[]`

**Files:**
- Modify: `apps/api/src/routes/books/bookPlaybackRoutes.ts` (add exported helper `buildManifestFiles`; use it in the `/editions/:id/manifest` handler, lines ~108-132)
- Test: `apps/api/src/routes/books/manifestFiles.test.ts` (new)

**Interfaces:**
- Consumes: `BookManifestFile` (Task 1).
- Produces: `export function buildManifestFiles(chapters: ChapterForGrouping[], grantUrlForFile: (fileId: number) => string): BookManifestFile[]` where `type ChapterForGrouping = { startSecs: number; endSecs: number; bookFile: { id: number; sizeBytes: bigint; sha256: string | null } }`. Files are grouped by `bookFile.id` in first-seen order; `start_secs` = first chapter's `startSecs`, `duration_secs` = last chapter's `endSecs` − first `startSecs`, one `url` per file.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/books/manifestFiles.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildManifestFiles } from "./bookPlaybackRoutes";

const ch = (startSecs: number, endSecs: number, fileId: number, size = 1000) => ({
  startSecs,
  endSecs,
  bookFile: { id: fileId, sizeBytes: BigInt(size), sha256: null },
});

describe("buildManifestFiles", () => {
  test("multi-file: one file per chapter, start_secs == chapter start", () => {
    const files = buildManifestFiles(
      [ch(0, 10, 100), ch(10, 25, 101)],
      (id) => `grant:${id}`,
    );
    expect(files).toEqual([
      { id: 100, start_secs: 0, duration_secs: 10, size_bytes: 1000, sha256: null, url: "grant:100" },
      { id: 101, start_secs: 10, duration_secs: 15, size_bytes: 1000, sha256: null, url: "grant:101" },
    ]);
  });

  test("single-file: many chapters collapse to one file spanning them", () => {
    const files = buildManifestFiles(
      [ch(0, 100, 1059, 500), ch(100, 250, 1059, 500), ch(250, 400, 1059, 500)],
      (id) => `grant:${id}`,
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      id: 1059,
      start_secs: 0,
      duration_secs: 400,
      size_bytes: 500,
      sha256: null,
      url: "grant:1059",
    });
  });

  test("grant is signed once per distinct file", () => {
    const seen: number[] = [];
    buildManifestFiles([ch(0, 100, 7), ch(100, 200, 7)], (id) => {
      seen.push(id);
      return `g:${id}`;
    });
    expect(seen).toEqual([7]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/routes/books/manifestFiles.test.ts`
Expected: FAIL — `buildManifestFiles` is not exported.

- [ ] **Step 3: Add the helper**

In `apps/api/src/routes/books/bookPlaybackRoutes.ts`, add near the top (after imports), and note it takes a memoized grant function so each file is signed once:

```ts
import type { BookManifestFile } from "@rawkoon/shared/types";

type ChapterForGrouping = {
  startSecs: number;
  endSecs: number;
  bookFile: { id: number; sizeBytes: bigint; sha256: string | null };
};

/**
 * Group chapters (ordered by index) into physical files. A single-file
 * audiobook has many chapters on one bookFile; each file is one download unit.
 */
export function buildManifestFiles(
  chapters: ChapterForGrouping[],
  grantUrlForFile: (fileId: number) => string,
): BookManifestFile[] {
  const byId = new Map<number, BookManifestFile>();
  for (const chapter of chapters) {
    const id = chapter.bookFile.id;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        start_secs: chapter.startSecs,
        duration_secs: chapter.endSecs - chapter.startSecs,
        size_bytes: Number(chapter.bookFile.sizeBytes),
        sha256: chapter.bookFile.sha256,
        url: grantUrlForFile(id),
      });
    } else {
      existing.duration_secs = chapter.endSecs - existing.start_secs;
    }
  }
  return [...byId.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/routes/books/manifestFiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the helper into the manifest handler**

In the `/editions/:id/manifest` handler, replace the `return { … }` block (currently lines ~108-132) so it builds one grant per file and emits `files`. The per-chapter `url` reuses the same per-file grant:

```ts
const secret = loadConfig().SECRET_KEY;
const expiresAt = Date.now() + GRANT_TTL_MS;
const grantCache = new Map<number, string>();
const grantUrlForFile = (fileId: number): string => {
  const cached = grantCache.get(fileId);
  if (cached) return cached;
  const url = `/api/books/files/${fileId}/content?grant=${signGrant(
    { fileId, variant: "original", grantId: crypto.randomUUID(), expiresAt },
    secret,
  )}`;
  grantCache.set(fileId, url);
  return url;
};

return {
  edition_id: edition.id,
  book_id: edition.book.id,
  title: edition.book.title,
  authors: edition.book.authors,
  total_duration_secs: edition.chapters.at(-1)!.endSecs,
  files: buildManifestFiles(edition.chapters, grantUrlForFile),
  chapters: edition.chapters.map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    start_secs: chapter.startSecs,
    end_secs: chapter.endSecs,
    file_id: chapter.bookFile.id,
    size_bytes: Number(chapter.bookFile.sizeBytes),
    sha256: chapter.bookFile.sha256,
    url: grantUrlForFile(chapter.bookFile.id),
  })),
};
```

- [ ] **Step 6: Typecheck + full api test**

Run: `cd apps/api && bun run --filter @rawkoon/api typecheck && bun test`
Expected: PASS (compare a failing/flaky suite against `main` per the flaky-suite note; run the FULL api suite, not one file).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/books/bookPlaybackRoutes.ts apps/api/src/routes/books/manifestFiles.test.ts
git commit -m "feat(api): emit files[] in book manifest (single-file audiobooks)"
```

---

### Task 3: RawkoonKit `ManifestFile` + `BookManifest.files` + legacy synthesis

**Files:**
- Modify: `apps/ios/Sources/RawkoonKit/BookManifest.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/BookManifestTests.swift`

**Interfaces:**
- Produces: `struct ManifestFile { id: Int; startSecs: Double; durationSecs: Double; sizeBytes: Int; sha256: String?; url: String; var fileExtension: String }`; `BookManifest.files: [ManifestFile]`; static `BookManifest.synthesizeFiles(from: [ManifestChapter]) -> [ManifestFile]`. When a decoded manifest has no `files`, `files` is synthesized one-per-chapter.

- [ ] **Step 1: Write the failing tests**

Append to `apps/ios/Tests/RawkoonKitTests/BookManifestTests.swift`:

```swift
    func testDecodesFilesArray() throws {
        let withFiles = """
        {
          "edition_id": 65, "book_id": 9, "title": "T", "authors": ["A"],
          "total_duration_secs": 400,
          "files": [
            {"id": 1059, "start_secs": 0, "duration_secs": 400,
             "size_bytes": 500, "sha256": null, "url": "/f/1059"}
          ],
          "chapters": [
            {"index": 0, "title": "C0", "start_secs": 0, "end_secs": 200,
             "file_id": 1059, "size_bytes": 500, "sha256": null, "url": "/f/1059"},
            {"index": 1, "title": "C1", "start_secs": 200, "end_secs": 400,
             "file_id": 1059, "size_bytes": 500, "sha256": null, "url": "/f/1059"}
          ]
        }
        """.data(using: .utf8)!
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: withFiles)
        XCTAssertEqual(m.files.count, 1)
        XCTAssertEqual(m.files[0].id, 1059)
        XCTAssertEqual(m.files[0].durationSecs, 400, accuracy: 1e-9)
        XCTAssertEqual(m.chapters.count, 2)
    }

    /// A manifest written before this change has no `files`; it must synthesize
    /// one file per chapter so an already-downloaded book still plays.
    func testLegacyManifestWithoutFilesSynthesizesOnePerChapter() throws {
        // `json` (top of file) is a two-chapter manifest with no files array.
        let m = BookManifest.decodePersisted(json)!
        XCTAssertEqual(m.files.count, 2)
        XCTAssertEqual(m.files[0].id, 267)
        XCTAssertEqual(m.files[0].startSecs, 0, accuracy: 1e-9)
        XCTAssertEqual(m.files[1].id, 268)
        XCTAssertEqual(m.files[1].startSecs, 504.189388, accuracy: 1e-6)
        XCTAssertEqual(m.files[1].durationSecs, 1042.860408 - 504.189388, accuracy: 1e-6)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ios && swift test --filter BookManifestTests`
Expected: FAIL — no `files` member / `ManifestFile`.

- [ ] **Step 3: Implement the model + synthesis**

In `apps/ios/Sources/RawkoonKit/BookManifest.swift`, add `ManifestFile` above `BookManifest`:

```swift
/// One physical file of a book: the unit of download and of playback. A
/// multi-file book has one file per chapter; a single-file audiobook has one
/// file that many chapters index into. `startSecs` is the whole-book position
/// of the file's t=0.
public struct ManifestFile: Codable, Equatable, Sendable {
    public let id: Int
    public let startSecs: Double
    public let durationSecs: Double
    public let sizeBytes: Int
    public let sha256: String?
    public let url: String

    public init(id: Int, startSecs: Double, durationSecs: Double,
                sizeBytes: Int, sha256: String?, url: String) {
        self.id = id
        self.startSecs = startSecs
        self.durationSecs = durationSecs
        self.sizeBytes = sizeBytes
        self.sha256 = sha256
        self.url = url
    }

    /// Same rule as `ManifestChapter.fileExtension`: grant URLs have no
    /// extension, so those land as `.bin`.
    public var fileExtension: String {
        let ext = URL(string: url)?.pathExtension ?? ""
        return ext.isEmpty ? "bin" : ext
    }
}
```

Replace the `BookManifest` struct body to add `files`, a memberwise init, a custom `init(from:)` that synthesizes when `files` is absent, and the synthesis helper. Keep the existing `decodePersisted`:

```swift
public struct BookManifest: Codable, Equatable, Sendable {
    public let editionId: Int
    public let bookId: Int
    public let title: String
    public let authors: [String]
    public let totalDurationSecs: Double
    public let files: [ManifestFile]
    public let chapters: [ManifestChapter]

    public init(editionId: Int, bookId: Int, title: String, authors: [String],
                totalDurationSecs: Double, files: [ManifestFile],
                chapters: [ManifestChapter]) {
        self.editionId = editionId
        self.bookId = bookId
        self.title = title
        self.authors = authors
        self.totalDurationSecs = totalDurationSecs
        self.files = files
        self.chapters = chapters
    }

    private enum CodingKeys: String, CodingKey {
        case editionId, bookId, title, authors, totalDurationSecs, files, chapters
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        editionId = try c.decode(Int.self, forKey: .editionId)
        bookId = try c.decode(Int.self, forKey: .bookId)
        title = try c.decode(String.self, forKey: .title)
        authors = try c.decode([String].self, forKey: .authors)
        totalDurationSecs = try c.decode(Double.self, forKey: .totalDurationSecs)
        chapters = try c.decode([ManifestChapter].self, forKey: .chapters)
        let decoded = try c.decodeIfPresent([ManifestFile].self, forKey: .files) ?? []
        files = decoded.isEmpty ? BookManifest.synthesizeFiles(from: chapters) : decoded
    }

    /// Legacy fallback: before `files` existed, each chapter WAS its own file.
    public static func synthesizeFiles(from chapters: [ManifestChapter]) -> [ManifestFile] {
        chapters.map {
            ManifestFile(
                id: $0.fileId,
                startSecs: $0.startSecs,
                durationSecs: max($0.endSecs - $0.startSecs, 0),
                sizeBytes: $0.sizeBytes,
                sha256: $0.sha256,
                url: $0.url
            )
        }
    }

    public static func decodePersisted(_ data: Data) -> BookManifest? {
        if let decoded = try? JSONDecoder().decode(BookManifest.self, from: data) {
            return decoded
        }
        let snake = JSONDecoder()
        snake.keyDecodingStrategy = .convertFromSnakeCase
        return try? snake.decode(BookManifest.self, from: data)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/ios && swift test --filter BookManifestTests`
Expected: PASS (existing manifest tests still green — `files` synthesizes for the no-files `json` fixture).

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/BookManifest.swift apps/ios/Tests/RawkoonKitTests/BookManifestTests.swift
git commit -m "feat(kit): ManifestFile + BookManifest.files with legacy synthesis"
```

---

### Task 4: RawkoonKit `DownloadPlan` keyed by files

**Files:**
- Modify: `apps/ios/Sources/RawkoonKit/DownloadPlan.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/DownloadPlanTests.swift`

**Interfaces:**
- Consumes: `ManifestFile` (Task 3).
- Produces: `DownloadPlan.init(files: [ManifestFile])`; `DownloadPlan.files: [ManifestFile]` (replaces `chapters`); `DownloadPlan.restored(files:existingBytes:)`. The `apply`/event API keyed by `fileId` is unchanged. `nextToStart` orders by `startSecs`. This removes the chapters-based dedup workaround (files carry no duplicate ids).

- [ ] **Step 1: Rewrite the tests to construct from files**

Replace `apps/ios/Tests/RawkoonKitTests/DownloadPlanTests.swift`'s `chapters(_:size:)` helper and the two ad-hoc `ManifestChapter` constructions with a `files(_:size:)` helper, and swap `DownloadPlan(chapters:)` → `DownloadPlan(files:)`, `plan.chapters` → `plan.files`, `DownloadPlan.restored(chapters:` → `DownloadPlan.restored(files:`. Replace the dedup test with a single-file test. The new helper:

```swift
    private func files(_ n: Int, size: Int = 1000) -> [ManifestFile] {
        (0 ..< n).map { i in
            ManifestFile(id: 100 + i, startSecs: Double(i) * 10,
                         durationSecs: 10, sizeBytes: size, sha256: nil, url: "u\(i)")
        }
    }
```

For `testMismatchedHashIsAFailure` and `testRestoredMatchingSizeTrustsManifestHash`, build a one-element `[ManifestFile]` with `sha256: "expected"` / `"abc"` instead of `ManifestChapter`.

Replace `testDuplicateFileIdsAreDedupedNotFatal` with:

```swift
    /// A single-file audiobook is one download unit even though it has many
    /// chapters. The plan is built from files, so there are no duplicate keys
    /// and the one file is offered exactly once.
    func testSingleFileEditionIsOneDownloadUnit() {
        let single = [ManifestFile(id: 1059, startSecs: 0, durationSecs: 400,
                                   sizeBytes: 500, sha256: nil, url: "u")]
        var plan = DownloadPlan(files: single)
        XCTAssertEqual(plan.files.count, 1)
        XCTAssertEqual(plan.nextToStart(limit: 5), [1059])
        plan.apply(.started(fileId: 1059))
        plan.apply(.completed(fileId: 1059, status: 200, bytes: 500, sha256: nil))
        XCTAssertTrue(plan.isComplete)
        XCTAssertEqual(plan.progressFraction(), 1, accuracy: 1e-9)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ios && swift test --filter DownloadPlanTests`
Expected: FAIL — `init(files:)` / `.files` do not exist.

- [ ] **Step 3: Rewrite `DownloadPlan` over files**

In `apps/ios/Sources/RawkoonKit/DownloadPlan.swift`, replace `chapters`/`chapterByFileId` with files and drop the dedup workaround:

- Property: `public let files: [ManifestFile]`; private `fileById: [Int: ManifestFile]`.
- Init:

```swift
public init(files: [ManifestFile]) {
    self.files = files
    states = Dictionary(uniqueKeysWithValues: files.map { ($0.id, .pending) })
    fileById = Dictionary(uniqueKeysWithValues: files.map { ($0.id, $0) })
}
```

- In `apply`, replace every `chapterByFileId[fileId]` with `fileById[fileId]`, and in the `.completed` branch use the file's fields: `guard bytes == file.sizeBytes` and `if let expected = file.sha256, expected != sha256`.
- `nextToStart`: iterate `files.sorted(by: { $0.startSecs < $1.startSecs })`, switch on `states[file.id]`, append `file.id`.
- `isComplete`: `!files.isEmpty && files.allSatisfy { states[$0.id] == .verified }`.
- `progressFraction`: `done = files.filter { states[$0.id] == .verified }.count; Double(done) / Double(files.count)`.
- `restored(files:existingBytes:)`: iterate `files`, `existingBytes[file.id] == file.sizeBytes` → `apply(.completed(fileId: file.id, status: 200, bytes:, sha256: file.sha256))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/ios && swift test --filter DownloadPlanTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/DownloadPlan.swift apps/ios/Tests/RawkoonKitTests/DownloadPlanTests.swift
git commit -m "refactor(kit): DownloadPlan keyed by files, not chapters"
```

---

### Task 5: iOS `ChapterDownloader` downloads files

**Files:**
- Modify: `apps/ios/Rawkoon/ChapterDownloader.swift`

**Interfaces:**
- Consumes: `DownloadPlan(files:)` (Task 4), `ManifestFile` (Task 3).
- Produces: unchanged public surface (`start`, `cancel`, `retryFailedChapters`, `refreshChapterURLs(from:)`, background-session hooks). Internally keyed by `ManifestFile`.

This layer has no Linux unit tests; the deliverable is verified by build (Task 8) and the sim run (Task 9). Make the edits precise.

- [ ] **Step 1: Swap the chapter lookup for a file lookup**

- Field: `private var chapterByFileId: [Int: ManifestChapter]` → `private var fileById: [Int: ManifestFile]`.
- Init (lines ~50-51): `plan = DownloadPlan(files: manifest.files)`; `fileById = Dictionary(uniqueKeysWithValues: manifest.files.map { ($0.id, $0) })`.
- `refreshChapterURLs(from:)` (lines ~112-117): `plan` and `fileById` rebuilt from `manifest.files` the same way.

- [ ] **Step 2: Point reconcile + download at files**

- `reconcileExistingFiles` (lines ~135-152): iterate `manifest.files`; use `file.fileExtension`, `file.id`, `file.sizeBytes`, `file.sha256` in the `FileStore.exists`/`size`/`plan.apply(.completed…)` calls.
- `didFinishDownloadingTo` (lines ~234-240): `guard let file = fileById[fileId]` (replacing `chapterByFileId[fileId]`); `let ext = file.fileExtension`.
- `resolvedChapterURL(for:)` (lines ~362-370): change the parameter to `for file: ManifestFile` and read `file.url`; update its one caller in `pumpIfNeeded` to pass the file (`guard let file = fileById[fileId], let url = resolvedChapterURL(for: file)`).

- [ ] **Step 3: Build RawkoonKit + typecheck the kit**

Run: `cd apps/ios && swift build`
Expected: PASS (this compiles `RawkoonKit`; the app target only compiles on macbuild — see Task 8).

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/ChapterDownloader.swift
git commit -m "refactor(ios): ChapterDownloader downloads files, not chapters"
```

---

### Task 6: iOS `AudiobookPlayer` — file is the item, chapter is the marker

**Files:**
- Modify: `apps/ios/Rawkoon/AudiobookPlayer.swift`

**Interfaces:**
- Consumes: `BookManifest.files`, `ManifestFile` (Task 3); `BookTimeline` (unchanged).
- Produces: no public API change. Playback offsets computed against the file, chapter markers against the timeline.

No Linux unit test (AVFoundation); verified by build + sim run.

- [ ] **Step 1: Add a file lookup and item→file mapping**

- Replace `itemChapters: [ObjectIdentifier: ManifestChapter]` with `itemFiles: [ObjectIdentifier: ManifestFile]`.
- Add:

```swift
private func file(forWholeBookPosition position: Double) -> ManifestFile? {
    guard let manifest else { return nil }
    if let f = manifest.files.first(where: {
        position >= $0.startSecs && position < $0.startSecs + $0.durationSecs
    }) { return f }
    if position >= duration { return manifest.files.last }
    return manifest.files.first
}

private func file(for item: AVPlayerItem?) -> ManifestFile? {
    guard let item else { return nil }
    return itemFiles[ObjectIdentifier(item)]
}
```

- [ ] **Step 2: Build the queue from the file**

In `buildQueue(at:autoplay:)` (lines ~728-795): replace `chapter(forWholeBookPosition:)` with `file(forWholeBookPosition:)`, map the item to the file (`itemFiles`), and compute the in-file offset from the file start:

```swift
guard let currentFile = file(forWholeBookPosition: clamped) else { /* teardown as today */ }
let queueFiles = [currentFile]
var items: [AVPlayerItem] = []
var mapping: [ObjectIdentifier: ManifestFile] = [:]
for f in queueFiles {
    guard let mediaURL = playbackURL(for: f, editionId: manifest.editionId) else { continue }
    let item = AVPlayerItem(url: mediaURL)
    item.audioTimePitchAlgorithm = .spectral
    items.append(item)
    mapping[ObjectIdentifier(item)] = f
}
// … existing guard/seekID/AVQueuePlayer setup …
itemFiles = mapping
let offset = max(0, min(clamped - currentFile.startSecs, max(currentFile.durationSecs, 0)))
positionSecs = clamped
setCurrentChapter(index: timeline.chapterIndex(at: clamped))
```

- [ ] **Step 3: Convert item-time↔book-position and playback URL to files**

- `wholeBookPosition(fromCurrentItemTime:)` (lines ~1097-1105): look up `file(for: player?.currentItem)`, return `file.startSecs + max(currentItemTime, 0)`.
- `playbackURL(for:editionId:)` (lines ~1011-1027): change the parameter to `for file: ManifestFile`; use `file.fileExtension`, `file.id`, `file.sizeBytes`, `recoveredFileIds.contains(file.id)`, and `resolvedRemoteURL(for: file)`.
- `resolvedRemoteURL(for:)`, `recoverFromFailedLocalItem`, `logItemFailure`: take/read the `ManifestFile` (via `file(for: item)`); `recoveredFileIds.insert(file.id)`.

- [ ] **Step 4: Advance at the physical file end**

- `handleItemDidPlayToEnd`: when an item ends, advance to the next file — `buildQueue(at: endedFile.startSecs + endedFile.durationSecs, autoplay: isPlaying)` if that position is `< duration`, else finish (mirror the current end-of-book handling).
- `handleTick` (lines ~863-877): keep `setCurrentChapter(index: timeline?.chapterIndex(at: clamped))` for the marker; it already falls back to the timeline. Remove the `chapter(for: player?.currentItem)` branch (the item now spans multiple chapters).

- [ ] **Step 5: Build RawkoonKit**

Run: `cd apps/ios && swift build`
Expected: PASS (app-target compile is Task 8 on macbuild).

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/AudiobookPlayer.swift
git commit -m "refactor(ios): player seeks by file, chapters are markers"
```

---

### Task 7: iOS `AppModel` counts files, not chapters

**Files:**
- Modify: `apps/ios/Rawkoon/AppModel.swift`

**Interfaces:**
- Consumes: `BookManifest.files`.
- Produces: no API change.

- [ ] **Step 1: Count download units by file**

- `persistDownloadedAudiobook` (line ~971): `fileCount: manifest.files.count`.
- `manifest(_:forceRefresh:)` backfill guard (line ~688): compare against `fetched.files.count` (and `!fetched.files.isEmpty`) instead of `fetched.chapters.count`.
- `applyDownloadPlan` / `verifiedChapterCount(in:)`: if it counts against a chapter total, switch to `plan.files.count`. (Verify: `DownloadPlan.isComplete` already covers "all files verified".)

- [ ] **Step 2: Build RawkoonKit**

Run: `cd apps/ios && swift build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Rawkoon/AppModel.swift
git commit -m "refactor(ios): offline file count from manifest.files"
```

---

### Task 8: iOS integration gate (macbuild)

**Files:** none (verification only).

- [ ] **Step 1: Push the branch and run the macbuild gate**

Per the macbuild verification note ([[macbuild-ios-verification]] — Linux builds only RawkoonKit; the PATH quirk and stale-git trap): sync to the `macbuild` host and run `lint`, `kit`, and `build`.

Run (on macbuild, via the project's usual ssh workflow):
```
lint && kit && build
```
Expected: all green. `build` (the full app target with AVFoundation) is the real compile gate for Tasks 5-7.

- [ ] **Step 2: Fix any app-target compile errors**

If `build` fails, the error points at the Task 5-7 edits (types, renamed params). Fix on the same branch, re-run, commit with `fix(ios): …`.

---

### Task 9: iOS behavior verification against prod edition 65

**Files:** none (verification only).

- [ ] **Step 1: Drive the real single-file book on the sim**

Per the sim repro recipe ([[ios-sim-repro-recipe]]) and prod token ([[rawkoon-prod-db-and-token]]): launch the app on the macbuild simulator against prod, open **edition 65 "La femme de ménage voit tout"** (1 file, 82 chapters).

Confirm:
- Opening the book does **not** crash (the old `uniqueKeysWithValues` trap).
- Download fetches **one** file (not 82), reaches 100%, persists offline.
- Playback plays continuously; the chapter marker advances across the single file as position crosses boundaries.
- Seek/scrub lands at the right place; resume from a mid-book position is correct.

- [ ] **Step 2: Regression — a multi-file audiobook**

Open a normal multi-file audiobook; confirm download, chapter advance, and resume behave exactly as before.

- [ ] **Step 3: Note the result on the board**

`add_note` on task 1148 with what was verified (both books), then leave iOS side done.

---

### Task 10: Web `fileIndex` helper

**Files:**
- Create: `apps/web/src/features/player/fileIndex.ts`
- Test: `apps/web/src/features/player/fileIndex.test.ts`

**Interfaces:**
- Consumes: `BookManifestFile` (Task 1).
- Produces: `createFileIndex(files: BookManifestFile[])` → `{ files, fileAt(positionSecs): BookManifestFile | null, boundaryAfterFile(positionSecs): number | null }`. `fileAt` covers `[start, start+duration)`; `boundaryAfterFile` returns the next file's `start_secs` or `null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/player/fileIndex.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFileIndex } from "./fileIndex";
import type { BookManifestFile } from "@rawkoon/shared/types";

const f = (id: number, start: number, duration: number): BookManifestFile => ({
  id,
  start_secs: start,
  duration_secs: duration,
  size_bytes: 1,
  sha256: null,
  url: `/f/${id}`,
});

describe("createFileIndex", () => {
  it("multi-file: file per position, boundary is next file start", () => {
    const idx = createFileIndex([f(1, 0, 10), f(2, 10, 15)]);
    expect(idx.fileAt(4)?.id).toBe(1);
    expect(idx.fileAt(10)?.id).toBe(2);
    expect(idx.fileAt(99)).toBeNull();
    expect(idx.boundaryAfterFile(4)).toBe(10);
    expect(idx.boundaryAfterFile(12)).toBeNull();
  });

  it("single-file: one file covers the whole book, no next boundary", () => {
    const idx = createFileIndex([f(1059, 0, 400)]);
    expect(idx.fileAt(0)?.id).toBe(1059);
    expect(idx.fileAt(399.9)?.id).toBe(1059);
    expect(idx.boundaryAfterFile(200)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/player/fileIndex.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/player/fileIndex.ts`:

```ts
import type { BookManifestFile } from "@rawkoon/shared/types";

export type FileIndex = ReturnType<typeof createFileIndex>;

/**
 * Physical-file lookup over a manifest. The <audio> element plays one file at
 * a time; chapters are only timeline markers (see timeline.ts).
 */
export function createFileIndex(files: BookManifestFile[]) {
  const sorted = [...files].sort((a, b) => a.start_secs - b.start_secs);

  const fileAt = (positionSecs: number): BookManifestFile | null =>
    sorted.find(
      (file) =>
        positionSecs >= file.start_secs &&
        positionSecs < file.start_secs + file.duration_secs,
    ) ?? null;

  return {
    files: sorted,
    fileAt,
    boundaryAfterFile: (positionSecs: number): number | null =>
      sorted.find((file) => file.start_secs > positionSecs)?.start_secs ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && env -u NODE_ENV bunx vitest run src/features/player/fileIndex.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/player/fileIndex.ts apps/web/src/features/player/fileIndex.test.ts
git commit -m "feat(web): createFileIndex — file-level lookup for the player"
```

---

### Task 11: Web `PlayerProvider` seeks by file

**Files:**
- Modify: `apps/web/src/features/player/PlayerProvider.tsx`

**Interfaces:**
- Consumes: `createFileIndex` (Task 10), `BookManifestFile` (Task 1).
- Produces: no context-API change (`PlayerContextValue` unchanged; chapters/`currentChapterIndex` still exposed from the timeline).

No unit test (needs a DOM/audio harness that doesn't exist here); verified by typecheck/lint/build and manual drive (Task 12).

- [ ] **Step 1: Track the file alongside the timeline**

- `LoadedBook`: add `fileIndex: FileIndex`.
- Add `const currentFileRef = useRef<BookManifestFile | null>(null);`.
- In `load` and `retryGrantOrError`, build `fileIndex: createFileIndex(manifest.files)` when the book is set (alongside `createTimeline(manifest.chapters)`).

- [ ] **Step 2: Make the audio source a file, not a chapter**

- Rename/retarget `applyChapter` → `applyFile(file: BookManifestFile, offsetSecs, playAfter, force)`: set `currentFileRef.current = file`; dedupe on `file.id` (replace `chapterIndexRef` comparison with a `currentFileRef.current?.id === file.id` check); `audio.src = file.url`.
- Keep the UI chapter marker in sync separately: wherever the position is set, call `setChapterIndex(timeline.chapterAt(position)?.index ?? null)` and update `chapterIndexRef`.

- [ ] **Step 3: Rework seek/position/ended/retry over files**

- `seekInternal(position, playAfter)`: `const file = book.fileIndex.fileAt(position)`; if none, clamp to the last file's end (mirror current last-chapter handling using the last file); else `applyFile(file, position - file.start_secs, playAfter)`. Set the chapter marker from `book.timeline.chapterAt(position)`.
- `onTimeUpdate`: `const file = currentFileRef.current; if (!book || !file) return; const position = file.start_secs + audio.currentTime;` then set position and marker as today.
- `onEnded`: `const nextStart = book.fileIndex.boundaryAfterFile(positionRef.current);` — `null` → finish (as today), else `seekInternal(nextStart, true)`.
- `retryGrantOrError`: after refetch, resolve the file via the rebuilt `fileIndex.fileAt(positionRef.current)`; `applyFile(file, Math.max(positionRef.current - file.start_secs, 0), playingRef.current, true)`.
- next/prev-chapter, `currentChapterIndex`, and the chapter list stay on `timeline` — unchanged.

- [ ] **Step 4: Typecheck, lint, web tests, build**

Run:
```
cd apps/web && env -u NODE_ENV bunx vitest run && cd ../.. && bun run typecheck && bun run lint && bun run build
```
Expected: PASS (`timeline` + `fileIndex` tests green; whole-workspace typecheck/lint/build clean).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/player/PlayerProvider.tsx
git commit -m "refactor(web): player seeks by file, chapters are markers"
```

---

### Task 12: Web behavior verification against prod edition 65

**Files:** none (verification only).

- [ ] **Step 1: Headful drive on prod data**

Per the web headful-repro note ([[rawkoon-web-headful-repro]]) (forge the `__Secure-` better-auth cookie, serve the static build over TLS): open edition 65's listen page.

Confirm: audio loads once (single file), seek/scrub is correct, the chapter marker advances across the file, resume from a mid-book position lands correctly. Then open a multi-file audiobook and confirm unchanged behavior.

- [ ] **Step 2: Close out the board task**

`add_note` on task 1148 (web verified, both books), then `move_task` 1148 → done.

---

## Self-Review

**Spec coverage:**
- Manifest contract `files[]` → Tasks 1 (type), 2 (server).
- RawkoonKit model + legacy synthesis → Task 3.
- DownloadPlan over files → Task 4.
- ChapterDownloader → Task 5. AudiobookPlayer → Task 6. AppModel counts → Task 7.
- Web `fileIndex` + PlayerProvider → Tasks 10, 11.
- Testing: RawkoonKit (Tasks 3, 4), API (Task 2), web (Tasks 10, 11), iOS integration (Tasks 8, 9), web behavior (Task 12).
- Constraints: multi-file regression (Tasks 9, 12); on-disk survival (Task 3 synthesis); additive/no Android-TV (Tasks 1, 2); no release (Task 8 wording). All covered.

**Placeholder scan:** No TBD/TODO; each code step carries real code or a precise, line-referenced edit list. App-layer Swift and the React hook are edit-lists (not full rewrites) because they have no Linux test cycle — their gate is build (Task 8) + manual drive (Tasks 9, 12), stated explicitly.

**Type consistency:** `BookManifestFile` fields (`id`, `start_secs`, `duration_secs`, `size_bytes`, `sha256`, `url`) identical across Tasks 1/2/10. Swift `ManifestFile` (`id`, `startSecs`, `durationSecs`, `sizeBytes`, `sha256`, `url`) identical across Tasks 3/4/5/6/7. `DownloadPlan.init(files:)`, `.files`, `.restored(files:)` consistent Tasks 4/5. `createFileIndex` shape identical Tasks 10/11.
