# RawkoonKit Implementation Plan (spec phase 2, Linux-testable half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-logic core of the iOS audiobook client — timeline arithmetic, download
state machine, position journal, sync reconciliation — as a SwiftPM target that compiles and
unit-tests on Linux, so it is fully verified before any Mac or phone is involved.

**Architecture:** `RawkoonKit` imports Foundation only. No AVFoundation, no UIKit, no URLSession,
no SwiftData. Every I/O dependency is a protocol this target defines and someone else implements.
That is what makes it testable here, and it is the deliberate lesson from bivouac's core, which
fails to build on Linux exactly where it reaches for `URLSession.bytes`.

**Tech Stack:** Swift 6.3 via swiftly at `~/.local/share/swiftly/bin` (add to PATH). SwiftPM.
`swift test` on Linux.

**Spec:** `docs/superpowers/specs/2026-08-29-audiobook-player-design.md`

## Global Constraints

- **Swift 5 language mode.** The app target pins `SWIFT_VERSION: "5.0"`; the package must match, so
  set `swiftLanguageModes: [.v5]` in Package.swift. Strict concurrency is a deliberate phase-later
  decision — do not opt into Swift 6 mode here.
- **Foundation only.** Importing AVFoundation, UIKit, URLSession or SwiftData in this target is a
  task failure. It must build on Linux.
- The reference book is **L'intruse**: 61 chapters, total **29383.444895s**. Real offsets, from the
  rows rawkoon registered:
  `ch0 0.0 → 504.189388`, `ch1 504.189388 → 1042.860408`, `ch2 1042.860408 → 1452.382041`,
  `ch3 1452.382041 → 1995.049796`, `ch59 27706.331426 → 28250.984487`, `ch60 28250.984487 → 29383.444895`.
- These are **NOT** the offsets in that book's `metadata.json`, which end at 29381.830. Do not use
  `metadata.json` for anything. The 1.567s gap is real and load-bearing.
- Chapter boundaries are contiguous: chapter N's start equals chapter N-1's end, exactly.
- Positions are always **whole-book seconds**, never a per-file offset. The player this replaces
  stored a file index plus an in-file offset and could resolve to an index that did not exist.
