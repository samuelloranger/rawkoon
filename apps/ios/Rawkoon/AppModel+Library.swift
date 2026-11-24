import Foundation
import RawkoonKit

extension AppModel {
    /// Flattens the audiobook library + remote progress into the Linux-tested
    /// CarPlay browse model. Order is applied by `CarPlayBrowse.sections`.
    func carPlayAudiobooks() async -> [CarPlayBrowseEntry] {
        // A car with a weak signal must not hold the whole list on the server.
        var remote: [RemoteProgress]?
        if isOnline, let apiClient = session.apiClient {
            remote = await withDeadline(seconds: 5) { try? await apiClient.getProgress() }
        }
        let progressByEdition = Dictionary(
            (remote ?? []).map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first }
        )
        // Offline, the phone's own journal is the only record of what is in progress.
        let journal = await progress.journalEntries()

        var entries: [CarPlayBrowseEntry] = []
        for book in libraryStore.library {
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
                    isDownloaded: downloads.downloadedBookIds.contains(book.bookId)
                )
            )
        }
        return entries
    }

    /// Mark the whole book read (or clear the badge). Marking read wipes this
    /// user's ebook and audiobook progress on the server and this device.
    func setBookRead(_ book: BookListItem, read: Bool) async {
        guard let apiClient = session.apiClient else { return }
        session.errorMessage = nil
        do {
            try await apiClient.setBookRead(bookId: book.bookId, read: read)
            if read {
                progress.clearLocalProgress(editionIds: editionIds(of: book))
            }
            await libraryStore.loadLibrary()
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
        guard let apiClient = session.apiClient else { return }
        session.errorMessage = nil
        do {
            try await apiClient.resetBookProgress(bookId: book.bookId)
            progress.clearLocalProgress(editionIds: editionIds(of: book))
            await libraryStore.loadLibrary()
            liveUpdates.bumpBookChangeToken()
            toast(String(localized: "Progress reset."), style: .success)
        } catch {
            toast(message(for: error), style: .error)
        }
    }

    private func editionIds(of book: BookListItem) -> [Int] {
        [book.audiobookEditionId, book.ebookEditionId].compactMap(\.self)
    }
}
