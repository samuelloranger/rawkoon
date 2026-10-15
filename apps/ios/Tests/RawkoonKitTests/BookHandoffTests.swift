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

    func testMatchesReadingOrderHref() {
        let spine = ["OEBPS/cover.xhtml", "OEBPS/ch1.xhtml", "OEBPS/text/ch2.xhtml", "OEBPS/Ch 3.xhtml"]
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("OEBPS/ch1.xhtml", in: spine), "OEBPS/ch1.xhtml")
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("ch1.xhtml", in: spine), "OEBPS/ch1.xhtml")
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("text/ch2.xhtml", in: spine), "OEBPS/text/ch2.xhtml")
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("ch1.xhtml#p4", in: spine), "OEBPS/ch1.xhtml")
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("Ch%203.xhtml", in: spine), "OEBPS/Ch 3.xhtml")
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("./ch1.xhtml", in: spine), "OEBPS/ch1.xhtml")
        // Reverse direction: the stored path is the longer one.
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("book/OEBPS/ch1.xhtml", in: spine), "OEBPS/ch1.xhtml")
        XCTAssertNil(BookHandoff.matchReadingOrderHref("missing.xhtml", in: spine))
        XCTAssertNil(BookHandoff.matchReadingOrderHref("h1.xhtml", in: spine))
        XCTAssertNil(BookHandoff.matchReadingOrderHref("", in: spine))
    }

    func testRootFileDoesNotClaimANestedPath() {
        XCTAssertNil(BookHandoff.matchReadingOrderHref("Text/a.html", in: ["a.html"]))
    }

    func testRawNameWithSpacesAndBracketsMatchesEncodedSpine() {
        let raw = "Name,J.K.-[Series-1]Title a l'Ecole(1997).split_002.html"
        let encoded = "Name,J.K.-%5BSeries-1%5DTitle%20a%20l'Ecole(1997).split_002.html"
        XCTAssertEqual(BookHandoff.matchReadingOrderHref(raw, in: ["intro.html", encoded]), encoded)
    }

    func testAmbiguousSuffixIsNil() {
        let spine = ["a/ch1.xhtml", "b/ch1.xhtml"]
        XCTAssertNil(BookHandoff.matchReadingOrderHref("ch1.xhtml", in: spine))
        XCTAssertEqual(BookHandoff.matchReadingOrderHref("a/ch1.xhtml", in: spine), "a/ch1.xhtml")
    }

    func testRewritesLocatorHrefKeepingTheRest() throws {
        let json = try XCTUnwrap(BookHandoff.locatorJSON(
            #"{"href":"ch1.xhtml","locations":{"progression":0.5}}"#, withHref: "OEBPS/ch1.xhtml"
        ))
        XCTAssertEqual(BookHandoff.locatorHref(json), "OEBPS/ch1.xhtml")
        XCTAssertTrue(json.contains("\"progression\":0.5"))
    }

    func testResolveFallbackFollowsSuffixMatchAndKeepsScroll() {
        let position = ReadingPosition(
            editionId: 1, fileId: nil, spineIndex: 1, spinePath: "ch2.xhtml",
            spineCount: 3, scrollFraction: 0.4, updatedAtMillis: 0
        )
        let resolved = ReadingProgressReconciler.resolve(
            position, spine: ["OEBPS/cover.xhtml", "OEBPS/ch1.xhtml", "OEBPS/ch2.xhtml"]
        )
        XCTAssertEqual(resolved.index, 2)
        XCTAssertEqual(resolved.scrollFraction, 0.4)
    }

    func testClassifiesRateLimitAndBudget() {
        XCTAssertEqual(BookHandoff.classify(status: 429), .rateLimited)
        XCTAssertEqual(BookHandoff.classify(status: 409, code: "budget_exceeded"), .budgetSpent)
        XCTAssertEqual(BookHandoff.classify(status: 409, code: "feature_disabled"), .syncOff)
    }

    func testClassifiesStatuses() {
        XCTAssertEqual(BookHandoff.classify(status: 404, code: "no_epub_file"), .needsBothEditions)
        XCTAssertEqual(BookHandoff.classify(status: 404, code: "no_audiobook_edition"), .needsBothEditions)
        // An older server without the handoff routes answers a bare 404.
        XCTAssertEqual(BookHandoff.classify(status: 404), .other)
        XCTAssertEqual(BookHandoff.classify(status: 404, code: "Not found"), .other)
        XCTAssertEqual(BookHandoff.classify(status: 409), .syncOff)
        XCTAssertEqual(BookHandoff.classify(status: 422), .spotNotFound)
        XCTAssertEqual(BookHandoff.classify(status: 502), .unreachable)
        XCTAssertEqual(BookHandoff.classify(status: 500), .other)
        XCTAssertEqual(BookHandoff.classify(status: nil), .other)
    }
}
