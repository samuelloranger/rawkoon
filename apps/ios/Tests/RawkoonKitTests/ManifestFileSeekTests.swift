@testable import RawkoonKit
import XCTest

final class ManifestFileSeekTests: XCTestCase {
    private func file(id: Int, start: Double, duration: Double) -> ManifestFile {
        ManifestFile(id: id, startSecs: start, durationSecs: duration,
                     sizeBytes: 1, sha256: nil, url: "u")
    }

    /// A single-file audiobook: a scrub across a chapter boundary stays in the
    /// one physical file, so it seeks in place (offset measured from the file).
    func testStaysInPlaceAcrossChaptersWithinOneFile() {
        let single = file(id: 1, start: 0, duration: 400)
        XCTAssertEqual(single.inPlaceSeekOffset(to: 250, bookDurationSecs: 400), 250)
        XCTAssertEqual(single.inPlaceSeekOffset(to: 0, bookDurationSecs: 400), 0)
    }

    /// Multi-file: a seek into a different file cannot be in place — the queue
    /// must rebuild — so the current file returns nil for that target.
    func testSeekIntoAnotherFileIsNotInPlace() {
        let first = file(id: 1, start: 0, duration: 100)
        XCTAssertNil(first.inPlaceSeekOffset(to: 150, bookDurationSecs: 250))
    }

    /// The offset is measured from the file's own start, not the book's.
    func testOffsetIsRelativeToTheFileStart() {
        let second = file(id: 2, start: 100, duration: 150)
        XCTAssertEqual(second.inPlaceSeekOffset(to: 175, bookDurationSecs: 250), 75)
    }

    /// The exact end of the book is in place at the end of the last file.
    func testEndOfBookStaysOnTheLastFile() {
        let last = file(id: 2, start: 100, duration: 150)
        XCTAssertEqual(last.inPlaceSeekOffset(to: 250, bookDurationSecs: 250), 150)
    }

    /// A non-last file does not absorb the book-end instant — that seek crosses
    /// into the last file, so it is not in place.
    func testNonLastFileDoesNotClaimTheBookEnd() {
        let first = file(id: 1, start: 0, duration: 100)
        XCTAssertNil(first.inPlaceSeekOffset(to: 250, bookDurationSecs: 250))
    }
}
