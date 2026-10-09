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
    /// The item couldn't be fetched because the server was out of reach, not gone.
    @State private var unreachable = false

    var body: some View {
        content
            // Keyed to `destination`: the deep-link sheet can switch target
            // (banner→push) while this view stays alive; an unkeyed task would
            // not reload and would show the previous target's detail.
            .task(id: destination) { await load() }
            .onChange(of: model.isOffline) { _, offline in
                guard !offline, unreachable else { return }
                loading = true
                Task { await load() }
            }
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
        case .transcode:
            ReencodeAdminView()
        }
    }

    private var statusView: some View {
        Group {
            if loading {
                ProgressView().tint(Theme.muted)
            } else if unreachable {
                ContentUnavailableView {
                    if model.isOffline {
                        Label("You're offline", systemImage: "wifi.slash")
                    } else {
                        Label("Can't reach the server", systemImage: "wifi.slash")
                    }
                } description: {
                    Text("This will open once the connection is back.")
                }
                .rawkoonLivingSymbol(.error)
            } else {
                ContentUnavailableView(
                    "Couldn't open this",
                    systemImage: "questionmark.circle",
                    description: Text("This notification's item is no longer available.")
                )
                .rawkoonLivingSymbol(.error)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.base)
    }

    private func load() async {
        defer { loading = false }
        unreachable = false
        switch destination {
        case let .media(libraryId, _, _, _):
            guard let client = model.api() else { return }
            // Only the ids are used, so a saved copy opens the detail without a fetch.
            if let known = model.serverStateStore.libraryItem(libraryId).value
                ?? client.cachedLibraryItem(id: libraryId)?.value
            {
                libraryMedia = known
                return
            }
            do {
                libraryMedia = try await client.libraryItem(id: libraryId)
            } catch {
                libraryMedia = nil
                unreachable = model.isOffline || (error as? APIError)?.isNetworkFailure == true
            }
        case let .book(bookId):
            if model.library.isEmpty {
                await model.ensureLibraryLoaded()
            }
            if let found = model.library.first(where: { $0.bookId == bookId }) {
                bookItem = found
            } else {
                // Not in the cached list — a book grabbed/downloaded after the
                // library was last loaded won't be there yet. Refresh once and
                // retry before falling back to the "unavailable" message.
                await model.loadLibrary()
                bookItem = model.library.first { $0.bookId == bookId }
                unreachable = bookItem == nil && model.isOffline
            }
        case .requests, .transcode:
            break
        }
    }
}
