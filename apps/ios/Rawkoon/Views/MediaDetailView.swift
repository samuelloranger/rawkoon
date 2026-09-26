import RawkoonKit
import SwiftUI

/// Pushed from Discover and Library. `mediaType` is TMDB-style ("movie"/"tv").
/// `libraryId` is non-nil when the title is already in the library.
///
/// A hero over an in-content segmented control (Info / Similar / Manage) that
/// mirrors the web app's detail tabs, so one section shows at a time instead of
/// one very long page. Manage (controls, files, downloads, overrides, artwork)
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
    /// — selects the Manage segment once it's available.
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
    @State var detailTab: DetailTab = .info

    /// The detail page's own sections, shown in an in-content segmented control
    /// under the hero (see `detailTabBar`). Mirrors the web app splitting detail
    /// into tabs, so only one section shows at a time instead of one very long
    /// page. Release search stays a sheet (the "Search releases" lamp in Manage),
    /// matching web.
    enum DetailTab: String, CaseIterable, Identifiable {
        case info, similar, manage
        var id: String {
            rawValue
        }

        var label: LocalizedStringKey {
            switch self {
            case .info: "Info"
            case .similar: "Similar"
            case .manage: "Manage"
            }
        }

        var systemImage: String {
            switch self {
            case .info: "info.circle"
            case .similar: "rectangle.stack"
            case .manage: "slider.horizontal.3"
            }
        }
    }

    /// Manage only exists for admins on in-library titles (same gate as the old
    /// inline management sections).
    var availableTabs: [DetailTab] {
        showManagement ? [.info, .similar, .manage] : [.info, .similar]
    }

    /// Guards against a stale `.manage` selection after an admin/library change
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await toggleWatchlist() }
                    } label: {
                        Image(systemName: inWatchlist ? "bookmark.fill" : "bookmark")
                    }
                    .accessibilityLabel(Text(LocalizedStringKey(inWatchlist ? "Remove from watchlist" : "Add to watchlist")))
                    .disabled(watchlistPending)
                }
            }
            .sensoryFeedback(RawkoonHaptics.feedback(for: .grab), trigger: requested)
            .sensoryFeedback(RawkoonHaptics.feedback(for: .libraryChanged), trigger: libraryChangeFeedback)
            .onChange(of: model.libraryChangeToken) { _, _ in
                guard showManagement, managementItem != nil else { return }
                liveReloadTask?.cancel()
                liveReloadTask = Task { await refreshManagementData() }
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
        .task {
            if details == nil {
                await fetchDetails()
            }
            if showManagement, managementItem == nil {
                await refreshManagementData()
            }
            if similarItems.isEmpty, !loadingSimilar {
                await fetchSimilar()
            }
            // Deep link "?tab=management" now selects the Manage segment instead
            // of scrolling a single long page to it.
            if focusManagement, showManagement {
                detailTab = .manage
            }
        }
    }

    func attachSheets(_ base: some View) -> some View {
        base
            .sheet(isPresented: $showingReleaseSearch, onDismiss: { releaseSearchSeason = nil }) {
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
                    onGrabbed: { Task { await refreshManagementData() } }
                )
                .environment(model)
            }
            .sheet(item: $menuReleaseSearch) { target in
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
            .sheet(item: $reencodeTarget) { target in
                ReencodeSheet(target: target) { count in
                    model.toast(String(localized: "\(count) files added to the re-encode queue"), style: .success)
                }
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
                }
            }
    }

    @ViewBuilder
    var mainContent: some View {
        if loading, details == nil {
            detailSkeleton
        } else if let errorMessage, details == nil {
            ContentUnavailableView(
                "Couldn't load details",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
            .padding(.top, 28)
        } else {
            // Hero + primary action stay pinned above the segmented content, the
            // way the web keeps the title header above its detail tabs.
            DetailHero(
                title: title,
                posterPath: posterPath,
                backdropPath: details?.primaryBackdropUrl,
                metaLine: metaLine,
                tagline: details?.tagline,
                statusText: detailStatusText,
                statusTint: detailStatusTint
            )
            primaryAction
            if availableTabs.count > 1 {
                detailTabBar
            }
            switch activeTab {
            case .info:
                infoSections
            case .similar:
                similarSection
            case .manage:
                if showManagement {
                    managementSections
                }
            }
        }
    }

    /// In-content tab switcher under the hero — an icon + label underline control
    /// that mirrors the web detail tabs. Deliberately NOT a bottom bar replacing
    /// the app tab bar: `.toolbar(.hidden, for: .tabBar)` is unreliable across iOS
    /// versions and a competing bottom strip double-stacks with the tab bar.
    var detailTabBar: some View {
        HStack(spacing: 0) {
            ForEach(availableTabs) { tab in
                let isActive = activeTab == tab
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { detailTab = tab }
                } label: {
                    VStack(spacing: 6) {
                        Label(tab.label, systemImage: tab.systemImage)
                            .labelStyle(.titleAndIcon)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(isActive ? Theme.textStrong : Theme.muted)
                            .lineLimit(1)
                        Capsule()
                            .fill(isActive ? Theme.apricot : Color.clear)
                            .frame(height: 2)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isActive ? .isSelected : [])
            }
        }
        .padding(.horizontal, 16)
        .overlay(alignment: .bottom) {
            Divider().overlay(Theme.border)
        }
    }

    @ViewBuilder
    var infoSections: some View {
        DetailFactsStrip(details: details, ratings: ratings, mediaType: mediaType, loading: loading)
        overview
        DetailCastRow(credits: credits, loading: loading)
        if DetailWhereToWatch.hasContent(trailer: trailer, providers: providers) {
            DetailWhereToWatch(trailer: trailer, providers: providers)
        }
        if mediaType == "tv" {
            seasonsSection
        }
    }

    /// Warm shimmer for the first paint: a hero band (backdrop + poster thumb +
    /// title lines) and a few overview lines, shaped like the real content.
    var detailSkeleton: some View {
        VStack(alignment: .leading, spacing: 18) {
            ZStack(alignment: .bottomLeading) {
                ShimmerView(cornerRadius: 0)
                    .frame(maxWidth: .infinity)
                    .frame(height: 260)
                HStack(alignment: .bottom, spacing: 16) {
                    ShimmerView(cornerRadius: 10)
                        .frame(width: 96, height: 144)
                    VStack(alignment: .leading, spacing: 8) {
                        ShimmerView(cornerRadius: 6).frame(width: 180, height: 26)
                        ShimmerView(cornerRadius: 4).frame(width: 90, height: 18)
                        ShimmerView(cornerRadius: 4).frame(width: 120, height: 12)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 260)

            VStack(alignment: .leading, spacing: 8) {
                ShimmerView(cornerRadius: 4).frame(height: 12)
                ShimmerView(cornerRadius: 4).frame(height: 12)
                ShimmerView(cornerRadius: 4).frame(width: 220, height: 12)
            }
            .padding(.horizontal, 16)
        }
        .allowsHitTesting(false)
    }

    var overview: some View {
        Group {
            if let overview = details?.overview, !overview.isEmpty {
                Text(overview)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 16)
            }
        }
    }

    // MARK: Status + primary action (the one lamp)

    /// The status shown as a pill in the hero (was a separate row before the
    /// hero redesign folded it under the title).
    var detailStatusText: String {
        if libraryId != nil || added {
            String(localized: "In library")
        } else if requested {
            String(localized: "Requested")
        } else if inWatchlist {
            String(localized: "Watchlist")
        } else {
            String(localized: "Not added")
        }
    }

    var detailStatusTint: Color {
        (libraryId != nil || added || requested) ? Theme.seed : Theme.muted
    }

    /// The add/request lamp for titles not yet in the library. In-library
    /// "Search releases" is no longer here — it moved into the Management card.
    @ViewBuilder
    var primaryAction: some View {
        if libraryId == nil {
            VStack(alignment: .leading, spacing: 8) {
                if !requested, !added {
                    HStack(spacing: 0) {
                        // On Mac/iPad the lamp sizes to its label and floats right
                        // instead of stretching the whole content width.
                        if isRegularWidth {
                            Spacer(minLength: 0)
                        }
                        lampButton(
                            title: model.isAdmin ? "Add to library" : "Request",
                            systemImage: model.isAdmin ? "plus.circle.fill" : "plus.circle",
                            busy: requesting
                        ) {
                            Task { model.isAdmin ? await submitAdd() : await submitRequest() }
                        }
                    }
                } else if requested {
                    Text("We'll notify you when this is in the library. See Requests in Library.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
                if let requestError {
                    Text(requestError)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    /// The single apricot lamp: the screen's one primary action.
    func lampButton(
        title: LocalizedStringKey,
        systemImage: String,
        busy: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if busy {
                    ProgressView().tint(Theme.onAccent)
                } else {
                    Label(title, systemImage: systemImage)
                }
            }
            .frame(maxWidth: isRegularWidth ? nil : .infinity)
            .padding(.horizontal, isRegularWidth ? 20 : 0)
            .frame(minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .tint(Theme.apricot)
        .foregroundStyle(Theme.onAccent)
        .fontWeight(.semibold)
        .breathingLamp(active: !busy)
        .disabled(busy)
    }

    // MARK: Seasons (interactive)

    @ViewBuilder
    var seasonsSection: some View {
        if let seasons = details?.seasons, !seasons.isEmpty {
            DetailSeasonsSection(
                seasons: seasons,
                episodesBySeason: episodesBySeason,
                filesBySeason: filesBySeason,
                inLibrary: libraryId != nil,
                isAdmin: model.isAdmin,
                onSeasonAutoSearch: { season in Task { await seasonAutoSearch(season) } },
                onSeasonReleaseSearch: { season in
                    releaseSearchSeason = season
                    showingReleaseSearch = true
                },
                onSeasonRetrySkipped: { season in Task { await seasonRetrySkipped(season) } },
                onSeasonToggleMonitor: { season, value in Task { await seasonToggleMonitor(season, value) } },
                onSeasonReencode: { season in
                    if let libraryId {
                        reencodeTarget = ReencodeTarget(
                            selection: TranscodeSelection(mediaId: libraryId, season: season),
                            subtitle: "\(title) · " + String(localized: "Season \(season)")
                        )
                    }
                },
                onFileReencode: { file in
                    reencodeTarget = ReencodeTarget(
                        selection: TranscodeSelection(fileIds: [file.id]),
                        subtitle: file.fileName
                    )
                },
                onEpisodeAutoSearch: { episode in Task { await episodeAutoSearch(episode) } },
                onEpisodeReleaseSearch: { episode in
                    releaseSearchSeason = episode.season
                    showingReleaseSearch = true
                },
                onEpisodeToggleMonitor: { episode in Task { await episodeToggleMonitor(episode) } },
                onEpisodeRetry: { episode in Task { await episodeRetry(episode) } },
                onEpisodeDeleteFile: { episode in pendingEpisodeDelete = episode },
                onFileChanged: { Task { await refreshManagementData() } },
                onFileNotice: { managementNotice = $0; managementError = nil },
                onFileError: { managementError = $0 }
            )
        }
    }

    // MARK: Similar

    @ViewBuilder
    var similarSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Similar titles")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 16)
            similarBody
        }
    }

    @ViewBuilder
    var similarBody: some View {
        if loadingSimilar {
            LazyVGrid(columns: similarColumns, spacing: 14) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        ShimmerView(cornerRadius: 10)
                            .aspectRatio(2.0 / 3.0, contentMode: .fit)
                        ShimmerView(cornerRadius: 4).frame(height: 12)
                    }
                }
            }
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
        } else if let similarError {
            VStack(alignment: .leading, spacing: 10) {
                Text(similarError)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                Button {
                    Task { await fetchSimilar() }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.horizontal, 16)
        } else if similarItems.isEmpty {
            Text("No similar titles.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
        } else {
            LazyVGrid(columns: similarColumns, spacing: 14) {
                ForEach(similarItems) { item in
                    similarCard(item)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    func similarCard(_ item: TmdbSearchItem) -> some View {
        NavigationLink {
            MediaDetailView(
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: item.title,
                posterPath: item.posterUrl,
                libraryId: item.libraryId
            )
        } label: {
            MediaPosterCard(
                title: item.title,
                posterURL: model.absoluteURL(item.posterUrl),
                menuItems: mediaPosterMenuItems(inLibrary: item.libraryId != nil, isAdmin: model.isAdmin),
                onMenuAction: { handleSimilarMenu($0, item: item) }
            ) {
                if let libraryId = item.libraryId, busySimilarLibraryIds.contains(libraryId) {
                    ProgressView().tint(Theme.apricot)
                } else if item.alreadyExists == true {
                    Circle().fill(Theme.seed).frame(width: 22, height: 22)
                        .overlay(Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: 0x10231A)))
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: Meta

    var metaLine: String {
        var parts: [String] = []
        if let year = yearValue {
            parts.append(String(year))
        }
        if mediaType == "tv" {
            parts.append("\(details?.numberOfSeasons ?? 0) seasons")
        } else if let runtime = details?.runtime, runtime > 0 {
            let hours = runtime / 60
            let minutes = runtime % 60
            parts.append(hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m")
        }
        if let genres = details?.genres, !genres.isEmpty {
            parts.append(genres.map(\.name).joined(separator: ", "))
        }
        return parts.joined(separator: " · ")
    }

    var yearValue: Int? {
        let raw = mediaType == "tv" ? details?.firstAirDate : details?.releaseDate
        guard let raw, raw.count >= 4 else { return nil }
        return Int(raw.prefix(4))
    }
}
