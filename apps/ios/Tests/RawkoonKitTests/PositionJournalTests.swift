@testable import RawkoonKit
import XCTest

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
            PositionEntry(editionId: 14, positionSecs: 100, atMillis: 1)
        )
            + PositionJournal.encode(
                PositionEntry(editionId: 14, positionSecs: 200, atMillis: 2)
            )
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

    func testLatestPrefersLaterEntryOnSameMillisTie() {
        let text = PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 100, atMillis: 7))
            + PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 200, atMillis: 7))

        XCTAssertEqual(PositionJournal.latest(in: text, editionId: 14)?.positionSecs, 200)
    }
}
