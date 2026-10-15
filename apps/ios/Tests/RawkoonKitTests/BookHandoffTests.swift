@testable import RawkoonKit
import XCTest

final class BookHandoffTests: XCTestCase {
    private let toEbook = """
    {"locator": {"href": "ch13.xhtml", "type": "application/xhtml+xml",
                 "locations": {"progression": 0.089, "totalProgression": 0.594},
                 "text": {"before": "a", "highlight": "b", "after": "c"}},
     "spine_index": 13, "spine_path": "ch13.xhtml", "progression": 0.089,
     "total_progression": 0.594, "score": 0.99, "transcript": "t"}
    """

    func testParsesEbookSpotAndKeepsLocatorAsJSON() throws {
        let spot = try XCTUnwrap(BookHandoff.parseEbookSpot(Data(toEbook.utf8)))
        XCTAssertEqual(spot.spineIndex, 13)
        XCTAssertEqual(spot.spinePath, "ch13.xhtml")
        XCTAssertEqual(spot.progression, 0.089)
        let json = try XCTUnwrap(spot.locatorJSON)
        let reparsed = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        )
        XCTAssertEqual(reparsed["href"] as? String, "ch13.xhtml")
        XCTAssertEqual((reparsed["locations"] as? [String: Any])?["totalProgression"] as? Double, 0.594)
    }

    func testEbookSpotRejectsMissingSpine() {
        XCTAssertNil(BookHandoff.parseEbookSpot(Data(#"{"progression": 0.1}"#.utf8)))
        XCTAssertNil(BookHandoff.parseEbookSpot(Data("nope".utf8)))
    }

    func testParsesAudiobookPosition() {
        let body = Data(#"{"position_secs": 17386.4, "score": 0.98, "calls": 2}"#.utf8)
        XCTAssertEqual(BookHandoff.parseAudiobookPosition(body), 17386.4)
        XCTAssertNil(BookHandoff.parseAudiobookPosition(Data("{}".utf8)))
        XCTAssertNil(BookHandoff.parseAudiobookPosition(Data(#"{"position_secs": -1}"#.utf8)))
    }

    func testBodiesUseSnakeCaseKeysAndClampProgression() throws {
        let one = try JSONEncoder().encode(BookHandoff.ToEbookBody(positionSecs: 12.5))
        XCTAssertEqual(String(decoding: one, as: UTF8.self), #"{"position_secs":12.5}"#)
        let two = BookHandoff.ToAudiobookBody(spinePath: "a.xhtml", progression: 1.4)
        XCTAssertEqual(two.progression, 1)
        let encoded = try JSONEncoder().encode(two)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(object["spine_path"] as? String, "a.xhtml")
    }

    func testReadingPositionFromSpot() throws {
        let spot = try XCTUnwrap(BookHandoff.parseEbookSpot(Data(toEbook.utf8)))
        let fresh = BookHandoff.readingPosition(
            from: spot, editionId: 7, fileId: 3, knownSpineCount: nil, nowMillis: 1000
        )
        XCTAssertEqual(fresh.editionId, 7)
        XCTAssertEqual(fresh.fileId, 3)
        XCTAssertEqual(fresh.spineIndex, 13)
        XCTAssertEqual(fresh.spineCount, 14)
        XCTAssertEqual(fresh.scrollFraction, 0.089)
        XCTAssertEqual(fresh.updatedAtMillis, 1000)
        XCTAssertNotNil(fresh.locator)

        let known = BookHandoff.readingPosition(
            from: spot, editionId: 7, fileId: nil, knownSpineCount: 40, nowMillis: 1
        )
        XCTAssertEqual(known.spineCount, 40)
        // The stored locator still drives the resume label.
        XCTAssertEqual(EbookResume.label(fresh), .resumePercent(59))
    }

    func testClassifiesStatuses() {
        XCTAssertEqual(BookHandoff.classify(status: 404), .needsBothEditions)
        XCTAssertEqual(BookHandoff.classify(status: 409), .syncOff)
        XCTAssertEqual(BookHandoff.classify(status: 422), .spotNotFound)
        XCTAssertEqual(BookHandoff.classify(status: 502), .unreachable)
        XCTAssertEqual(BookHandoff.classify(status: 500), .other)
        XCTAssertEqual(BookHandoff.classify(status: nil), .other)
    }
}
