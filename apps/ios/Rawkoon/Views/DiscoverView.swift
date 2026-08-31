import SwiftUI

// Tab root. Explore feed + TMDB search + poster grid; tap → MediaDetailView.
struct DiscoverView: View {
    @EnvironmentObject private var model: AppModel

    @State private var query = ""
    @State private var kindFilter: KindFilter = .all

    @State private var feed: ExploreFeed?
    @State private var loadingFeed = false
    @State private var feedError: String?

    @State private var searchResults: [TmdbSearchItem] = []
    @State private var loadingSearch = false
    @State private var searchError: String?
    @State private var searchTask: Task<Void, Never>?

    private enum KindFilter: String, CaseIterable {
        case all = "All"
        case movies = "Movies"
        case tv = "TV"

        var apiValue: String? {
            switch self {
            case .all: return nil
            case .movies: return "movie"
            case .tv: return "tv"
            }
        }
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearching: Bool {
        trimmedQuery.count >= 2
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                searchField

                if isSearching {
                    kindPicker
                    searchContent
                } else {
                    feedContent
                }
            }
            .padding(.top, 12)
            .padding(.bottom, 96)
        }
        .background(Theme.base)
        .navigationTitle("Discover")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if feed == nil {
                await loadFeed()
            }
        }
        .onChange(of: query) { _, _ in
            scheduleSearch()
        }
        .onChange(of: kindFilter) { _, _ in
            scheduleSearch()
        }
    }

    // MARK: Search field

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.muted)
            TextField("Search movies & shows", text: $query)
                .foregroundStyle(Theme.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.faint)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private var kindPicker: some View {
        Picker("Kind", selection: $kindFilter) {
            ForEach(KindFilter.allCases, id: \.self) { kind in
                Text(kind.rawValue).tag(kind)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
    }

    // MARK: Explore feed

    @ViewBuilder
    private var feedContent: some View {
        if loadingFeed {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
        } else if let feedError {
            ContentUnavailableView(
                "Couldn't load Discover",
                systemImage: "wifi.slash",
                description: Text(feedError)
            )
            .padding(.top, 16)
        } else if let feed, !feed.sections.isEmpty {
            VStack(alignment: .leading, spacing: 24) {
                ForEach(feed.sections, id: \.title) { section in
                    rail(title: section.title, items: section.items)
                }
            }
        } else {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "sparkles.rectangle.stack",
                description: Text("Check back soon for new releases.")
            )
            .padding(.top, 28)
        }
    }

    private func rail(title: String, items: [TmdbSearchItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.display(17))
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in
                        NavigationLink {
                            MediaDetailView(
                                tmdbId: item.tmdbId,
                                mediaType: item.mediaType,
                                title: item.title,
                                posterPath: item.posterUrl,
                                libraryId: item.libraryId
                            )
                        } label: {
                            posterCard(item, fixedWidth: 110)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: Search grid

    private var searchGridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    @ViewBuilder
    private var searchContent: some View {
        if loadingSearch {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
        } else if let searchError {
            ContentUnavailableView(
                "Search failed",
                systemImage: "wifi.slash",
                description: Text(searchError)
            )
            .padding(.top, 16)
        } else if searchResults.isEmpty {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "magnifyingglass",
                description: Text("Try a different title.")
            )
            .padding(.top, 28)
        } else {
            LazyVGrid(columns: searchGridColumns, spacing: 14) {
                ForEach(searchResults) { item in
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            title: item.title,
                            posterPath: item.posterUrl,
                            libraryId: item.libraryId
                        )
                    } label: {
                        posterCard(item, fixedWidth: nil)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: Poster card

    /// A 2:3 poster with a status chip, plus a title caption below the image.
    /// Pass `fixedWidth` for the horizontal rails (a known point size); pass
    /// nil inside the search grid, where the LazyVGrid column already
    /// constrains the width and the view simply fills it while keeping the
    /// 2:3 ratio.
    @ViewBuilder
    private func posterCard(_ item: TmdbSearchItem, fixedWidth: CGFloat?) -> some View {
        let image = AsyncImage(url: model.absoluteURL(item.posterUrl)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Theme.raised
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .topTrailing) {
            statusChip(item)
                .padding(6)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.06), lineWidth: 1)
        )

        VStack(alignment: .leading, spacing: 6) {
            if let fixedWidth {
                image.frame(width: fixedWidth, height: fixedWidth * 1.5)
            } else {
                image.aspectRatio(2.0 / 3.0, contentMode: .fit)
            }

            Text(item.title)
                .font(.display(13))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(height: 34, alignment: .top)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(width: fixedWidth)
    }

    @ViewBuilder
    private func statusChip(_ item: TmdbSearchItem) -> some View {
        if item.alreadyExists == true {
            Image(systemName: "checkmark")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.onAccent)
                .padding(5)
                .background(Theme.seed, in: Circle())
        } else {
            Image(systemName: "plus")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.onAccent)
                .padding(5)
                .background(Theme.apricot.opacity(0.9), in: Circle())
        }
    }

    // MARK: Data

    private func loadFeed() async {
        loadingFeed = true
        feedError = nil
        defer { loadingFeed = false }

        guard let client = model.api() else {
            feedError = "Not signed in."
            return
        }
        do {
            feed = try await client.explore()
        } catch let error as APIError {
            feedError = message(for: error)
        } catch {
            feedError = "Network error. Check your connection."
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()

        guard isSearching else {
            searchResults = []
            searchError = nil
            loadingSearch = false
            return
        }

        let currentQuery = trimmedQuery
        let currentKind = kindFilter
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await runSearch(query: currentQuery, kind: currentKind)
        }
    }

    private func runSearch(query: String, kind: KindFilter) async {
        loadingSearch = true
        searchError = nil
        defer { loadingSearch = false }

        guard let client = model.api() else {
            searchError = "Not signed in."
            return
        }
        do {
            let response = try await client.tmdbSearch(q: query, kind: kind.apiValue)
            guard !Task.isCancelled else { return }
            searchResults = response.items
        } catch let error as APIError {
            guard !Task.isCancelled else { return }
            searchError = message(for: error)
        } catch {
            guard !Task.isCancelled else { return }
            searchError = "Network error. Check your connection."
        }
    }

    private func message(for error: APIError) -> String {
        switch error {
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
}
