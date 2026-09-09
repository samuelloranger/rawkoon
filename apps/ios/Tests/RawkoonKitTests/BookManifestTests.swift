@testable import RawkoonKit
import XCTest

final class BookManifestTests: XCTestCase {
    /// A trimmed copy of what the server actually returns.
    private let json = """
    {
      "edition_id": 14,
      "book_id": 17,
      "title": "L'intruse",
      "authors": ["Freida McFadden"],
      "total_duration_secs": 29383.444895,
      "chapters": [
        {"index": 0, "title": "Chapter 1", "start_secs": 0,
         "end_secs": 504.189388, "file_id": 267, "size_bytes": 12367295,
         "sha256": null, "url": "/api/books/files/267/content?grant=abc"},
        {"index": 1, "title": "Chapter 2", "start_secs": 504.189388,
         "end_secs": 1042.860408, "file_id": 268, "size_bytes": 13026495,
         "sha256": null, "url": "/api/books/files/268/content?grant=def"}
      ]
    }
    """.data(using: .utf8)!

    func testDecodesServerJSON() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: json)
        XCTAssertEqual(m.editionId, 14)
        XCTAssertEqual(m.title, "L'intruse")
        XCTAssertEqual(m.chapters.count, 2)
        XCTAssertEqual(m.chapters[0].fileId, 267)
        XCTAssertEqual(m.chapters[0].sizeBytes, 12_367_295)
        XCTAssertEqual(m.totalDurationSecs, 29383.444895, accuracy: 0.000001)
    }

    /// sha256 is null throughout phase 1 and populated later. A decoder that
    /// requires it would break against the current server.
    func testSha256MayBeNull() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: json)
        XCTAssertNil(m.chapters[0].sha256)
    }

    func testGrantURLHasNoExtensionSoFileIsBin() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: json)
        XCTAssertEqual(m.chapters[0].fileExtension, "bin")
    }

    func testAbsoluteAudioURLKeepsItsExtension() {
        let chapter = ManifestChapter(
            index: 0, title: "C", startSecs: 0, endSecs: 1,
            fileId: 1, sizeBytes: 1, sha256: nil,
            url: "https://cdn.example/chapter.m4b"
        )
        XCTAssertEqual(chapter.fileExtension, "m4b")
    }

    func testRoundTripThroughJSONEncoderIsReadableWithoutSnakeCase() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let original = try d.decode(BookManifest.self, from: json)
        let data = try JSONEncoder().encode(original)
        let fromDisk = try JSONDecoder().decode(BookManifest.self, from: data)
        XCTAssertEqual(fromDisk.editionId, 14)
        XCTAssertEqual(fromDisk.chapters.count, 2)
        XCTAssertEqual(fromDisk.chapters[0].fileId, 267)
    }

    func testDecodePersistedAcceptsCamelCaseDiskJSON() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let original = try d.decode(BookManifest.self, from: json)
        let data = try JSONEncoder().encode(original)
        let decoded = BookManifest.decodePersisted(data)
        XCTAssertEqual(decoded?.editionId, 14)
        XCTAssertEqual(decoded?.chapters.count, 2)
    }

    func testDecodePersistedAcceptsServerSnakeCaseJSON() {
        let decoded = BookManifest.decodePersisted(json)
        XCTAssertEqual(decoded?.editionId, 14)
        XCTAssertEqual(decoded?.chapters.count, 2)
        XCTAssertEqual(decoded?.chapters[0].fileId, 267)
    }

    func testDecodesFilesArray() throws {
        let withFiles = """
        {
          "edition_id": 65, "book_id": 9, "title": "T", "authors": ["A"],
          "total_duration_secs": 400,
          "files": [
            {"id": 1059, "start_secs": 0, "duration_secs": 400,
             "size_bytes": 500, "sha256": null, "url": "/f/1059"}
          ],
          "chapters": [
            {"index": 0, "title": "C0", "start_secs": 0, "end_secs": 200,
             "file_id": 1059, "size_bytes": 500, "sha256": null, "url": "/f/1059"},
            {"index": 1, "title": "C1", "start_secs": 200, "end_secs": 400,
             "file_id": 1059, "size_bytes": 500, "sha256": null, "url": "/f/1059"}
          ]
        }
        """.data(using: .utf8)!
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: withFiles)
        XCTAssertEqual(m.files.count, 1)
        XCTAssertEqual(m.files[0].id, 1059)
        XCTAssertEqual(m.files[0].durationSecs, 400, accuracy: 1e-9)
        XCTAssertEqual(m.chapters.count, 2)
    }

    /// A manifest written before this change has no `files`; it must synthesize
    /// one file per chapter so an already-downloaded book still plays.
    func testLegacyManifestWithoutFilesSynthesizesOnePerChapter() throws {
        // `json` (top of file) is a two-chapter manifest with no files array.
        let m = BookManifest.decodePersisted(json)!
        XCTAssertEqual(m.files.count, 2)
        XCTAssertEqual(m.files[0].id, 267)
        XCTAssertEqual(m.files[0].startSecs, 0, accuracy: 1e-9)
        XCTAssertEqual(m.files[1].id, 268)
        XCTAssertEqual(m.files[1].startSecs, 504.189388, accuracy: 1e-6)
        XCTAssertEqual(m.files[1].durationSecs, 1042.860408 - 504.189388, accuracy: 1e-6)
    }
}
