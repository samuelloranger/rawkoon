@testable import RawkoonKit
import XCTest

final class AudiobookResumeTests: XCTestCase {
    private func entry(_ id: Int, position: Double?, total: Double? = 100, updated: Int64?) -> CarPlayBrowseEntry {
        CarPlayBrowseEntry(
            editionId: id, title: "Book \(id)", author: nil,
            positionSecs: position, totalDurationSecs: total,
            updatedAtMillis: updated, libraryOrder: id
        )
    }

    func testActivePlayerWins() {
        let entries = [entry(1, position: 50, updated: 999)]
        XCTAssertEqual(AudiobookResume.editionId(activeEditionId: 7, entries: entries), 7)
    }

    func testMostRecentInProgress() {
        let entries = [
            entry(1, position: 30, updated: 100),
            entry(2, position: 40, updated: 300),
            entry(3, position: 20, updated: 200),
        ]
        XCTAssertEqual(AudiobookResume.editionId(activeEditionId: nil, entries: entries), 2)
    }

    func testNothingPlayable() {
        let entries = [
            entry(1, position: nil, updated: 100),
            entry(2, position: 0, updated: 200),
        ]
        XCTAssertNil(AudiobookResume.editionId(activeEditionId: nil, entries: entries))
    }

    func testFinishedOrUnstartedIgnored() {
        // position past the 1s floor but total <= 1 (not in progress) is ignored
        let entries = [entry(1, position: 5, total: 1, updated: 100)]
        XCTAssertNil(AudiobookResume.editionId(activeEditionId: nil, entries: entries))
    }
}
