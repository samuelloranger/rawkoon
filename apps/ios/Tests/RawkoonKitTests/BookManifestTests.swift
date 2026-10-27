@testable import RawkoonKit
import XCTest

final class BookManifestTests: XCTestCase {
    /// A trimmed copy of what the server actually returns.
    private let json = """
    {
      "edition_id": 14,
      "book_id": 17,
      "title": "L'inconnue",
      "authors": ["Nora Whitfield"],
      "total_duration_secs": 28800.5,
      "chapters": [
        {"index": 0, "title": "Chapter 1", "start_secs": 0,
         "end_secs": 498.125, "file_id": 301, "size_bytes": 12000000,
         "sha256": null, "url": "/api/books/files/301/content?grant=abc"},
        {"index": 1, "title": "Chapter 2", "start_secs": 498.125,
         "end_secs": 1037.5, "file_id": 302, "size_bytes": 12500000,
         "sha256": null, "url": "/api/books/files/302/content?grant=def"}
      ]
    }
    """.data(using: .utf8)!

    func testDecodesServerJSON() throws {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let m = try d.decode(BookManifest.self, from: json)
        XCTAssertEqual(m.editionId, 14)
        XCTAssertEqual(m.title, "L'inconnue")
        XCTAssertEqual(m.chapters.count, 2)
        XCTAssertEqual(m.chapters[0].fileId, 301)
        XCTAssertEqual(m.chapters[0].sizeBytes, 12_000_000)
        XCTAssertEqual(m.totalDurationSecs, 28800.5, accuracy: 0.000001)
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
        XCTAssertEqual(fromDisk.chapters[0].fileId, 301)
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
        XCTAssertEqual(decoded?.chapters[0].fileId, 301)
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
        let m = try XCTUnwrap(BookManifest.decodePersisted(json))
        XCTAssertEqual(m.files.count, 2)
        XCTAssertEqual(m.files[0].id, 301)
        XCTAssertEqual(m.files[0].startSecs, 0, accuracy: 1e-9)
        XCTAssertEqual(m.files[1].id, 302)
        XCTAssertEqual(m.files[1].startSecs, 498.125, accuracy: 1e-6)
        XCTAssertEqual(m.files[1].durationSecs, 1037.5 - 498.125, accuracy: 1e-6)
    }

    /// A server re-import changes ids or sizes; the old local copies must go,
    /// or the book stays listed offline with chapters that cannot play.
    func testStaleLocalFilesAreThoseRemovedOrResized() {
        func file(_ id: Int, _ size: Int) -> ManifestFile {
            ManifestFile(id: id, startSecs: 0, durationSecs: 1, sizeBytes: size, sha256: nil, url: "u")
        }
        let persisted = [file(1, 100), file(2, 200), file(3, 300)]
        let fresh = [file(1, 100), file(2, 250), file(4, 400)]

        XCTAssertEqual(staleLocalFiles(persisted: persisted, fresh: fresh).map(\.id), [2, 3])
        XCTAssertEqual(staleLocalFiles(persisted: persisted, fresh: persisted), [])
    }
}
