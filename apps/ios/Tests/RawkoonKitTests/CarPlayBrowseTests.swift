@testable import RawkoonKit
import XCTest

final class CarPlayBrowseTests: XCTestCase {
    private func entry(
        _ id: Int, order: Int, pos: Double? = nil,
        total: Double? = nil, updated: Int64? = nil
    ) -> CarPlayBrowseEntry {
        CarPlayBrowseEntry(
            editionId: id, title: "Book \(id)", author: nil,
            positionSecs: pos, totalDurationSecs: total,
            updatedAtMillis: updated, libraryOrder: order
        )
    }

    func testInProgressRequiresBothPositionAndDuration() {
        XCTAssertFalse(entry(1, order: 0).isInProgress)
        XCTAssertFalse(entry(1, order: 0, pos: 100, total: 0.5).isInProgress)
        XCTAssertFalse(entry(1, order: 0, pos: 0.5, total: 1000).isInProgress)
        XCTAssertTrue(entry(1, order: 0, pos: 100, total: 1000).isInProgress)
    }

    func testContinueSortedByUpdatedDescendingNilLast() {
        let list = [
            entry(1, order: 2, pos: 10, total: 100, updated: 500),
            entry(2, order: 0, pos: 10, total: 100, updated: 900),
            entry(3, order: 1, pos: 10, total: 100, updated: nil),
            entry(4, order: 3), // not in progress
        ]
        let out = CarPlayBrowse.sections(entries: list)
        XCTAssertEqual(out.continueListening.map(\.editionId), [2, 1, 3])
    }

    func testLibraryContainsAllSortedByLibraryOrder() {
        let list = [
            entry(1, order: 2, pos: 10, total: 100, updated: 500),
            entry(2, order: 0),
            entry(3, order: 1),
        ]
        let out = CarPlayBrowse.sections(entries: list)
        XCTAssertEqual(out.library.map(\.editionId), [2, 3, 1])
    }

    func testEmptyInputEmptySections() {
        let out = CarPlayBrowse.sections(entries: [])
        XCTAssertTrue(out.continueListening.isEmpty)
        XCTAssertTrue(out.library.isEmpty)
    }
}

final class CarPlayBrowseDetailTextTests: XCTestCase {
    func testResumeLineLeadsAndAuthorFollows() {
        XCTAssertEqual(
            CarPlayBrowse.detailText(resumeText: "Resume from 1:12:05", author: "Ursula K. Le Guin"),
            "Resume from 1:12:05 · Ursula K. Le Guin"
        )
    }

    func testEitherPartAlone() {
        XCTAssertEqual(CarPlayBrowse.detailText(resumeText: nil, author: "Ursula K. Le Guin"), "Ursula K. Le Guin")
        XCTAssertEqual(CarPlayBrowse.detailText(resumeText: "Resume from 2:05", author: nil), "Resume from 2:05")
    }

    func testNilWhenNothingToShow() {
        XCTAssertNil(CarPlayBrowse.detailText(resumeText: nil, author: nil))
        // A blank author is the same as none — it must not leave a dangling separator.
        XCTAssertNil(CarPlayBrowse.detailText(resumeText: nil, author: "   "))
        XCTAssertEqual(CarPlayBrowse.detailText(resumeText: "Resume from 2:05", author: "  "), "Resume from 2:05")
    }

    /// A long book's chapter list is cut to the head unit's limit around the
    /// playing chapter, instead of silently losing everything past the limit.
    func testWindowCentresOnTheCurrentItemWithinTheLimit() {
        XCTAssertEqual(CarPlayBrowse.window(count: 10, around: 3, limit: 20), 0 ..< 10)
        XCTAssertEqual(CarPlayBrowse.window(count: 100, around: 50, limit: 12), 44 ..< 56)
        XCTAssertEqual(CarPlayBrowse.window(count: 100, around: 2, limit: 12), 0 ..< 12)
        XCTAssertEqual(CarPlayBrowse.window(count: 100, around: 99, limit: 12), 88 ..< 100)
        XCTAssertEqual(CarPlayBrowse.window(count: 100, around: nil, limit: 12), 0 ..< 12)
    }
}
