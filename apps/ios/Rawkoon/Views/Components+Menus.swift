import RawkoonKit
import SwiftUI

/// A destructive book action waiting on the user's confirmation.
enum PendingBookConfirm: Identifiable {
    case markRead(BookListItem)
    case resetProgress(BookListItem)
    case removeDownload(BookListItem)

    var id: String {
        switch self {
        case let .markRead(book): "read-\(book.bookId)"
        case let .resetProgress(book): "reset-\(book.bookId)"
        case let .removeDownload(book): "remove-\(book.bookId)"
        }
    }

    var title: String {
        switch self {
        case .markRead: String(localized: "Mark as read?")
        case .resetProgress: String(localized: "Reset progress?")
        case .removeDownload: String(localized: "Remove downloaded audiobook?")
        }
    }

    var message: String {
        switch self {
        case .markRead: String(localized: "This resets ebook and audiobook progress.")
        case .resetProgress: String(localized: "Clears ebook and audiobook progress. The read badge stays.")
        case .removeDownload:
            // Keep the localizable message in one literal.
            // swiftlint:disable:next line_length
            String(localized: "Deletes the offline chapters from this iPhone. Playback will need the network until you download them again.")
        }
    }

    var confirmLabel: String {
        switch self {
        case .markRead: String(localized: "Mark as read")
        case .resetProgress: String(localized: "Reset progress")
        case .removeDownload: String(localized: "Remove Download")
        }
    }
}

/// The trailing "…" menu on the book detail screen; same actions as the card long-press.
struct BookActionsMenu: View {
    let items: [BookCardMenuAction]
    let onAction: (BookCardMenuAction) -> Void

