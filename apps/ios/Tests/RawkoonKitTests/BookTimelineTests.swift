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
