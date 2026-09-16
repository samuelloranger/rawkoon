@testable import Rawkoon
import Testing

@MainActor
struct ServerStateStoreTests {
    @Test func rollbackRestoresExactLibrarySnapshot() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1)], for: key)

        let token = store.beginMutation(.removeLibraryItem(1))
        store.removeLibraryItemOptimistically(id: 1, from: key, token: token)
        store.rollback(token)

        #expect(store.libraryList(key).value?.map(\.id) == [1])
    }

    @Test func invalidatingLibraryItemInvalidatesLibraryLists() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1)], for: key)

        store.invalidate(.libraryItem(1))

        #expect(store.libraryList(key).isInvalidated)
    }

    private func movie(id: Int) -> LibraryMedia {
        LibraryMedia(
            id: id, tmdbId: id, type: "movie", title: "Movie \(id)", year: 2026,
            status: "wanted", monitored: true, posterUrl: nil, overview: nil,
            qualityProfileId: nil, qualityProfile: nil, totalSizeBytes: nil,
            episodeCount: nil, downloadedEpisodeCount: nil, seasonCount: nil,
            durationSecs: nil, resolution: nil, videoCodec: nil, hdrFormat: nil,
            audioFormat: nil, languageTags: nil, lastGrabbedAt: nil, addedAt: nil,
            digitalReleaseDate: nil
        )
    }
}