    var body: some View {
        Menu {
            ForEach(items, id: \.self) { action in
                bookCardMenuButton(action, perform: onAction)
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel(Text("More"))
    }
}

extension AppModel {
    /// Goes through the root-level alert: one raised from a zoom-pushed screen stays hidden.
    func confirmBookAction(_ pending: PendingBookConfirm, onDone: @escaping () async -> Void = {}) {
        let destructive: Bool
        let run: @MainActor () -> Void
        switch pending {
        case let .markRead(book):
            destructive = false
            run = { [self] in
                Task {
                    await setBookRead(book, read: true)
                    await onDone()
                }
            }
        case let .resetProgress(book):
            destructive = false
            run = { [self] in
                Task {
                    await resetBookProgress(book)
                    await onDone()
                }
            }
        case let .removeDownload(book):
            destructive = true
            run = { [self] in
                if let editionId = book.audiobookEditionId {
                    downloads.removeDownload(editionId: editionId)
                }
                Task { await onDone() }
            }
        }
        router.pendingConfirm = ConfirmRequest(
            title: pending.title,
            message: pending.message,
            confirmTitle: pending.confirmLabel,
            isDestructive: destructive,
            action: run
        )
    }
}

struct ReleaseSearchPresentation: Identifiable {
    let query: String
    let libraryMediaId: Int?
    let tmdbId: Int
    let mediaType: String

    var id: String {
        "\(mediaType)-\(tmdbId)-\(libraryMediaId ?? 0)"
    }
}

extension View {
    @ViewBuilder
    func bookCardContextMenu(
        items: [BookCardMenuAction],
        onAction: @escaping (BookCardMenuAction) -> Void
    ) -> some View {
        if items.isEmpty {
            self
        } else {
            contextMenu {
                ForEach(items, id: \.self) { action in
                    bookCardMenuButton(action, perform: onAction)
                }
            }
        }
    }

    /// Same keep-files / delete-files choice MediaDetailView's remove flow uses.
    func libraryRemoveConfirmation(
        isPresented: Binding<Bool>,
        title: String,
        onConfirm: @escaping (_ deleteFiles: Bool) -> Void
    ) -> some View {
        rawkoonConfirm("Remove from library?", isPresented: isPresented) {
            Button("Remove, keep files") { onConfirm(false) }
            Button("Remove and delete files", role: .destructive) { onConfirm(true) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("“\(title)” will leave your library. Deleting files also removes them from disk.")
        }
    }

    /// Window-level confirm. iOS 26's `confirmationDialog` is a popover anchored
    /// to this view — on a ScrollView that lands off-screen or on the wrong row.
    func rawkoonConfirm(
        _ title: LocalizedStringKey,
        isPresented: Binding<Bool>,
        @ViewBuilder actions: () -> some View
    ) -> some View {
        alert(title, isPresented: isPresented, actions: actions)
    }

    func rawkoonConfirm(
        _ title: LocalizedStringKey,
        isPresented: Binding<Bool>,
        @ViewBuilder actions: () -> some View,
        @ViewBuilder message: () -> some View
    ) -> some View {
        alert(title, isPresented: isPresented, actions: actions, message: message)
    }

    func rawkoonConfirm<T>(
        _ title: LocalizedStringKey,
        isPresented: Binding<Bool>,
        presenting data: T?,
        @ViewBuilder actions: (T) -> some View,
        @ViewBuilder message: (T) -> some View
    ) -> some View {
        alert(title, isPresented: isPresented, presenting: data, actions: actions, message: message)
    }
}

/// Greyed rather than hidden offline, so the menu keeps its shape and says why.
func mediaPosterMenuButton(
    _ action: MediaPosterMenuAction,
    perform: @escaping (MediaPosterMenuAction) -> Void
) -> some View {
    mediaPosterMenuButtonContent(action, perform: perform)
        .disabled(action.requiresConnection && AppModel.shared.isOffline)
}

@ViewBuilder
private func mediaPosterMenuButtonContent(
    _ action: MediaPosterMenuAction,
    perform: @escaping (MediaPosterMenuAction) -> Void
) -> some View {
    switch action {
    case .toggleMonitored:
        Button { perform(action) } label: {
            Label("Toggle monitored", systemImage: "antenna.radiowaves.left.and.right")
        }
    case .autoSearch:
        Button { perform(action) } label: {
            Label("Auto search", systemImage: "bolt.fill")
        }
    case .searchReleases:
        Button { perform(action) } label: {
            Label("Search releases", systemImage: "magnifyingglass")
        }
    case .openDetails:
        Button { perform(action) } label: {
            Label("Open details", systemImage: "info.circle")
        }
    case .removeFromLibrary:
        Button(role: .destructive) { perform(action) } label: {
            Label("Remove from library", systemImage: "trash")
        }
    }
}

private func bookCardMenuButton(
    _ action: BookCardMenuAction,
    perform: @escaping (BookCardMenuAction) -> Void
) -> some View {
    bookCardMenuButtonContent(action, perform: perform)
        .disabled(action.requiresConnection && AppModel.shared.isOffline)
}

@ViewBuilder
private func bookCardMenuButtonContent(
    _ action: BookCardMenuAction,
    perform: @escaping (BookCardMenuAction) -> Void
) -> some View {
    switch action {
    case .read:
        Button { perform(action) } label: {
            Label("Read", systemImage: "book.pages")
        }
    case .play:
        Button { perform(action) } label: {
            Label("Play", systemImage: "play.fill")
        }
    case .markRead:
        Button { perform(action) } label: {
            Label("Mark as read", systemImage: "checkmark.circle")
        }
    case .markUnread:
        Button { perform(action) } label: {
            Label("Mark as unread", systemImage: "checkmark.circle.badge.minus")
        }
    case .resetProgress:
        Button { perform(action) } label: {
            Label("Reset progress", systemImage: "arrow.counterclockwise")
        }
    case .download:
        Button { perform(action) } label: {
            Label("Download", systemImage: "arrow.down.circle")
        }
    case .removeDownload:
        Button(role: .destructive) { perform(action) } label: {
            Label("Remove download", systemImage: "trash")
        }
    case .addAudiobook:
        Button { perform(action) } label: {
            Label("Add audiobook", systemImage: "plus.circle")
        }
    case .addEbook:
        Button { perform(action) } label: {
            Label("Add ebook", systemImage: "plus.circle")
        }
    case .rescan:
        Button { perform(action) } label: {
            Label("Rescan", systemImage: "arrow.clockwise")
        }
    }
}
