import Foundation
import Testing
@testable import Rawkoon

@MainActor
struct BookViewModelTests {
    private func makeBook(hasEbook: Bool, audiobookEditionId: Int?) -> BookListItem {
        BookListItem(
            bookId: 1,
            title: "Test Book",
            author: "Author",
            coverURL: nil,
            audiobookEditionId: audiobookEditionId,
            ebookEditionId: nil,
            audiobookDurationSecs: nil,
            audiobookStatus: nil,
            audiobookFileCount: 0,
            hasEbook: hasEbook
        )
    }

    private func makeEdition(id: Int, kind: String) -> BookEditionDetail {
        BookEditionDetail(
            id: id,
            kind: kind,
            status: "wanted",
            monitored: true,
            durationSecs: nil,
            totalSizeBytes: nil,
            fileCount: 0,
            bestFormat: nil,
            narrators: []
        )
    }

    private func makeDetail(editions: [BookEditionDetail]) -> BookDetailItem {
        BookDetailItem(
            id: 1,
            title: "Test Book",
            subtitle: nil,
            overview: nil,
            coverUrl: nil,
            authors: [],
            language: "en",
            publishedYear: nil,
            publishedDate: nil,
            seriesName: nil,
            seriesPosition: nil,
            narrators: [],
            genres: [],
            publisher: nil,
            pageCount: nil,
            rating: nil,
            ratingCount: nil,
            isbn13: nil,
            editions: editions
        )
    }

    /// Mirrors the original `alignLaneToAvailableEditions()`: the audiobook
    /// lane is selected, but the audiobook edition is missing while an ebook
    /// edition IS present — the view used to flip `activeLane` to `.ebook` in
    /// place. `alignedLane(current:)` must return that same flipped value
    /// instead of mutating anything.
    @Test func alignedLaneFlipsToEbookWhenAudiobookEditionMissing() {
        let book = makeBook(hasEbook: true, audiobookEditionId: nil)
        let vm = BookViewModel(book: book)
        vm.detail = makeDetail(editions: [makeEdition(id: 10, kind: "ebook")])

        #expect(vm.alignedLane(current: .audiobook) == .ebook)
    }

    /// Mirror image: ebook lane selected, no ebook edition, audiobook edition
    /// present — original code flipped to `.audiobook`.
    @Test func alignedLaneFlipsToAudiobookWhenEbookEditionMissing() {
        let book = makeBook(hasEbook: false, audiobookEditionId: 5)
        let vm = BookViewModel(book: book)
        vm.detail = makeDetail(editions: [makeEdition(id: 5, kind: "audiobook")])

        #expect(vm.alignedLane(current: .ebook) == .audiobook)
    }

    /// Both editions available: the original never touched `activeLane`,
    /// whichever lane was already selected.
    @Test func alignedLaneStaysPutWhenBothEditionsAvailable() {
        let book = makeBook(hasEbook: true, audiobookEditionId: 5)
        let vm = BookViewModel(book: book)
        vm.detail = makeDetail(editions: [
            makeEdition(id: 5, kind: "audiobook"),
            makeEdition(id: 10, kind: "ebook"),
        ])

        #expect(vm.alignedLane(current: .audiobook) == .audiobook)
        #expect(vm.alignedLane(current: .ebook) == .ebook)
    }

    /// Neither edition available: the original's two `if`/`else if` branches
    /// both require the OTHER lane to have an edition before flipping, so
    /// with neither present, the lane never moves.
    @Test func alignedLaneStaysPutWhenNeitherEditionAvailable() {
        let book = makeBook(hasEbook: false, audiobookEditionId: nil)
        let vm = BookViewModel(book: book)
        vm.detail = makeDetail(editions: [])

        #expect(vm.alignedLane(current: .audiobook) == .audiobook)
        #expect(vm.alignedLane(current: .ebook) == .ebook)
    }
}
