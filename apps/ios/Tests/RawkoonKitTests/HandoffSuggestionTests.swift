@testable import RawkoonKit
import XCTest

final class HandoffSuggestionTests: XCTestCase {
    func testEbookCheckNeedsListenNewerByMoreThanAMinute() {
        XCTAssertTrue(HandoffSuggestion.shouldCheckEbook(
            listenAtMillis: 200_000, listenPositionSecs: 600, readAtMillis: 100_000
        ))
        XCTAssertFalse(HandoffSuggestion.shouldCheckEbook(
            listenAtMillis: 160_000, listenPositionSecs: 600, readAtMillis: 100_000
        ))
        XCTAssertFalse(HandoffSuggestion.shouldCheckEbook(
            listenAtMillis: 90000, listenPositionSecs: 600, readAtMillis: 100_000
        ))
    }

    func testEbookCheckNeedsThirtySecondsOfListening() {
        XCTAssertFalse(HandoffSuggestion.shouldCheckEbook(
            listenAtMillis: 500_000, listenPositionSecs: 29, readAtMillis: nil
        ))
        XCTAssertTrue(HandoffSuggestion.shouldCheckEbook(
            listenAtMillis: 500_000, listenPositionSecs: 30, readAtMillis: nil
        ))
    }

    func testEbookCheckNeedsAListenTimestamp() {
        XCTAssertFalse(HandoffSuggestion.shouldCheckEbook(
            listenAtMillis: nil, listenPositionSecs: 600, readAtMillis: nil
        ))
    }

    func testEbookCheckSkippedRightAfterAHandoff() {
        XCTAssertFalse(HandoffSuggestion.shouldCheckEbook(
            listenAtMillis: 200_000, listenPositionSecs: 600, readAtMillis: 100_000, agreedAtMillis: 190_000
        ))
    }

    func testAudiobookCheckNeedsReadNewerByMoreThanAMinute() {
        XCTAssertTrue(HandoffSuggestion.shouldCheckAudiobook(readAtMillis: 200_000, listenAtMillis: 100_000))
        XCTAssertFalse(HandoffSuggestion.shouldCheckAudiobook(readAtMillis: 160_000, listenAtMillis: 100_000))
        XCTAssertFalse(HandoffSuggestion.shouldCheckAudiobook(readAtMillis: 100_000, listenAtMillis: 200_000))
    }

    func testAudiobookCheckWithNoListeningYet() {
        XCTAssertTrue(HandoffSuggestion.shouldCheckAudiobook(readAtMillis: 200_000, listenAtMillis: nil))
        XCTAssertFalse(HandoffSuggestion.shouldCheckAudiobook(readAtMillis: nil, listenAtMillis: 100))
    }

    func testAudiobookCheckSkippedRightAfterAHandoff() {
        XCTAssertFalse(HandoffSuggestion.shouldCheckAudiobook(
            readAtMillis: 200_000, listenAtMillis: 100_000, agreedAtMillis: 195_000
        ))
    }

    func testEbookSpotInAnotherSpineItemIsDifferent() {
        XCTAssertTrue(HandoffSuggestion.isMeaningfullyDifferent(
            openedSpinePath: "OEBPS/ch1.xhtml", openedProgression: 0.5,
            matchedSpinePath: "ch2.xhtml", matchedProgression: 0.5
        ))
    }

    func testEbookSpotInSameItemUsesTwoPercentGap() {
        XCTAssertFalse(HandoffSuggestion.isMeaningfullyDifferent(
            openedSpinePath: "OEBPS/ch1.xhtml", openedProgression: 0.50,
            matchedSpinePath: "ch1.xhtml", matchedProgression: 0.51
        ))
        XCTAssertTrue(HandoffSuggestion.isMeaningfullyDifferent(
            openedSpinePath: "OEBPS/ch1.xhtml", openedProgression: 0.50,
            matchedSpinePath: "ch1.xhtml", matchedProgression: 0.53
        ))
    }

    func testEbookSpotWithUnknownOpenedPositionIsDifferent() {
        XCTAssertTrue(HandoffSuggestion.isMeaningfullyDifferent(
            openedSpinePath: nil, openedProgression: nil,
            matchedSpinePath: "ch1.xhtml", matchedProgression: 0
        ))
    }

    func testAudiobookSpotNeedsMoreThanTwentySeconds() {
        XCTAssertFalse(HandoffSuggestion.isMeaningfullyDifferent(currentSecs: 100, matchedSecs: 120))
        XCTAssertTrue(HandoffSuggestion.isMeaningfullyDifferent(currentSecs: 100, matchedSecs: 121))
        XCTAssertTrue(HandoffSuggestion.isMeaningfullyDifferent(currentSecs: 300, matchedSecs: 270))
    }

    func testMemoKeysIgnoreJitterButSeeMovement() {
        XCTAssertEqual(
            HandoffSuggestion.memoKey(bookId: 1, listenPositionSecs: 600.2),
            HandoffSuggestion.memoKey(bookId: 1, listenPositionSecs: 599.8)
        )
        XCTAssertNotEqual(
            HandoffSuggestion.memoKey(bookId: 1, listenPositionSecs: 600),
            HandoffSuggestion.memoKey(bookId: 1, listenPositionSecs: 700)
        )
        XCTAssertNotEqual(
            HandoffSuggestion.memoKey(bookId: 1, listenPositionSecs: 600),
            HandoffSuggestion.memoKey(bookId: 2, listenPositionSecs: 600)
        )
        XCTAssertEqual(
            HandoffSuggestion.memoKey(bookId: 1, spinePath: "a.xhtml", progression: 0.501),
            HandoffSuggestion.memoKey(bookId: 1, spinePath: "a.xhtml", progression: 0.499)
        )
        XCTAssertNotEqual(
            HandoffSuggestion.memoKey(bookId: 1, spinePath: "a.xhtml", progression: 0.5),
            HandoffSuggestion.memoKey(bookId: 1, spinePath: "b.xhtml", progression: 0.5)
        )
    }

    func testMemoKeysDifferByDirection() {
        XCTAssertNotEqual(
            HandoffSuggestion.memoKey(bookId: 1, listenPositionSecs: 0),
            HandoffSuggestion.memoKey(bookId: 1, spinePath: "0", progression: 0)
        )
    }

    func testSnippetFromLocatorHighlight() {
        let json = #"{"href":"a.xhtml","text":{"highlight":"  It was a\n dark night. "}}"#
        XCTAssertEqual(HandoffSuggestion.snippet(fromLocatorJSON: json), "It was a dark night.")
    }

    func testSnippetIsShortenedAndOptional() throws {
        let long = String(repeating: "word ", count: 40)
        let data = try JSONSerialization.data(withJSONObject: ["text": ["highlight": long]])
        let snippet = HandoffSuggestion.snippet(fromLocatorJSON: String(data: data, encoding: .utf8))
        XCTAssertEqual(snippet?.count, 60)
        XCTAssertTrue(snippet?.hasSuffix("…") == true)
        XCTAssertNil(HandoffSuggestion.snippet(fromLocatorJSON: #"{"href":"a"}"#))
        XCTAssertNil(HandoffSuggestion.snippet(fromLocatorJSON: nil))
    }
}
