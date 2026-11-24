import Foundation
import Observation
import RawkoonKit

/// Owns the book library the screens browse (online, saved copy or built from
/// the downloaded index), its load dedup, and the library growth card. API access
/// goes through `SessionStore`; the offline prefetch that follows a confirmed load
/// is a hook `AppModel.init` wires.
@MainActor
@Observable
final class LibraryStore {
    private static let growthStaleAfter: TimeInterval = 300

    var library: [BookListItem] = []
    var libraryGrowth: LibraryGrowth?
    var libraryGrowthFetchedAt: Date?
    /// True once a fetch failed with nothing cached, so the Library strip hides instead of waiting.
    var libraryGrowthFailed = false
    /// True when `library` was built from the on-device downloaded index because
    /// the server was unreachable and no saved copy of the full library existed —
    /// the UI shows an "Offline" hint instead of a network-error wall, and lists
    /// only downloaded books.
    var isOfflineLibrary = false
    /// When the server last confirmed `library`; nil while it is only the saved
    /// copy painted at launch, so screens know to refresh it once.
    var libraryFetchedAt: Date?
    /// The in-flight library load — Home, Library and the root all ask for one on
    /// launch, and every page of the library should be fetched once.
    var libraryTask: Task<Void, Never>?
    /// Open requests awaiting an admin, for the Activity badge; zero for everyone else.
    var pendingRequestCount = 0

    // MARK: Hooks wired by AppModel.init

    /// Runs after a load the server confirmed, so the saved copies refill.
    var prefetchForOffline: () async -> Void = {}

    private let session: SessionStore

    init(session: SessionStore) {
        self.session = session
    }

    func loadLibrary() async {
        if let libraryTask {
            return await libraryTask.value
        }
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            session.loading = true
            session.errorMessage = nil
            defer { session.loading = false }

            do {
                try await reloadLibrary()
                // Siri only matches "Play <title>" against titles it has been handed.
                RawkoonShortcuts.updateAppShortcutParameters()
                if libraryFetchedAt != nil {
                    Task { await prefetchForOffline() }
                }
            } catch {
                session.errorMessage = session.describeError(error)
            }
        }
        libraryTask = task
        await task.value
        libraryTask = nil
    }

    /// True until the server has confirmed the library this launch — the saved
    /// copy painted at launch still wants one refresh.
    var needsLibraryRefresh: Bool {
        libraryFetchedAt == nil
    }

    /// Loads the library if a CarPlay-only launch means no SwiftUI view ever
    /// triggered `loadLibrary()`.
    func ensureLibraryLoaded() async {
        if library.isEmpty {
            await loadLibrary()
        } else if needsLibraryRefresh {
            // The saved copy is enough to browse; don't hold the car on the refresh.
            Task { await loadLibrary() }
        }
    }

    func reloadLibrary() async throws {
        guard let apiClient = session.apiClient else { throw APIError.unauthorized }
        // Alongside, not after: the greeting and admin rows must not wait on
        // every page of the library.
        Task { await session.refreshAdmin() }
        do {
            let fetched = try await apiClient.libraryBooks()
            library = Self.sortedLibrary(fetched)
            libraryFetchedAt = Date()
            isOfflineLibrary = false
            OfflineLibraryStore.backfillMissingCovers(library: library)
        } catch {
            // Server unreachable: keep the full library already on screen, else
            // the last saved copy of it, and only then fall back to the
            // downloaded index. A failed refresh must never shrink the list.
            if !library.isEmpty, !isOfflineLibrary {
                return
            }
            if let cached = apiClient.cachedLibraryBooks(), !cached.value.isEmpty {
                library = Self.sortedLibrary(cached.value)
                isOfflineLibrary = false
                return
            }
            let downloaded = DownloadedStore.readIndex()
            guard !downloaded.isEmpty else { throw error }
            library = Self.offlineLibrary(from: downloaded)
            isOfflineLibrary = true
        }
    }

    /// Paints the book library from the last saved response, so a cold launch
    /// shows the user's books before (or without) the network.
    func hydrateFromCache() {
        guard let apiClient = session.apiClient else { return }
        if library.isEmpty, let cached = apiClient.cachedLibraryBooks() {
            library = Self.sortedLibrary(cached.value)
        }
    }

    /// Clears what belongs to the signed-in account.
    func reset() {
        pendingRequestCount = 0
        library = []
        libraryFetchedAt = nil
    }

    static func sortedLibrary(_ items: [BookListItem]) -> [BookListItem] {
        BookOrdering.sorted(items) {
            BookOrderKey(id: $0.bookId, title: $0.title, isInProgress: false, isDownloaded: false)
        }
    }

    /// Collapses the downloaded index into library rows, merging an audiobook
    /// and an ebook of the same book into one row (mirroring the online merged
    /// list) and preserving the title sort.
    private static func offlineLibrary(from index: [DownloadedEdition]) -> [BookListItem] {
        var byBook: [Int: [DownloadedEdition]] = [:]
        for entry in DownloadedLibrary.sortedForDisplay(index) {
            byBook[entry.bookId, default: []].append(entry)
        }
        // Order books by their best (first, per the title sort) edition.
        var seen = Set<Int>()
        var order: [Int] = []
        for entry in DownloadedLibrary.sortedForDisplay(index) where !seen.contains(entry.bookId) {
            seen.insert(entry.bookId)
            order.append(entry.bookId)
        }
        return order.compactMap { bookId in
            guard let editions = byBook[bookId], let primary = editions.first else { return nil }
            let audiobook = editions.first { $0.kind == .audiobook }
            let ebook = editions.first { $0.kind == .ebook }
            return BookListItem(
                bookId: bookId,
                title: primary.title,
                author: primary.author,
                coverURL: DownloadedStore.coverURL(
                    editionId: primary.editionId, fileName: primary.coverFileName
                ),
                audiobookEditionId: audiobook?.editionId,
                ebookEditionId: ebook?.editionId,
                audiobookDurationSecs: audiobook?.totalDurationSecs,
                audiobookStatus: audiobook != nil ? "downloaded" : nil,
                audiobookFileCount: audiobook?.fileCount ?? 0,
                hasEbook: ebook != nil,
                readAt: nil
            )
        }
    }

    /// Shared by Home's card and the Library strip so each open doesn't refetch; `force` skips the freshness check.
    func refreshLibraryGrowth(force: Bool = false) async {
        guard let client = session.apiClient else {
            libraryGrowthFailed = libraryGrowth == nil
            return
        }
        if libraryGrowth == nil, let cached = client.cached(Endpoints.libraryGrowth),
           GrowthDates.isCurrentMonth(start: cached.value.growth.month.start, timezone: cached.value.growth.timezone)
        {
            libraryGrowth = cached.value.growth
        }
        if !force, libraryGrowth != nil, let at = libraryGrowthFetchedAt,
           Date().timeIntervalSince(at) < Self.growthStaleAfter
        {
            return
        }
        do {
            let fresh = try await client.libraryGrowth()
            withRawkoonMotion(RawkoonMotion.spring) { libraryGrowth = fresh }
            libraryGrowthFetchedAt = Date()
            libraryGrowthFailed = false
        } catch {
            Log.network.error("library growth fetch failed: \(String(describing: error), privacy: .public)")
            // A failed refresh must not leave last month's numbers up after the month rolls over.
            if let kept = libraryGrowth,
               !GrowthDates.isCurrentMonth(start: kept.month.start, timezone: kept.timezone)
            {
                withRawkoonMotion(RawkoonMotion.spring) { libraryGrowth = nil }
            }
            libraryGrowthFailed = libraryGrowth == nil
        }
    }
}
