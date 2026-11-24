import RawkoonKit
import SwiftUI

extension ContinueListeningView {
    func open(_ item: ContinueItem) async {
        openingID = item.id
        defer { openingID = nil }

        switch item {
        case let .audiobook(audiobook):
            // The card's position is a snapshot; the loaded book is already past it.
            let resumeAt = model.activeEditionId == audiobook.editionId ? nil : audiobook.positionSecs
            await model.openPlayer(editionId: audiobook.editionId, resumeAt: resumeAt)
            if let error = model.session.errorMessage {
                model.toast(error, style: .error)
            } else {
                showingPlayer = true
            }

        case let .ebook(ebook):
            do {
                previewDocument = try await ebookDocument(for: ebook)
            } catch EbookContinueError.missingRemoteURL {
                model.toast(String(localized: "This server version cannot provide ebook download links yet."), style: .error)
            } catch let error as APIError {
                model.toast(message(for: error), style: .error)
            } catch {
                model.toast(String(localized: "Could not open this ebook yet. Pull to refresh and retry."), style: .error)
            }
        }
    }

    func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            String(localized: "Sign in required.")
        case .forbidden:
            String(localized: "You don't have permission to do that.")
        case let .http(status):
            status == 404
                ? String(localized: "No ebook files are available yet for this book.")
                : String(localized: "Couldn't reach the server (\(status)).")
        case let .server(_, message):
            message
        case .decode:
            String(localized: "Could not parse server response.")
        case .transport:
            String(localized: "Can't reach the server. Try again in a moment.")
        case .offline:
            String(localized: "You're offline. This needs a connection.")
        }
    }

    func libraryBook(for item: ContinueItem) -> BookListItem? {
        switch item {
        case let .audiobook(audiobook):
            model.libraryStore.library.first { $0.audiobookEditionId == audiobook.editionId }
        case let .ebook(ebook):
            model.libraryStore.library.first { $0.bookId == ebook.bookId }
        }
    }

    func menuItems(for item: ContinueItem) -> [BookCardMenuAction] {
        guard let book = libraryBook(for: item) else { return [] }
        return bookCardMenuItems(
            hasAudiobook: book.hasAudiobook,
            hasEbook: book.hasEbook,
            isAdmin: model.isAdmin,
            isRead: book.isRead,
            hasProgress: true,
            audiobookDownloaded: book.audiobookEditionId
                .map { model.downloads.downloadPlans[$0]?.isComplete == true } ?? false
        )
    }

    func handleMenu(_ action: BookCardMenuAction, item: ContinueItem) {
        guard let book = libraryBook(for: item), !(action.requiresConnection && model.isOffline) else { return }
        switch action {
        case .read:
            if case .ebook = item {
                Task { await open(item) }
            } else {
                readingBook = book
            }
        case .play:
            if case .audiobook = item {
                Task { await open(item) }
            } else if let editionId = book.audiobookEditionId {
                guard !busyIds.contains(item.id) else { return }
                busyIds.insert(item.id)
                Task {
                    await model.openPlayer(editionId: editionId)
                    if model.session.errorMessage == nil {
                        showingPlayer = true
                    } else {
                        model.toast(
                            model.session.errorMessage ?? String(localized: "Could not start playback."), style: .error
                        )
                    }
                    busyIds.remove(item.id)
                }
            }
        case .addAudiobook:
            guard !busyIds.contains(item.id) else { return }
            busyIds.insert(item.id)
            Task {
                await addEdition(book: book, kind: "audiobook")
                busyIds.remove(item.id)
            }
        case .addEbook:
            guard !busyIds.contains(item.id) else { return }
            busyIds.insert(item.id)
            Task {
                await addEdition(book: book, kind: "ebook")
                busyIds.remove(item.id)
            }
        case .rescan:
            guard !busyIds.contains(item.id) else { return }
            busyIds.insert(item.id)
            Task {
                await rescanBook(book)
                busyIds.remove(item.id)
            }
        case .markRead:
            model.confirmBookAction(.markRead(book)) { await load() }
        case .resetProgress:
            model.confirmBookAction(.resetProgress(book)) { await load() }
        case .removeDownload:
            model.confirmBookAction(.removeDownload(book)) { await load() }
        case .download:
            if let editionId = book.audiobookEditionId {
                Task { await model.downloads.startDownload(editionId: editionId) }
            }
        case .markUnread:
            Task {
                await model.setBookRead(book, read: false)
                await load()
            }
        }
    }

    func addEdition(book: BookListItem, kind: String) async {
        guard let client = model.api() else { return }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.libraryStore.loadLibrary()
            await load()
            model.toast(String(localized: "Added \(kind == "audiobook" ? "audiobook" : "ebook") edition."), style: .success)
        } catch let error as APIError {
            model.toast(message(for: error), style: .error)
        } catch {
            model.toast(String(localized: "Could not add that edition."), style: .error)
        }
    }

    func rescanBook(_ book: BookListItem) async {
        guard let client = model.api() else { return }
        do {
            if book.hasAudiobook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "audiobook")
            }
            if book.hasEbook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "ebook")
            }
            await model.libraryStore.loadLibrary()
            await load()
            model.toast(String(localized: "Rescan started."), style: .success)
        } catch let error as APIError {
            model.toast(message(for: error), style: .error)
        } catch {
            model.toast(String(localized: "Could not rescan this book."), style: .error)
        }
    }
}
