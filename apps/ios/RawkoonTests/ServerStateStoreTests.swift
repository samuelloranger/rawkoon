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

    @Test func needsLoadWhenNothingIsCached() {
        let store = ServerStateStore()

        #expect(store.needsLoad(.default))
    }

    @Test func noLoadWhenFreshDataIsCached() {
        let store = ServerStateStore()
        store.seedLibraryList([movie(id: 1)], for: .default)

        #expect(store.needsLoad(.default) == false)
    }

    @Test func needsLoadAgainOnceTheQueryIsInvalidated() {
        let store = ServerStateStore()
        store.seedLibraryList([movie(id: 1)], for: .default)

        SSEEventRegistry.apply(.media(id: 1), to: store)

        #expect(store.needsLoad(.default))
    }

    @Test func refreshingClearsTheNeedToLoad() async throws {
        let store = ServerStateStore()
        store.seedLibraryList([movie(id: 1)], for: .default)
        SSEEventRegistry.apply(.media(id: 1), to: store)

        try await store.refreshLibraryWindow(.default) { _ in
            LibraryPage(items: [movie(id: 1)], hasMore: false)
        }

        #expect(store.needsLoad(.default) == false)
    }

    @Test func anEmptyLibraryStillLoadsOnAppear() {
        let store = ServerStateStore()
        store.seedLibraryList([], for: .default)

        #expect(store.needsLoad(.default))
    }

    private nonisolated func movie(id: Int) -> LibraryMedia {
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
