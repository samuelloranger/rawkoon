import SwiftUI

/// Tab root. Deck-primary Discover (swipe triage of personalized/trending
/// picks) + TMDB/book search; a toolbar Filter button opens the paginated
/// `ExploreView` grid. Tap → MediaDetailView.
struct DiscoverView: View {
    @Environment(AppModel.self) private var model

    @State private var query = ""
    @State private var kindFilter: KindFilter = .all

    // MARK: Deck

    @State private var deckItems: [DiscoverDeckItem] = []
    @State private var deckSource: DiscoverSource?
    @State private var deckLoading = false
    @State private var deckError: String?
    /// Bumped on every fresh batch so `.id(deckBatch)` forces `SwipeDeck` to
    /// re-init its own local stack state instead of reusing stale offsets.
    @State private var deckBatch = 0
    /// tmdbIds already surfaced this session (acted on or merely shown), so a
    /// prefetch/exhausted refetch doesn't hand back a card already seen.
    @State private var excludedTmdbIds: Set<Int> = []
    /// Cards left in the on-screen deck, tracked from this side since
    /// `SwipeDeck` doesn't expose its remaining count — decremented on every
    /// action closure so a background prefetch can fire before the deck
    /// visibly runs dry.
    @State private var actionsRemaining = 0
    @State private var isPrefetching = false
    @State private var prefetchedBatch: DiscoverDeckResponse?
    @State private var openDeckItem: DiscoverDeckItem?

    @State private var showExplore = false

    @State private var searchResults: [TmdbSearchItem] = []
    @State private var bookResults: [BookSearchHit] = []
    @State private var loadingSearch = false
    @State private var searchError: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var addingVolumeId: String?
    @State private var requestingVolumeId: String?

    /// Cards still in the current batch before a prefetch kicks off.
    private let prefetchThreshold = 5

    private enum KindFilter: String, CaseIterable {
        case all = "All"
        case movies = "Movies"
        case tv = "TV"
        case books = "Books"

        var apiValue: String? {
            switch self {
            case .all: nil
            case .movies: "movie"
            case .tv: "tv"
            case .books: nil
            }
        }

        var title: LocalizedStringKey {
            switch self {
            case .all: "All"
            case .movies: "Movies"
            case .tv: "TV"
            case .books: "Books"
            }
        }

        var includesMoviesAndTV: Bool {
            self != .books
        }

