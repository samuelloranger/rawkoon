import SwiftUI

/// Resolves an `AppModel.deepLinkTarget` into the concrete pushed screen.
///
/// `NotificationDestination` only carries ids (whatever the notification's
/// `url` encoded); this view does the async fetch each destination needs to
/// build its real screen — `MediaDetailView` wants a TMDB id/type/title, not
/// just a library row id, and `BookView` wants a `BookListItem`. A fetch
/// failure or unmapped id falls back to a plain message rather than a crash
/// or a dead-end push (spec T6: never crash, never open a web view).
struct NotificationDestinationView: View {
    @Environment(AppModel.self) private var model
    let destination: NotificationDestination

    @State private var libraryMedia: LibraryMedia?
    @State private var bookItem: BookListItem?
    @State private var loading = true

    var body: some View {
        content
            .task { await load() }
    }

    @ViewBuilder private var content: some View {
        switch destination {
        case let .media(_, _, _, focusManagement):
            if let libraryMedia {
                MediaDetailView(
                    tmdbId: libraryMedia.tmdbId,
                    mediaType: libraryMedia.type == "show" ? "tv" : "movie",
                    title: libraryMedia.title,
                    posterPath: libraryMedia.posterUrl,
                    libraryId: libraryMedia.id,
                    focusManagement: focusManagement
                )
            } else {
                statusView
            }
        case .book:
            if let bookItem {
                BookView(book: bookItem)
            } else {
                statusView
            }
        case .requests:
            RequestsView()
        }
    }

    private var statusView: some View {
        Group {
            if loading {
                ProgressView().tint(Theme.muted)
            } else {
                ContentUnavailableView(
                    "Couldn't open this",
                    systemImage: "questionmark.circle",
                    description: Text("This notification's item is no longer available.")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.base)
    }

    private func load() async {
        defer { loading = false }
        switch destination {
        case let .media(libraryId, _, _, _):
            guard let client = model.api() else { return }
            libraryMedia = try? await client.libraryItem(id: libraryId)
        case let .book(bookId):
            if model.library.isEmpty {
                await model.ensureLibraryLoaded()
            }
            bookItem = model.library.first { $0.bookId == bookId }
        case .requests:
            break
        }
    }
}
