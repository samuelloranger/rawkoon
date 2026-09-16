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

final class AudiobookResumeLabelTests: XCTestCase {
    func testStartedBookResumes() {
        XCTAssertEqual(
            AudiobookResume.label(positionSecs: 4325, totalDurationSecs: 33120),
            .resume(positionSecs: 4325)
        )
    }

    func testUnstartedBookPlays() {
        XCTAssertEqual(AudiobookResume.label(positionSecs: nil, totalDurationSecs: 33120), .play)
        XCTAssertEqual(AudiobookResume.label(positionSecs: 0, totalDurationSecs: 33120), .play)
        // Same 1-second floor the Continue card and CarPlay already use.
        XCTAssertEqual(AudiobookResume.label(positionSecs: 1, totalDurationSecs: 33120), .play)
    }

    func testFinishedBookPlaysFromTheStart() {
        XCTAssertEqual(AudiobookResume.label(positionSecs: 33120, totalDurationSecs: 33120), .play)
        // Within the last second counts as finished — resuming there would end
        // the book immediately.
        XCTAssertEqual(AudiobookResume.label(positionSecs: 33119.5, totalDurationSecs: 33120), .play)
        XCTAssertEqual(AudiobookResume.label(positionSecs: 40000, totalDurationSecs: 33120), .play)
    }

    func testUnknownOrInvalidDurationPlays() {
        XCTAssertEqual(AudiobookResume.label(positionSecs: 500, totalDurationSecs: nil), .play)
        XCTAssertEqual(AudiobookResume.label(positionSecs: 500, totalDurationSecs: 1), .play)
        XCTAssertEqual(AudiobookResume.label(positionSecs: .nan, totalDurationSecs: 33120), .play)
        XCTAssertEqual(AudiobookResume.label(positionSecs: 500, totalDurationSecs: .infinity), .play)
    }

    func testEntryConvenienceMatchesRawNumbers() {
        let started = CarPlayBrowseEntry(
            editionId: 1, title: "Book", author: nil,
            positionSecs: 4325, totalDurationSecs: 33120,
            updatedAtMillis: nil, libraryOrder: 0
        )
        XCTAssertEqual(AudiobookResume.label(for: started), .resume(positionSecs: 4325))
    }
}
