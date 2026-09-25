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

    func testExcludingDropsNamedEditionsAndKeepsTheRest() {
        let text = PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 100, atMillis: 1))
            + PositionJournal.encode(PositionEntry(editionId: 99, positionSecs: 7, atMillis: 2))
            + PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 50, atMillis: 3))
        let kept = PositionJournal.excluding(text, editionIds: [14])
        XCTAssertNil(PositionJournal.latest(in: kept, editionId: 14))
        XCTAssertEqual(PositionJournal.latest(in: kept, editionId: 99)?.positionSecs, 7)
    }

    func testLatestPrefersLaterEntryOnSameMillisTie() {
        let text = PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 100, atMillis: 7))
            + PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 200, atMillis: 7))

        XCTAssertEqual(PositionJournal.latest(in: text, editionId: 14)?.positionSecs, 200)
    }

    /// Compaction keeps each edition's newest line and nothing else.
    func testCompactionKeepsOnlyTheNewestEntryPerEdition() {
        let lines = [
            PositionEntry(editionId: 1, positionSecs: 10, atMillis: 100),
            PositionEntry(editionId: 2, positionSecs: 50, atMillis: 150),
            PositionEntry(editionId: 1, positionSecs: 20, atMillis: 200),
            PositionEntry(editionId: 1, positionSecs: 15, atMillis: 120),
        ].map(PositionJournal.encode).joined()

        let compacted = PositionJournal.compacted(lines)

        XCTAssertEqual(PositionJournal.parse(compacted), [
            PositionEntry(editionId: 2, positionSecs: 50, atMillis: 150),
            PositionEntry(editionId: 1, positionSecs: 20, atMillis: 200),
        ])
        XCTAssertEqual(PositionJournal.latest(in: compacted, editionId: 1)?.positionSecs, 20)
        XCTAssertEqual(PositionJournal.latestByEdition(lines)[2]?.positionSecs, 50)
    }
}
