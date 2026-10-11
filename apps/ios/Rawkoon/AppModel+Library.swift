import Foundation
import RawkoonKit

extension AppModel {
    func loadLibrary() async {
        if let libraryTask {
            return await libraryTask.value
        }
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            loading = true
            errorMessage = nil
            defer { loading = false }

            do {
                try await reloadLibrary()
                // Siri only matches "Play <title>" against titles it has been handed.
                RawkoonShortcuts.updateAppShortcutParameters()
                if libraryFetchedAt != nil {
                    Task { await prefetchForOffline() }
                }
            } catch {
                errorMessage = message(for: error)
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

    /// Flattens the audiobook library + remote progress into the Linux-tested
    /// CarPlay browse model. Order is applied by `CarPlayBrowse.sections`.
    func carPlayAudiobooks() async -> [CarPlayBrowseEntry] {
        // A car with a weak signal must not hold the whole list on the server.
        var remote: [RemoteProgress]?
        if isOnline, let apiClient {
            remote = await withDeadline(seconds: 5) { try? await apiClient.getProgress() }
        }
        let progressByEdition = Dictionary(
            (remote ?? []).map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first }
        )
        // Offline, the phone's own journal is the only record of what is in progress.
        let journal = await journalEntries()

        var entries: [CarPlayBrowseEntry] = []
        for book in library {
            guard let summary = book.audiobookSummary else { continue }
            let progress = progressByEdition[summary.editionId]
            // A finished book's journal line sits at its end; that is not "in progress".
            let local = (remote == nil ? journal[summary.editionId] : nil).map { entry in
                playStartPosition(positionSecs: entry.positionSecs, durationSecs: summary.durationSecs ?? .infinity) == 0
                    ? PositionEntry(editionId: entry.editionId, positionSecs: 0, atMillis: entry.atMillis)
                    : entry
            }
            entries.append(
                CarPlayBrowseEntry(
                    editionId: summary.editionId,
                    title: summary.title,
                    author: summary.author,
                    positionSecs: book.isRead
                        ? 0 : progress.map { $0.finished ? 0 : $0.positionSecs } ?? local?.positionSecs,
                    totalDurationSecs: progress?.totalDurationSecs ?? summary.durationSecs,
                    updatedAtMillis: progress.map { Int64($0.updatedAt.timeIntervalSince1970 * 1000) }
                        ?? local?.atMillis,
                    isDownloaded: downloadedBookIds.contains(book.bookId)
                )
            )
        }
        return entries
    }

    /// Resolves a possibly-relative image path against the server base URL.
    /// TMDB poster URLs are already absolute; library posters may be relative.
    func absoluteURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let absolute = URL(string: raw), absolute.scheme != nil {
            return absolute
        }
        guard let base = URL(string: serverURL) else { return nil }
        return URL(string: raw, relativeTo: base)?.absoluteURL
    }

    func reloadLibrary() async throws {
        guard let apiClient else { throw APIError.unauthorized }
        // Alongside, not after: the greeting and admin rows must not wait on
        // every page of the library.
        Task { await refreshAdmin() }
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

    /// Mark the whole book read (or clear the badge). Marking read wipes this
    /// user's ebook and audiobook progress on the server and this device.
    func setBookRead(_ book: BookListItem, read: Bool) async {
        guard let apiClient else { return }
        errorMessage = nil
        do {
            try await apiClient.setBookRead(bookId: book.bookId, read: read)
            if read {
                clearLocalProgress(for: book)
            }
            await loadLibrary()
            liveUpdates.bumpBookChangeToken()
            toast(
                read
                    ? String(localized: "Marked as read.")
                    : String(localized: "Read badge cleared."),
                style: .success
            )
        } catch {
            toast(message(for: error), style: .error)
        }
    }

    /// Clears ebook and audiobook progress on the server and this device; the read flag is untouched.
    func resetBookProgress(_ book: BookListItem) async {
        guard let apiClient else { return }
        errorMessage = nil
        do {
            try await apiClient.resetBookProgress(bookId: book.bookId)
            clearLocalProgress(for: book)
            await loadLibrary()
            liveUpdates.bumpBookChangeToken()
            toast(String(localized: "Progress reset."), style: .success)
        } catch {
            toast(message(for: error), style: .error)
        }
    }

    private func clearLocalProgress(for book: BookListItem) {
        let editionIds = [book.audiobookEditionId, book.ebookEditionId].compactMap(\.self)
        for editionId in editionIds {
            try? readingProgressStore.remove(editionId: editionId)
            lastProgressPosition[editionId] = nil
        }
        let kept = PositionJournal.excluding(readJournal(), editionIds: Set(editionIds))
        try? kept.write(to: journalURL, atomically: true, encoding: .utf8)
        // Closed, not rewound: a playing book would PUT a position within seconds
        // and recreate the progress row the server just deleted. activeEditionId
        // goes first so the unload's pause has nothing to save.
        if let active = activeEditionId, editionIds.contains(active) {
            activeEditionId = nil
            player.unload()
        }
    }
}
