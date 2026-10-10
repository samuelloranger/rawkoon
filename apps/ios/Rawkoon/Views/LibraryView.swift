import RawkoonKit
import SwiftUI

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isActiveRootTab) private var isActiveRootTab
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// List mutations animate with the app spring, degrading to a crossfade
    /// under Reduce Motion (RawkoonMotion consumers must be Reduce-Motion safe).
    private var listMotion: Animation {
        reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.spring
    }

    @State private var section: LibrarySection = .media
    /// False while the grid is empty, so a refill from empty does not animate cells in from narrow widths.
    @State private var mediaPopulated = false

    /// When set (desktop's split Media/Books tabs), the section is fixed and the
    /// Media/Books segmented toggle is hidden. Nil keeps the phone's single tab.
    private let forcedSection: LibrarySection?

    init(forcedSection: LibrarySection? = nil) {
        self.forcedSection = forcedSection
        _section = State(initialValue: forcedSection ?? .media)
    }

    /// Grid is the default so the first open is byte-identical to today.
    @AppStorage("library.density") private var densityRaw = LibraryDensity.grid.rawValue

    // Media filters/sort — web defaults.
    @State private var mediaType: MediaTypeFilter = .all
    @State private var mediaStatus: MediaStatusFilter = .all
    @State private var sort: MediaSort = .added_at
    @State private var sortAscending = false
    @State private var mediaSearch = ""
    @State private var releaseSearch: ReleaseSearchPresentation?
    @State private var removeCandidate: LibraryMedia?
    @State private var showingRemoveConfirm = false
    @State private var menuDetailMedia: LibraryMedia?
    @State private var showingPlayer = false
    /// The in-flight live-event reload, cancelled before a new one starts so
    /// rapid `/api/library/events` bursts can't race the list state.
    @State private var liveReloadTask: Task<Void, Never>?
    @State private var readingBook: BookListItem?
    @State private var busyMediaIds: Set<Int> = []

    @State private var bookKind: BookKindFilter = .all
    @State private var bookSearch = ""
    @State private var busyBookIds: Set<Int> = []
    /// Local books error, captured at the load site so a stale/unrelated
    /// `model.errorMessage` can't leak into the books view.
    @State private var booksError: String?
    // Per-user progress that drives the `.recent` sort, keyed by edition id.
    @State private var audioProgress: [Int: RemoteProgress] = [:]
    @State private var ebookProgress: [Int: ReadingPosition] = [:]

    /// Compact (phone) keeps the tuned 3-up grid. Regular width (iPad, Mac) fills
    /// as many ~160pt posters as fit instead of stretching three huge ones.
    @Environment(\.horizontalSizeClass) private var hSizeClass

    private var columns: [GridItem] {
        if hSizeClass == .regular {
            return [GridItem(.adaptive(minimum: 160, maximum: 220), spacing: 12)]
        }
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    private var isRegularWidth: Bool {
        hSizeClass == .regular
    }

    private var navigationTitleKey: LocalizedStringKey {
        switch forcedSection {
        case .media: "Movies & Shows"
        case .books: "Books"
        case nil: "Library"
        }
    }

    private var density: LibraryDensity {
        LibraryDensity(rawValue: densityRaw) ?? .grid
    }

    private var densityBinding: Binding<LibraryDensity> {
        Binding(get: { density }, set: { densityRaw = $0.rawValue })
    }

    var body: some View {
        VStack(spacing: 0) {
            if forcedSection == nil {
                Picker("Section", selection: $section) {
                    ForEach(LibrarySection.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }

            if model.isOfflineLibrary {
                offlineBanner
                    .transition(.rawkoonReveal)
            }

            if section == .media {
                mediaToolbar
                    .transition(.rawkoonSwap)
            } else {
                booksToolbar
                    .transition(.rawkoonSwap)
            }

            content
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: section)
        .rawkoonMotion(RawkoonMotion.spring, value: model.isOfflineLibrary)
        .background(Theme.base)
        .navigationTitle(navigationTitleKey)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if section == .media {
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
            ToolbarItem(placement: .topBarTrailing) {
                if section == .books {
                    NavigationLink {
                        BookDiscoveryView()
                    } label: {
                        Label("Explore books", systemImage: "trophy")
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                // Requests are a movie/TV concept only.
                if section == .media {
                    NavigationLink {
                        RequestsView()
                    } label: {
                        Label("Requests", systemImage: "tray.and.arrow.down")
                    }
                }
            }
        }
        .task {
            #if DEBUG
                // Screenshot-only: the simulator can't type into the search field.
                if let preset = ProcessInfo.processInfo.environment["RAWKOON_LIBRARY_SEARCH"], mediaSearch.isEmpty {
                    mediaSearch = preset
                }
            #endif
            hydrateMediaFromCache()
            if section == .media, store.needsLoad(mediaKey) {
                await loadMedia(reset: true)
            }
            if model.needsLibraryRefresh {
                await loadBooks()
            }
            await loadBookProgress()
        }
        .onAppear { mediaPopulated = mediaPopulated || !media.isEmpty }
        .onChange(of: media.isEmpty) { _, isEmpty in
            mediaPopulated = !isEmpty
        }
        // Kept-alive iPhone tabs never re-appear, so a revisit refreshes like the old TabView did.
        .onChange(of: isActiveRootTab) { _, active in
            if active {
                Task { await loadBookProgress() }
            }
        }
        .onChange(of: model.reconnectToken) { _, _ in
            Task {
                if section == .media {
                    await loadMedia(reset: true)
                }
                await loadBookProgress()
            }
        }
        .onChange(of: mediaFilterKey) { _, _ in
            liveReloadTask?.cancel()
            hydrateMediaFromCache()
            Task { await loadMedia(reset: true) }
        }
        .onChange(of: section) { _, newSection in
            if newSection == .media {
                liveReloadTask?.cancel()
                Task { await loadMedia(reset: true) }
            } else {
                Task { await loadBookProgress() }
            }
        }
        .onChange(of: store.isInvalidated(.libraryList(mediaKey))) { _, invalidated in
            guard section == .media, invalidated else { return }
            liveReloadTask?.cancel()
            liveReloadTask = Task { await reloadLoadedWindow() }
        }
        .onChange(of: model.bookChangeToken) { _, _ in
            guard section == .books else { return }
            liveReloadTask?.cancel()
            liveReloadTask = Task {
                await model.loadLibrary()
                await loadBookProgress()
            }
        }
        .sheet(item: $releaseSearch) { target in
            ReleaseSearchView(
                query: target.query,
                libraryMediaId: target.libraryMediaId,
                tmdbId: target.tmdbId,
                mediaType: target.mediaType,
                availableSeasons: [],
                // A grab only invalidates the item, not the list, so refetch the
                // loaded window here — else the row's status chip stays stale.
                onGrabbed: {
                    liveReloadTask?.cancel()
                    liveReloadTask = Task { await reloadLoadedWindow() }
                }
            )
            .environment(model)
        }
        .sheet(isPresented: $showingPlayer) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environment(model)
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { menuDetailMedia != nil },
            set: {
                if !$0 {
                    menuDetailMedia = nil
                }
            }
        )) {
            if let m = menuDetailMedia {
                MediaDetailView(
                    tmdbId: m.tmdbId,
                    mediaType: m.type == "show" ? "tv" : "movie",
                    title: m.title,
                    posterPath: m.posterUrl,
                    libraryId: m.id
                )
                .rawkoonZoomDestination(
                    RawkoonZoom.media(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie")
                )
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { readingBook != nil },
            set: {
                if !$0 {
                    readingBook = nil
                }
            }
        )) {
            if let book = readingBook {
                BookView(book: book, preferEbook: true)
            }
        }
        .libraryRemoveConfirmation(
            isPresented: $showingRemoveConfirm,
            title: removeCandidate?.title ?? ""
        ) { deleteFiles in
            if let media = removeCandidate {
                Task { await removeFromLibrary(media, deleteFiles: deleteFiles) }
            }
        }
    }

    private var normalizedMediaSearch: String {
        mediaSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var mediaFilterKey: String {
        "\(mediaType.rawValue)|\(mediaStatus.rawValue)|\(sort.rawValue)|\(sortAscending)|\(normalizedMediaSearch)"
    }

    // MARK: Media server state

    //
    // The list, its pages, loading flags and error all live in the shared
    // `ServerStateStore`, so a mutation elsewhere updates this view without a
    // refetch and returning to the tab keeps the pages already loaded.

    private var store: ServerStateStore {
        model.serverStateStore
    }

    private var mediaKey: LibraryListKey {
        LibraryListKey(
            type: mediaType.param,
            status: mediaStatus.param,
            query: normalizedMediaSearch.isEmpty ? nil : normalizedMediaSearch,
            page: 1,
            limit: 60,
            sortBy: sort.rawValue,
            sortDirection: sortAscending ? "asc" : "desc"
        )
    }

    private var mediaState: ServerQueryState<[LibraryMedia]> {
        store.libraryList(mediaKey)
    }

    private var media: [LibraryMedia] {
        mediaState.value ?? []
    }

    private var mediaError: String? {
        mediaState.errorDescription
    }

    private var loadingMedia: Bool {
        mediaState.isLoading
    }

    private var loadingMoreMedia: Bool {
        store.pagination(mediaKey).isLoadingMore
    }

    private var mediaHasMore: Bool {
        store.pagination(mediaKey).hasMore
    }

    /// Changes worth animating: rows appearing or leaving, the monitored badge
    /// flipping, and status or busy badges swapping. Cheap at page size.
    private var mediaAnimationToken: Int {
        var hasher = Hasher()
        for item in media {
            hasher.combine(item.id)
            hasher.combine(item.monitored)
            hasher.combine(item.isProvisional)
            hasher.combine(item.status)
            hasher.combine(busyMediaIds.contains(item.id))
        }
        return hasher.finalize()
    }

    // MARK: Toolbars

    private var mediaToolbar: some View {
        VStack(spacing: 8) {
            searchField("Search titles", text: $mediaSearch)
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        filterMenu(title: mediaType.title, systemImage: "film") {
                            ForEach(MediaTypeFilter.allCases) { t in
                                Button(t.title) { mediaType = t }
                            }
                        }
                        filterMenu(title: mediaStatus.title, systemImage: "line.3.horizontal.decrease") {
                            ForEach(MediaStatusFilter.allCases) { s in
                                Button(s.title) { mediaStatus = s }
                            }
                        }
                        filterMenu(title: sort.title, systemImage: sortAscending ? "arrow.up" : "arrow.down") {
                            ForEach(MediaSort.allCases) { s in
                                Button(s.title) { sort = s }
                            }
                            Divider()
                            Button(LocalizedStringKey(sortAscending ? "Descending" : "Ascending")) {
                                sortAscending.toggle()
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
        }
    }

    private var booksToolbar: some View {
        VStack(spacing: 8) {
            searchField("Search books", text: $bookSearch)
                .padding(.horizontal, 16)
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    filterMenu(title: bookKind.title, systemImage: "books.vertical") {
                        ForEach(BookKindFilter.allCases) { k in
                            Button(k.title) { bookKind = k }
                        }
                    }
                    Spacer()
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func filterMenu(title: LocalizedStringKey, systemImage: String, @ViewBuilder content: () -> some View) -> some View {
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

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if section == .media {
            ZStack {
                if density == .list {
                    mediaList
                } else {
                    mediaGrid
                }
            }
            .rawkoonMotion(RawkoonMotion.spring, value: density)
        } else {
            booksGrid
        }
    }

    private var mediaGrid: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(media) { m in
                        let zoomID = RawkoonZoom.media(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie")
                        NavigationLink {
                            MediaDetailView(
                                tmdbId: m.tmdbId,
                                mediaType: m.type == "show" ? "tv" : "movie",
                                title: m.title,
                                posterPath: m.posterUrl,
                                libraryId: m.id
                            )
                            .rawkoonZoomDestination(zoomID)
                        } label: {
                            MediaPosterCard(
                                title: m.title,
                                posterURL: model.absoluteURL(m.posterUrl),
                                menuItems: mediaPosterMenuItems(
                                    inLibrary: true,
                                    isAdmin: model.isAdmin,
                                    canAutoSearch: movieCanAutoSearch(type: m.type, status: m.status)
                                ),
                                onMenuAction: { handleMediaMenu($0, media: m) }
                            ) {
                                if busyMediaIds.contains(m.id) {
                                    ProgressView().tint(Theme.apricot)
                                        .transition(.rawkoonSwap)
                                } else {
                                    mediaBadge(for: m)
                                }
                            }
                            .rawkoonZoomSource(zoomID)
                        }
                        .buttonStyle(.rawkoonPressable)
                        .disabled(!LibraryRowPresentation(media: m).isInteractive)
                        .rawkoonScrollSettle()
                    }
                }
                .padding(.horizontal, 16)

                if mediaHasMore {
                    paginationFooter
                }
            }
            .padding(.vertical, 16)
        }
        .reportsTabBarScroll()
        .overlay { mediaOverlay }
        // motion-ok: listMotion already resolves Reduce Motion
        .animation(mediaPopulated ? listMotion : nil, value: mediaAnimationToken)
        .refreshable { await loadMedia(reset: true) }
    }

    /// Infinite-scroll sentinel. Lives inside the lazy container so its `onAppear`
    /// fires only when scrolled near the end — and re-fires each time it reappears,
    /// so a failed page can be retried and a deleted last row can't strand it.
    @ViewBuilder
    private var paginationFooter: some View {
        Group {
            if let mediaError, !media.isEmpty {
                Button {
                    Task { await loadMedia(reset: false) }
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
        .onAppear { loadMoreIfNeeded() }
    }

    /// Each branch carries its own transition so a status change crossfades between badges.
    @ViewBuilder
    private func mediaBadge(for m: LibraryMedia) -> some View {
        if case .adding = LibraryRowPresentation(media: m).status {
            StatusBadge(text: "Adding…", tint: Theme.apricot)
                .transition(.rawkoonSwap)
        } else if m.status == "downloading" {
            Circle().fill(Theme.importing).frame(width: 22, height: 22)
                .overlay(Image(systemName: "arrow.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.onAccent))
                .transition(.rawkoonSwap)
        } else if m.status == "wanted" || m.status == "missing" {
            Circle().fill(Theme.muted.opacity(0.9)).frame(width: 22, height: 22)
                .overlay(Image(systemName: "questionmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.base))
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
            ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(mediaError))
                .rawkoonLivingSymbol(.error)
        } else if !loadingMedia, mediaError == nil, media.isEmpty {
            ContentUnavailableView("No titles", systemImage: "film", description: Text("Nothing matches these filters."))
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
                ForEach(media) { m in
                    let zoomID = RawkoonZoom.media(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie")
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: m.tmdbId,
                            mediaType: m.type == "show" ? "tv" : "movie",
                            title: m.title,
                            posterPath: m.posterUrl,
                            libraryId: m.id
                        )
                        .rawkoonZoomDestination(zoomID)
                    } label: {
                        LibraryMediaRow(
                            media: m,
                            posterURL: model.absoluteURL(m.posterUrl),
                            isBusy: busyMediaIds.contains(m.id),
                            menuItems: mediaPosterMenuItems(
                                inLibrary: true,
                                isAdmin: model.isAdmin,
                                canAutoSearch: movieCanAutoSearch(type: m.type, status: m.status)
                            ),
                            onMenuAction: { handleMediaMenu($0, media: m) }
                        )
                        .rawkoonZoomSource(zoomID)
                    }
                    .buttonStyle(.rawkoonPressable(scale: 0.98))
                    .disabled(!LibraryRowPresentation(media: m).isInteractive)
                    .rawkoonScrollSettle()
                }

                if mediaHasMore {
                    paginationFooter
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 16)
            .libraryReadingWidth(isRegularWidth)
        }
        .reportsTabBarScroll()
        .overlay { mediaOverlay }
        // motion-ok: listMotion already resolves Reduce Motion
        .animation(mediaPopulated ? listMotion : nil, value: mediaAnimationToken)
        .refreshable { await loadMedia(reset: true) }
    }

    @ViewBuilder
    private func bookLink(_ book: BookListItem, grid: Bool) -> some View {
        let menuItems = bookCardMenuItems(
            hasAudiobook: book.hasAudiobook,
            hasEbook: book.hasEbook,
            isAdmin: model.isAdmin,
            isRead: book.isRead,
            hasProgress: hasProgress(book),
            audiobookDownloaded: isDownloaded(book)
        )
        NavigationLink {
            BookView(book: book)
        } label: {
            Group {
                if grid {
                    BookGridCard(
                        book: book,
                        downloaded: isDownloaded(book),
                        progress: progressFraction(book),
                        menuItems: menuItems,
                        onMenuAction: { handleBookMenu($0, book: book) }
                    )
                } else {
                    BookRow(
                        book: book,
                        downloaded: isDownloaded(book),
                        progress: progressFraction(book),
                        menuItems: menuItems,
                        onMenuAction: { handleBookMenu($0, book: book) }
                    )
                }
            }
            .overlay(alignment: grid ? .topTrailing : .trailing) {
                if busyBookIds.contains(book.bookId) {
                    ProgressView().tint(Theme.muted).padding(grid ? 14 : 0).padding(.trailing, grid ? 0 : 10)
                        .transition(.rawkoonSwap)
                }
            }
        }
        .buttonStyle(.rawkoonPressable(scale: 0.98))
        .rawkoonScrollSettle()
    }

    private var booksGrid: some View {
        ScrollView {
            Group {
                if isRegularWidth {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 230), spacing: 12)], spacing: 12) {
                        ForEach(filteredBooks) { book in
                            bookLink(book, grid: true)
                        }
                    }
                } else {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredBooks) { book in
                            bookLink(book, grid: false)
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: busyBookIds)
        .reportsTabBarScroll()
        .overlay {
            if model.loading, model.library.isEmpty {
                booksSkeleton
            } else if let booksError, model.library.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load books", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(booksError)
                } actions: {
                    Button("Try again") { Task { await loadBooks() } }
                        .buttonStyle(.bordered)
                        .tint(Theme.apricot)
                }
                .rawkoonLivingSymbol(.error)
            } else if !model.loading, filteredBooks.isEmpty {
                ContentUnavailableView("No books", systemImage: "books.vertical", description: Text("Books added on your server show up here."))
                    .rawkoonLivingSymbol(.empty)
            }
        }
        .refreshable { await loadBooks() }
    }

    /// Warm skeleton rows matching `BookRow` while the first books page loads.
    private var booksSkeleton: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(0 ..< 8, id: \.self) { _ in
                    HStack(spacing: 12) {
                        ShimmerView(cornerRadius: 10).frame(width: 56, height: 56)
                        VStack(alignment: .leading, spacing: 6) {
                            ShimmerView(cornerRadius: 4).frame(height: 15)
                            ShimmerView(cornerRadius: 4).frame(width: 120, height: 11)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .allowsHitTesting(false)
    }

    private var offlineBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
            Text("Offline — showing downloaded books")
            Spacer(minLength: 0)
        }
        .font(.caption)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var filteredBooks: [BookListItem] {
        let filtered = model.library.filter { book in
            switch bookKind {
            case .all: true
            case .audiobook: book.hasAudiobook
            case .ebook: book.hasEbook
            }
        }.filter { book in
            let query = bookSearch.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty else { return true }
            let haystack = "\(book.title) \(book.author ?? "")".lowercased()
            return haystack.contains(query.lowercased())
        }

        return BookOrdering.sorted(filtered, key: orderKey)
    }

    private func orderKey(_ book: BookListItem) -> BookOrderKey {
        BookOrderKey(
            id: book.bookId, title: book.title,
            isInProgress: isInProgress(book), isDownloaded: isDownloaded(book)
        )
    }

    /// Unfinished listening or reading on any edition, matching the row's progress bar.
    private func isInProgress(_ book: BookListItem) -> Bool {
        let audio = book.audiobookEditionId.flatMap { audioProgress[$0] }.map {
            BookOrdering.isAudiobookInProgress(
                positionSecs: $0.positionSecs, totalDurationSecs: $0.totalDurationSecs, finished: $0.finished
            )
        } ?? false
        let ebook = book.ebookEditionId.flatMap { ebookProgress[$0] }.map {
            BookOrdering.isEbookInProgress(
                spineIndex: $0.spineIndex, scrollFraction: $0.scrollFraction, finished: $0.finished
            )
        } ?? false
        return BookOrdering.isInProgress(audiobookInProgress: audio, ebookInProgress: ebook)
    }

    /// Loads the books library and captures any failure locally, so the books
    /// view shows this load's own error (with a retry) rather than the shared,
    /// possibly stale, `model.errorMessage`.
    private func loadBooks() async {
        booksError = nil
        await model.loadLibrary()
        // `loadLibrary` clears then sets `model.errorMessage` within its own
        // scope, so reading it right here reflects this load's outcome.
        booksError = model.errorMessage
    }

    /// Loads audiobook and ebook progress to rank in-progress books. Best effort:
    /// a failure just leaves them in the downloaded/alphabetical tiers.
    private func loadBookProgress() async {
        guard let client = model.api() else { return }
        // Offline, the saved progress keeps the bars and the in-progress tier.
        let audio = await (try? client.getProgress()) ?? client.cachedProgress()?.value
        let ebook = await (try? client.readingProgress()) ?? client.cachedReadingProgress()?.value
        if let audio {
            audioProgress = Dictionary(
                audio.map { ($0.editionId, $0) },
                uniquingKeysWith: { first, _ in first }
            )
        }
        if let ebook {
            ebookProgress = Dictionary(
                ebook.map { ($0.editionId, $0) },
                uniquingKeysWith: { first, _ in first }
            )
        }
    }

    /// Audiobook listening fraction for the row's progress bar. Audiobook only:
    /// ebook `scrollFraction` is per-spine, not whole-book, so a bar from it
    /// would lie. Nil when nothing is meaningfully in progress or finished.
    private func progressFraction(_ book: BookListItem) -> Double? {
        guard
            let editionId = book.audiobookEditionId,
            let p = audioProgress[editionId],
            !p.finished, p.totalDurationSecs > 1, p.positionSecs > 1
        else { return nil }
        return min(1, p.positionSecs / p.totalDurationSecs)
    }

    private func hasProgress(_ book: BookListItem) -> Bool {
        let audio = book.audiobookEditionId.flatMap { audioProgress[$0] } != nil
        let ebook = book.ebookEditionId.flatMap { ebookProgress[$0] } != nil
        return audio || ebook
    }

    private func isDownloaded(_ book: BookListItem) -> Bool {
        model.downloadedBookIds.contains(book.bookId)
    }

    /// A reset refetches every page currently loaded and replaces them in place,
    /// so a filter change, pull-to-refresh or live event never collapses the list
    /// to page 1 — which would drop the pages scrolled past and reset the offset.
    private func loadMedia(reset: Bool) async {
        if applyOfflineSearch() {
            return
        }
        guard let client = model.api() else { return }
        let key = mediaKey
        let loader = mediaPageLoader(for: key, client: client)
        do {
            if reset {
                try await store.refreshLibraryWindow(key, loader: loader)
            } else {
                try await store.loadNextLibraryPage(key, loader: loader)
            }
        } catch {
            // The store publishes the failure on the query state; the list keeps
            // whatever it already had.
        }
    }

    /// Paints a list this launch hasn't fetched from the pages saved last time,
    /// so the grid opens full — offline, or while the refetch is in flight.
    private func hydrateMediaFromCache() {
        let key = mediaKey
        guard let client = model.api(), store.libraryList(key).value == nil else { return }
        if let saved = savedPages(for: key, client: client) {
            store.hydrateLibraryList(key, items: saved.items, pagesLoaded: saved.pages, hasMore: saved.hasMore)
        }
    }

    /// Offline, a search filters the saved list for the same type and status
    /// instead of asking the server; the server search runs once back online.
    private func applyOfflineSearch() -> Bool {
        let key = mediaKey
        guard model.isOffline, let query = key.query, !query.isEmpty, let client = model.api() else { return false }
        let base = LibraryListKey(
            type: key.type, status: key.status, query: nil, page: key.page,
            limit: key.limit, sortBy: key.sortBy, sortDirection: key.sortDirection
        )
        let source = store.libraryList(base).value ?? savedPages(for: base, client: client)?.items ?? []
        let matches = source.filter { $0.title.localizedStandardContains(query) }
        store.seedLibraryList(matches, for: key, pagesLoaded: 1, hasMore: false)
        return true
    }

    private func savedPages(
        for key: LibraryListKey,
        client: APIClient
    ) -> (items: [LibraryMedia], pages: Int, hasMore: Bool)? {
        var items: [LibraryMedia] = []
        var pages = 0
        var hasMore = false
        while let cached = client.cached(Endpoints.libraryList(
            type: key.type,
            status: key.status,
            q: key.query,
            page: pages + 1,
            limit: key.limit,
            sortBy: key.sortBy ?? "added_at",
            sortDir: key.sortDirection ?? "desc"
        )) {
            for item in cached.value.items where !items.contains(where: { $0.id == item.id }) {
                items.append(item)
            }
            pages += 1
            hasMore = cached.value.hasMore == true
            if !hasMore {
                break
            }
        }
        return pages > 0 ? (items, pages, hasMore) : nil
    }

    private func mediaPageLoader(
        for key: LibraryListKey,
        client: APIClient
    ) -> @Sendable (Int) async throws -> LibraryPage {
        { page in
            do {
                let response = try await client.libraryList(
                    type: key.type,
                    status: key.status,
                    q: key.query,
                    page: page,
                    limit: key.limit,
                    sortBy: key.sortBy ?? "added_at",
                    sortDir: key.sortDirection ?? "desc"
                )
                return LibraryPage(items: response.items, hasMore: response.hasMore == true)
            } catch {
                throw LibraryLoadError(message: libraryErrorMessage(for: error))
            }
        }
    }

    /// Infinite scroll: the footer sentinel scrolled into view — fetch the next page.
    /// A load-more error blocks auto-retry (the footer shows a manual retry instead).
    private func loadMoreIfNeeded() {
        guard mediaHasMore, !loadingMoreMedia, !loadingMedia, mediaError == nil else { return }
        Task { await loadMedia(reset: false) }
    }

    private func reloadLoadedWindow() async {
        await loadMedia(reset: true)
    }

    private func errorMessage(for error: Error) -> String {
        libraryErrorMessage(for: error)
    }

    private func handleMediaMenu(_ action: MediaPosterMenuAction, media: LibraryMedia) {
        // A provisional row carries a negative placeholder id — nothing that
        // addresses the server may run against it.
        guard LibraryRowPresentation(media: media).isInteractive,
              !(action.requiresConnection && model.isOffline) else { return }
        switch action {
        case .toggleMonitored:
            Task { await toggleMonitored(media) }
        case .autoSearch:
            Task { await autoSearch(media) }
        case .searchReleases:
            releaseSearch = presentation(for: media)
        case .openDetails:
            menuDetailMedia = media
        case .removeFromLibrary:
            removeCandidate = media
            showingRemoveConfirm = true
        }
    }

    private func presentation(for media: LibraryMedia) -> ReleaseSearchPresentation {
        ReleaseSearchPresentation(
            query: media.title,
            libraryMediaId: media.id,
            tmdbId: media.tmdbId,
            mediaType: media.type == "show" ? "tv" : "movie"
        )
    }

    private func autoSearch(_ media: LibraryMedia) async {
        guard !busyMediaIds.contains(media.id) else { return }
        busyMediaIds.insert(media.id)
        defer { busyMediaIds.remove(media.id) }
        model.toast(String(localized: "Searching for a release…"), style: .info)
        let grabbed = await model.autoSearchMovie(libraryId: media.id) {
            releaseSearch = presentation(for: media)
        }
        if grabbed {
            await reloadLoadedWindow()
        }
    }

    private func handleBookMenu(_ action: BookCardMenuAction, book: BookListItem) {
        guard !busyBookIds.contains(book.bookId), !(action.requiresConnection && model.isOffline) else { return }
        switch action {
        case .read:
            readingBook = book
        case .play:
            busyBookIds.insert(book.bookId)
            Task {
                await playAudiobook(book)
                busyBookIds.remove(book.bookId)
            }
        case .markRead:
            model.confirmBookAction(.markRead(book))
        case .resetProgress:
            model.confirmBookAction(.resetProgress(book))
        case .removeDownload:
            model.confirmBookAction(.removeDownload(book))
        case .download:
            if let editionId = book.audiobookEditionId {
                Task { await model.startDownload(editionId: editionId) }
            }
        case .markUnread:
            busyBookIds.insert(book.bookId)
            Task {
                await model.setBookRead(book, read: false)
                busyBookIds.remove(book.bookId)
            }
        case .addAudiobook:
            busyBookIds.insert(book.bookId)
            Task {
                await addEdition(book: book, kind: "audiobook")
                busyBookIds.remove(book.bookId)
            }
        case .addEbook:
            busyBookIds.insert(book.bookId)
            Task {
                await addEdition(book: book, kind: "ebook")
                busyBookIds.remove(book.bookId)
            }
        case .rescan:
            busyBookIds.insert(book.bookId)
            Task {
                await rescanBook(book)
                busyBookIds.remove(book.bookId)
            }
        }
    }

    private func toggleMonitored(_ media: LibraryMedia) async {
        guard let client = model.api(), !busyMediaIds.contains(media.id) else { return }
        busyMediaIds.insert(media.id)
        do {
            // The store patches every cached copy before the request returns and
            // restores them if it fails, so scroll and loaded pages stay put.
            _ = try await store.updateMonitored(
                id: media.id,
                monitored: !media.monitored,
                request: { try await client.updateLibraryMonitored(id: media.id, monitored: !media.monitored) }
            )
            model.toast(media.monitored ? String(localized: "Unmonitored.") : String(localized: "Monitored."), style: .success)
        } catch {
            model.toast(errorMessage(for: error), style: .error)
        }
        busyMediaIds.remove(media.id)
    }

    private func removeFromLibrary(_ media: LibraryMedia, deleteFiles: Bool) async {
        guard let client = model.api() else { return }
        busyMediaIds.insert(media.id)
        do {
            // The row leaves every cached list at once instead of refetching page 1,
            // which would reset scroll and drop the pages already loaded, and comes
            // back if the request fails.
            try await store.removeLibraryItem(
                id: media.id,
                request: { try await client.removeFromLibrary(id: media.id, deleteFiles: deleteFiles) }
            )
            removeCandidate = nil
            model.toast(String(localized: "Removed from library."), style: .success)
            // Removing the last loaded row while more pages exist would strand the
            // list on an empty view with no sentinel to fire — pull the next page in.
            if self.media.isEmpty, mediaHasMore {
                await loadMedia(reset: true)
            }
        } catch {
            model.toast(errorMessage(for: error), style: .error)
        }
        busyMediaIds.remove(media.id)
    }

    private func playAudiobook(_ book: BookListItem) async {
        guard let editionId = book.audiobookEditionId else { return }
        await model.openPlayer(editionId: editionId)
        if model.errorMessage == nil {
            showingPlayer = true
        } else {
            model.toast(model.errorMessage ?? String(localized: "Could not start playback."), style: .error)
        }
    }

    private func addEdition(book: BookListItem, kind: String) async {
        guard let client = model.api() else { return }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
            model.toast(String(localized: "Added \(kind == "audiobook" ? "audiobook" : "ebook") edition."), style: .success)
        } catch {
            model.toast(errorMessage(for: error), style: .error)
        }
    }

    private func rescanBook(_ book: BookListItem) async {
        guard let client = model.api() else { return }
        do {
            if book.hasAudiobook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "audiobook")
            }
            if book.hasEbook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "ebook")
            }
            await model.loadLibrary()
            model.toast(String(localized: "Rescan started."), style: .success)
        } catch {
            model.toast(errorMessage(for: error), style: .error)
        }
    }
}
