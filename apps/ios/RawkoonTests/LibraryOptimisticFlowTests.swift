import Foundation
@testable import Rawkoon
import Testing

@MainActor
struct LibraryOptimisticFlowTests {
    @Test func discoverAddShowsProvisionalRowThenReplacesIt() async throws {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([], for: key)
        let gate = AddGate()

        let add = Task { try await store.addToLibrary(provisional: provisional(tmdbId: 7), request: gate.run) }
        await gate.waitUntilStarted()

        #expect(store.libraryList(key).value?.count == 1)
        #expect(store.libraryList(key).value?.first?.tmdbId == 7)
        #expect(store.libraryList(key).value?.first?.isProvisional == true)

        gate.finish(.success(movie(id: 42, tmdbId: 7)))
        _ = try await add.value

        #expect(store.libraryList(key).value?.map(\.id) == [42])
        #expect(store.libraryList(key).value?.first?.isProvisional == false)
    }

    @Test func failedDiscoverAddRemovesProvisionalRow() async {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1, tmdbId: 1)], for: key)
        let gate = AddGate()

        let add = Task { try await store.addToLibrary(provisional: provisional(tmdbId: 7), request: gate.run) }
        await gate.waitUntilStarted()
        gate.finish(.failure(TestError.failed))

        await #expect(throws: TestError.self) { try await add.value }
        #expect(store.libraryList(key).value?.map(\.id) == [1])
        #expect(store.libraryList(key).value?.contains { $0.isProvisional } == false)
    }

    @Test func addOnlyTouchesListsThatCanContainTheItem() async throws {
        let store = ServerStateStore()
        let all = LibraryListKey.default
        let shows = LibraryListKey(type: "show")
        let searched = LibraryListKey(query: "dune")
        store.seedLibraryList([], for: all)
        store.seedLibraryList([], for: shows)
        store.seedLibraryList([], for: searched)
        let gate = AddGate()

        let add = Task { try await store.addToLibrary(provisional: provisional(tmdbId: 7), request: gate.run) }
        await gate.waitUntilStarted()

        #expect(store.libraryList(all).value?.count == 1)
        #expect(store.libraryList(shows).value?.isEmpty == true)
        #expect(store.libraryList(searched).value?.isEmpty == true)

        gate.finish(.success(movie(id: 42, tmdbId: 7)))
        _ = try await add.value
    }

    @Test func sseEventCannotOverwriteAPendingAdd() async throws {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([], for: key)
        let gate = AddGate()

        let add = Task { try await store.addToLibrary(provisional: provisional(tmdbId: 7), request: gate.run) }
        await gate.waitUntilStarted()
        SSEEventRegistry.apply(.media(id: 99), to: store)

        #expect(store.libraryList(key).value?.first?.isProvisional == true)
        #expect(store.libraryList(key).isInvalidated == false)

        gate.finish(.success(movie(id: 42, tmdbId: 7)))
        _ = try await add.value
    }

    @Test func windowRefreshKeepsEveryLoadedPage() async throws {
        let store = ServerStateStore()
        let key = LibraryListKey(limit: 1)
        try await store.loadLibraryWindow(key, pages: 1) { page in
            LibraryPage(items: [movie(id: page, tmdbId: page)], hasMore: page < 2)
        }
        try await store.loadNextLibraryPage(key) { page in
            LibraryPage(items: [movie(id: page, tmdbId: page)], hasMore: page < 2)
        }
        #expect(store.libraryList(key).value?.map(\.id) == [1, 2])
        #expect(store.pagination(key).pagesLoaded == 2)

        try await store.refreshLibraryWindow(key) { page in
            LibraryPage(items: [movie(id: page, tmdbId: page)], hasMore: page < 2)
        }

        #expect(store.libraryList(key).value?.map(\.id) == [1, 2])
        #expect(store.pagination(key).pagesLoaded == 2)
        #expect(store.libraryList(key).isInvalidated == false)
    }

    @Test func removeRollsBackWithoutResettingLoadedPages() async {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1, tmdbId: 1), movie(id: 2, tmdbId: 2)], for: key, pagesLoaded: 2, hasMore: true)
        let gate = AddGate()

        let remove = Task { try await store.removeLibraryItem(id: 1, request: { _ = try await gate.run() }) }
        await gate.waitUntilStarted()
        #expect(store.libraryList(key).value?.map(\.id) == [2])

        gate.finish(.failure(TestError.failed))
        await #expect(throws: TestError.self) { try await remove.value }

        #expect(store.libraryList(key).value?.map(\.id) == [1, 2])
        #expect(store.pagination(key).pagesLoaded == 2)
        #expect(store.pagination(key).hasMore)
    }

    @Test func monitorPatchUpdatesListAndItemBeforeNetworkReturns() async throws {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1, tmdbId: 1)], for: key)
        store.seedLibraryItem(movie(id: 1, tmdbId: 1))
        let gate = AddGate()

        let update = Task { try await store.updateMonitored(id: 1, monitored: false, request: gate.run) }
        await gate.waitUntilStarted()

        #expect(store.libraryList(key).value?.first?.monitored == false)
        #expect(store.libraryItem(1).value?.monitored == false)

        var confirmed = movie(id: 1, tmdbId: 1)
        confirmed.monitored = false
        gate.finish(.success(confirmed))
        _ = try await update.value

        #expect(store.libraryList(key).value?.first?.monitored == false)
        #expect(store.isInvalidated(.libraryItem(1)))
    }

    @Test func failedMonitorChangeRestoresBothCaches() async {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1, tmdbId: 1)], for: key)
        store.seedLibraryItem(movie(id: 1, tmdbId: 1))
        let gate = AddGate()

        let update = Task { try await store.updateMonitored(id: 1, monitored: false, request: gate.run) }
        await gate.waitUntilStarted()
        gate.finish(.failure(TestError.failed))
        await #expect(throws: TestError.self) { try await update.value }

        #expect(store.libraryList(key).value?.first?.monitored == true)
        #expect(store.libraryItem(1).value?.monitored == true)
    }

    @Test func qualityProfilePatchAppliesThenConverges() async throws {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1, tmdbId: 1)], for: key)
        store.seedLibraryItem(movie(id: 1, tmdbId: 1))
        let gate = AddGate()

        let update = Task { try await store.updateQualityProfile(id: 1, qualityProfileId: 9, request: gate.run) }
        await gate.waitUntilStarted()
        #expect(store.libraryItem(1).value?.qualityProfileId == 9)

        var confirmed = movie(id: 1, tmdbId: 1)
        confirmed.qualityProfileId = 9
        gate.finish(.success(confirmed))
        _ = try await update.value

        #expect(store.libraryList(key).value?.first?.qualityProfileId == 9)
    }

    @Test func downloadAndFileChangesInvalidateWithoutPatching() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1, tmdbId: 1)], for: key)

        store.invalidateDownloadHistory(itemID: 1)
        #expect(store.isInvalidated(.downloadHistory(1)))
        #expect(store.isInvalidated(.libraryItem(1)))
        #expect(store.libraryList(key).isInvalidated)
        #expect(store.libraryList(key).value?.map(\.id) == [1])

        store.seedLibraryList([movie(id: 1, tmdbId: 1)], for: key)
        store.invalidateLibraryRollup(itemID: 1)
        #expect(store.isInvalidated(.libraryItem(1)))
        #expect(store.libraryList(key).isInvalidated)
    }

    @Test func sseEventDuringPendingRemoveCannotResurrectTheRow() async throws {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 1, tmdbId: 1), movie(id: 2, tmdbId: 2)], for: key)
        let gate = AddGate()

        let remove = Task { try await store.removeLibraryItem(id: 1, request: { _ = try await gate.run() }) }
        await gate.waitUntilStarted()
        SSEEventRegistry.apply(.media(id: 1), to: store)

        #expect(store.libraryList(key).value?.map(\.id) == [2])
        #expect(store.libraryList(key).isInvalidated == false)

        gate.finish(.success(movie(id: 1, tmdbId: 1)))
        try await remove.value
        #expect(store.libraryList(key).value?.map(\.id) == [2])
    }

    private nonisolated func provisional(tmdbId: Int) -> LibraryMedia {
        LibraryMedia.provisional(tmdbId: tmdbId, type: "movie", title: "Movie \(tmdbId)", year: 2026, posterUrl: nil, overview: nil)
    }

    private nonisolated func movie(id: Int, tmdbId: Int) -> LibraryMedia {
        LibraryMedia(
            id: id, tmdbId: tmdbId, type: "movie", title: "Movie \(id)", year: 2026,
            status: "wanted", monitored: true, posterUrl: nil, overview: nil,
            qualityProfileId: nil, qualityProfile: nil, totalSizeBytes: nil,
            episodeCount: nil, downloadedEpisodeCount: nil, seasonCount: nil,
            durationSecs: nil, resolution: nil, videoCodec: nil, hdrFormat: nil,
            audioFormat: nil, languageTags: nil, lastGrabbedAt: nil, addedAt: nil,
            digitalReleaseDate: nil
        )
    }
}

