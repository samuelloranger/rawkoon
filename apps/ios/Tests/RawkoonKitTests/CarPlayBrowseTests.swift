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
        let e = [
            entry(1, order: 2, pos: 10, total: 100, updated: 500),
            entry(2, order: 0, pos: 10, total: 100, updated: 900),
            entry(3, order: 1, pos: 10, total: 100, updated: nil),
            entry(4, order: 3), // not in progress
        ]
        let out = CarPlayBrowse.sections(entries: e)
        XCTAssertEqual(out.continueListening.map(\.editionId), [2, 1, 3])
    }

    func testLibraryContainsAllSortedByLibraryOrder() {
        let e = [
            entry(1, order: 2, pos: 10, total: 100, updated: 500),
            entry(2, order: 0),
            entry(3, order: 1),
        ]
        let out = CarPlayBrowse.sections(entries: e)
        XCTAssertEqual(out.library.map(\.editionId), [2, 3, 1])
    }

    func testEmptyInputEmptySections() {
        let out = CarPlayBrowse.sections(entries: [])
        XCTAssertTrue(out.continueListening.isEmpty)
        XCTAssertTrue(out.library.isEmpty)
    }
}
