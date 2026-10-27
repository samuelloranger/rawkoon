@testable import RawkoonKit
import XCTest

final class LibraryStatusDisplayTests: XCTestCase {
    func testDownloadedAiringShowReadsAsItsAiringState() {
        for state in ["returning", "in_production", "planned"] {
            XCTAssertEqual(LibraryStatusDisplay.status("downloaded", airingState: state), state)
        }
    }

    func testFinishedOrUnknownShowStaysDownloaded() {
        XCTAssertEqual(LibraryStatusDisplay.status("downloaded", airingState: "ended"), "downloaded")
        XCTAssertEqual(LibraryStatusDisplay.status("downloaded", airingState: nil), "downloaded")
        XCTAssertEqual(LibraryStatusDisplay.status("downloaded", airingState: "something_new"), "downloaded")
    }

    func testAcquisitionStatusWinsOverTheAiringState() {
        for status in ["wanted", "downloading", "upgrading", "skipped"] {
            XCTAssertEqual(LibraryStatusDisplay.status(status, airingState: "returning"), status)
        }
    }
}
