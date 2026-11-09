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
        XCTAssertEqual(PositionJournal.latest(in: text, editionId: 14, serverKey: nil)?.positionSecs, 100)
        XCTAssertEqual(PositionJournal.latest(in: text, editionId: 99, serverKey: nil)?.positionSecs, 7)
        XCTAssertNil(PositionJournal.latest(in: text, editionId: 1, serverKey: nil))
    }

    func testEmptyAndGarbageInput() {
        XCTAssertEqual(PositionJournal.parse(""), [])
        XCTAssertEqual(PositionJournal.parse("not json\n\n"), [])
        XCTAssertNil(PositionJournal.latest(in: "", editionId: 14, serverKey: nil))
    }

    func testExcludingDropsNamedEditionsAndKeepsTheRest() {
        let text = PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 100, atMillis: 1))
            + PositionJournal.encode(PositionEntry(editionId: 99, positionSecs: 7, atMillis: 2))
            + PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 50, atMillis: 3))
        let kept = PositionJournal.excluding(text, editionIds: [14], serverKey: nil)
        XCTAssertNil(PositionJournal.latest(in: kept, editionId: 14, serverKey: nil))
        XCTAssertEqual(PositionJournal.latest(in: kept, editionId: 99, serverKey: nil)?.positionSecs, 7)
    }

    func testLatestPrefersLaterEntryOnSameMillisTie() {
        let text = PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 100, atMillis: 7))
            + PositionJournal.encode(PositionEntry(editionId: 14, positionSecs: 200, atMillis: 7))

        XCTAssertEqual(PositionJournal.latest(in: text, editionId: 14, serverKey: nil)?.positionSecs, 200)
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
        XCTAssertEqual(PositionJournal.latest(in: compacted, editionId: 1, serverKey: nil)?.positionSecs, 20)
        XCTAssertEqual(PositionJournal.latestByEdition(lines, serverKey: nil)[2]?.positionSecs, 50)
    }

    /// A truncated last line must not swallow the next appended entry.
    func testAppendAfterPartialLineKeepsTheNewEntry() {
        let partial = PositionJournal.encode(PositionEntry(editionId: 1, positionSecs: 5, atMillis: 1)).dropLast(8)
        let next = PositionEntry(editionId: 2, positionSecs: 9, atMillis: 2)
        let text = String(partial) + PositionJournal.appendText(for: next, afterPartialLine: true)

        XCTAssertEqual(PositionJournal.parse(text), [next])
        XCTAssertEqual(PositionJournal.appendText(for: next, afterPartialLine: false), PositionJournal.encode(next))
    }

    // MARK: Server scope

    private func line(_ edition: Int, _ secs: Double, _ at: Int64, _ key: String?) -> String {
        PositionJournal.encode(PositionEntry(editionId: edition, positionSecs: secs, atMillis: at, serverKey: key))
    }

    /// Same edition id on two servers: each server sees only its own position.
    func testAnotherServersEntryIsIgnored() {
        let text = line(12, 100, 1, "a") + line(12, 999, 2, "b")
        XCTAssertEqual(PositionJournal.latestByEdition(text, serverKey: "a")[12]?.positionSecs, 100)
        XCTAssertEqual(PositionJournal.latestByEdition(text, serverKey: "b")[12]?.positionSecs, 999)
        XCTAssertNil(PositionJournal.latestByEdition(line(12, 1, 1, "a"), serverKey: "b")[12])
    }

    /// Compaction and wipes for one server must keep the other server's lines.
    func testCompactionAndExcludingKeepAnotherServersLines() {
        let text = line(12, 100, 1, "a") + line(12, 999, 2, "b") + line(12, 150, 3, "a")
        let compacted = PositionJournal.compacted(text)
        XCTAssertEqual(PositionJournal.latestByEdition(compacted, serverKey: "a")[12]?.positionSecs, 150)
        XCTAssertEqual(PositionJournal.latestByEdition(compacted, serverKey: "b")[12]?.positionSecs, 999)
        let wiped = PositionJournal.excluding(text, editionIds: [12], serverKey: "a")
        XCTAssertNil(PositionJournal.latestByEdition(wiped, serverKey: "a")[12])
        XCTAssertEqual(PositionJournal.latestByEdition(wiped, serverKey: "b")[12]?.positionSecs, 999)
    }

    /// Lines written by older builds have no key, decode fine, and are adopted once by the first server.
    func testLegacyLinesDecodeAndAreAdoptedOnce() {
        let legacy = "{\"editionId\":12,\"positionSecs\":40,\"atMillis\":5}\n"
        XCTAssertNil(PositionJournal.parse(legacy).first?.serverKey)
        XCTAssertEqual(PositionJournal.latestByEdition(legacy, serverKey: "a")[12]?.positionSecs, 40)

        let adopted = PositionJournal.adopting(legacy, serverKey: "a")
        XCTAssertEqual(PositionJournal.parse(adopted).first?.serverKey, "a")
        // After adoption a different server no longer sees it, and re-adopting changes nothing.
        XCTAssertNil(PositionJournal.latestByEdition(adopted, serverKey: "b")[12])
        XCTAssertEqual(PositionJournal.adopting(adopted, serverKey: "b"), adopted)
    }

    func testServerKeyIsStableAndNormalisesTheURL() {
        let a = ServerScope.key(serverURL: "https://Rawkoon.example.com/", userId: "u1")
        XCTAssertEqual(a, ServerScope.key(serverURL: " https://rawkoon.example.com ", userId: "u1"))
        XCTAssertNotEqual(a, ServerScope.key(serverURL: "https://rawkoon.example.com", userId: "u2"))
        XCTAssertNotEqual(a, ServerScope.key(serverURL: "https://other.example.com", userId: "u1"))
    }
}
