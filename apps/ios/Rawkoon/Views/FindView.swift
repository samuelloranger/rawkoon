import RawkoonKit
import SwiftUI

/// The Find tab: one search field over the library, TMDB titles and books, and a
/// Browse | Swipe switch over today's Explore grid and Discover deck. A query of
/// two or more characters replaces the switch with the three result groups.
struct FindView: View {
    @Environment(AppModel.self) private var model

    @State private var query = ""
    @FocusState private var searchFocused: Bool
    /// Held here so Browse keeps its filters while the switch or a search swaps it out.
    @State private var filters = ExploreFilters()
    @State private var openShelf: FindShelf?
    /// A mode mounts on first use and then stays, keeping its loaded pages and deck.
    @State private var browseMounted = false
    @State private var swipeMounted = false

    private var searching: Bool {
        FindSearch.isActive(query)
    }

    private var mode: Binding<FindMode> {
        Binding(get: { model.findMode }, set: { model.findMode = $0 })
    }

    var body: some View {
        VStack(spacing: 0) {
            MediaSearchField(query: $query, focus: $searchFocused)
                .padding(.vertical, 8)
            // Both modes stay mounted, hidden while searching, so clearing the field or flipping the
            // switch returns to the same grid position and the same deck.
            ZStack {
                catalogue
                    .opacity(searching ? 0 : 1)
                    .allowsHitTesting(!searching)
                    .accessibilityHidden(searching)
                if searching {
                    ScrollView {
                        FindSearchResults(query: query)
                            .padding(.top, 4)
                            .padding(.bottom, 32)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .reportsTabBarScroll()
                    .background(Theme.base)
                }
            }
        }
        .background(Theme.base)
        .navigationTitle("Find")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openShelf) { shelf in
            shelf.destination
        }
        .onChange(of: model.findMode, initial: true) { _, mode in
            switch mode {
            case .browse: browseMounted = true
            case .swipe: swipeMounted = true
            }
        }
        // A re-tap of the Find tab and a deep link both ask for the field or a shelf.
        .onChange(of: model.exploreSearchFocusRequest, initial: true) { _, requested in
            guard requested else { return }
            model.exploreSearchFocusRequest = false
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                searchFocused = true
            }
        }
        .onChange(of: model.requestedFindShelf, initial: true) { _, shelf in
            guard let shelf else { return }
            model.requestedFindShelf = nil
            openShelf = shelf
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: searching)
    }

    private var catalogue: some View {
        VStack(spacing: 0) {
            modePicker
            ZStack {
                if browseMounted {
                    ExploreView(filters: $filters, isActive: model.findMode == .browse && !searching)
                        .opacity(model.findMode == .browse ? 1 : 0)
                        .allowsHitTesting(model.findMode == .browse)
                        .accessibilityHidden(model.findMode != .browse)
                }
                if swipeMounted {
                    DiscoverView()
                        .opacity(model.findMode == .swipe ? 1 : 0)
                        .allowsHitTesting(model.findMode == .swipe)
                        .accessibilityHidden(model.findMode != .swipe)
                }
            }
        }
    }

    private var modePicker: some View {
        Picker("Mode", selection: mode) {
            Text("Browse").tag(FindMode.browse)
            Text("Swipe").tag(FindMode.swipe)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

extension FindShelf {
    var title: LocalizedStringKey {
        switch self {
        case .watchlist: "Watchlist"
        case .collections: "Collections"
        case .shelves: "Shelves"
        case .bestsellers: "Bestsellers"
        }
    }

    var symbol: String {
        switch self {
        case .watchlist: "bookmark"
        case .collections: "rectangle.stack"
        case .shelves: "square.stack"
        case .bestsellers: "trophy"
        }
    }

    @ViewBuilder var destination: some View {
        switch self {
        case .watchlist: WatchlistView()
        case .collections: CollectionsView()
        case .shelves: ShelvesView()
        case .bestsellers: BookDiscoveryView()
        }
    }
}