- Run everything with `export PATH="$HOME/.local/share/swiftly/bin:$PATH"` first.
- Do not add Co-Authored-By trailers.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/ios/Package.swift` | SwiftPM manifest: `RawkoonKit` library + `RawkoonKitTests`. |
| `apps/ios/Sources/RawkoonKit/BookManifest.swift` | `Codable` models mirroring the server's manifest JSON. |
| `apps/ios/Sources/RawkoonKit/BookTimeline.swift` | Whole-book ↔ chapter position arithmetic. |
| `apps/ios/Sources/RawkoonKit/DownloadPlan.swift` | Per-chapter download state machine and policy. |
| `apps/ios/Sources/RawkoonKit/PositionJournal.swift` | Append-only position log + truncation recovery. |
| `apps/ios/Sources/RawkoonKit/SyncReconciler.swift` | Local vs remote progress conflict resolution. |
| `apps/ios/Tests/RawkoonKitTests/*.swift` | One test file per source file. |

---

### Task 1: Package skeleton that builds and tests on Linux

**Files:**
- Create: `apps/ios/Package.swift`
- Create: `apps/ios/Sources/RawkoonKit/RawkoonKit.swift`
- Create: `apps/ios/Tests/RawkoonKitTests/SmokeTests.swift`
- Modify: `.gitignore` (add `apps/ios/.build/`)

**Interfaces:**
- Produces: a `RawkoonKit` library target and a test target, both building on Linux.

- [ ] **Step 1: Write Package.swift**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RawkoonKit",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "RawkoonKit", targets: ["RawkoonKit"])],
    targets: [
        .target(name: "RawkoonKit", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(
            name: "RawkoonKitTests",
            dependencies: ["RawkoonKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
```

- [ ] **Step 2: Write a placeholder source and a smoke test**

```swift
// Sources/RawkoonKit/RawkoonKit.swift
import Foundation

/// Marker for the pure core. This target must never import AVFoundation, UIKit,
/// URLSession or SwiftData: it is built and tested on Linux, where none exist.
public enum RawkoonKit {
    public static let name = "RawkoonKit"
}
```

```swift
// Tests/RawkoonKitTests/SmokeTests.swift
import XCTest
@testable import RawkoonKit

final class SmokeTests: XCTestCase {
    func testTargetBuilds() {
        XCTAssertEqual(RawkoonKit.name, "RawkoonKit")
    }
}
```

- [ ] **Step 3: Build and test on Linux**

Run:
```bash
export PATH="$HOME/.local/share/swiftly/bin:$PATH"
cd apps/ios && swift test 2>&1 | tail -20
```
Expected: builds, 1 test passes. If it fails on the platforms line, drop `.iOS(.v18)` — Linux
ignores platforms but an unsupported spelling errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Package.swift apps/ios/Sources apps/ios/Tests .gitignore
git commit -m "feat(ios): add RawkoonKit package building on Linux"
```

---

### Task 2: BookManifest models

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/BookManifest.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/BookManifestTests.swift`

**Interfaces:**
- Produces: `BookManifest`, `ManifestChapter`, both `Codable`, `Equatable`, `Sendable`.
- Consumed by: every later task.

The server emits snake_case. Decode with `.convertFromSnakeCase` rather than writing CodingKeys.

- [ ] **Step 1: Write the failing test**

```swift
// Tests/RawkoonKitTests/BookManifestTests.swift
import XCTest
@testable import RawkoonKit

final class BookManifestTests: XCTestCase {
    /// A trimmed copy of what the server actually returns.
    private let json = """
    {
      "edition_id": 14,
      "book_id": 17,
      "title": "L'intruse",
      "authors": ["Freida McFadden"],
      "total_duration_secs": 29383.444895,
      "chapters": [
        {"index": 0, "title": "Chapter 1", "start_secs": 0,
         "end_secs": 504.189388, "file_id": 267, "size_bytes": 12367295,
         "sha256": null, "url": "/api/books/files/267/content?grant=abc"},
        {"index": 1, "title": "Chapter 2", "start_secs": 504.189388,
         "end_secs": 1042.860408, "file_id": 268, "size_bytes": 13026495,
         "sha256": null, "url": "/api/books/files/268/content?grant=def"}
      ]
    }
    """.data(using: .utf8)!

    func testDecodesServerJSON() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: json)
        XCTAssertEqual(m.editionId, 14)
        XCTAssertEqual(m.title, "L'intruse")
        XCTAssertEqual(m.chapters.count, 2)
        XCTAssertEqual(m.chapters[0].fileId, 267)
        XCTAssertEqual(m.chapters[0].sizeBytes, 12_367_295)
        XCTAssertEqual(m.totalDurationSecs, 29_383.444895, accuracy: 0.000001)
    }

    /// sha256 is null throughout phase 1 and populated later. A decoder that
    /// requires it would break against the current server.
    func testSha256MayBeNull() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: json)
        XCTAssertNil(m.chapters[0].sha256)
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$HOME/.local/share/swiftly/bin:$PATH"; cd apps/ios && swift test --filter BookManifestTests`
Expected: FAIL — cannot find `BookManifest` in scope.

- [ ] **Step 3: Implement**

```swift
// Sources/RawkoonKit/BookManifest.swift
import Foundation

/// One chapter, as the server describes it.
///
/// `startSecs`/`endSecs` are offsets on the WHOLE-BOOK timeline, produced by
/// accumulating the probed durations of the files on disk. They are not the
/// source chapter atoms, which drift by about a frame per chapter.
public struct ManifestChapter: Codable, Equatable, Sendable {
    public let index: Int
    public let title: String
    public let startSecs: Double
    public let endSecs: Double
    public let fileId: Int
    public let sizeBytes: Int
    /// Null until the server computes hashes; the client must tolerate that.
    public let sha256: String?
    public let url: String

    public var durationSecs: Double { endSecs - startSecs }
}

public struct BookManifest: Codable, Equatable, Sendable {
    public let editionId: Int
    public let bookId: Int
    public let title: String
    public let authors: [String]
    public let totalDurationSecs: Double
    public let chapters: [ManifestChapter]
}
```

- [ ] **Step 4: Run the tests**

Run: `swift test --filter BookManifestTests`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/BookManifest.swift apps/ios/Tests/RawkoonKitTests/BookManifestTests.swift
git commit -m "feat(ios): add BookManifest models"
```

---

### Task 3: BookTimeline

The single place offset arithmetic is allowed to live.

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/BookTimeline.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/BookTimelineTests.swift`

**Interfaces:**
- Consumes: `ManifestChapter` (Task 2).
- Produces:
  - `BookTimeline(chapters: [ManifestChapter])`
  - `var totalDurationSecs: Double`
  - `func chapterIndex(at positionSecs: Double) -> Int?`
  - `func offsetWithinChapter(at positionSecs: Double) -> (index: Int, offsetSecs: Double)?`
  - `func position(chapterIndex: Int, offsetSecs: Double) -> Double?`
  - `func clamp(_ positionSecs: Double) -> Double`
  - `func boundary(after positionSecs: Double) -> Double?`
  - `func boundary(before positionSecs: Double) -> Double?`

- [ ] **Step 1: Write the failing test**

```swift
// Tests/RawkoonKitTests/BookTimelineTests.swift
import XCTest
@testable import RawkoonKit

final class BookTimelineTests: XCTestCase {
    /// The real registered offsets for L'intruse. NOT metadata.json's atoms,
    /// which end at 29381.830 — the 1.567s gap is frame-quantisation drift and
    /// a fixture from the wrong source would encode the bug into the client.
    private func chapter(_ i: Int, _ s: Double, _ e: Double) -> ManifestChapter {
        ManifestChapter(index: i, title: "Chapter \(i + 1)", startSecs: s, endSecs: e,
                        fileId: 100 + i, sizeBytes: 1000, sha256: nil, url: "u\(i)")
    }

    private var timeline: BookTimeline {
        BookTimeline(chapters: [
            chapter(0, 0.0, 504.189388),
            chapter(1, 504.189388, 1042.860408),
            chapter(2, 1042.860408, 1452.382041),
            chapter(3, 1452.382041, 1995.049796),
        ])
    }

    func testTotalIsTheLastChaptersEnd() {
        XCTAssertEqual(timeline.totalDurationSecs, 1995.049796, accuracy: 1e-9)
    }

    func testPositionMapsToTheContainingChapter() {
        XCTAssertEqual(timeline.chapterIndex(at: 0), 0)
        XCTAssertEqual(timeline.chapterIndex(at: 100), 0)
        XCTAssertEqual(timeline.chapterIndex(at: 600), 1)
        XCTAssertEqual(timeline.chapterIndex(at: 1500), 3)
    }

    /// A boundary belongs to the chapter it STARTS, never the one it ends.
    /// Ambiguity here is what makes a "next chapter" tap land back where it was.
    func testExactBoundaryBelongsToTheFollowingChapter() {
        XCTAssertEqual(timeline.chapterIndex(at: 504.189388), 1)
        XCTAssertEqual(timeline.chapterIndex(at: 1042.860408), 2)
    }

    func testRoundTripThroughChapterOffset() {
        let p = 700.5
        guard let split = timeline.offsetWithinChapter(at: p) else {
            return XCTFail("expected a chapter")
        }
        XCTAssertEqual(split.index, 1)
        XCTAssertEqual(split.offsetSecs, 700.5 - 504.189388, accuracy: 1e-9)
        XCTAssertEqual(timeline.position(chapterIndex: split.index,
                                         offsetSecs: split.offsetSecs)!,
                       p, accuracy: 1e-9)
    }

    func testOutOfRangePositions() {
        XCTAssertNil(timeline.chapterIndex(at: -1))
        XCTAssertNil(timeline.chapterIndex(at: 1995.049796))
        XCTAssertNil(timeline.chapterIndex(at: 99_999))
    }

    func testClampKeepsPositionsInsideTheBook() {
        XCTAssertEqual(timeline.clamp(-5), 0)
        XCTAssertEqual(timeline.clamp(500), 500)
        XCTAssertEqual(timeline.clamp(99_999), 1995.049796, accuracy: 1e-9)
    }

    func testBoundaryNavigation() {
        XCTAssertEqual(timeline.boundary(after: 100)!, 504.189388, accuracy: 1e-9)
        XCTAssertEqual(timeline.boundary(before: 600)!, 504.189388, accuracy: 1e-9)
        XCTAssertEqual(timeline.boundary(before: 100)!, 0, accuracy: 1e-9)
        XCTAssertNil(timeline.boundary(after: 1900))
    }

    func testEmptyTimeline() {
        let empty = BookTimeline(chapters: [])
        XCTAssertEqual(empty.totalDurationSecs, 0)
        XCTAssertNil(empty.chapterIndex(at: 0))
        XCTAssertEqual(empty.clamp(50), 0)
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `swift test --filter BookTimelineTests`
Expected: FAIL — cannot find `BookTimeline`.

- [ ] **Step 3: Implement**

```swift
// Sources/RawkoonKit/BookTimeline.swift
import Foundation

/// Whole-book position arithmetic, and the only place it is allowed to live.
///
/// Every position in this client is a whole-book offset in seconds. The removed
/// web player stored a file index plus an in-file offset, and its own comment
/// records the result: a resume could resolve to an index that did not exist,
/// so it "only ever worked from position 0". One number cannot desynchronise
/// from a file list.
public struct BookTimeline: Sendable {
    public let chapters: [ManifestChapter]

    public init(chapters: [ManifestChapter]) {
        self.chapters = chapters.sorted { $0.index < $1.index }
    }

    public var totalDurationSecs: Double { chapters.last?.endSecs ?? 0 }

    /// The chapter containing `positionSecs`, or nil when outside the book.
    ///
    /// A position exactly on a boundary belongs to the chapter it STARTS. The
    /// half-open interval is what makes "skip to next chapter" land in the next
    /// chapter rather than at the last instant of the current one.
    public func chapterIndex(at positionSecs: Double) -> Int? {
        guard positionSecs >= 0, positionSecs < totalDurationSecs else { return nil }
        return chapters.firstIndex { positionSecs >= $0.startSecs && positionSecs < $0.endSecs }
    }

    public func offsetWithinChapter(at positionSecs: Double) -> (index: Int, offsetSecs: Double)? {
        guard let i = chapterIndex(at: positionSecs) else { return nil }
        return (i, positionSecs - chapters[i].startSecs)
    }

    public func position(chapterIndex index: Int, offsetSecs: Double) -> Double? {
        guard chapters.indices.contains(index) else { return nil }
        return chapters[index].startSecs + offsetSecs
    }

    public func clamp(_ positionSecs: Double) -> Double {
        min(max(positionSecs, 0), totalDurationSecs)
    }

    public func boundary(after positionSecs: Double) -> Double? {
        chapters.first { $0.startSecs > positionSecs }?.startSecs
    }

    public func boundary(before positionSecs: Double) -> Double? {
        chapters.last { $0.startSecs < positionSecs }?.startSecs
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `swift test --filter BookTimelineTests`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/BookTimeline.swift apps/ios/Tests/RawkoonKitTests/BookTimelineTests.swift
git commit -m "feat(ios): add BookTimeline whole-book position arithmetic"
```

---

### Task 4: PositionJournal

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/PositionJournal.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/PositionJournalTests.swift`

**Interfaces:**
- Produces:
  - `struct PositionEntry: Codable, Equatable, Sendable { let editionId: Int; let positionSecs: Double; let atMillis: Int64 }`
  - `enum PositionJournal { static func encode(_:) -> String; static func parse(_ text: String) -> [PositionEntry]; static func latest(in text: String, editionId: Int) -> PositionEntry? }`

One JSON object per line. Parsing tolerates a truncated final line, because the process can die
mid-write; that is the entire reason this is a log rather than a saved file.

- [ ] **Step 1: Write the failing test**

```swift
// Tests/RawkoonKitTests/PositionJournalTests.swift
import XCTest
@testable import RawkoonKit

final class PositionJournalTests: XCTestCase {
    func testRoundTripsOneEntry() {
        let e = PositionEntry(editionId: 14, positionSecs: 1234.5, atMillis: 1_700_000_000_000)
        let parsed = PositionJournal.parse(PositionJournal.encode(e))
        XCTAssertEqual(parsed, [e])
    }

    /// The whole point: the process can be killed mid-append, so the last line
    /// may be half-written. Everything before it must still be recoverable.
    func testTruncatedFinalLineIsIgnoredAndTheRestSurvives() {
        let good = PositionJournal.encode(
            PositionEntry(editionId: 14, positionSecs: 100, atMillis: 1))
            + PositionJournal.encode(
                PositionEntry(editionId: 14, positionSecs: 200, atMillis: 2))
        let text = good + "{\"editionId\":14,\"positionSe"
        let parsed = PositionJournal.parse(text)
        XCTAssertEqual(parsed.count, 2)
        XCTAssertEqual(parsed.last?.positionSecs, 200)
    }

    func testLatestPerEditionWinsByTimestampNotOrder() {
        let text = PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 100, atMillis: 5))
            + PositionJournal.encode(PositionEntry(editionId: 99, positionSecs: 7, atMillis: 9))
            + PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 50, atMillis: 3))
        XCTAssertEqual(PositionJournal.latest(in: text, editionId: 14)?.positionSecs, 100)
        XCTAssertEqual(PositionJournal.latest(in: text, editionId: 99)?.positionSecs, 7)
        XCTAssertNil(PositionJournal.latest(in: text, editionId: 1))
    }

    func testEmptyAndGarbageInput() {
        XCTAssertEqual(PositionJournal.parse(""), [])
        XCTAssertEqual(PositionJournal.parse("not json\n\n"), [])
        XCTAssertNil(PositionJournal.latest(in: "", editionId: 14))
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `swift test --filter PositionJournalTests`
Expected: FAIL — cannot find `PositionEntry` / `PositionJournal`.

- [ ] **Step 3: Implement**

```swift
// Sources/RawkoonKit/PositionJournal.swift
import Foundation

public struct PositionEntry: Codable, Equatable, Sendable {
    public let editionId: Int
    public let positionSecs: Double
    public let atMillis: Int64

    public init(editionId: Int, positionSecs: Double, atMillis: Int64) {
        self.editionId = editionId
        self.positionSecs = positionSecs
        self.atMillis = atMillis
    }
}

/// An append-only log of listening positions, one JSON object per line.
///
/// iOS termination hooks are not reliable, so nothing is saved on quit:
/// positions are appended as they happen and the newest survivor wins. Parsing
/// therefore has to tolerate a truncated final line, because the process can be
/// killed mid-append — that case is the reason this is a log at all.
public enum PositionJournal {
    public static func encode(_ entry: PositionEntry) -> String {
        guard let data = try? JSONEncoder().encode(entry),
              let line = String(data: data, encoding: .utf8) else { return "" }
        return line + "\n"
    }

    public static func parse(_ text: String) -> [PositionEntry] {
        let decoder = JSONDecoder()
        return text.split(separator: "\n", omittingEmptySubsequences: true).compactMap { line in
            guard let data = line.data(using: .utf8) else { return nil }
            return try? decoder.decode(PositionEntry.self, from: data)
        }
    }

    public static func latest(in text: String, editionId: Int) -> PositionEntry? {
        parse(text).filter { $0.editionId == editionId }.max { $0.atMillis < $1.atMillis }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `swift test --filter PositionJournalTests`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/PositionJournal.swift apps/ios/Tests/RawkoonKitTests/PositionJournalTests.swift
git commit -m "feat(ios): add append-only position journal"
```

---

### Task 5: SyncReconciler

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/SyncReconciler.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/SyncReconcilerTests.swift`

**Interfaces:**
- Produces:
  - `struct ProgressRecord: Equatable, Sendable { let positionSecs: Double; let totalDurationSecs: Double; let finished: Bool; let updatedAtMillis: Int64 }`
  - `enum SyncOutcome: Equatable, Sendable { case keepLocal, takeRemote, push }`
  - `enum SyncReconciler { static func reconcile(local: ProgressRecord?, remote: ProgressRecord?) -> SyncOutcome; static func adjust(_ remote: ProgressRecord, toTotal: Double) -> ProgressRecord }`

Mirrors the server: newer `updatedAtMillis` wins, and a record whose `totalDurationSecs` disagrees
with the current book is clamped and never allowed to mark it finished.

- [ ] **Step 1: Write the failing test**

```swift
// Tests/RawkoonKitTests/SyncReconcilerTests.swift
import XCTest
@testable import RawkoonKit

final class SyncReconcilerTests: XCTestCase {
    private func rec(_ pos: Double, _ at: Int64, total: Double = 1000, finished: Bool = false) -> ProgressRecord {
        ProgressRecord(positionSecs: pos, totalDurationSecs: total, finished: finished, updatedAtMillis: at)
    }

    func testNewerSideWins() {
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 5), remote: rec(20, 9)), .takeRemote)
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 9), remote: rec(20, 5)), .push)
    }

    func testMissingSides() {
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 5), remote: nil), .push)
        XCTAssertEqual(SyncReconciler.reconcile(local: nil, remote: rec(10, 5)), .takeRemote)
        XCTAssertEqual(SyncReconciler.reconcile(local: nil, remote: nil), .keepLocal)
    }

    /// Equal timestamps must not ping-pong between devices.
    func testEqualTimestampsKeepLocal() {
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 7), remote: rec(20, 7)), .keepLocal)
    }

    /// A position recorded against a different book length is approximate. It is
    /// clamped, and must never mark the book finished — finished books are
    /// auto-evicted, so a bad clamp would delete a download mid-listen.
    func testPositionFromADifferentEditionLengthIsClampedAndNeverFinishes() {
        let stale = rec(9_000, 5, total: 10_000, finished: false)
        let adjusted = SyncReconciler.adjust(stale, toTotal: 1_000)
        XCTAssertEqual(adjusted.positionSecs, 1_000)
        XCTAssertEqual(adjusted.totalDurationSecs, 1_000)
        XCTAssertFalse(adjusted.finished)
    }

    func testMatchingTotalIsLeftAlone() {
        let r = rec(500, 5, total: 1_000, finished: true)
        XCTAssertEqual(SyncReconciler.adjust(r, toTotal: 1_000), r)
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `swift test --filter SyncReconcilerTests`
Expected: FAIL — cannot find `ProgressRecord`.

- [ ] **Step 3: Implement**

```swift
// Sources/RawkoonKit/SyncReconciler.swift
import Foundation

public struct ProgressRecord: Equatable, Sendable {
    public let positionSecs: Double
    public let totalDurationSecs: Double
    public let finished: Bool
    public let updatedAtMillis: Int64

    public init(positionSecs: Double, totalDurationSecs: Double, finished: Bool, updatedAtMillis: Int64) {
        self.positionSecs = positionSecs
        self.totalDurationSecs = totalDurationSecs
        self.finished = finished
        self.updatedAtMillis = updatedAtMillis
    }
}

public enum SyncOutcome: Equatable, Sendable {
    case keepLocal
    case takeRemote
    case push
}

/// Decides which of two progress records wins, mirroring the server's rule.
public enum SyncReconciler {
    public static func reconcile(local: ProgressRecord?, remote: ProgressRecord?) -> SyncOutcome {
        switch (local, remote) {
        case (nil, nil): return .keepLocal
        case (nil, .some): return .takeRemote
        case (.some, nil): return .push
        case let (.some(l), .some(r)):
            if r.updatedAtMillis > l.updatedAtMillis { return .takeRemote }
            if l.updatedAtMillis > r.updatedAtMillis { return .push }
            // A tie must be stable, or two devices flip the position forever.
            return .keepLocal
        }
    }

    /// Re-point a record at the current book length.
    ///
    /// A whole-book offset survives re-chapterising the same audio, but not an
    /// upgrade to a different rip. When the lengths disagree the position is
    /// approximate: clamp it, and never let the clamp set `finished`, because
    /// finished books are evicted automatically and that would delete a
    /// download out from under someone mid-listen.
    public static func adjust(_ remote: ProgressRecord, toTotal total: Double) -> ProgressRecord {
        guard remote.totalDurationSecs != total else { return remote }
        return ProgressRecord(
            positionSecs: min(max(remote.positionSecs, 0), total),
            totalDurationSecs: total,
            finished: false,
            updatedAtMillis: remote.updatedAtMillis
        )
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `swift test --filter SyncReconcilerTests`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/SyncReconciler.swift apps/ios/Tests/RawkoonKitTests/SyncReconcilerTests.swift
git commit -m "feat(ios): add progress sync reconciliation"
```

---

### Task 6: DownloadPlan

The state machine that decides what a book's download is doing. It never performs a transfer.

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/DownloadPlan.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/DownloadPlanTests.swift`

**Interfaces:**
- Consumes: `ManifestChapter` (Task 2).
- Produces:
  - `enum ChapterState: Equatable, Sendable { case pending, inFlight, verified, failed(attempts: Int), evicted }`
  - `enum DownloadEvent: Equatable, Sendable { case started(fileId: Int), completed(fileId: Int, status: Int, bytes: Int, sha256: String?), transportFailed(fileId: Int), evicted(fileId: Int) }`
  - `struct DownloadPlan` with `init(chapters:)`, `private(set) var states: [Int: ChapterState]`, `mutating func apply(_ event: DownloadEvent)`, `func nextToStart(limit: Int) -> [Int]`, `var isComplete: Bool`, `var needsFreshGrants: Bool`, `func progressFraction() -> Double`
  - `static let maxAttempts = 3`

Rules the tests pin down:
- A `completed` with a non-2xx status is **not** success. 401/403 mean the grant expired: the
  chapter returns to `pending` and `needsFreshGrants` becomes true. Any other non-2xx is a failure
  with an attempt consumed.
- A `completed` whose byte count disagrees with the manifest is a failure, not a success.
- When the manifest carries a sha256 and it disagrees, that is a failure.
- After `maxAttempts` a chapter stays `failed` and is not restarted by `nextToStart`.
- `nextToStart` never returns a chapter already in flight or verified.

- [ ] **Step 1: Write the failing test**

```swift
// Tests/RawkoonKitTests/DownloadPlanTests.swift
import XCTest
@testable import RawkoonKit

final class DownloadPlanTests: XCTestCase {
    private func chapters(_ n: Int, size: Int = 1000) -> [ManifestChapter] {
        (0..<n).map { i in
            ManifestChapter(index: i, title: "C\(i)", startSecs: Double(i) * 10,
                            endSecs: Double(i + 1) * 10, fileId: 100 + i,
                            sizeBytes: size, sha256: nil, url: "u\(i)")
        }
    }

    func testStartsPendingAndOffersWorkUpToTheLimit() {
        let plan = DownloadPlan(chapters: chapters(5))
        XCTAssertEqual(plan.nextToStart(limit: 2), [100, 101])
        XCTAssertFalse(plan.isComplete)
    }

    func testASuccessfulCompletionVerifies() {
        var plan = DownloadPlan(chapters: chapters(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertTrue(plan.isComplete)
    }

    /// A background download task reports success for ANY response the server
    /// sent, including an error page. Status must be checked before the bytes
    /// are trusted, or a 401 body lands in the file as if it were audio.
    func testAnErrorStatusIsNotSuccess() {
        var plan = DownloadPlan(chapters: chapters(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 500, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
        XCTAssertFalse(plan.isComplete)
    }

    /// 401 is not a failure of the chapter, it is an expired grant. The chapter
    /// goes back to pending and the caller is told to refetch the manifest.
    func testExpiredGrantRequeuesWithoutConsumingAnAttempt() {
        var plan = DownloadPlan(chapters: chapters(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 401, bytes: 52, sha256: nil))
        XCTAssertEqual(plan.states[100], .pending)
        XCTAssertTrue(plan.needsFreshGrants)
        XCTAssertTrue(plan.nextToStart(limit: 5).contains(100))
    }

    func testWrongByteCountIsAFailure() {
        var plan = DownloadPlan(chapters: chapters(1, size: 1000))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 52, sha256: nil))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
    }

    func testMismatchedHashIsAFailure() {
        let c = [ManifestChapter(index: 0, title: "C0", startSecs: 0, endSecs: 10,
                                 fileId: 100, sizeBytes: 1000, sha256: "expected", url: "u")]
        var plan = DownloadPlan(chapters: c)
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: "different"))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
    }

    func testGivesUpAfterMaxAttempts() {
        var plan = DownloadPlan(chapters: chapters(1))
        for _ in 0..<DownloadPlan.maxAttempts {
            plan.apply(.started(fileId: 100))
            plan.apply(.transportFailed(fileId: 100))
        }
        XCTAssertEqual(plan.states[100], .failed(attempts: DownloadPlan.maxAttempts))
        XCTAssertTrue(plan.nextToStart(limit: 5).isEmpty)
    }

    func testInFlightChaptersAreNotOfferedAgain() {
        var plan = DownloadPlan(chapters: chapters(3))
        plan.apply(.started(fileId: 100))
        XCTAssertEqual(plan.nextToStart(limit: 3), [101, 102])
    }

    func testProgressFraction() {
        var plan = DownloadPlan(chapters: chapters(4))
        XCTAssertEqual(plan.progressFraction(), 0, accuracy: 1e-9)
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.progressFraction(), 0.25, accuracy: 1e-9)
    }

    func testEviction() {
        var plan = DownloadPlan(chapters: chapters(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        plan.apply(.evicted(fileId: 100))
        XCTAssertEqual(plan.states[100], .evicted)
        XCTAssertFalse(plan.isComplete)
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `swift test --filter DownloadPlanTests`
Expected: FAIL — cannot find `DownloadPlan`.

- [ ] **Step 3: Implement**

```swift
// Sources/RawkoonKit/DownloadPlan.swift
import Foundation

public enum ChapterState: Equatable, Sendable {
    case pending
    case inFlight
    case verified
    case failed(attempts: Int)
    case evicted
}

public enum DownloadEvent: Equatable, Sendable {
    case started(fileId: Int)
    /// A background task reports completion for any response the server sent,
    /// including an error body. `status` is what separates audio from a 401 page.
    case completed(fileId: Int, status: Int, bytes: Int, sha256: String?)
    case transportFailed(fileId: Int)
    case evicted(fileId: Int)
}

/// What a book's download is doing. It decides; it never transfers.
public struct DownloadPlan: Sendable {
    public static let maxAttempts = 3

    public let chapters: [ManifestChapter]
    public private(set) var states: [Int: ChapterState]
    public private(set) var needsFreshGrants = false

    private var attempts: [Int: Int] = [:]

    public init(chapters: [ManifestChapter]) {
        self.chapters = chapters
        self.states = Dictionary(uniqueKeysWithValues: chapters.map { ($0.fileId, .pending) })
    }

    public mutating func apply(_ event: DownloadEvent) {
        switch event {
        case let .started(fileId):
            states[fileId] = .inFlight

        case let .completed(fileId, status, bytes, sha256):
            guard let chapter = chapters.first(where: { $0.fileId == fileId }) else { return }
            if status == 401 || status == 403 {
                // Not the chapter's fault: the grant expired. Requeue without
                // spending an attempt, and tell the caller to refetch.
                states[fileId] = .pending
                needsFreshGrants = true
                return
            }
            guard (200...299).contains(status) else { return fail(fileId) }
            guard bytes == chapter.sizeBytes else { return fail(fileId) }
            if let expected = chapter.sha256, let got = sha256, expected != got {
                return fail(fileId)
            }
            states[fileId] = .verified

        case let .transportFailed(fileId):
            fail(fileId)

        case let .evicted(fileId):
            states[fileId] = .evicted
            attempts[fileId] = 0
        }
    }

    private mutating func fail(_ fileId: Int) {
        let n = (attempts[fileId] ?? 0) + 1
        attempts[fileId] = n
        states[fileId] = .failed(attempts: n)
    }

    /// The next chapters worth starting, in book order.
    ///
    /// Book order matters: a listener starts at chapter 1, so downloading in
    /// order means they can begin before the book finishes arriving.
    public func nextToStart(limit: Int) -> [Int] {
        var out: [Int] = []
        for chapter in chapters.sorted(by: { $0.index < $1.index }) {
            guard out.count < limit else { break }
            switch states[chapter.fileId] {
            case .pending, .evicted:
                out.append(chapter.fileId)
            case let .failed(attempts) where attempts < Self.maxAttempts:
                out.append(chapter.fileId)
            default:
                continue
            }
        }
        return out
    }

    public var isComplete: Bool {
        !chapters.isEmpty && chapters.allSatisfy { states[$0.fileId] == .verified }
    }

    public func progressFraction() -> Double {
        guard !chapters.isEmpty else { return 0 }
        let done = chapters.filter { states[$0.fileId] == .verified }.count
        return Double(done) / Double(chapters.count)
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `swift test --filter DownloadPlanTests`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole suite and check the Foundation-only rule**

```bash
swift test 2>&1 | tail -5
grep -rn "import AVFoundation\|import UIKit\|import SwiftData\|URLSession" apps/ios/Sources/RawkoonKit/ && echo "FORBIDDEN IMPORT" || echo "Foundation-only: OK"
```
Expected: all tests pass; the grep prints "Foundation-only: OK".

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/DownloadPlan.swift apps/ios/Tests/RawkoonKitTests/DownloadPlanTests.swift
git commit -m "feat(ios): add chapter download state machine"
```

---

### Task 7: Wire RawkoonKit into CI

**Files:**
- Modify: `.github/workflows/ios.yml`

- [ ] **Step 1: Add a Linux job**

Add as the first job, so a logic regression is caught on cheap Ubuntu minutes before a macOS runner
is spent:

```yaml
  kit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swift-actions/setup-swift@v2
        with:
          swift-version: "6.0"
      - run: swift test
        working-directory: apps/ios
```

Then add `needs: kit` to the existing `build` job.

- [ ] **Step 2: Verify the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ios.yml')); print('ok')"`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ios.yml
git commit -m "ci(ios): run RawkoonKit tests on Linux"
```

---

## Self-Review

**Spec coverage.** The spec's RawkoonKit bullet list maps to Tasks 2-6: `BookManifest`,
`BookTimeline`, `DownloadPlan`, `PositionJournal`, `SyncReconciler`. Task 1 is the package that
makes them buildable; Task 7 makes CI enforce it.

**Deliberately not here.** The adapters (`AVPlayerEngine`, `BackgroundDownloader`, `FileStore`,
`APIClient`) are Mac-only and cannot be tested on Linux, so they wait until the phase-0 background
wake question is answered. `DownloadPlan` is written so the downloader is a thin executor of its
decisions — which is what keeps that answer from invalidating this work.

**Known limits.** `DownloadPlan` models per-chapter state, not byte-level resume; that is
deliberate, since resilience comes from the 11MB unit and unconditional retry rather than from
`resumeData`. `PositionJournal` defines the format and recovery rule but performs no file I/O — the
appending is an adapter's job.
