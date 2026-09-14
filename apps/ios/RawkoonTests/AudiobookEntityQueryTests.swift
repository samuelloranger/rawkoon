@testable import Rawkoon
import Testing

struct AudiobookEntityQueryTests {
    private func book(_ bookId: Int, title: String, audiobookEditionId: Int?) -> BookListItem {
        BookListItem(
            bookId: bookId,
            title: title,
            author: "Author \(bookId)",
            coverURL: nil,
            audiobookEditionId: audiobookEditionId,
            ebookEditionId: nil,
            audiobookDurationSecs: nil,
            audiobookStatus: nil,
            audiobookFileCount: audiobookEditionId == nil ? 0 : 1,
            hasEbook: false,
            readAt: nil
        )
    }

    @Test func resolvesExactEditionId() {
        let library = [
            book(1, title: "Dune", audiobookEditionId: 10),
            book(2, title: "Hyperion", audiobookEditionId: 20),
        ]
        let entities = AudiobookCatalog.entities(for: [20], in: library, isLoggedIn: true)
        #expect(entities.map(\.id) == [20])
        #expect(entities.first?.title == "Hyperion")
    }

    @Test func sameTitleDifferentEditionsStayDistinct() {
        let library = [
            book(1, title: "Dune", audiobookEditionId: 10),
            book(2, title: "Dune", audiobookEditionId: 11),
        ]
        let entities = AudiobookCatalog.entities(for: [10, 11], in: library, isLoggedIn: true)
        #expect(Set(entities.map(\.id)) == [10, 11])
    }

    @Test func signedOutResolvesNothing() {
        let library = [book(1, title: "Dune", audiobookEditionId: 10)]
        #expect(AudiobookCatalog.all(in: library, isLoggedIn: false).isEmpty)
        #expect(AudiobookCatalog.entities(for: [10], in: library, isLoggedIn: false).isEmpty)
    }

    @Test func removedItemResolvesNothing() {
        let library = [book(1, title: "Dune", audiobookEditionId: 10)]
        #expect(AudiobookCatalog.entities(for: [99], in: library, isLoggedIn: true).isEmpty)
    }

    @Test func nonAudiobookItemsExcluded() {
        let library = [
            book(1, title: "Dune", audiobookEditionId: 10),
            book(2, title: "Ebook only", audiobookEditionId: nil),
        ]
        #expect(AudiobookCatalog.all(in: library, isLoggedIn: true).map(\.id) == [10])
    }
}
