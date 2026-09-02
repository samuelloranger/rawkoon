@testable import RawkoonKit
import Testing

struct DownloadedLibraryTests {
    private func edition(
        _ id: Int, kind: DownloadedKind = .audiobook,
        title: String = "Book", added: Int64 = 0
    ) -> DownloadedEdition {
        DownloadedEdition(
            editionId: id, bookId: id * 10, kind: kind, title: title,
            author: nil, totalDurationSecs: nil, fileCount: 1,
            coverFileName: nil, addedAtMillis: added
        )
    }

    @Test func upsertAppendsWhenNew() {
        let out = DownloadedLibrary.upsert([edition(1)], edition(2))
        #expect(out.map(\.editionId) == [1, 2])
    }

    @Test func upsertReplacesSameEditionInPlace() {
        let start = [edition(1, title: "Old"), edition(2)]
        let out = DownloadedLibrary.upsert(start, edition(1, title: "New"))
        #expect(out.count == 2)
        #expect(out.first(where: { $0.editionId == 1 })?.title == "New")
        // Replacement keeps position, does not move to the end.
        #expect(out.map(\.editionId) == [1, 2])
    }

    @Test func removeDropsMatchingEdition() {
        let out = DownloadedLibrary.remove([edition(1), edition(2)], editionId: 1)
        #expect(out.map(\.editionId) == [2])
    }

    @Test func removeMissingIsNoOp() {
        let out = DownloadedLibrary.remove([edition(1)], editionId: 99)
        #expect(out.map(\.editionId) == [1])
    }

    @Test func editionIdsIsTheSetOfDownloaded() {
        #expect(DownloadedLibrary.editionIds([edition(3), edition(7)]) == [3, 7])
    }

    @Test func sortedForDisplayIsCaseInsensitiveTitleThenEditionId() {
        let list = [
            edition(1, title: "banana"),
            edition(2, title: "Apple"),
            edition(3, title: "apple"),
        ]
        let out = DownloadedLibrary.sortedForDisplay(list)
        // "Apple"/"apple" tie on title (case-insensitive) → editionId ascending.
        #expect(out.map(\.editionId) == [2, 3, 1])
    }

    @Test func downloadedEditionRoundTripsThroughCodable() throws {
        let original = edition(5, kind: .ebook, title: "Round", added: 123)
        let data = try JSONEncoder().encode([original])
        let decoded = try JSONDecoder().decode([DownloadedEdition].self, from: data)
        #expect(decoded == [original])
    }
}
