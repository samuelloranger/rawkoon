@testable import RawkoonKit
import XCTest

final class EbookResumeTests: XCTestCase {
    private func position(
        spineIndex: Int = 3,
        spineCount: Int = 12,
        scrollFraction: Double = 0.5,
        finished: Bool = false,
        locator: String? = nil
    ) -> ReadingPosition {
        ReadingPosition(
            editionId: 1,
            fileId: 9,
            spineIndex: spineIndex,
            spinePath: "OEBPS/ch04.xhtml",
            spineCount: spineCount,
            scrollFraction: scrollFraction,
            finished: finished,
            updatedAtMillis: 1000,
            locator: locator
        )
    }

    private func locator(title: String? = nil, totalProgression: Double? = nil) -> String {
        var parts = ["\"href\": \"OEBPS/ch04.xhtml\""]
        if let title {
            parts.append("\"title\": \"\(title)\"")
        }
        if let totalProgression {
            parts.append("\"locations\": { \"totalProgression\": \(totalProgression) }")
        }
        return "{ \(parts.joined(separator: ", ")) }"
    }

    func testChapterTitleWins() {
        let label = EbookResume.label(position(locator: locator(title: "The Hunt", totalProgression: 0.37)))
        XCTAssertEqual(label, .resumeChapter("The Hunt"))
    }

    func testPercentWhenNoTitle() {
        XCTAssertEqual(
            EbookResume.label(position(locator: locator(totalProgression: 0.37))),
            .resumePercent(37)
        )
        // A blank title is no title — it must not render an empty "Resume · ".
        XCTAssertEqual(
            EbookResume.label(position(locator: locator(title: "   ", totalProgression: 0.37))),
            .resumePercent(37)
        )
    }

    func testFinishedReadsFromTheStart() {
        XCTAssertEqual(
            EbookResume.label(position(finished: true, locator: locator(title: "Afterword", totalProgression: 0.99))),
            .read
        )
    }

    func testNothingStoredOrNothingReadYet() {
        XCTAssertEqual(EbookResume.label(nil), .read)
        // Under one percent counts as unstarted, mirroring the audiobook floor.
        XCTAssertEqual(
            EbookResume.label(position(spineIndex: 0, scrollFraction: 0, locator: locator(totalProgression: 0.001))),
            .read
        )
        XCTAssertEqual(EbookResume.label(position(spineIndex: 0, spineCount: 0, scrollFraction: 0)), .read)
    }

    func testFallsBackToSpineEstimateWithoutALocator() {
        // (3 + 0.5) / 12 ≈ 0.29
        XCTAssertEqual(EbookResume.label(position()), .resumePercent(29))
    }

    func testMalformedLocatorFallsBackInsteadOfCrashing() {
        XCTAssertEqual(EbookResume.label(position(locator: "not json at all")), .resumePercent(29))
        XCTAssertEqual(EbookResume.label(position(locator: "[1, 2, 3]")), .resumePercent(29))
        XCTAssertEqual(EbookResume.label(position(locator: "{}")), .resumePercent(29))
    }

    func testPercentIsClampedAndNeverClaimsCompletion() {
        // 99%+ without the finished flag still must not read as done.
        XCTAssertEqual(EbookResume.label(position(locator: locator(totalProgression: 0.995))), .resumePercent(99))
        XCTAssertEqual(EbookResume.label(position(locator: locator(totalProgression: 2))), .resumePercent(99))
    }
}
