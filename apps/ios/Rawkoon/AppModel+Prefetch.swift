import BackgroundTasks
import Foundation
import RawkoonKit
import UIKit

/// Keeps the saved copy useful before it is needed: detail pages the user has
/// never opened are fetched ahead of time on an unmetered connection, and a
/// background refresh keeps the main screens current between launches.
extension AppModel {
    static let backgroundRefreshIdentifier = "cloud.samlo.rawkoon.refresh"

    private static let lastPrefetchKey = "offline_prefetch_at"
    /// Recent titles are what gets opened on a plane; the long tail is left to the network.
    private nonisolated static let prefetchMediaLimit = 100
    private nonisolated static let prefetchBookLimit = 100
    private nonisolated static let prefetchImageLimit = 40

    /// Warms saved detail pages and artwork for recent library titles. Skipped on
    /// cellular and in Low Data Mode, and at most every 6 hours unless forced.
    func prefetchForOffline(force: Bool = false) async {
        guard isLoggedIn, isOnline, !isOnExpensiveNetwork, let apiClient, prefetchTask == nil else { return }
        let last = UserDefaults.standard.double(forKey: Self.lastPrefetchKey)
        guard force || Date().timeIntervalSince1970 - last > 6 * 3600 else { return }

        let books = Array(library.prefix(Self.prefetchBookLimit))
        let scale = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.screen.scale }.first ?? 3
        let absolute: @Sendable (String?) -> URL? = { [serverURL] raw in
            guard let raw, !raw.isEmpty else { return nil }
            if let url = URL(string: raw), url.scheme != nil {
                return url
            }
            return URL(string: serverURL).flatMap { URL(string: raw, relativeTo: $0)?.absoluteURL }
        }
        let task = Task.detached(priority: .utility) {
            await Self.runPrefetch(client: apiClient, books: books, scale: scale, absolute: absolute)
        }
        prefetchTask = task
        await task.value
        prefetchTask = nil
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastPrefetchKey)
    }

    private nonisolated static func runPrefetch(
        client: APIClient,
        books: [BookListItem],
        scale: CGFloat,
        absolute: @escaping @Sendable (String?) -> URL?
    ) async {
        // Books run alongside movies and shows so a short session still covers both.
        async let bookPass: Void = prefetchBookDetails(client: client, books: books)
        let recent = await (try? client.get(Endpoints.libraryList(
            page: 1, limit: prefetchMediaLimit, sortBy: "added_at", sortDir: "desc"
        )))?.items ?? []

        var images: [(URL, CGSize)] = []
        await withTaskGroup(of: (URL?, URL?).self) { group in
            var inFlight = 0
            for (index, media) in recent.enumerated() {
                if Task.isCancelled {
                    break
                }
                let endpoint = Endpoints.mediaModal(mediaType: media.type == "show" ? "tv" : "movie", tmdbId: media.tmdbId)
                let wantsImages = index < prefetchImageLimit
                guard isStale(client.cachedEntry(endpoint.path, query: endpoint.query)) || wantsImages else { continue }
                if inFlight >= 3 {
                    if let (poster, backdrop) = await group.next() {
                        images.append(contentsOf: [poster, backdrop].enumerated().compactMap { offset, url in
                            url.map { ($0, offset == 0 ? posterSize : backdropSize) }
                        })
                    }
                    inFlight -= 1
                }
                inFlight += 1
                group.addTask {
                    let modal = isStale(client.cachedEntry(endpoint.path, query: endpoint.query))
                        ? try? await client.get(endpoint)
                        : client.cached(endpoint)?.value
                    guard wantsImages else { return (nil, nil) }
                    return (absolute(media.posterUrl), absolute(modal?.details.primaryBackdropUrl))
                }
            }
            for await (poster, backdrop) in group {
                images.append(contentsOf: [poster, backdrop].enumerated().compactMap { offset, url in
                    url.map { ($0, offset == 0 ? posterSize : backdropSize) }
                })
            }
        }

        await bookPass
        for book in books.prefix(prefetchImageLimit) {
            if let cover = book.coverURL {
                images.append((cover, bookCoverSize))
            }
        }

        for (url, size) in images where !Task.isCancelled {
            await PosterCache.prefetch(url, targetSize: size, scale: scale)
        }
    }

    private nonisolated static func prefetchBookDetails(client: APIClient, books: [BookListItem]) async {
        for book in books where !Task.isCancelled {
            if isStale(client.cachedEntry("/api/books/\(book.bookId)")) {
                _ = try? await client.bookDetail(bookId: book.bookId)
            }
        }
    }

    /// A day-old detail page is fresh enough to open offline; don't refetch it.
    private nonisolated static func isStale(_ entry: ResponseCache.Entry?) -> Bool {
        entry.map { $0.age(now: Date()) > 24 * 3600 } ?? true
    }

    /// The sizes the detail heroes ask for, so the prefetched bytes are the ones they load.
    private nonisolated static let posterSize = CGSize(width: 192, height: 288)
    private nonisolated static let backdropSize = CGSize(width: 600, height: 320)
    private nonisolated static let bookCoverSize = CGSize(width: 200, height: 300)

    // MARK: Background refresh

    /// Registered before launch finishes, as BGTaskScheduler requires. The main
    /// queue keeps the handler on the actor this module defaults to.
    static func registerBackgroundRefresh() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: backgroundRefreshIdentifier, using: .main) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            MainActor.assumeIsolated {
                AppModel.shared.handleBackgroundRefresh(refresh)
            }
        }
    }

    /// Asks for the next refresh a few hours out; iOS picks the actual time.
    func scheduleBackgroundRefresh() {
        guard isLoggedIn else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundRefreshIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 3600)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            Log.sync.debug("background refresh not scheduled: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func handleBackgroundRefresh(_ task: BGAppRefreshTask) {
        scheduleBackgroundRefresh()
        let work = Task { @MainActor in
            await refreshSavedData()
            await prefetchForOffline()
        }
        // Called off the main thread; an inferred @MainActor closure would trap.
        task.expirationHandler = { @Sendable in
            work.cancel()
        }
        Task { @MainActor in
            await work.value
            task.setTaskCompleted(success: !work.isCancelled)
        }
    }

    /// Refetches what the main tabs paint first, which rewrites their saved copies.
    func refreshSavedData() async {
        guard isLoggedIn, let apiClient else { return }
        await loadLibrary()
        await refreshAdmin()
        async let recent = try? apiClient.get(Endpoints.recentlyAdded())
        async let upcoming = try? apiClient.get(Endpoints.upcoming)
        async let deck = try? apiClient.get(Endpoints.discoverDeck(limit: 12))
        async let grid = try? apiClient.get(Endpoints.libraryList(
            page: 1, limit: 60, sortBy: "added_at", sortDir: "desc"
        ))
        async let progress = try? apiClient.getProgress()
        async let reading = try? apiClient.readingProgress()
        async let notifications = try? apiClient.get(Endpoints.notifications(page: 1, limit: 25))
        _ = await (recent, upcoming, deck, grid, progress, reading, notifications)
        await refreshUnreadNotificationCount()
    }
}
