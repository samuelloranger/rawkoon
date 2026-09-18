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
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var hSizeClass

    private var isRegularWidth: Bool {
        hSizeClass == .regular
    }

    let tmdbId: Int
    let mediaType: String
    let title: String
    let posterPath: String?
    /// Mutable so a fresh "Add to library" can reveal the admin tabs/management
    /// in place — seeded from init, then set to the created item's id on add.
    @State private var libraryId: Int?
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

    @State private var details: TmdbMediaDetails?
    @State private var credits: MediaCredits?
    @State private var trailer: MediaTrailer?
    @State private var providers: WatchProviders?
    @State private var ratings: MediaRatings?
    @State private var loading = false
    @State private var errorMessage: String?

    @State private var requesting = false
    @State private var requested = false
    @State private var added = false
    @State private var requestError: String?
    @State private var watchlistPending = false
    @State private var inWatchlist = false
    /// Changes only after a successful user-initiated library action, avoiding
    /// feedback when the initial detail fetch populates server state.
    @State private var libraryChangeFeedback = 0

    @State private var showingReleaseSearch = false
    /// When set, the release-search sheet opens scoped to a single season.
    @State private var releaseSearchSeason: Int?
    @State private var showingRemoveConfirm = false
    @State private var menuReleaseSearch: ReleaseSearchPresentation?
    @State private var pendingRemoveLibraryId: Int?
    @State private var pendingRemoveTitle = ""
    @State private var similarMenuDetail: TmdbSearchItem?
    @State private var pendingMovieFileDelete: LibraryFileInfo?
    @State private var pendingEpisodeDelete: Episode?

    @State private var episodesBySeason: [Int: [Episode]] = [:]
    @State private var similarItems: [TmdbSearchItem] = []
    @State private var busySimilarLibraryIds: Set<Int> = []
    @State private var loadingSimilar = false
    @State private var similarError: String?

    @State private var managementItem: LibraryMedia?
    @State private var managementLoading = false
    @State private var managementError: String?
    @State private var managementNotice: String?
    @State private var qualityProfiles: [QualityProfile] = []
    @State private var mediaFiles: [LibraryFileInfo] = []
    @State private var mediaFilesType = "movie"
    @State private var downloads: [DownloadHistoryItem] = []
    @State private var pendingDownloadActionId: Int?
    @State private var pendingDownloadRemoveId: Int?
    @State private var applyingManagementChange = false
    @State private var showingOverridesEditor = false
    @State private var showingArtworkPicker = false
    @State private var detailTab: DetailTab = .info

    /// The detail page's own sections, shown in an in-content segmented control
    /// under the hero (see `detailTabBar`). Mirrors the web app splitting detail
    /// into tabs, so only one section shows at a time instead of one very long
    /// page. Release search stays a sheet (the "Search releases" lamp in Manage),
    /// matching web.
    private enum DetailTab: String, CaseIterable, Identifiable {
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
    private var availableTabs: [DetailTab] {
        showManagement ? [.info, .similar, .manage] : [.info, .similar]
    }

    /// Guards against a stale `.manage` selection after an admin/library change
    /// removes that tab mid-view.
    private var activeTab: DetailTab {
        availableTabs.contains(detailTab) ? detailTab : .info
    }

    /// In-flight live-event management refresh, cancelled before the next starts
    /// so a burst of SSE events can't run overlapping refreshes.
    @State private var liveReloadTask: Task<Void, Never>?

    /// Phone (compact) keeps 3 up; regular width (iPad, Mac) packs more, smaller posters.
    private var similarColumns: [GridItem] {
        if isRegularWidth {
            return [GridItem(.adaptive(minimum: 140, maximum: 180), spacing: 12)]
        }
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    private var showManagement: Bool {
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

    private var scrollBody: some View {
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

    private func attachSheets(_ base: some View) -> some View {
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
    }

    private func attachDialogs(_ base: some View) -> some View {
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
    private var mainContent: some View {
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
    private var detailTabBar: some View {
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
    private var infoSections: some View {
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
    private var detailSkeleton: some View {
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

    private var overview: some View {
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
    private var detailStatusText: String {
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

    private var detailStatusTint: Color {
        (libraryId != nil || added || requested) ? Theme.seed : Theme.muted
    }

    /// The add/request lamp for titles not yet in the library. In-library
    /// "Search releases" is no longer here — it moved into the Management card.
    @ViewBuilder
    private var primaryAction: some View {
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
    private func lampButton(
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
    private var seasonsSection: some View {
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

    // MARK: Management (admin, in-library)

    @ViewBuilder
    private var managementSections: some View {
        if managementLoading, managementItem == nil {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        } else if let managementError, managementItem == nil {
            VStack(spacing: 12) {
                ContentUnavailableView(
                    "Couldn't load management",
                    systemImage: "exclamationmark.triangle",
                    description: Text(managementError)
                )
                Button {
                    Task { await refreshManagementData() }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.top, 8)
        } else if let managementItem {
            managementControlsCard(managementItem)
                .id("management")
            // TV files fold into the seasons section; only movies keep a card.
            if mediaType != "tv" {
                managementFilesCard
            }
            managementDownloadsCard
            if let managementNotice {
                Text(managementNotice)
                    .font(.caption)
                    .foregroundStyle(Theme.apricotSoft)
                    .padding(.horizontal, 16)
            }
            if let managementError {
                Text(managementError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
                    .padding(.horizontal, 16)
            }
        }
    }

    private func managementControlsCard(_ item: LibraryMedia) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Text("Management")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                if applyingManagementChange {
                    ProgressView().tint(Theme.muted)
                }
                // The item's edit / artwork / rescan / remove actions live in one
                // overflow menu so no single control has to carry a long label.
                Menu {
                    Button {
                        showingOverridesEditor = true
                    } label: {
                        Label("Edit info", systemImage: "pencil")
                    }
                    Button {
                        showingArtworkPicker = true
                    } label: {
                        Label("Change artwork", systemImage: "photo")
                    }
                    Button {
                        Task { await runRescan() }
                    } label: {
                        Label("Rescan files", systemImage: "arrow.clockwise")
                    }
                    Divider()
                    Button(role: .destructive) {
                        pendingRemoveLibraryId = libraryId
                        pendingRemoveTitle = title
                        showingRemoveConfirm = true
                    } label: {
                        Label("Remove from library", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(Theme.apricot)
                }
                .disabled(applyingManagementChange)
                .accessibilityLabel("More actions")
            }

            // The card's one lamp: searching releases is the primary reason an
            // admin opens Management.
            Button {
                releaseSearchSeason = nil
                showingReleaseSearch = true
            } label: {
                Label("Search releases", systemImage: "magnifyingglass")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.apricot)
            .foregroundStyle(Theme.onAccent)
            .fontWeight(.semibold)
            .disabled(applyingManagementChange)

            managementDivider

            // Monitoring + quality: what the library tracks and how.
            Toggle("Monitored", isOn: Binding(
                get: { item.monitored },
                set: { newValue in Task { await applyMonitoredChange(newValue) } }
            ))
            .tint(Theme.terracotta)
            .disabled(applyingManagementChange)

            managementFieldRow(label: "Status") {
                LocalizedStatus.text(item.status)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            Text("Status is controlled by grabs and scans, not edited manually.")
                .font(.caption2)
                .foregroundStyle(Theme.faint)

            qualityProfileField(item)
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
        .sheet(isPresented: $showingOverridesEditor) {
            NavigationStack {
                LibraryOverridesEditorView(item: item) { updated in
                    managementItem = updated
                    managementNotice = String(localized: "Details updated.")
                }
                .environment(model)
            }
        }
        .sheet(isPresented: $showingArtworkPicker) {
            NavigationStack {
                LibraryArtworkPickerView(item: item) { updated in
                    managementItem = updated
                    managementNotice = String(localized: "Artwork updated.")
                }
                .environment(model)
            }
        }
    }

    private var managementDivider: some View {
        Divider().overlay(Theme.border)
    }

    /// A label on the left, its control/value trailing — the row shape shared by
    /// the Status and Quality-profile lines.
    private func managementFieldRow(label: LocalizedStringKey, @ViewBuilder trailing: () -> some View) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(Theme.text)
            Spacer(minLength: 8)
            trailing()
        }
    }

    /// The quality-profile control on its own full-width line so a long profile
    /// name truncates instead of wrapping the label onto a second row.
    private func qualityProfileField(_ item: LibraryMedia) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Quality profile")
                .font(.subheadline)
                .foregroundStyle(Theme.text)
            Menu {
                Picker("Quality profile", selection: Binding(
                    get: { item.qualityProfileId ?? 0 },
                    set: { newValue in Task { await applyQualityProfileChange(newValue == 0 ? nil : newValue) } }
                )) {
                    Text("None").tag(0)
                    ForEach(qualityProfiles) { profile in
                        Text(profile.name).tag(profile.id)
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Text(qualityProfileName(for: item))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .frame(maxWidth: .infinity)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
            }
            .tint(Theme.apricot)
            .disabled(applyingManagementChange)
        }
    }

    /// The selected profile's name for the field label, or "None".
    private func qualityProfileName(for item: LibraryMedia) -> String {
        guard let id = item.qualityProfileId else { return String(localized: "None") }
        return qualityProfiles.first(where: { $0.id == id })?.name ?? String(localized: "None")
    }

    private var managementFilesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Files")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                Text("\(mediaFiles.count)")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }

            if mediaFiles.isEmpty {
                Text("No file metadata yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(mediaFiles) { file in
                        fileRow(file, mode: .movie)
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private func fileRow(_ file: LibraryFileInfo, mode: DetailFileRow.Mode) -> some View {
        DetailFileRow(
            file: file,
            mode: mode,
            isAdmin: model.isAdmin,
            onChanged: {
                if let libraryId {
                    store.invalidateLibraryRollup(itemID: libraryId)
                }
                Task { await refreshManagementData() }
            },
            onNotice: { managementNotice = $0; managementError = nil },
            onError: { managementError = $0 },
            onRequestDelete: { pendingMovieFileDelete = file }
        )
    }

    /// Library files keyed by season, for the seasons section. Empty unless
    /// admin + in-library (the only case `mediaFiles` is populated).
    private var filesBySeason: [Int: [LibraryFileInfo]] {
        guard mediaFilesType == "show" else { return [:] }
        return Dictionary(grouping: mediaFiles) { $0.season ?? 0 }
    }

    private var managementDownloadsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Download history")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                Button("Clear failed") {
                    Task { await clearFailedDownloadsAction() }
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.apricot)
                .disabled(applyingManagementChange)
            }

            if downloads.isEmpty {
                Text("No download history yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(liveDownloads) { row in
                        DetailDownloadRow(
                            row: row,
                            busy: pendingDownloadActionId == row.id,
                            onAction: { action in Task { await performDownloadAction(row.id, action: action) } },
                            onRemoveActive: { pendingDownloadRemoveId = row.id },
                            onDeleteEntry: { Task { await deleteDownloadEntryAction(row.id) } }
                        )
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    // MARK: Similar

    @ViewBuilder
    private var similarSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Similar titles")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 16)
            similarBody
        }
    }

    @ViewBuilder
    private var similarBody: some View {
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

    private func similarCard(_ item: TmdbSearchItem) -> some View {
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

    private var metaLine: String {
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

    private var yearValue: Int? {
        let raw = mediaType == "tv" ? details?.firstAirDate : details?.releaseDate
        guard let raw, raw.count >= 4 else { return nil }
        return Int(raw.prefix(4))
    }

    // MARK: Networking

    private func fetchDetails() async {
        guard let client = model.api() else {
            errorMessage = String(localized: "Not logged in.")
            return
        }
        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            let response = try await client.mediaModal(mediaType: mediaType, tmdbId: tmdbId)
            details = response.details
            credits = response.credits
            trailer = response.trailer
            providers = response.providers
            ratings = response.ratings
            inWatchlist = response.watchlistStatus == true

            if mediaType == "tv", let libraryId {
                await reloadEpisodes(client: client, libraryId: libraryId)
            }
        } catch APIError.unauthorized {
            errorMessage = String(localized: "Sign in required.")
        } catch {
            errorMessage = String(localized: "Could not load details.")
        }
    }

    private func fetchSimilar() async {
        guard let client = model.api() else {
            similarError = String(localized: "Not logged in.")
            return
        }
        loadingSimilar = true
        similarError = nil
        defer { loadingSimilar = false }

        do {
            similarItems = try await client.similar(tmdbId: tmdbId, mediaType: mediaType)
        } catch APIError.unauthorized {
            similarError = String(localized: "Sign in required.")
        } catch {
            similarError = String(localized: "Could not load similar titles.")
        }
    }

    private var store: ServerStateStore {
        model.serverStateStore
    }

    /// Download rows with server-pushed live progress overlaid. Reading
    /// `model.downloadProgress` here makes the section re-render on each
    /// `.downloadProgress` SSE event, so the progress bar tracks the live value
    /// between fetches — no client poll.
    private var liveDownloads: [DownloadHistoryItem] {
        guard let libraryId, let progress = model.downloadProgress[libraryId]
        else { return downloads }
        return overlayDownloadProgress(downloads, progress: progress)
    }

    private func refreshManagementData() async {
        guard let libraryId, model.isAdmin else { return }
        guard let client = model.api() else {
            managementError = String(localized: "Not logged in.")
            return
        }
        managementLoading = true
        managementError = nil
        defer { managementLoading = false }

        do {
            async let itemRequest = client.libraryItem(id: libraryId)
            async let profileRequest = client.qualityProfiles()
            async let filesRequest = client.libraryFiles(id: libraryId)
            async let downloadsRequest = client.downloads(libraryId: libraryId)

            let item = try await itemRequest
            let profileResponse = try await profileRequest
            let filesResponse = try await filesRequest
            let downloadsResponse = try await downloadsRequest

            managementItem = item
            store.seedLibraryItem(item)
            qualityProfiles = profileResponse.profiles
            mediaFilesType = filesResponse.mediaType
            mediaFiles = filesResponse.files
            downloads = downloadsResponse.items
        } catch APIError.unauthorized {
            managementError = String(localized: "Admin only.")
        } catch {
            managementError = String(localized: "Could not load management data.")
        }
    }

    private func reloadEpisodes(client: APIClient, libraryId: Int) async {
        do {
            let response = try await client.libraryEpisodes(id: libraryId)
            var map: [Int: [Episode]] = [:]
            for season in response.seasons {
                map[season.season] = season.episodes
            }
            episodesBySeason = map
        } catch {
            // Non-fatal: seasons still render with episode counts from TMDB.
        }
    }

    private func reloadEpisodes() async {
        guard mediaType == "tv", let libraryId, let client = model.api() else { return }
        await reloadEpisodes(client: client, libraryId: libraryId)
    }

    // MARK: Management actions

    private func applyMonitoredChange(_ monitored: Bool) async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            managementItem = try await store.updateMonitored(
                id: libraryId,
                monitored: monitored,
                request: { try await client.updateLibraryMonitored(id: libraryId, monitored: monitored) }
            )
            managementNotice = String(localized: "Monitoring updated.")
            managementError = nil
        } catch {
            managementError = String(localized: "Could not update monitoring.")
        }
    }

    private func applyQualityProfileChange(_ qualityProfileId: Int?) async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            managementItem = try await store.updateQualityProfile(
                id: libraryId,
                qualityProfileId: qualityProfileId,
                request: { try await client.updateLibraryQualityProfile(id: libraryId, qualityProfileId: qualityProfileId) }
            )
            managementNotice = String(localized: "Quality profile updated.")
            managementError = nil
        } catch {
            managementError = String(localized: "Could not update quality profile.")
        }
    }

    private func runRescan() async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let result = try await client.rescanLibraryItem(id: libraryId)
            managementNotice = String(localized: "Rescan complete: \(result.rescanned) rescanned, \(result.imported) imported, \(result.deleted) deleted.")
            managementError = nil
            await refreshManagementData()
        } catch {
            managementError = String(localized: "Rescan failed.")
        }
    }

    private func clearFailedDownloadsAction() async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let deleted = try await client.clearFailedDownloads(libraryId: libraryId)
            managementNotice = deleted == 0 ? String(localized: "No failed downloads to clear.") : String(localized: "Cleared \(deleted) failed downloads.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not clear failed downloads.")
        }
    }

    private func performDownloadAction(_ downloadHistoryId: Int, action: String, deleteFiles: Bool = false) async {
        guard let libraryId, let client = model.api() else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.downloadAction(
                libraryId: libraryId,
                downloadHistoryId: downloadHistoryId,
                action: action,
                deleteFiles: deleteFiles
            )
            store.invalidateDownloadHistory(itemID: libraryId)
            managementNotice = String(localized: "Download updated.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not update download.")
        }
    }

    private func deleteDownloadEntryAction(_ downloadHistoryId: Int) async {
        guard let libraryId, let client = model.api() else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.deleteDownloadEntry(libraryId: libraryId, downloadHistoryId: downloadHistoryId)
            store.invalidateDownloadHistory(itemID: libraryId)
            managementNotice = String(localized: "Download entry removed.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not remove download entry.")
        }
    }

    private func deleteMovieFileAction(_ file: LibraryFileInfo) async {
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            try await client.deleteMovieFile(fileId: file.id)
            if let libraryId {
                store.invalidateLibraryRollup(itemID: libraryId)
            }
            managementNotice = String(localized: "File deleted.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not delete file.")
        }
    }

    private func removeLibraryItem(id: Int, deleteFiles: Bool) async {
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            try await store.removeLibraryItem(
                id: id,
                request: { try await client.removeFromLibrary(id: id, deleteFiles: deleteFiles) }
            )
            if id == libraryId {
                dismiss()
            } else {
                await fetchSimilar()
            }
        } catch {
            if id == libraryId {
                managementError = String(localized: "Could not remove from library.")
            } else {
                similarError = String(localized: "Could not remove from library.")
            }
        }
    }

    // MARK: Season / episode actions (admin)

    private func seasonAutoSearch(_ season: Int) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            let result = try await client.searchSeason(id: libraryId, season: season)
            reportGrab(result)
            await reloadEpisodes()
            await refreshManagementData()
        } catch {
            model.toast(String(localized: "Season search failed."), style: .error)
        }
    }

    private func seasonRetrySkipped(_ season: Int) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            let retried = try await client.retrySkippedSeason(id: libraryId, season: season)
            model.toast(String(localized: "Reset \(retried) skipped episodes."), style: .success)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not retry skipped episodes."), style: .error)
        }
    }

    private func seasonToggleMonitor(_ season: Int, _ monitored: Bool) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            _ = try await client.setSeasonMonitored(id: libraryId, season: season, monitored: monitored)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not update monitoring."), style: .error)
        }
    }

    private func episodeAutoSearch(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            let result = try await client.searchEpisode(id: libraryId, episodeId: episode.id)
            reportGrab(result)
            await reloadEpisodes()
            await refreshManagementData()
        } catch {
            model.toast(String(localized: "Episode search failed."), style: .error)
        }
    }

    private func episodeToggleMonitor(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            _ = try await client.setEpisodeMonitored(id: libraryId, episodeId: episode.id, monitored: !episode.monitored)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not update monitoring."), style: .error)
        }
    }

    private func episodeRetry(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            _ = try await client.setEpisodeStatus(id: libraryId, episodeId: episode.id, status: "wanted")
            model.toast(String(localized: "Episode marked wanted."), style: .success)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not update episode."), style: .error)
        }
    }

    private func deleteEpisodeFileAction(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            try await client.deleteEpisodeFile(id: libraryId, episodeId: episode.id)
            store.invalidateLibraryRollup(itemID: libraryId)
            model.toast(String(localized: "Episode file deleted."), style: .success)
            await reloadEpisodes()
            await refreshManagementData()
        } catch {
            model.toast(String(localized: "Could not delete episode file."), style: .error)
        }
    }

    private func reportGrab(_ result: LibrarySearchResponse) {
        if result.grabbed {
            model.toast(String(localized: "Grabbed \(result.releaseTitle ?? "a release")."), style: .success)
        } else {
            model.toast(result.reason ?? String(localized: "No release grabbed."), style: .info)
        }
    }

    // MARK: Similar menu

    private func handleSimilarMenu(_ action: MediaPosterMenuAction, item: TmdbSearchItem) {
        switch action {
        case .toggleMonitored:
            guard let libraryId = item.libraryId else { return }
            Task { await toggleSimilarMonitored(libraryId: libraryId) }
        case .searchReleases:
            menuReleaseSearch = ReleaseSearchPresentation(
                query: item.title,
                libraryMediaId: item.libraryId,
                tmdbId: item.tmdbId,
                mediaType: item.mediaType
            )
        case .openDetails:
            similarMenuDetail = item
        case .removeFromLibrary:
            guard let libraryId = item.libraryId else { return }
            pendingRemoveTitle = item.title
            pendingRemoveLibraryId = libraryId
            showingRemoveConfirm = true
        }
    }

    private func toggleSimilarMonitored(libraryId: Int) async {
        guard let client = model.api(), !busySimilarLibraryIds.contains(libraryId) else { return }
        busySimilarLibraryIds.insert(libraryId)
        do {
            let item = try await client.libraryItem(id: libraryId)
            _ = try await store.updateMonitored(
                id: libraryId,
                monitored: !item.monitored,
                request: { try await client.updateLibraryMonitored(id: libraryId, monitored: !item.monitored) }
            )
            await fetchSimilar()
            model.toast(String(localized: "Updated monitoring."), style: .success)
        } catch {
            model.toast(String(localized: "Could not update monitoring."), style: .error)
        }
        busySimilarLibraryIds.remove(libraryId)
    }

    // MARK: Watchlist / request / add

    private func toggleWatchlist() async {
        guard let client = model.api() else {
            requestError = String(localized: "Not logged in.")
            return
        }
        watchlistPending = true
        defer { watchlistPending = false }

        do {
            if inWatchlist {
                try await client.removeFromWatchlist(tmdbId: tmdbId, mediaType: mediaType)
                inWatchlist = false
            } else {
                try await client.addToWatchlist(
                    tmdbId: tmdbId,
                    mediaType: mediaType,
                    title: title,
                    posterURL: posterPath,
                    overview: details?.overview,
                    releaseYear: yearValue,
                    voteAverage: details?.voteAverage,
                    releaseDate: mediaType == "tv" ? details?.firstAirDate : details?.releaseDate
                )
                inWatchlist = true
            }
            recordLibraryChangeFeedback()
        } catch APIError.unauthorized {
            requestError = String(localized: "Sign in required.")
        } catch {
            requestError = String(localized: "Could not update watchlist.")
        }
    }

    private func submitRequest() async {
        guard let client = model.api() else {
            requestError = String(localized: "Not logged in.")
            return
        }
        requesting = true
        requestError = nil
        defer { requesting = false }

        let body = CreateRequestBody(
            tmdbId: tmdbId,
            type: mediaType == "tv" ? "show" : "movie",
            title: title,
            posterUrl: posterPath,
            year: yearValue,
            googleVolumeId: nil,
            author: nil
        )

        do {
            _ = try await client.createRequest(body)
            requested = true
        } catch APIError.unauthorized {
            requestError = String(localized: "Sign in required.")
        } catch let APIError.http(status) where status == 409 {
            requestError = String(localized: "Already requested.")
        } catch {
            requestError = String(localized: "Could not submit request.")
        }
    }

    // Admin: add straight to the library from TMDB.
    private func submitAdd() async {
        guard let client = model.api() else {
            requestError = String(localized: "Not logged in.")
            return
        }
        requesting = true
        requestError = nil
        defer { requesting = false }
        let type = mediaType == "tv" ? "show" : "movie"
        do {
            // The store shows an `Adding…` row in Library immediately and swaps in
            // the server's created item — or drops it again if the add fails.
            let item = try await model.serverStateStore.addToLibrary(
                provisional: .provisional(
                    tmdbId: tmdbId,
                    type: type,
                    title: title,
                    year: yearValue,
                    posterUrl: posterPath,
                    overview: details?.overview
                ),
                request: { try await client.addToLibrary(tmdbId: tmdbId, type: type) }
            )
            added = true
            // Reveal the admin tabs (Manage hosts the grab surface) in place, land
            // there, and load its data — no reopen needed to grab what was just added.
            libraryId = item.id
            recordLibraryChangeFeedback()
            if showManagement {
                detailTab = .manage
                await refreshManagementData()
            }
        } catch APIError.unauthorized {
            requestError = String(localized: "Admin only.")
        } catch let APIError.http(status) where status == 409 {
            added = true
        } catch {
            requestError = String(localized: "Could not add to library.")
        }
    }

    private func recordLibraryChangeFeedback() {
        libraryChangeFeedback &+= 1
    }
}
