import Foundation
import Observation
import RawkoonKit

/// Book-lane filters, progress, and actions retained across section switches.
@MainActor
@Observable
final class LibraryBooksModel {
    var bookKind: BookKindFilter = .all
    var bookSearch = ""
    var busyBookIds: Set<Int> = []
    var booksError: String?
    var audioProgress: [Int: RemoteProgress] = [:]
    var ebookProgress: [Int: ReadingPosition] = [:]
    var readingBook: BookListItem?
    var showingPlayer = false

    func filteredBooks(in model: AppModel) -> [BookListItem] {
        let filtered = model.library.filter { book in
            switch bookKind {
            case .all: true
            case .audiobook: book.hasAudiobook
            case .ebook: book.hasEbook
            }
        }.filter { book in
            let query = bookSearch.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty else { return true }
            let haystack = "\(book.title) \(book.author ?? "")".lowercased()
            return haystack.contains(query.lowercased())
        }
        return BookOrdering.sorted(filtered) { book in
            BookOrderKey(
                id: book.bookId, title: book.title,
                isInProgress: isInProgress(book), isDownloaded: isDownloaded(book, model: model)
            )
        }
    }

    private func isInProgress(_ book: BookListItem) -> Bool {
        let audio = book.audiobookEditionId.flatMap { audioProgress[$0] }.map {
            BookOrdering.isAudiobookInProgress(
                positionSecs: $0.positionSecs, totalDurationSecs: $0.totalDurationSecs, finished: $0.finished
            )
        } ?? false
        let ebook = book.ebookEditionId.flatMap { ebookProgress[$0] }.map {
            BookOrdering.isEbookInProgress(
                spineIndex: $0.spineIndex, scrollFraction: $0.scrollFraction, finished: $0.finished
            )
        } ?? false
        return BookOrdering.isInProgress(audiobookInProgress: audio, ebookInProgress: ebook)
    }

    func loadBooks(model: AppModel) async {
        booksError = nil
        await model.loadLibrary()
        booksError = model.errorMessage
    }

    func loadBookProgress(model: AppModel) async {
        guard let client = model.api() else { return }
        let audio = await (try? client.getProgress()) ?? client.cachedProgress()?.value
        let ebook = await (try? client.readingProgress()) ?? client.cachedReadingProgress()?.value
        if let audio {
            audioProgress = Dictionary(audio.map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first })
        }
        if let ebook {
            ebookProgress = Dictionary(ebook.map { ($0.editionId, $0) }, uniquingKeysWith: { first, _ in first })
        }
    }

    func progressFraction(_ book: BookListItem) -> Double? {
        guard let editionId = book.audiobookEditionId,
              let progress = audioProgress[editionId],
              !progress.finished, progress.totalDurationSecs > 1, progress.positionSecs > 1
        else { return nil }
        return min(1, progress.positionSecs / progress.totalDurationSecs)
    }

    func hasProgress(_ book: BookListItem) -> Bool {
        book.audiobookEditionId.flatMap { audioProgress[$0] } != nil
            || book.ebookEditionId.flatMap { ebookProgress[$0] } != nil
    }

    func isDownloaded(_ book: BookListItem, model: AppModel) -> Bool {
        model.downloadedBookIds.contains(book.bookId)
    }

    // Each menu case is a distinct user action; splitting this exhaustive switch obscures it.
    // swiftlint:disable:next cyclomatic_complexity
    func handleMenu(_ action: BookCardMenuAction, book: BookListItem, model: AppModel) {
        guard !busyBookIds.contains(book.bookId), !(action.requiresConnection && model.isOffline) else { return }
        switch action {
        case .read:
            readingBook = book
        case .play:
            busyBookIds.insert(book.bookId)
            Task {
                await playAudiobook(book, model: model)
                busyBookIds.remove(book.bookId)
            }
        case .markRead:
            model.confirmBookAction(.markRead(book))
        case .resetProgress:
            model.confirmBookAction(.resetProgress(book))
        case .removeDownload:
            model.confirmBookAction(.removeDownload(book))
        case .download:
            if let editionId = book.audiobookEditionId {
                Task { await model.startDownload(editionId: editionId) }
            }
        case .markUnread:
            busyBookIds.insert(book.bookId)
            Task {
                await model.setBookRead(book, read: false)
                busyBookIds.remove(book.bookId)
            }
        case .addAudiobook:
            busyBookIds.insert(book.bookId)
            Task {
                await addEdition(book: book, kind: "audiobook", model: model)
                busyBookIds.remove(book.bookId)
            }
        case .addEbook:
            busyBookIds.insert(book.bookId)
            Task {
                await addEdition(book: book, kind: "ebook", model: model)
                busyBookIds.remove(book.bookId)
            }
        case .rescan:
            busyBookIds.insert(book.bookId)
            Task {
                await rescanBook(book, model: model)
                busyBookIds.remove(book.bookId)
            }
        }
    }

    private func playAudiobook(_ book: BookListItem, model: AppModel) async {
        guard let editionId = book.audiobookEditionId else { return }
        await model.openPlayer(editionId: editionId)
        if model.errorMessage == nil {
            showingPlayer = true
        } else {
            model.toast(model.errorMessage ?? String(localized: "Could not start playback."), style: .error)
        }
    }

    private func addEdition(book: BookListItem, kind: String, model: AppModel) async {
        guard let client = model.api() else { return }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
            let edition = kind == "audiobook" ? "audiobook" : "ebook"
            model.toast(String(localized: "Added \(edition) edition."), style: .success)
        } catch {
            model.toast(libraryErrorMessage(for: error), style: .error)
        }
    }

    private func rescanBook(_ book: BookListItem, model: AppModel) async {
        guard let client = model.api() else { return }
        do {
            if book.hasAudiobook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "audiobook")
            }
            if book.hasEbook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "ebook")
            }
            await model.loadLibrary()
            model.toast(String(localized: "Rescan started."), style: .success)
        } catch {
            model.toast(libraryErrorMessage(for: error), style: .error)
        }
    }
}
