import RawkoonKit
import SwiftUI

/// Tab root. The swipe deck of personalized/trending picks; search and the
/// paginated grid live on Explore. Tap → MediaDetailView.
struct DiscoverView: View {
    @Environment(AppModel.self) private var model
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

    /// Cards still in the current batch before a prefetch kicks off.
    private let prefetchThreshold = 5

    var body: some View {
        phoneScroll
            .background(Theme.base)
            .navigationTitle("Discover")
            .navigationBarTitleDisplayMode(.inline)
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
    }

    /// The swipe deck in one scrolling column; search lives on Explore.
    private var phoneScroll: some View {
        ScrollView {
            deckColumn
        }
        .reportsTabBarScroll()
        .refreshable { await loadDeck() }
    }

    private var deckColumn: some View {
        VStack(alignment: .leading, spacing: 20) {
            deckContent
        }
        .padding(.top, 12)
    }

    // MARK: Search field

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
            ShimmerView(cornerRadius: 16)
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .frame(maxWidth: 260)
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
                .allowsHitTesting(false)
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
                    let type = item.mediaType == "tv" ? "show" : "movie"
                    _ = try await model.serverStateStore.addToLibrary(
                        provisional: .provisional(
                            tmdbId: item.tmdbId,
                            type: type,
                            title: item.title,
                            year: item.releaseYear,
                            posterUrl: item.posterUrl,
                            overview: item.overview
                        ),
                        request: { try await client.addToLibrary(tmdbId: item.tmdbId, type: type) }
                    )
                    await model.loadLibrary()
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
                }
            } catch let error as APIError {
                model.toast(message(for: error), style: .error)
            } catch {
                model.toast(String(localized: "Network error. Check your connection."), style: .error)
            }
        }
    }

    private func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}
