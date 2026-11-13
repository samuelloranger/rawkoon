import RawkoonKit
import SwiftUI

/// The one sheet the title page can present at a time.
enum MediaDetailSheet: Identifiable {
    case overrides(LibraryMedia)
    case artwork(LibraryMedia)
    case reencode(ReencodeTarget)
    case release
    case menuRelease(ReleaseSearchPresentation)
    case addToShelf(LibraryMedia)

    var id: String {
        switch self {
        case .overrides: "overrides"
        case .artwork: "artwork"
        case let .reencode(target): "reencode-\(target.id)"
        case .release: "release"
        case let .menuRelease(target): "menu-\(target.id)"
        case let .addToShelf(item): "add-to-shelf-\(item.id)"
        }
    }
}

/// Pushed from Discover and Library. `mediaType` is TMDB-style ("movie"/"tv").
/// `libraryId` is non-nil when the title is already in the library.
///
/// A hero over an in-content segmented control (Info / Similar / Files) that
/// mirrors the web app's detail tabs, so one section shows at a time instead of
/// one very long page. Files (seasons or the file card, then download history)
/// shows only for admins on in-library titles, because the server routes it
/// drives are admin-only.
struct MediaDetailView: View {
    @Environment(AppModel.self) var model
    @Environment(\.dismiss) var dismiss
    @Environment(\.horizontalSizeClass) var hSizeClass

    var isRegularWidth: Bool {
        hSizeClass == .regular
    }

    let tmdbId: Int
    let mediaType: String
    let title: String
    let posterPath: String?
    /// Mutable so a fresh "Add to library" can reveal the admin tabs/management
    /// in place — seeded from init, then set to the created item's id on add.
    @State var libraryId: Int?
    /// Set when opened via a notification's `?tab=management` deep link (spec T6)
    /// — selects the Files segment once it's available.
    let focusManagement: Bool

    init(
        tmdbId: Int, mediaType: String, title: String, posterPath: String?, libraryId: Int?,
        focusManagement: Bool = false
    ) {
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.title = title
        self.posterPath = posterPath
        _libraryId = State(initialValue: libraryId)
        self.focusManagement = focusManagement
    }

    @State var details: TmdbMediaDetails?
    @State var credits: MediaCredits?
    @State var trailer: MediaTrailer?
    @State var providers: WatchProviders?
    @State var ratings: MediaRatings?
    @State var loading = false
    @State var errorMessage: String?
    /// The details fetch had no answer and nothing was saved: show the hero and a calm note.
    @State var detailsUnreachable = false
    @State var didInitialLoad = false

    @State var requesting = false
    @State var requested = false
    @State var added = false
    @State var requestError: String?
    @State var watchlistPending = false
    @State var inWatchlist = false
    /// Changes only after a successful user-initiated library action, avoiding
    /// feedback when the initial detail fetch populates server state.
    @State var libraryChangeFeedback = 0

    @State var showingReleaseSearch = false
    /// When set, the release-search sheet opens scoped to a single season.
    @State var releaseSearchSeason: Int?
    @State var releaseSearchUpgrade = false
    @State var autoSearching = false
    /// False once the screen is popped, so a late auto-search result doesn't offer its sheet.
    @State var isOnScreen = false
    @State var releaseSearchEpisode: Int?
    @State var showingRemoveConfirm = false
    @State var menuReleaseSearch: ReleaseSearchPresentation?
    @State var pendingRemoveLibraryId: Int?
    @State var pendingRemoveTitle = ""
    @State var similarMenuDetail: TmdbSearchItem?
    @State var pendingMovieFileDelete: LibraryFileInfo?
    @State var pendingEpisodeDelete: Episode?
    @State var reencodeTarget: ReencodeTarget?

    @State var episodesBySeason: [Int: [Episode]] = [:]
    @State var similarItems: [TmdbSearchItem] = []
    @State var busySimilarLibraryIds: Set<Int> = []
    @State var loadingSimilar = false
    @State var similarError: String?

    @State var managementItem: LibraryMedia?
    /// Fetched when the caller opened the title without a poster, like a widget tap.
    @State var fetchedPosterPath: String?
    @State var managementLoading = false
    @State var managementError: String?
    @State var managementNotice: String?
    @State var qualityProfiles: [QualityProfile] = []
    @State var mediaFiles: [LibraryFileInfo] = []
    @State var mediaFilesType = "movie"
    @State var downloads: [DownloadHistoryItem] = []
    @State var pendingDownloadActionId: Int?
    @State var pendingDownloadRemoveId: Int?
    @State var applyingManagementChange = false
    @State var showingOverridesEditor = false
    @State var showingArtworkPicker = false
    @State var showingAddToShelf = false
    @State var detailTab: DetailTab = .info

    /// The detail page's own sections, shown in an in-content segmented control
    /// under the hero (see `detailTabBar`). Mirrors the web app splitting detail
    /// into tabs, so only one section shows at a time instead of one very long
    /// page. Release search stays a sheet (the strip's search button and lamp),
    /// matching web.
    enum DetailTab: String, CaseIterable, Identifiable {
        case info, similar, files
        var id: String {
            rawValue
        }

