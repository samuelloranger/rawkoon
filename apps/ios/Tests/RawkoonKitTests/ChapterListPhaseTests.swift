@testable import RawkoonKit
import XCTest

final class ChapterListPhaseTests: XCTestCase {
    /// The screenshot: detail has loaded (so "63 files" is visible) but the
    /// chapter fetch has not started yet because it was queued behind the ebook
    /// files request. That idle window must be a spinner, not the default error.
    func testUnattemptedFetchIsLoadingNotError() {
        let phase = chapterListPhase(
            loading: false,
            fetchAttempted: false,
            hasChapters: false,
            error: nil
        )
        XCTAssertEqual(phase, .loading)
    }

    func testInFlightFetchIsLoading() {
        let phase = chapterListPhase(
            loading: true,
            fetchAttempted: true,
            hasChapters: false,
            error: nil
        )
        XCTAssertEqual(phase, .loading)
    }

    func testFinishedFetchWithoutChaptersUsesDefaultCopy() {
        let phase = chapterListPhase(
            loading: false,
            fetchAttempted: true,
            hasChapters: false,
            error: nil
        )
        XCTAssertEqual(phase, .failed("Chapters couldn't load."))
    }

    func testFinishedFetchWithoutChaptersSurfacesServerError() {
        let phase = chapterListPhase(
            loading: false,
            fetchAttempted: true,
            hasChapters: false,
            error: "Network error. Check your connection."
        )
        XCTAssertEqual(phase, .failed("Network error. Check your connection."))
    }

    func testChaptersWinOverLoadingAndError() {
        let phase = chapterListPhase(
            loading: true,
            fetchAttempted: true,
            hasChapters: true,
            error: "stale"
        )
        XCTAssertEqual(phase, .ready)
    }
}
