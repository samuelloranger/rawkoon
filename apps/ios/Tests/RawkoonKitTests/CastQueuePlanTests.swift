@testable import RawkoonKit
import XCTest

final class CastQueuePlanTests: XCTestCase {
    private func file(_ id: Int, start: Double, duration: Double, mime: String? = nil) -> ManifestFile {
        ManifestFile(id: id, startSecs: start, durationSecs: duration, sizeBytes: 1, sha256: nil,
                     url: "/api/books/files/\(id)/content?grant=g", mimeType: mime)
    }

    private lazy var multiFile = [
        file(1, start: 0, duration: 100),
        file(2, start: 100, duration: 50),
        file(3, start: 150, duration: 200)
    ]

    func testStartPicksTheFileHoldingThePosition() {
        XCTAssertEqual(CastQueuePlan.start(files: multiFile, at: 120), .init(index: 1, offset: 20))
    }

    func testStartOnAFileBoundaryBelongsToTheNextFile() {
        XCTAssertEqual(CastQueuePlan.start(files: multiFile, at: 100), .init(index: 1, offset: 0))
    }

    func testStartBeforeTheBookClampsToTheFirstFile() {
        XCTAssertEqual(CastQueuePlan.start(files: multiFile, at: -5), .init(index: 0, offset: 0))
    }

    func testStartPastTheEndSitsAtTheEndOfTheLastFile() {
        XCTAssertEqual(CastQueuePlan.start(files: multiFile, at: 999), .init(index: 2, offset: 200))
    }

    func testSingleFileBookOffsetIsTheWholeBookPosition() {
        let single = [file(9, start: 0, duration: 36000)]
        XCTAssertEqual(CastQueuePlan.start(files: single, at: 7200.5), .init(index: 0, offset: 7200.5))
    }

    func testNoFilesHasNoStart() {
        XCTAssertNil(CastQueuePlan.start(files: [], at: 10))
    }

    func testWholeBookPositionAddsTheFileStart() {
        XCTAssertEqual(CastQueuePlan.wholeBookPosition(file: multiFile[2], streamPosition: 30), 180)
    }

    func testWholeBookPositionClampsAReceiverOvershoot() {
        XCTAssertEqual(CastQueuePlan.wholeBookPosition(file: multiFile[1], streamPosition: 51.2), 150)
    }

    func testWholeBookPositionIgnoresANonFiniteReport() {
        XCTAssertEqual(CastQueuePlan.wholeBookPosition(file: multiFile[1], streamPosition: .nan), 100)
    }

    func testContentTypeComesFromTheManifest() {
        XCTAssertEqual(CastQueuePlan.contentType(for: file(1, start: 0, duration: 1, mime: "audio/mp4")), "audio/mp4")
    }

    func testContentTypeFallsBackToMP3ForAnOlderManifest() {
        XCTAssertEqual(CastQueuePlan.contentType(for: file(1, start: 0, duration: 1)), "audio/mpeg")
    }

    func testMimeTypeDecodesFromTheServerAndIsOptional() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let withType = try decoder.decode(ManifestFile.self, from: Data("""
        {"id": 1, "start_secs": 0, "duration_secs": 1, "size_bytes": 1, "sha256": null,
         "url": "/f/1", "mime_type": "audio/mp4"}
        """.utf8))
        XCTAssertEqual(withType.mimeType, "audio/mp4")
        let without = try decoder.decode(ManifestFile.self, from: Data("""
        {"id": 1, "start_secs": 0, "duration_secs": 1, "size_bytes": 1, "sha256": null, "url": "/f/1"}
        """.utf8))
        XCTAssertNil(without.mimeType)
    }
}