enum TestError: Error { case failed }

/// Lets a test observe the optimistic state while the "network" call is still
/// in flight, then decide how that call finishes.
final class AddGate: @unchecked Sendable {
    private let lock = NSLock()
    private var didStart = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var result: Result<LibraryMedia, Error>?
    private var resultWaiter: CheckedContinuation<LibraryMedia, Error>?

    @Sendable func run() async throws -> LibraryMedia {
        let waiters: [CheckedContinuation<Void, Never>] = lock.withLock {
            didStart = true
            let pending = startWaiters
            startWaiters = []
            return pending
        }
        for waiter in waiters {
            waiter.resume()
        }

        return try await withCheckedThrowingContinuation { continuation in
            let ready: Result<LibraryMedia, Error>? = lock.withLock {
                if let result {
                    return result
                }
                resultWaiter = continuation
                return nil
            }
            if let ready {
                continuation.resume(with: ready)
            }
        }
    }

    func waitUntilStarted() async {
        await withCheckedContinuation { continuation in
            let alreadyStarted: Bool = lock.withLock {
                if didStart {
                    return true
                }
                startWaiters.append(continuation)
                return false
            }
            if alreadyStarted {
                continuation.resume()
            }
        }
    }

    func finish(_ outcome: Result<LibraryMedia, Error>) {
        let waiter: CheckedContinuation<LibraryMedia, Error>? = lock.withLock {
            result = outcome
            let pending = resultWaiter
            resultWaiter = nil
            return pending
        }
        waiter?.resume(with: outcome)
    }
}
