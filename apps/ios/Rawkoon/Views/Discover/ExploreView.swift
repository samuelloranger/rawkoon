import RawkoonKit
import SwiftUI

/// Filter state for `ExploreView` / `ExploreFilterSheet`. Provider and genre
/// hold the full TMDB object (not just an id) so the active-filter chip row
/// can show a name without a second lookup.
struct ExploreFilters: Equatable {
    enum Kind: String, CaseIterable, Identifiable, Sendable {
        case movie
        case tv

        var id: String {
            rawValue
        }

        var apiValue: String {
            rawValue
        }

        var label: LocalizedStringKey {
            switch self {
            case .movie: "Movies"
            case .tv: "TV"
            }
        }
    }

    var kind: Kind = .movie
    var provider: StreamingProvider?
    var genre: Genre?
    var sort: DiscoverSort = .popularityDesc
    var originalLanguageOnly = false

    init(kind: Kind = .movie) {
        self.kind = kind
    }

    /// Whether every filter but `kind` is at its default — drives the sheet's
    /// Reset button and whether the chip row has anything to show.
    var isDefault: Bool {
        provider == nil && genre == nil && sort == .popularityDesc && !originalLanguageOnly
    }
}

/// A filterable, paginated TMDB discover grid — the "browse everything"
/// counterpart to the swipe deck — with the movies, shows and books search on top.
struct ExploreView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var hSizeClass

    /// True when hosted inline (Mac split view) rather than in a sheet: hides the
    /// Done button, since there's nothing to dismiss.
    var embedded = false

    @State private var filters = ExploreFilters()
    @State private var query = ""
    @State private var items: [TmdbSearchItem] = []
    @State private var page = 1
    @State private var totalPages = 1
    @State private var totalResults = 0

    @State private var loading = false
    @State private var loadingMore = false
    @State private var error: String?
    @State private var loadMoreError: String?
    @State private var showFilters = false
    /// Bumped every time filters change so a `loadFirstPage`/`loadMore` still
    /// in flight from the previous filters discards its response instead of
    /// appending stale-filter pages onto the new grid.
    @State private var loadGeneration = 0
    /// Ties each active chip to its glass shape, so adding or clearing one morphs inside the container.
    @Namespace private var chipNamespace

    private var gridColumns: [GridItem] {
        if hSizeClass == .regular {
            return [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: 12)]
        }
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    var body: some View {
        Group {
            if hSizeClass == .regular {
                regularLayout
            } else {
                gridScroll
            }
        }
        .background(Theme.base)
        .navigationTitle("Explore")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !embedded {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            // The inline filter panel on regular width replaces the Filters sheet.
            if hSizeClass != .regular {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showFilters = true
                    } label: {
                        Label("Filters", systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $showFilters) {
            ExploreFilterSheet(filters: $filters)
        }
        .task {
            if items.isEmpty, !loading {
                await loadFirstPage()
            }
        }
        .onChange(of: filters) { _, _ in
            loadGeneration += 1
            items = []
            page = 1
            totalPages = 1
            loadMoreError = nil
            // Set synchronously so no frame commits the empty state before the load starts.
            loading = true
            error = nil
            Task { await loadFirstPage() }
        }
        .onChange(of: model.isOffline) { _, offline in
            guard !offline, items.isEmpty || error != nil else { return }
            Task { await loadFirstPage() }
        }
        #if DEBUG
        .onAppear {
            // `simctl` has no tap injection, so the filter sheet — normally
            // opened by tapping the toolbar button — needs a way in for
            // screenshot verification. Mirrors the `RAWKOON_TAB`/`RAWKOON_SCREEN`
            // pattern in `RawkoonApp.swift`.
            if ProcessInfo.processInfo.environment["RAWKOON_EXPLORE_FILTERS"] != nil {
                showFilters = true
            }
        }
        #endif
    }

    /// Mac/iPad: the filter controls live inline in a left panel beside the grid.
    private var regularLayout: some View {
        HStack(spacing: 0) {
            ScrollView {
                ExploreFilterControls(filters: $filters)
                    .padding(16)
            }
            .frame(width: 300)

            Divider().overlay(Theme.border)

            gridScroll
        }
    }

    private var gridScroll: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                MediaSearchField(query: $query)

                if MediaSearchField.isActive(query) {
                    MediaSearchResults(query: query)
                } else {
                    filterBar

                    // Offline, the app-wide strip already says why nothing refreshed.
                    if let error, !model.isOffline {
                        refreshErrorBanner(error)
                    }

                    content
                }
            }
            .padding(.top, 12)
            .padding(.bottom, 32)
            // Chips morph on a filter change; banner, skeleton and grid swap when a load settles.
            .rawkoonMotion(RawkoonMotion.snappy, value: filters)
            .rawkoonMotion(RawkoonMotion.spring, value: loading)
        }
        .reportsTabBarScroll()
        .refreshable {
            await loadFirstPage()
        }
    }

    // MARK: Filter bar

    @ViewBuilder
    private var filterBar: some View {
        if !filters.isDefault {
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        if let provider = filters.provider {
                            activeChip(Text(provider.name), id: "provider") { filters.provider = nil }
                        }
                        if let genre = filters.genre {
                            activeChip(Text(genre.name), id: "genre") { filters.genre = nil }
                        }
                        if filters.sort != .popularityDesc {
                            activeChip(Text(filters.sort.label), id: "sort") { filters.sort = .popularityDesc }
                        }
                        if filters.originalLanguageOnly {
                            activeChip(Text("Original language"), id: "language") {
                                filters.originalLanguageOnly = false
                            }
                        }
                        // Stays mounted so the figure rolls; hidden while loading or failed.
                        Text("\(totalResults) results")
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                            .padding(.leading, 4)
                            .rawkoonNumeric(Double(totalResults))
                            .opacity(loading || error != nil ? 0 : 1)
                            .accessibilityHidden(loading || error != nil)
                    }
                    .padding(.horizontal, 16)
                }
            }
            .transition(.rawkoonReveal)
        }
    }

    private func activeChip(_ label: Text, id: String, onClear: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            label
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
            Button(action: onClear) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Clear filter")
        }
        .foregroundStyle(Theme.onAccent)
        .padding(.leading, 10)
        .frame(minHeight: 44)
        .glassEffect(.regular.tint(Theme.apricot), in: .capsule)
        .glassEffectID(id, in: chipNamespace)
    }

    private func refreshErrorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .foregroundStyle(Theme.terracotta)
            Text(message)
                .font(.callout)
                .foregroundStyle(Theme.muted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
        .transition(.rawkoonReveal)
    }

    // MARK: Grid content

    @ViewBuilder
    private var content: some View {
        if loading, items.isEmpty {
            skeletonGrid
                .transition(.rawkoonSwap)
        } else if items.isEmpty, error != nil, model.isOffline {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty, error != nil {
            ContentUnavailableView(
                "Couldn't load Explore",
                systemImage: "wifi.slash",
                description: Text(error ?? "")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty {
            ContentUnavailableView {
                Label("No results for these filters", systemImage: "sparkles.rectangle.stack")
            } description: {
                Text("Try a different provider, genre, or sort order.")
            } actions: {
                if !filters.isDefault {
                    Button("Clear filters") {
                        filters = ExploreFilters(kind: filters.kind)
                    }
                }
            }
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            grid
                .transition(.rawkoonSwap)
        }
    }

    private var skeletonGrid: some View {
        LazyVGrid(columns: gridColumns, spacing: 14) {
            ForEach(0 ..< 12, id: \.self) { _ in
                ShimmerView(cornerRadius: 10)
                    .aspectRatio(2.0 / 3.0, contentMode: .fit)
            }
        }
        .padding(.horizontal, 16)
    }

    private var grid: some View {
        VStack(spacing: 0) {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(items) { item in
                    let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            title: item.title,
                            posterPath: item.posterUrl,
                            libraryId: item.libraryId
                        )
                        .rawkoonZoomDestination(zoomID)
                    } label: {
                        posterCard(item)
                            .rawkoonZoomSource(zoomID)
                    }
                    .buttonStyle(.rawkoonPressable)
                    .onAppear {
                        guard item.id == items.last?.id else { return }
                        Task { await loadMore() }
                    }
                    .rawkoonEntrance(id: item.id)
                }
            }
            .padding(.horizontal, 16)
            // Lives with the grid: a new filter set rebuilds it and cascades; a refresh in place does not replay.
            .rawkoonEntranceScope()

            paginationFooter
        }
    }

    @ViewBuilder
    private var paginationFooter: some View {
        if loadingMore {
            ProgressView().tint(Theme.muted)
                .padding(.vertical, 16)
        } else if let loadMoreError, page < totalPages, !model.isOffline {
            Button {
                Task { await loadMore(force: true) }
            } label: {
                Text("Couldn't load more — \(loadMoreError). Tap to retry.")
                    .font(.footnote)
                    .foregroundStyle(Theme.terracotta)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, 16)
        }
    }

    // MARK: Poster card

    /// A 2:3 poster with a status chip, plus a flexible-height caption below
    /// — unlike `DiscoverView`'s rail card, this never clips at large Dynamic
    /// Type: the caption sizes to its content instead of a fixed 34pt frame,
    /// with `minimumScaleFactor` as the last-resort guard rail.
    private func posterCard(_ item: TmdbSearchItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedAsyncImage(url: model.absoluteURL(item.posterUrl), targetSize: CGSize(width: 160, height: 240)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.raised
            }
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topTrailing) {
                if item.alreadyExists == true {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color(hex: 0x10231A))
                        .frame(width: 22, height: 22)
                        .background(Theme.seed, in: Circle())
                        .accessibilityLabel("In library")
                        .padding(6)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.06), lineWidth: 1)
            )

            Text(item.title)
                .font(.caption)
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Data

    private func fetchPage(client: APIClient, page: Int) async throws -> DiscoverMediasResponse {
        try await client.discoverGrid(
            type: filters.kind.apiValue,
            providerId: filters.provider?.id,
            genreId: filters.genre?.id,
            sortBy: filters.sort.rawValue,
            page: page,
            originalLanguage: originalLanguageFilter
        )
    }

    /// The saved copy of the page `fetchPage` would request with the same filters.
    private func cachedPage(client: APIClient, page: Int) -> DiscoverMediasResponse? {
        client.cached(Endpoints.discoverGrid(
            type: filters.kind.apiValue,
            providerId: filters.provider?.id,
            genreId: filters.genre?.id,
            sortBy: filters.sort.rawValue,
            page: page,
            originalLanguage: originalLanguageFilter
        ))?.value
    }

    private var originalLanguageFilter: String? {
        filters.originalLanguageOnly ? Locale.current.language.languageCode?.identifier : nil
    }

    private func loadFirstPage() async {
        guard let client = model.api() else {
            error = String(localized: "Not signed in.")
            loading = false
            return
        }
        let generation = loadGeneration
        if items.isEmpty, let cached = cachedPage(client: client, page: 1) {
            items = cached.items
            page = cached.page
            totalPages = cached.totalPages
            totalResults = cached.totalResults
        }
        loading = true
        error = nil
        defer {
            if generation == loadGeneration {
                loading = false
            }
        }
        do {
            let response = try await fetchPage(client: client, page: 1)
            guard generation == loadGeneration else { return }
            items = response.items
            page = response.page
            totalPages = response.totalPages
            totalResults = response.totalResults
        } catch let apiError as APIError {
            guard generation == loadGeneration else { return }
            error = message(for: apiError)
        } catch {
            guard generation == loadGeneration else { return }
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }

    /// `force` lets the "Tap to retry" button bypass the `loadMoreError`
    /// guard that otherwise stops the automatic `onAppear` trigger from
    /// hot-looping after a failed page fetch.
    private func loadMore(force: Bool = false) async {
        guard !loadingMore, !loading, page < totalPages, force || loadMoreError == nil else { return }
        guard let client = model.api() else { return }
        let generation = loadGeneration
        loadingMore = true
        loadMoreError = nil
        defer {
            if generation == loadGeneration {
                loadingMore = false
            }
        }
        do {
            let response = try await fetchPage(client: client, page: page + 1)
            guard generation == loadGeneration else { return }
            items.append(contentsOf: response.items)
            page = response.page
            totalPages = response.totalPages
            totalResults = response.totalResults
        } catch let apiError as APIError {
            guard generation == loadGeneration else { return }
            // Offline, the next page may still be saved from an earlier scroll.
            if apiError.isNetworkFailure, let cached = cachedPage(client: client, page: page + 1) {
                items.append(contentsOf: cached.items)
                page = cached.page
                totalPages = cached.totalPages
                totalResults = cached.totalResults
            } else {
                loadMoreError = message(for: apiError)
            }
        } catch {
            guard generation == loadGeneration else { return }
            loadMoreError = String(localized: "Can't reach the server.")
        }
    }

    private func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}