        var label: LocalizedStringKey {
            switch self {
            case .info: "Info"
            case .similar: "Similar"
            case .files: "Files"
            }
        }

        var systemImage: String {
            switch self {
            case .info: "info.circle"
            case .similar: "rectangle.stack"
            case .files: "doc.on.doc"
            }
        }
    }

    /// Files only exists for admins on in-library titles (same gate as the old
    /// inline management sections).
    var availableTabs: [DetailTab] {
        showManagement ? [.info, .similar, .files] : [.info, .similar]
    }

    /// Guards against a stale `.files` selection after an admin/library change
    /// removes that tab mid-view.
    var activeTab: DetailTab {
        availableTabs.contains(detailTab) ? detailTab : .info
    }

    /// In-flight live-event management refresh, cancelled before the next starts
    /// so a burst of SSE events can't run overlapping refreshes.
    @State var liveReloadTask: Task<Void, Never>?

    /// Phone (compact) keeps 3 up; regular width (iPad, Mac) packs more, smaller posters.
    var similarColumns: [GridItem] {
        if isRegularWidth {
            return [GridItem(.adaptive(minimum: 140, maximum: 180), spacing: 12)]
        }
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    var showManagement: Bool {
        model.isAdmin && libraryId != nil
    }

    var body: some View {
        let base = scrollBody
            .background(Theme.base)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if showManagement {
                    ToolbarItem(placement: .topBarTrailing) {
                        actionsMenu
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await toggleWatchlist() }
                    } label: {
                        Image(systemName: inWatchlist ? "bookmark.fill" : "bookmark")
                    }
                    .accessibilityLabel(Text(LocalizedStringKey(inWatchlist ? "Remove from watchlist" : "Add to watchlist")))
                    .disabled(watchlistPending)
                    .requiresConnection(model.isOffline)
                }
            }
            .sensoryFeedback(RawkoonHaptics.feedback(for: .grab), trigger: requested)
            .sensoryFeedback(RawkoonHaptics.feedback(for: .libraryChanged), trigger: libraryChangeFeedback)
            .onChange(of: model.libraryChangeToken) { _, _ in
                guard showManagement, managementItem != nil else { return }
                liveReloadTask?.cancel()
                liveReloadTask = Task { await refreshManagementData() }
            }
            // Painted from saved data while the server was out of reach: refetch once it's back.
            .onChange(of: model.reconnectToken) { _, _ in
                guard !loading else { return }
                Task {
                    await fetchDetails()
                    await fetchSimilar()
                    if showManagement, managementItem != nil {
                        await refreshManagementData()
                    }
                }
            }
        return attachDialogs(attachSheets(base))
    }

    var scrollBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                mainContent
            }
            // Cap to a readable measure and center on iPad/Mac; full-bleed on phone.
            .frame(maxWidth: isRegularWidth ? 980 : .infinity)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 24)
        }
        .onAppear {
            isOnScreen = true
            if let libraryId {
                model.liveSearch.detailAppeared(libraryId)
            }
            hydrateFromCache()
        }
        .onDisappear {
            isOnScreen = false
            if let libraryId {
                model.liveSearch.detailDisappeared(libraryId)
            }
        }
        .onChange(of: libraryId) { old, new in
            guard isOnScreen else { return }
            if let old {
                model.liveSearch.detailDisappeared(old)
            }
            if let new {
                model.liveSearch.detailAppeared(new)
            }
        }
        .onChange(of: model.releaseSheetRequest) { openRequestedReleaseSheet() }
        .task {
            // Saved copies painted on appear, so the first open always refetches;
            // a revisit only retries what is still missing.
            if !didInitialLoad || details == nil {
                await fetchDetails()
            }
            if showManagement, !didInitialLoad || managementItem == nil {
                await refreshManagementData()
            }
            if !didInitialLoad || similarItems.isEmpty, !loadingSimilar {
                await fetchSimilar()
            }
            didInitialLoad = true
            // Deep link "?tab=management" now selects the Manage segment instead
            // of scrolling a single long page to it.
            if focusManagement, showManagement {
                detailTab = .files
            }
            openRequestedReleaseSheet()
        }
    }

    func attachSheets(_ base: some View) -> some View {
        base
            .sheet(item: activeSheetBinding) { sheet in
                sheetContent(sheet)
            }
    }

    /// One sheet at a time: the request flags stay set while another sheet is up, so a second request waits its turn.
    var activeSheet: MediaDetailSheet? {
        if showingOverridesEditor, let item = managementItem {
            return .overrides(item)
        }
        if showingArtworkPicker, let item = managementItem {
            return .artwork(item)
        }
        if showingAddToShelf, let item = managementItem {
            return .addToShelf(item)
        }
        if let reencodeTarget {
            return .reencode(reencodeTarget)
        }
        if showingReleaseSearch {
            return .release
        }
        if let menuReleaseSearch {
            return .menuRelease(menuReleaseSearch)
        }
        return nil
    }

    var activeSheetBinding: Binding<MediaDetailSheet?> {
        Binding(
            get: { activeSheet },
            set: { newValue in
                guard newValue == nil, let current = activeSheet else { return }
                switch current {
                case .overrides: showingOverridesEditor = false
                case .artwork: showingArtworkPicker = false
                case .addToShelf: showingAddToShelf = false
                case .reencode: reencodeTarget = nil
                case .release:
                    showingReleaseSearch = false
                    releaseSearchSeason = nil
                    releaseSearchEpisode = nil
                    releaseSearchUpgrade = false
                case .menuRelease: menuReleaseSearch = nil
                }
            }
        )
    }

    @ViewBuilder
    func sheetContent(_ sheet: MediaDetailSheet) -> some View {
        switch sheet {
        case let .overrides(item):
            NavigationStack {
                LibraryOverridesEditorView(item: item) { updated in
                    managementItem = updated
                    managementNotice = String(localized: "Details updated.")
                }
                .environment(model)
            }
        case let .artwork(item):
            NavigationStack {
                LibraryArtworkPickerView(item: item) { updated in
                    managementItem = updated
                    managementNotice = String(localized: "Artwork updated.")
                }
                .environment(model)
            }
        case let .reencode(target):
            ReencodeSheet(target: target) { count in
                model.toast(String(localized: "\(count) files added to the re-encode queue"), style: .success)
            }
            .environment(model)
        case .release:
            ReleaseSearchView(
                query: title,
                libraryMediaId: libraryId,
                tmdbId: tmdbId,
                mediaType: mediaType,
                availableSeasons: releaseSearchSeason.map { [$0] } ?? (details?.seasons?.map(\.seasonNumber) ?? []),
                mediaYear: yearValue,
                originalTitle: details?.originalTitle,
                originalLanguage: details?.originalLanguage,
                titleTranslations: details?.titleTranslations ?? [],
                targetSeason: releaseSearchSeason,
                targetEpisode: releaseSearchEpisode,
                isUpgrade: releaseSearchUpgrade,
                onGrabbed: { Task { await refreshManagementData() } }
            )
            .environment(model)
        case let .addToShelf(item):
            AddToShelfSheet(item: item) {
                managementNotice = String(localized: "Shelf updated.")
            }
            .environment(model)
        case let .menuRelease(target):
            ReleaseSearchView(
                query: target.query,
                libraryMediaId: target.libraryMediaId,
                tmdbId: target.tmdbId,
                mediaType: target.mediaType,
                availableSeasons: [],
                onGrabbed: { Task { await refreshManagementData() } }
            )
            .environment(model)
        }
    }

    func attachDialogs(_ base: some View) -> some View {
        base
            .libraryRemoveConfirmation(
                isPresented: $showingRemoveConfirm,
                title: pendingRemoveTitle.isEmpty ? title : pendingRemoveTitle
            ) { deleteFiles in
                let targetId = pendingRemoveLibraryId ?? libraryId
                pendingRemoveLibraryId = nil
                pendingRemoveTitle = ""
                if let targetId {
                    Task { await removeLibraryItem(id: targetId, deleteFiles: deleteFiles) }
                }
            }
            .confirmationDialog(
                "Remove download?",
                isPresented: Binding(
                    get: { pendingDownloadRemoveId != nil },
                    set: {
                        if !$0 {
                            pendingDownloadRemoveId = nil
                        }
                    }
                ),
                presenting: pendingDownloadRemoveId
            ) { id in
                Button("Remove", role: .destructive) {
                    Task { await performDownloadAction(id, action: "remove") }
                }
                Button("Remove and delete files", role: .destructive) {
                    Task { await performDownloadAction(id, action: "remove", deleteFiles: true) }
                }
                Button("Cancel", role: .cancel) {}
            }
            .rawkoonConfirm(
                "Delete file?",
                isPresented: Binding(
                    get: { pendingMovieFileDelete != nil },
                    set: {
                        if !$0 {
                            pendingMovieFileDelete = nil
                        }
                    }
                ),
                presenting: pendingMovieFileDelete
            ) { file in
                Button("Delete file", role: .destructive) { Task { await deleteMovieFileAction(file) } }
                Button("Cancel", role: .cancel) {}
            } message: { file in
                Text("“\(file.fileName)” will be removed from disk.")
            }
            .rawkoonConfirm(
                "Delete episode file?",
                isPresented: Binding(
                    get: { pendingEpisodeDelete != nil },
                    set: {
                        if !$0 {
                            pendingEpisodeDelete = nil
                        }
                    }
                ),
                presenting: pendingEpisodeDelete
            ) { episode in
                Button("Delete file", role: .destructive) { Task { await deleteEpisodeFileAction(episode) } }
                Button("Cancel", role: .cancel) {}
            } message: { episode in
                Text("The file for “\(episode.title ?? "this episode")” will be removed from disk.")
            }
            .navigationDestination(isPresented: Binding(
                get: { similarMenuDetail != nil },
                set: {
                    if !$0 {
                        similarMenuDetail = nil
                    }
                }
            )) {
                if let item = similarMenuDetail {
                    MediaDetailView(
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterPath: item.posterUrl,
                        libraryId: item.libraryId
                    )
                    .rawkoonZoomDestination(similarZoomID(item))
                }
            }
    }
}
