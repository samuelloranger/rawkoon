@testable import Rawkoon
import Testing

@MainActor
struct BookViewSplitRegressionTests {
    @Test func initialLaneFollowsAvailableEditionAndPreference() {
        #expect(BookView(book: book(audio: 7, ebook: 8)).activeLane == .audiobook)
        #expect(BookView(book: book(audio: 7, ebook: 8), preferEbook: true).activeLane == .ebook)
        #expect(BookView(book: book(audio: nil, ebook: 8)).activeLane == .ebook)
        #expect(BookView(book: book(audio: 7, ebook: nil), preferEbook: true).activeLane == .audiobook)
    }

    @Test func cachedEditionIdsRemainAvailableWithoutDetail() {
        let view = BookView(book: book(audio: 7, ebook: 8))
        #expect(view.audiobookEditionId == 7)
        #expect(view.ebookEditionId == 8)
        #expect(view.ebookStorageEditionId == 8)
        #expect(view.hasAudiobookEdition)
        #expect(view.hasEbookEdition)
    }

    @Test func ebookStorageFallbackAndExtensionAreStable() {
        let view = BookView(book: book(audio: nil, ebook: nil))
        #expect(view.ebookStorageEditionId == 1_000_000_042)
        #expect(view.ebookExtension(for: file(name: "Novel.EPUB", format: "mobi")) == "epub")
        #expect(view.ebookExtension(for: file(name: "Novel", format: ".EPUB")) == "epub")
    }

    private func book(audio: Int?, ebook: Int?) -> BookListItem {
        BookListItem(
            bookId: 42, title: "Novel", author: nil, coverURL: nil,
            audiobookEditionId: audio, ebookEditionId: ebook,
            audiobookDurationSecs: nil, audiobookStatus: nil,
            audiobookFileCount: 0, hasEbook: ebook != nil, readAt: nil
        )
    }

    private func file(name: String, format: String) -> BookEditionFile {
        BookEditionFile(id: 1, fileName: name, filePath: name, contentUrl: nil,
                        sizeBytes: "0", format: format, durationSecs: nil,
                        audioBitrate: nil, audioCodec: nil, isRetail: false,
                        releaseGroup: nil, languageTags: [], scannedAt: "")
    }
}
