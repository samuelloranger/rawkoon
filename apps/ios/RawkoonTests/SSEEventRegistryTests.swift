import Foundation
@testable import Rawkoon
import Testing

struct SSEContractEntryDTO: Decodable {
    let id: String
    let path: String
    let ios_policy: String
}

private final class TestBundleMarker {}

enum SSEContractFixture {
    static func load() throws -> [SSEContractEntryDTO] {
        let testBundle = Bundle(for: TestBundleMarker.self)
        guard let url = testBundle.url(forResource: "sse-contract.v1", withExtension: "json")
            ?? Bundle.main.url(forResource: "sse-contract.v1", withExtension: "json")
        else {
            throw CocoaError(.fileNoSuchFile)
        }
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode([SSEContractEntryDTO].self, from: data)
    }
}

@MainActor
struct SSEEventRegistryTests {
    @Test func everyBundledSSEContractEntryHasOneHandler() throws {
        let entries = try SSEContractFixture.load()
        #expect(Set(entries.map(\.id)) == SSEEventRegistry.handledContractIDs)
    }

    @Test func mediaEventInvalidatesLibraryItemAndLists() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1)], for: key)

        SSEEventRegistry.apply(.media(id: 1), to: store)

        #expect(store.libraryList(key).isInvalidated)
        #expect(store.isInvalidated(.libraryItem(1)))
        #expect(!store.isInvalidated(.bookList))
    }

    @Test func bookEventInvalidatesOnlyBookAndProgressFamilies() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1)], for: key)

        SSEEventRegistry.apply(.book(id: 2), to: store)

        #expect(!store.libraryList(key).isInvalidated)
        #expect(store.isInvalidated(.bookItem(2)))
        #expect(store.isInvalidated(.bookList))
        #expect(store.isInvalidated(.progress))
    }

    @Test func libraryHandshakeInvalidatesLibraryAndBookFamilies() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1)], for: key)

        SSEEventRegistry.apply(.libraryHandshake, to: store)

        #expect(store.libraryList(key).isInvalidated)
        #expect(store.isInvalidated(.bookList))
        #expect(store.isInvalidated(.progress))
    }

    private func movie(id: Int) -> LibraryMedia {
        LibraryMedia(
            id: id, tmdbId: id, type: "movie", title: "Movie \(id)", year: 2026,
            status: "wanted", monitored: true, posterUrl: nil, backdropUrl: nil, overview: nil, overrides: nil,
            qualityProfileId: nil, qualityProfile: nil, totalSizeBytes: nil,
            episodeCount: nil, downloadedEpisodeCount: nil, seasonCount: nil,
            durationSecs: nil, resolution: nil, videoCodec: nil, hdrFormat: nil,
            audioFormat: nil, languageTags: nil, lastGrabbedAt: nil, addedAt: nil,
            digitalReleaseDate: nil
        )
    }
}
