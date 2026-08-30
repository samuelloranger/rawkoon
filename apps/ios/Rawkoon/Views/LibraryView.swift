import SwiftUI

private enum LibraryTab: String, CaseIterable, Identifiable {
    case movies = "Movies"
    case tv = "TV"
    case books = "Books"
    var id: String { rawValue }
}

struct LibraryView: View {
    @EnvironmentObject private var model: AppModel

    @State private var tab: LibraryTab = .movies

    @State private var movies: [LibraryMedia] = []
    @State private var loadingMovies = false
    @State private var moviesError: String?
    @State private var loadedMoviesOnce = false

    @State private var shows: [LibraryMedia] = []
    @State private var loadingShows = false
    @State private var showsError: String?
    @State private var loadedShowsOnce = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Library", selection: $tab) {
                ForEach(LibraryTab.allCases) { t in
                    Text(t.rawValue).tag(t)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 4)

            content
        }
        .background(Theme.base)
        .navigationTitle("Library")
        .task(id: tab) {
            switch tab {
            case .movies:
                if !loadedMoviesOnce { await loadMovies() }
            case .tv:
                if !loadedShowsOnce { await loadShows() }
            case .books:
                if model.library.isEmpty { await model.loadLibrary() }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .movies:
            mediaGrid(
                items: movies,
                loading: loadingMovies,
                error: moviesError,
                emptyTitle: "No movies yet",
                emptyIcon: "film",
                mediaType: "movie",
                refresh: { await loadMovies(force: true) }
            )
        case .tv:
            mediaGrid(
                items: shows,
                loading: loadingShows,
                error: showsError,
                emptyTitle: "No TV shows yet",
                emptyIcon: "tv",
                mediaType: "tv",
                refresh: { await loadShows(force: true) }
            )
        case .books:
            booksList
        }
    }

    // MARK: Movies / TV grid

    private func mediaGrid(
        items: [LibraryMedia],
        loading: Bool,
        error: String?,
        emptyTitle: String,
        emptyIcon: String,
        mediaType: String,
        refresh: @escaping () async -> Void
    ) -> some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 16) {
                ForEach(items) { m in
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: m.tmdbId,
                            mediaType: mediaType,
                            title: m.title,
                            posterPath: m.posterUrl,
                            libraryId: m.id
                        )
                    } label: {
                        MediaPosterCell(item: m, mediaType: mediaType)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Theme.base)
        .overlay {
            if loading && items.isEmpty {
                ProgressView().tint(Theme.apricot)
            } else if let error, items.isEmpty {
                ContentUnavailableView(
                    "Couldn't load",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error)
                )
            } else if !loading && error == nil && items.isEmpty {
                ContentUnavailableView(
                    emptyTitle,
                    systemImage: emptyIcon,
                    description: Text("Titles added on your Rawkoon server show up here.")
                )
            }
        }
        .refreshable {
            await refresh()
        }
    }

    private func loadMovies(force: Bool = false) async {
        guard let client = model.api() else { return }
        if loadingMovies { return }
        loadingMovies = true
        moviesError = nil
        defer {
            loadingMovies = false
            loadedMoviesOnce = true
        }
        do {
            let response = try await client.libraryList(type: "movie")
            movies = response.items
        } catch {
            moviesError = errorMessage(for: error)
        }
    }

    private func loadShows(force: Bool = false) async {
        guard let client = model.api() else { return }
        if loadingShows { return }
        loadingShows = true
        showsError = nil
        defer {
            loadingShows = false
            loadedShowsOnce = true
        }
        do {
            let response = try await client.libraryList(type: "show")
            shows = response.items
        } catch {
            showsError = errorMessage(for: error)
        }
    }

    private func errorMessage(for error: Error) -> String {
        guard let apiError = error as? APIError else {
            return "Unexpected error. Please try again."
        }
        switch apiError {
        case .unauthorized:
            return "Admin only."
        case let .http(status):
            return "Server error (\(status))."
        case .decode:
            return "Could not parse server response."
        case .transport:
            return "Network error. Check your connection."
        }
    }

    // MARK: Books (unchanged behavior)

    private var booksList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(model.library) { item in
                    NavigationLink {
                        BookView(summary: item)
                    } label: {
                        LibraryRow(item: item, downloaded: isDownloaded(item))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
        .background(Theme.base)
        .overlay {
            if model.loading && model.library.isEmpty {
                ProgressView().tint(Theme.apricot)
            } else if !model.loading && model.library.isEmpty {
                ContentUnavailableView(
                    "No books yet",
                    systemImage: "books.vertical",
                    description: Text("Books added on your Rawkoon server show up here.")
                )
            }
        }
        .refreshable {
            await model.loadLibrary()
        }
    }

    private func isDownloaded(_ item: LibrarySummary) -> Bool {
        model.downloadPlans[item.editionId]?.isComplete == true
    }
}

private struct MediaPosterCell: View {
    @EnvironmentObject private var model: AppModel
    let item: LibraryMedia
    let mediaType: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                AsyncImage(url: model.absoluteURL(item.posterUrl)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Theme.raised
                }
                .aspectRatio(2 / 3, contentMode: .fill)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1)
                )

                badge
                    .padding(6)
            }

            Text(item.title)
                .font(.subheadline)
                .foregroundStyle(Theme.text)
                .lineLimit(2)

            if mediaType == "tv" {
                Text("\(item.downloadedEpisodeCount ?? 0)/\(item.episodeCount ?? 0)")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    @ViewBuilder
    private var badge: some View {
        switch item.status {
        case "downloading":
            StatusBadge(text: "DL", tint: Theme.apricot)
        case "downloaded":
            StatusBadge(text: "✓", tint: Theme.seed)
        default:
            EmptyView()
        }
    }
}

private struct LibraryRow: View {
    let item: LibrarySummary
    let downloaded: Bool

    var body: some View {
        HStack(spacing: 12) {
            BookCover(url: item.coverURL, size: 56, corner: 10)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                if let author = item.author, !author.isEmpty {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 12)

            if downloaded {
                StatusBadge(text: "Offline", tint: Theme.seed)
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1)
        )
    }
}
