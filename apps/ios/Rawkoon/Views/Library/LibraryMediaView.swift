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
        mediaRowsLaidOut && media.allSatisfy { shownMediaIds.contains($0.id) } ? listMotion : nil
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
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { RequestsView() } label: {
                    Label("Requests", systemImage: "tray.and.arrow.down")
                }
            }
        }
        .task {
            #if DEBUG
                let preset = ProcessInfo.processInfo.environment["RAWKOON_LIBRARY_SEARCH"]
                if let preset, state.mediaSearch.isEmpty {
                    state.mediaSearch = preset
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

    private var mediaToolbar: some View {
        VStack(spacing: 8) {
            searchField("Search titles", text: $state.mediaSearch)
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        filterMenu(title: state.mediaType.title, systemImage: "film") {
                            ForEach(MediaTypeFilter.allCases) { mediaType in
                                Button(mediaType.title) { state.mediaType = mediaType }
                            }
                        }
                        filterMenu(title: state.mediaStatus.title, systemImage: "line.3.horizontal.decrease") {
                            ForEach(MediaStatusFilter.allCases) { status in
                                Button(status.title) { state.mediaStatus = status }
                            }
                        }
                        filterMenu(
                            title: state.sort.title,
                            systemImage: state.sortAscending ? "arrow.up" : "arrow.down"
                        ) {
                            ForEach(MediaSort.allCases) { ordering in
                                Button(ordering.title) { state.sort = ordering }
                            }
                            Divider()
                            Button(LocalizedStringKey(state.sortAscending ? "Descending" : "Ascending")) {
                                state.sortAscending.toggle()
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
        }
    }

    private func filterMenu(
        title: LocalizedStringKey, systemImage: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: systemImage).font(.caption2)
                Text(title).font(.subheadline.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
    }

    private var mediaGrid: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
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
            .padding(.vertical, 16)
            .onGeometryChange(for: Bool.self) { $0.size.height > 40 } action: { mediaRowsLaidOut = $0 }
        }
        .reportsTabBarScroll()
        .overlay { mediaOverlay }
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
            Circle().fill(Theme.muted.opacity(0.9)).frame(width: 22, height: 22)
                .overlay(
                    Image(systemName: "questionmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.base)
                )
                .transition(.rawkoonSwap)
        }
    }

    @ViewBuilder
    private var mediaOverlay: some View {
        if loadingMedia, media.isEmpty {
            if density == .list {
                mediaListSkeleton
            } else {
                mediaGridSkeleton
            }
        } else if let mediaError, media.isEmpty {
            ContentUnavailableView(
                "Couldn't load", systemImage: "exclamationmark.triangle",
                description: Text(mediaError)
            )
            .rawkoonLivingSymbol(.error)
        } else if !loadingMedia, mediaError == nil, media.isEmpty {
            ContentUnavailableView(
                "No titles", systemImage: "film",
                description: Text("Nothing matches these filters.")
            )
            .rawkoonLivingSymbol(.empty)
        }
    }

    /// Warm skeleton poster grid shown while the first media page loads.
    private var mediaGridSkeleton: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(0 ..< 9, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        ShimmerView(cornerRadius: 10)
                            .aspectRatio(2.0 / 3.0, contentMode: .fit)
                        ShimmerView(cornerRadius: 4).frame(height: 12)
                    }
                }
            }
            .padding(16)
        }
        .allowsHitTesting(false)
    }

    /// Warm skeleton rows matching the list layout while the first page loads.
    private var mediaListSkeleton: some View {
        ScrollView {
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
            .padding(.horizontal, 16).padding(.vertical, 16)
        }
        .allowsHitTesting(false)
    }

    private var mediaList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
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
            .padding(.horizontal, 16).padding(.vertical, 16)
            .libraryReadingWidth(isRegularWidth)
            .onGeometryChange(for: Bool.self) { $0.size.height > 40 } action: { mediaRowsLaidOut = $0 }
        }
        .reportsTabBarScroll()
        .overlay { mediaOverlay }
        // motion-ok: listMotion already resolves Reduce Motion
        .animation(mediaListMotion, value: state.animationToken(for: media))
        .refreshable { await state.load(reset: true, model: model) }
    }
}
