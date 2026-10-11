import Foundation
@testable import Rawkoon
import RawkoonKit
import Testing

@MainActor
struct AppModelSplitRegressionTests {
    @Test func failedLibraryRefreshKeepsVisibleBooks() async throws {
        let model = AppModel()
        model.apiClient = try APIClient(baseURL: #require(URL(string: "http://127.0.0.1:1")), token: "test")
        model.library = [book(id: 21, title: "Already visible")]
        model.libraryFetchedAt = nil
        model.isOfflineLibrary = false

        try await model.reloadLibrary()

        #expect(model.library.map(\.bookId) == [21])
        #expect(model.libraryFetchedAt == nil)
        #expect(model.isOfflineLibrary == false)
    }

    @Test func cachedManifestIsReturnedWithoutAnAPIClient() async throws {
        let model = AppModel()
        model.apiClient = nil
        let cached = manifest(editionId: 987_654_321, bookId: 21)
        model.manifests[cached.editionId] = cached

        let result = try await model.manifest(cached.editionId)

        #expect(result == cached)
    }

    @Test func activeBookRequiresBothTheLibraryRowAndManifest() {
        let model = AppModel()
        let cached = manifest(editionId: 987_654_322, bookId: 22)
        model.library = [book(id: 22, title: "Playing", editionId: cached.editionId)]
        model.activeEditionId = cached.editionId
        #expect(model.activeBook() == nil)

        model.manifests[cached.editionId] = cached
        #expect(model.activeBook()?.summary.title == "Playing")
        #expect(model.activeBook()?.manifest == cached)

        model.library = []
        #expect(model.activeBook() == nil)
    }

    @Test func carPlayBrowseIncludesOnlyAudiobookEditions() async {
        let model = AppModel()
        model.apiClient = nil
        model.library = [
            book(id: 31, title: "Ebook only"),
            book(id: 32, title: "Audiobook", editionId: 987_654_323),
        ]

        let entries = await model.carPlayAudiobooks()

        #expect(entries.map(\.editionId) == [987_654_323])
        #expect(entries.map(\.title) == ["Audiobook"])
    }

    @Test func unrecognizedBackgroundSessionFinishesItsCompletion() {
        let model = AppModel()
        var finished = false

        model.handleBackgroundEvents(identifier: "not-a-rawkoon-session") {
            finished = true
        }

        #expect(finished)
    }

    @Test func artworkURLResolvesRelativePathsAgainstTheServer() {
        let model = AppModel()
        model.serverURL = "https://rawkoon.example/base/"

        #expect(model.absoluteURL("/posters/21.jpg")?.absoluteString == "https://rawkoon.example/posters/21.jpg")
        #expect(model.absoluteURL("https://images.example/cover.jpg")?.absoluteString == "https://images.example/cover.jpg")
        #expect(model.absoluteURL(nil) == nil)
    }

    private func book(id: Int, title: String, editionId: Int? = nil) -> BookListItem {
        BookListItem(
            bookId: id, title: title, author: nil, coverURL: nil,
            audiobookEditionId: editionId, ebookEditionId: nil,
            audiobookDurationSecs: 100, audiobookStatus: nil,
            audiobookFileCount: editionId == nil ? 0 : 1,
            hasEbook: false, readAt: nil
        )
    }

    private func manifest(editionId: Int, bookId: Int) -> BookManifest {
        BookManifest(
            editionId: editionId, bookId: bookId, title: "Playing", authors: [],
            totalDurationSecs: 100, files: [], chapters: []
        )
    }
}
