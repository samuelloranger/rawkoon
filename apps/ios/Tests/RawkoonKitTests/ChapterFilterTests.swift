import XCTest
@testable import RawkoonKit

final class ChapterFilterTests: XCTestCase {
    private func chapters(_ titles: [String]) -> [ManifestChapter] {
        titles.enumerated().map { index, title in
            ManifestChapter(
                index: index,
                title: title,
                startSecs: Double(index) * 10,
                endSecs: Double(index + 1) * 10,
                fileId: 100 + index,
                sizeBytes: 1000,
                sha256: nil,
                url: "u\(index)"
            )
        }
    }

    func testEmptyQueryReturnsAll() {
        let all = chapters(["Prologue", "ménage", "Epilogue"])
        XCTAssertEqual(filterChapters(all, query: ""), all)
        XCTAssertEqual(filterChapters(all, query: "   "), all)
    }

    func testDiacriticInsensitiveTitleMatch() {
        let all = chapters(["Prologue", "Les secrets de la femme de ménage", "Epilogue"])
        let result = filterChapters(all, query: "menage")
        XCTAssertEqual(result.map(\.title), ["Les secrets de la femme de ménage"])
    }

    func testNumericMatchOnOneBasedIndex() {
        let untitled = (0..<50).map { index in
            ManifestChapter(
                index: index,
                title: "Untitled",
                startSecs: 0,
                endSecs: 10,
                fileId: 200 + index,
                sizeBytes: 1,
                sha256: nil,
                url: "u"
            )
        }
        XCTAssertEqual(filterChapters(untitled, query: "47").map(\.index), [46])
        XCTAssertEqual(
            filterChapters(untitled, query: "4").map { $0.index + 1 },
            [4, 14, 24, 34, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49]
        )
    }

    func testNoMatchReturnsEmpty() {
        let all = chapters(["Prologue", "ménage"])
        XCTAssertEqual(filterChapters(all, query: "xyz"), [])
    }

    func testQueryMatchingTitleAndNumberDoesNotDuplicate() {
        let all = chapters(["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"])
        let result = filterChapters(all, query: "4")
        XCTAssertEqual(result.map(\.index), [3])
    }
}
