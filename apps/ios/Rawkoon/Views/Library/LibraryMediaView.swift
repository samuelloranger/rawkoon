import RawkoonKit
import SwiftUI

struct LibraryMediaView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var hSizeClass
    @AppStorage("library.density") private var densityRaw = LibraryDensity.grid.rawValue
    @Bindable var state: LibraryMediaModel
    /// Existing rows may animate out or change badges; newly created lazy rows appear in place.
    @State private var shownMediaIds: Set<Int> = []
    @State private var mediaRowsLaidOut = false

    private var store: ServerStateStore {
        model.serverStateStore
    }

    private var media: [LibraryMedia] {
        state.media(in: model)
    }

    private var mediaError: String? {
        state.error(in: model)
    }

    private var loadingMedia: Bool {
        state.isLoading(in: model)
    }

    private var mediaHasMore: Bool {
        state.hasMore(in: model)
    }

    private var density: LibraryDensity {
        LibraryDensity(rawValue: densityRaw) ?? .grid
    }

    private var isRegularWidth: Bool {
        hSizeClass == .regular
    }

    private var listMotion: Animation {
        reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.spring
    }

    private var mediaListMotion: Animation? {
        !media.isEmpty && mediaRowsLaidOut && media.allSatisfy { shownMediaIds.contains($0.id) } ? listMotion : nil
    }

    private var columns: [GridItem] {
        if isRegularWidth {
            return [GridItem(.adaptive(minimum: 160, maximum: 220), spacing: 12)]
        }
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    private var densityBinding: Binding<LibraryDensity> {
        Binding(get: { density }, set: { densityRaw = $0.rawValue })
    }

    var body: some View {
        VStack(spacing: 0) {
            mediaToolbar
            ZStack {
                if density == .list {
                    mediaList
                } else {
                    mediaGrid
                }
            }
            .rawkoonMotion(RawkoonMotion.spring, value: density)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Layout", selection: densityBinding) {
                        Label("Grid", systemImage: "square.grid.2x2").tag(LibraryDensity.grid)
                        Label("List", systemImage: "list.bullet").tag(LibraryDensity.list)
                    }
                } label: {
                    Label("Layout", systemImage: density == .grid ? "square.grid.2x2" : "list.bullet")
                }
            }
        }
        .task {
            #if DEBUG
                let preset = ProcessInfo.processInfo.environment["RAWKOON_LIBRARY_SEARCH"]
                if let preset, state.mediaSearch.isEmpty {
                    state.mediaSearch = preset
                }
                if ProcessInfo.processInfo.environment["RAWKOON_LIBRARY_FILTERED"] != nil {
                    state.mediaType = .show
                    state.mediaStatus = .wanted
                }
                if ProcessInfo.processInfo.environment["RAWKOON_LIBRARY_SORT_ASC"] != nil {
                    state.sort = .title
                    state.sortAscending = true
                }
            #endif
            state.hydrateFromCache(model: model)
            if store.needsLoad(state.key) {
                await state.load(reset: true, model: model)
            }
        }
        .onAppear { shownMediaIds = Set(media.map(\.id)) }
        .onChange(of: media.map(\.id)) { _, ids in shownMediaIds = Set(ids) }
        .onChange(of: state.filterKey) { _, _ in
            state.liveReloadTask?.cancel()
            state.hydrateFromCache(model: model)
            Task { await state.load(reset: true, model: model) }
        }
        .onChange(of: model.reconnectToken) { _, _ in
            Task { await state.load(reset: true, model: model) }
        }
        .onChange(of: store.isInvalidated(.libraryList(state.key))) { _, invalidated in
            guard invalidated else { return }
            state.liveReloadTask?.cancel()
            state.liveReloadTask = Task { await state.reloadLoadedWindow(model: model) }
        }
        .sheet(item: $state.releaseSearch) { target in
            ReleaseSearchView(
                query: target.query, libraryMediaId: target.libraryMediaId,
                tmdbId: target.tmdbId, mediaType: target.mediaType,
                availableSeasons: [], onGrabbed: {
                    state.liveReloadTask?.cancel()
                    state.liveReloadTask = Task { await state.reloadLoadedWindow(model: model) }
                }
            )
            .environment(model)
        }
        .navigationDestination(isPresented: Binding(
            get: { state.menuDetailMedia != nil },
            set: {
                if !$0 {
                    state.menuDetailMedia = nil
                }
            }
        )) {
            if let media = state.menuDetailMedia {
                MediaDetailView(
                    tmdbId: media.tmdbId, mediaType: media.type == "show" ? "tv" : "movie",
                    title: media.title, posterPath: media.posterUrl, libraryId: media.id
                )
                .rawkoonZoomDestination(RawkoonZoom.media(
                    tmdbId: media.tmdbId, mediaType: media.type == "show" ? "tv" : "movie"
                ))
            }
        }
        .libraryRemoveConfirmation(
            isPresented: $state.showingRemoveConfirm,
            title: state.removeCandidate?.title ?? ""
        ) { deleteFiles in
            if let media = state.removeCandidate {
                Task { await state.removeFromLibrary(media, deleteFiles: deleteFiles, model: model) }
            }
        }
    }

    private var activeFilterLabels: [String] {
        var labels: [String] = []
        if state.mediaType != .all {
            labels.append(String(localized: state.mediaType.title))
        }
        if state.mediaStatus != .all {
            labels.append(String(localized: state.mediaStatus.title))
        }
        if let order = state.sort.summary(ascending: state.sortAscending) {
            labels.append(order)
        }
        return labels
    }

    private var mediaToolbar: some View {
        HStack(spacing: 8) {
            searchField(LocalizedStringKey("Search titles"), text: $state.mediaSearch)
                .frame(minWidth: 100, maxWidth: .infinity)
            LibraryFilterChip(activeLabels: activeFilterLabels) {
                state.mediaType = .all
                state.mediaStatus = .all
                state.sort = .added_at
                state.sortAscending = false
            } content: {
                Picker("Type", selection: $state.mediaType) {
                    ForEach(MediaTypeFilter.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.inline)
                Picker("Status", selection: $state.mediaStatus) {
                    ForEach(MediaStatusFilter.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.inline)
                Menu("Sort by") {
                    Picker("Sort by", selection: $state.sort) {
                        ForEach(MediaSort.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.inline)
                    Picker("Direction", selection: $state.sortAscending) {
                        Text("Descending").tag(false)
                        Text("Ascending").tag(true)
                    }
                    .pickerStyle(.inline)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var mediaGrid: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                LibraryGrowthStrip()
                    .padding(.horizontal, 16)
                ShelfChipsRow(shelves: [.watchlist, .collections, .shelves])

                if loadingMedia, media.isEmpty {
                    mediaGridSkeleton
                } else if media.isEmpty {
                    mediaEmptyState
                } else {
                    LazyVGrid(columns: columns, spacing: 16) {
                        ForEach(media) { mediaItem in
                            let zoomID = RawkoonZoom.media(
                                tmdbId: mediaItem.tmdbId,
                                mediaType: mediaItem.type == "show" ? "tv" : "movie"
                            )
                            NavigationLink {
                                MediaDetailView(
                                    tmdbId: mediaItem.tmdbId,
                                    mediaType: mediaItem.type == "show" ? "tv" : "movie",
                                    title: mediaItem.title,
                                    posterPath: mediaItem.posterUrl,
                                    libraryId: mediaItem.id
                                )
                                .rawkoonZoomDestination(zoomID)
                            } label: {
                                MediaPosterCard(
                                    title: mediaItem.title,
                                    posterURL: model.absoluteURL(mediaItem.posterUrl),
                                    menuItems: mediaPosterMenuItems(
                                        inLibrary: true,
                                        isAdmin: model.isAdmin,
                                        canAutoSearch: movieCanAutoSearch(type: mediaItem.type, status: mediaItem.status)
                                    ),
                                    onMenuAction: { state.handleMenu($0, media: mediaItem, model: model) },
                                    overlay: {
                                        if state.busyMediaIds.contains(mediaItem.id) {
                                            ProgressView().tint(Theme.apricot)
                                                .transition(.rawkoonSwap)
                                        } else {
                                            mediaBadge(for: mediaItem)
                                        }
                                    }
                                )
                                .rawkoonZoomSource(zoomID)
                            }
                            .buttonStyle(.rawkoonPressable)
                            .disabled(!LibraryRowPresentation(media: mediaItem).isInteractive)
                            .rawkoonScrollSettle()
                        }
                    }
                    .padding(.horizontal, 16)

                    if mediaHasMore {
                        paginationFooter
                    }
                }
            }
            .padding(.vertical, 16)
            .onGeometryChange(for: Bool.self) { $0.size.height > 40 } action: { mediaRowsLaidOut = $0 }
        }
        .reportsTabBarScroll()
        // motion-ok: listMotion already resolves Reduce Motion
        .animation(mediaListMotion, value: state.animationToken(for: media))
        .refreshable { await state.load(reset: true, model: model) }
    }

    /// Infinite-scroll sentinel. Lives inside the lazy container so its `onAppear`
    /// fires only when scrolled near the end — and re-fires each time it reappears,
    /// so a failed page can be retried and a deleted last row can't strand it.
    @ViewBuilder
    private var paginationFooter: some View {
        Group {
            if let mediaError, !media.isEmpty {
                Button {
                    Task { await state.load(reset: false, model: model) }
                } label: {
                    VStack(spacing: 4) {
                        Text(mediaError).font(.caption).foregroundStyle(Theme.muted)
                        Text("Tap to retry").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                    }
                }
                .buttonStyle(.plain)
            } else {
                ProgressView().tint(Theme.apricot)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .onAppear { state.loadMoreIfNeeded(model: model) }
    }

    /// Each branch carries its own transition so a status change crossfades between badges.
    @ViewBuilder
    private func mediaBadge(for mediaItem: LibraryMedia) -> some View {
        if case .adding = LibraryRowPresentation(media: mediaItem).status {
            StatusBadge(text: "Adding…", tint: Theme.apricot)
                .transition(.rawkoonSwap)
        } else if mediaItem.status == "downloading" {
            Circle().fill(Theme.importing).frame(width: 22, height: 22)
                .overlay(
                    Image(systemName: "arrow.down")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.onAccent)
                )
                .transition(.rawkoonSwap)
        } else if mediaItem.status == "wanted" || mediaItem.status == "missing" {
            WantedBadge(media: mediaItem)
                .transition(.rawkoonSwap)
        }
    }

    @ViewBuilder
    private var mediaEmptyState: some View {
        if let mediaError {
            ContentUnavailableView(
                "Couldn't load", systemImage: "exclamationmark.triangle",
                description: Text(mediaError)
            )
            .rawkoonLivingSymbol(.error)
        } else {
            ContentUnavailableView(
                "No titles", systemImage: "film",
                description: Text("Nothing matches these filters.")
            )
            .rawkoonLivingSymbol(.empty)
        }
    }

    /// Warm skeleton poster grid shown while the first media page loads.
    private var mediaGridSkeleton: some View {
        LazyVGrid(columns: columns, spacing: 16) {
            ForEach(0 ..< 9, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 6) {
                    ShimmerView(cornerRadius: 10)
                        .aspectRatio(2.0 / 3.0, contentMode: .fit)
                    ShimmerView(cornerRadius: 4).frame(height: 12)
                }
            }
        }
        .padding(.horizontal, 16)
        .allowsHitTesting(false)
    }

    /// Warm skeleton rows matching the list layout while the first page loads.
    private var mediaListSkeleton: some View {
        LazyVStack(spacing: 8) {
            ForEach(0 ..< 8, id: \.self) { _ in
                HStack(alignment: .top, spacing: 12) {
                    ShimmerView(cornerRadius: 6).frame(width: 46, height: 69)
                    VStack(alignment: .leading, spacing: 6) {
                        ShimmerView(cornerRadius: 4).frame(height: 14)
                        ShimmerView(cornerRadius: 4).frame(width: 140, height: 10)
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .allowsHitTesting(false)
    }

    private var mediaList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                LibraryGrowthStrip()
                ShelfChipsRow(shelves: [.watchlist, .collections, .shelves])

                if loadingMedia, media.isEmpty {
                    mediaListSkeleton
                } else if media.isEmpty {
                    mediaEmptyState
                } else {
                    ForEach(media) { mediaItem in
                        let zoomID = RawkoonZoom.media(
                            tmdbId: mediaItem.tmdbId,
                            mediaType: mediaItem.type == "show" ? "tv" : "movie"
                        )
                        NavigationLink {
                            MediaDetailView(
                                tmdbId: mediaItem.tmdbId,
                                mediaType: mediaItem.type == "show" ? "tv" : "movie",
                                title: mediaItem.title,
                                posterPath: mediaItem.posterUrl,
                                libraryId: mediaItem.id
                            )
                            .rawkoonZoomDestination(zoomID)
                        } label: {
                            LibraryMediaRow(
                                media: mediaItem,
                                posterURL: model.absoluteURL(mediaItem.posterUrl),
                                isBusy: state.busyMediaIds.contains(mediaItem.id),
                                menuItems: mediaPosterMenuItems(
                                    inLibrary: true,
                                    isAdmin: model.isAdmin,
                                    canAutoSearch: movieCanAutoSearch(type: mediaItem.type, status: mediaItem.status)
                                ),
                                onMenuAction: { state.handleMenu($0, media: mediaItem, model: model) }
                            )
                            .rawkoonZoomSource(zoomID)
                        }
                        .buttonStyle(.rawkoonPressable(scale: 0.98))
                        .disabled(!LibraryRowPresentation(media: mediaItem).isInteractive)
                        .rawkoonScrollSettle()
                    }

                    if mediaHasMore {
                        paginationFooter
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 16)
            .libraryReadingWidth(isRegularWidth)
            .onGeometryChange(for: Bool.self) { $0.size.height > 40 } action: { mediaRowsLaidOut = $0 }
        }
        .reportsTabBarScroll()
        // motion-ok: listMotion already resolves Reduce Motion
        .animation(mediaListMotion, value: state.animationToken(for: media))
        .refreshable { await state.load(reset: true, model: model) }
    }
}