        var includesBooks: Bool {
            self == .all || self == .books
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
                    deckContent
                }
            }
            .padding(.top, 12)
        }
        .background(Theme.base)
        .navigationTitle("Discover")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showExplore = true
                } label: {
                    Label("Filter", systemImage: "line.3.horizontal.decrease.circle")
                }
            }
        }
        .sheet(isPresented: $showExplore) {
            NavigationStack {
                ExploreView()
            }
        }
        .navigationDestination(item: $openDeckItem) { item in
            MediaDetailView(
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: item.title,
                posterPath: item.posterUrl,
                libraryId: nil
            )
        }
        .task {
            if deckItems.isEmpty, !deckLoading {
                await loadDeck()
            }
        }
        .refreshable {
            await loadDeck()
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
            TextField("Search movies, shows & books", text: $query)
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
                Text(kind.title).tag(kind)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
    }

    // MARK: Discover deck

    @ViewBuilder
    private var deckContent: some View {
        if !deckItems.isEmpty {
            SwipeDeck(
                items: deckItems,
                label: deckSource.map(deckLabel(for:)) ?? "",
                primaryActionTitle: model.isAdmin ? String(localized: "Add") : String(localized: "Request"),
                onDismiss: handleDismiss,
                onWatchlist: handleWatchlist,
                onPrimary: handlePrimary,
                onExhausted: handleExhausted,
                onOpen: { openDeckItem = $0 }
            )
            .id(deckBatch)
        } else if deckLoading {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
        } else if let deckError {
            ContentUnavailableView(
                "Couldn't load Discover",
                systemImage: "wifi.slash",
                description: Text(deckError)
            )
            .padding(.top, 16)
        } else {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "sparkles.rectangle.stack",
                description: Text("Check back soon for new releases.")
            )
            .padding(.top, 28)
        }
    }

    private func deckLabel(for source: DiscoverSource) -> String {
        switch source {
        case .personalized: String(localized: "For you")
        case .trending: String(localized: "Trending now")
        }
    }

    // MARK: Search grid

    private var searchGridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    @ViewBuilder
    private var searchContent: some View {
        if loadingSearch {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
        } else if let searchError {
            ContentUnavailableView(
                "Search failed",
                systemImage: "wifi.slash",
                description: Text(searchError)
            )
            .padding(.top, 16)
        } else if searchResults.isEmpty, bookResults.isEmpty {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "magnifyingglass",
                description: Text("Try a different title.")
            )
            .padding(.top, 28)
        } else {
            VStack(alignment: .leading, spacing: 20) {
                if !bookResults.isEmpty {
                    Text("Books")
                        .font(.display(17))
                        .foregroundStyle(Theme.textStrong)
                        .padding(.horizontal, 16)
                    ForEach(bookResults) { hit in
                        bookSearchRow(hit)
                            .padding(.horizontal, 16)
                    }
                }
                if !searchResults.isEmpty {
                    if !bookResults.isEmpty {
                        Text("Movies & TV")
                            .font(.display(17))
                            .foregroundStyle(Theme.textStrong)
                            .padding(.horizontal, 16)
                    }
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
        }
    }

    @ViewBuilder
    private func bookSearchRow(_ hit: BookSearchHit) -> some View {
        let inLibraryBook = hit.libraryBookId.flatMap { id in
            model.library.first { $0.bookId == id }
        }
        HStack(spacing: 12) {
            if let book = inLibraryBook {
                NavigationLink {
                    BookView(book: book)
                } label: {
                    bookSearchLabel(hit)
                }
                .buttonStyle(.plain)
            } else {
                bookSearchLabel(hit)
            }

            if hit.inLibrary {
                StatusBadge(text: "In library", tint: Theme.seed)
            } else if model.isAdmin {
                Button {
                    Task { await addBook(hit) }
                } label: {
                    if addingVolumeId == hit.googleVolumeId {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text("Add")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .padding(.horizontal, 12)
                .background(Theme.terracotta, in: Capsule())
                .foregroundStyle(Theme.onAccent)
                .disabled(addingVolumeId != nil)
            } else {
                Button {
                    Task { await requestBook(hit) }
                } label: {
                    if requestingVolumeId == hit.googleVolumeId {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text("Request")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .padding(.horizontal, 12)
                .background(Theme.terracotta, in: Capsule())
                .foregroundStyle(Theme.onAccent)
                .disabled(requestingVolumeId != nil)
            }
        }
    }

    private func bookSearchLabel(_ hit: BookSearchHit) -> some View {
        HStack(spacing: 12) {
            BookCover(url: model.absoluteURL(hit.coverUrl), size: 56, corner: 10)
            VStack(alignment: .leading, spacing: 4) {
                Text(hit.title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                if !hit.authors.isEmpty {
                    Text(hit.authors.joined(separator: ", "))
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                if let year = hit.publishedYear {
                    Text(String(year))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
            Spacer(minLength: 8)
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: Poster card

    /// A 2:3 poster with a status chip, plus a title caption below the image.
    /// Pass `fixedWidth` for a known point size; pass nil inside the search
    /// grid, where the LazyVGrid column already constrains the width and the
    /// view simply fills it while keeping the 2:3 ratio.
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
                .font(.caption)
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
                .foregroundStyle(Color(hex: 0x10231A))
                .frame(width: 22, height: 22)
                .background(Theme.seed, in: Circle())
                .accessibilityLabel("In library")
        }
    }

    // MARK: Deck data

    private func loadDeck() async {
        deckLoading = true
        deckError = nil
        defer { deckLoading = false }

        guard let client = model.api() else {
            deckError = String(localized: "Not signed in.")
            return
        }
        do {
            let response = try await client.discoverDeck(exclude: Array(excludedTmdbIds))
            applyBatch(response)
        } catch let error as APIError {
            deckError = message(for: error)
        } catch {
            deckError = String(localized: "Network error. Check your connection.")
        }
    }

    private func applyBatch(_ response: DiscoverDeckResponse) {
        deckItems = response.items
        deckSource = response.source
        actionsRemaining = response.items.count
        deckBatch += 1
        excludedTmdbIds.formUnion(response.items.map(\.tmdbId))
        prefetchedBatch = nil
    }

    /// Called from every deck action closure. Once the visible stack drops to
    /// `prefetchThreshold`, fetch the next batch in the background so
    /// `handleExhausted` can hand it over instantly instead of showing a
    /// loading spinner mid-swipe.
    private func trackAction() {
        actionsRemaining = max(0, actionsRemaining - 1)
        guard actionsRemaining == prefetchThreshold, !isPrefetching, prefetchedBatch == nil else { return }
        Task { await prefetchMore() }
    }

    private func prefetchMore() async {
        guard let client = model.api() else { return }
        isPrefetching = true
        defer { isPrefetching = false }
        if let response = try? await client.discoverDeck(exclude: Array(excludedTmdbIds)) {
            prefetchedBatch = response
        }
    }

    private func handleExhausted() {
        if let batch = prefetchedBatch, !batch.items.isEmpty {
            applyBatch(batch)
        } else {
            Task { await loadDeck() }
        }
    }

    private func handleDismiss(_ item: DiscoverDeckItem) {
        trackAction()
        excludedTmdbIds.insert(item.tmdbId)

        let tmdbId = item.tmdbId
        let type = item.mediaType
        Task {
            guard let client = model.api() else { return }
            try? await client.dismissDiscover(tmdbId: tmdbId, type: type)
        }

        model.toast(
            String(localized: "Not interested"),
            action: ToastAction(label: String(localized: "Undo")) {
                excludedTmdbIds.remove(tmdbId)
                Task {
                    guard let client = model.api() else { return }
                    try? await client.undismissDiscover(tmdbId: tmdbId, type: type)
                }
            }
        )
    }

    private func handleWatchlist(_ item: DiscoverDeckItem) {
        trackAction()
        Task {
            guard let client = model.api() else { return }
            do {
                try await client.addToWatchlist(
                    tmdbId: item.tmdbId,
                    mediaType: item.mediaType,
                    title: item.title,
                    posterURL: item.posterUrl,
                    overview: item.overview,
                    releaseYear: item.releaseYear,
                    voteAverage: item.voteAverage,
                    releaseDate: nil
                )
                model.toast(String(localized: "Added to watchlist"), style: .success)
            } catch let error as APIError {
                model.toast(message(for: error), style: .error)
            } catch {
                model.toast(String(localized: "Network error. Check your connection."), style: .error)
            }
        }
    }

    private func handlePrimary(_ item: DiscoverDeckItem) {
        trackAction()
        Task {
            guard let client = model.api() else { return }
            do {
                if model.isAdmin {
                    try await client.addToLibrary(
                        tmdbId: item.tmdbId,
                        type: item.mediaType == "tv" ? "show" : "movie"
                    )
                    await model.loadLibrary()
                    model.toast(String(localized: "Added to library"), style: .success)
                } else {
                    _ = try await client.createRequest(CreateRequestBody(
                        tmdbId: item.tmdbId,
                        type: item.mediaType == "tv" ? "show" : "movie",
                        title: item.title,
                        posterUrl: item.posterUrl,
                        year: item.releaseYear,
                        googleVolumeId: nil,
                        author: nil
                    ))
                    model.toast(String(localized: "Requested — we'll notify you"), style: .success)
                }
            } catch let error as APIError {
                model.toast(message(for: error), style: .error)
            } catch {
                model.toast(String(localized: "Network error. Check your connection."), style: .error)
            }
        }
    }

    // MARK: Search data

    private func scheduleSearch() {
        searchTask?.cancel()

        guard isSearching else {
            searchResults = []
            bookResults = []
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
            searchError = String(localized: "Not signed in.")
            return
        }

        var tmdb: [TmdbSearchItem] = []
        var books: [BookSearchHit] = []
        var firstError: String?

        if kind.includesMoviesAndTV {
            do {
                tmdb = try await client.tmdbSearch(q: query, kind: kind.apiValue).items
            } catch let error as APIError {
                firstError = message(for: error)
            } catch {
                firstError = String(localized: "Network error. Check your connection.")
            }
            guard !Task.isCancelled else { return }
        }

        if kind.includesBooks {
            do {
                books = try await client.bookSearch(q: query).results
            } catch let error as APIError {
                if firstError == nil {
                    firstError = message(for: error)
                }
            } catch {
                if firstError == nil {
                    firstError = String(localized: "Network error. Check your connection.")
                }
            }
            guard !Task.isCancelled else { return }
        }

        searchResults = tmdb
        bookResults = books
        if tmdb.isEmpty, books.isEmpty {
            searchError = firstError
        } else {
            searchError = nil
        }
    }

    private func addBook(_ hit: BookSearchHit) async {
        guard let client = model.api() else { return }
        addingVolumeId = hit.googleVolumeId
        defer { addingVolumeId = nil }
        do {
            try await client.addBook(googleVolumeId: hit.googleVolumeId)
            await model.loadLibrary()
            await runSearch(query: trimmedQuery, kind: kindFilter)
        } catch {
            searchError = String(localized: "Could not add that book.")
        }
    }

    private func requestBook(_ hit: BookSearchHit) async {
        guard let client = model.api() else { return }
        requestingVolumeId = hit.googleVolumeId
        defer { requestingVolumeId = nil }
        do {
            _ = try await client.createRequest(CreateRequestBody(
                tmdbId: nil,
                type: "book",
                title: hit.title,
                posterUrl: hit.coverUrl,
                year: hit.publishedYear,
                googleVolumeId: hit.googleVolumeId,
                author: hit.authors.isEmpty ? nil : hit.authors.joined(separator: ", ")
            ))
            model.toast(String(localized: "Requested — we'll notify you"), style: .success)
        } catch let error as APIError {
            model.toast(message(for: error), style: .error)
        } catch {
            model.toast(String(localized: "Network error. Check your connection."), style: .error)
        }
    }

    private func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}
