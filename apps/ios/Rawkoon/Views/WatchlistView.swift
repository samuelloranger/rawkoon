import SwiftUI

/// The titles the user bookmarked from Discover and Explore, newest first.
struct WatchlistView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var hSizeClass

    @State private var items: [WatchlistItem] = []
    @State private var loading = true
    @State private var error: String?

    private var gridColumns: [GridItem] {
        if hSizeClass == .regular {
            return [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: 12)]
        }
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    var body: some View {
        ScrollView {
            content
                .padding(.top, 12)
                .padding(.bottom, 32)
        }
        .reportsTabBarScroll()
        .refreshable { await load() }
        .background(Theme.base)
        .navigationTitle("Watchlist")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: model.isOffline) { _, offline in
            guard !offline, items.isEmpty || error != nil else { return }
            Task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        if loading, items.isEmpty {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(0 ..< 12, id: \.self) { _ in
                    ShimmerView(cornerRadius: 10)
                        .aspectRatio(2.0 / 3.0, contentMode: .fit)
                }
            }
            .padding(.horizontal, 16)
        } else if items.isEmpty, error != nil, model.isOffline {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .padding(.top, 16)
        } else if items.isEmpty, let error {
            ContentUnavailableView(
                "Couldn't load your watchlist",
                systemImage: "wifi.slash",
                description: Text(error)
            )
            .padding(.top, 16)
        } else if items.isEmpty {
            ContentUnavailableView(
                "Nothing on your watchlist",
                systemImage: "bookmark",
                description: Text("Bookmark a movie or show and it will wait here.")
            )
            .padding(.top, 28)
        } else {
            grid
        }
    }

    private var grid: some View {
        LazyVGrid(columns: gridColumns, spacing: 14) {
            ForEach(items) { item in
                NavigationLink {
                    MediaDetailView(
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterPath: item.posterUrl,
                        libraryId: nil
                    )
                } label: {
                    MediaPosterCard(title: item.title, posterURL: model.absoluteURL(item.posterUrl))
                }
                .buttonStyle(.rawkoonPressable)
                .contextMenu {
                    Button(role: .destructive) {
                        Task { await remove(item) }
                    } label: {
                        Label("Remove from watchlist", systemImage: "bookmark.slash")
                    }
                    .requiresConnection(model.isOffline)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func load() async {
        guard let client = model.api() else {
            error = String(localized: "Not signed in.")
            loading = false
            return
        }
        do {
            items = try await client.watchlist()
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func remove(_ item: WatchlistItem) async {
        guard let client = model.api() else { return }
        do {
            try await client.removeFromWatchlist(tmdbId: item.tmdbId, mediaType: item.mediaType)
            items.removeAll { $0.id == item.id }
        } catch {
            model.toast(error.localizedDescription, style: .error)
        }
    }
}
