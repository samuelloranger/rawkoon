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
}
