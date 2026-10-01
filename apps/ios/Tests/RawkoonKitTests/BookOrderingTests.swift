@testable import RawkoonKit
import XCTest

final class BookOrderingTests: XCTestCase {
    private func key(
        _ id: Int, _ title: String, progress: Bool = false, downloaded: Bool = false
    ) -> BookOrderKey {
        BookOrderKey(id: id, title: title, isInProgress: progress, isDownloaded: downloaded)
    }

    private func order(_ keys: [BookOrderKey]) -> [Int] {
        BookOrdering.sorted(keys) { $0 }.map(\.id)
    }

    func testTiersInProgressThenDownloadedThenRest() {
        let out = order([
            key(1, "Alpha"),
            key(2, "Beta", downloaded: true),
            key(3, "Zulu", progress: true),
        ])
        XCTAssertEqual(out, [3, 2, 1])
    }

    func testInProgressBeatsDownloadedEvenWhenAlsoDownloaded() {
        let out = order([
            key(1, "Alpha", downloaded: true),
            key(2, "Beta", progress: true, downloaded: true),
        ])
        XCTAssertEqual(out, [2, 1])
    }

    func testAlphabeticalWithinEachTierIgnoringCaseAndDiacritics() {
        let out = order([
            key(1, "banane", progress: true),
            key(2, "Éclair", progress: true),
            key(3, "apple", progress: true),
            key(4, "Zed", downloaded: true),
            key(5, "ant", downloaded: true),
            key(6, "yak"),
            key(7, "Eel"),
        ])
        XCTAssertEqual(out, [3, 1, 2, 5, 4, 7, 6])
    }

    func testTitleTieBreaksByIdAndIsInputOrderIndependent() {
        let a = key(9, "Same"), b = key(4, "same"), c = key(7, "SAME")
        XCTAssertEqual(order([a, b, c]), [4, 7, 9])
        XCTAssertEqual(order([c, a, b]), [4, 7, 9])
    }

    func testFinishedEditionsAreNotInProgress() {
        XCTAssertFalse(BookOrdering.isAudiobookInProgress(positionSecs: 500, totalDurationSecs: 1000, finished: true))
        XCTAssertFalse(BookOrdering.isEbookInProgress(spineIndex: 4, scrollFraction: 0.5, finished: true))
    }

    func testInProgressThresholds() {
        XCTAssertFalse(BookOrdering.isAudiobookInProgress(positionSecs: 1, totalDurationSecs: 1000, finished: false))
        XCTAssertFalse(BookOrdering.isAudiobookInProgress(positionSecs: 50, totalDurationSecs: 1, finished: false))
        XCTAssertTrue(BookOrdering.isAudiobookInProgress(positionSecs: 50, totalDurationSecs: 1000, finished: false))
        XCTAssertFalse(BookOrdering.isEbookInProgress(spineIndex: 0, scrollFraction: 0.01, finished: false))
        XCTAssertTrue(BookOrdering.isEbookInProgress(spineIndex: 0, scrollFraction: 0.2, finished: false))
        XCTAssertTrue(BookOrdering.isEbookInProgress(spineIndex: 2, scrollFraction: 0, finished: false))
        XCTAssertTrue(BookOrdering.isInProgress(audiobookInProgress: false, ebookInProgress: true))
        XCTAssertFalse(BookOrdering.isInProgress(audiobookInProgress: false, ebookInProgress: false))
    }
}
