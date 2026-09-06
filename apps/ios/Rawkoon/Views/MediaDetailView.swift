import RawkoonKit
import SwiftUI

/// Pushed from Discover and Library. `mediaType` is TMDB-style ("movie"/"tv").
/// `libraryId` is non-nil when the title is already in the library.
///
/// One native scroll: info for everyone, and — for admins on in-library titles —
/// management sections (controls, files, downloads) folded inline. Grabs, file,
/// and monitor controls are gated on `model.isAdmin` because the server routes
/// they drive are admin-only.
struct MediaDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let tmdbId: Int
    let mediaType: String
    let title: String
    let posterPath: String?
    let libraryId: Int?
    /// Set when opened via a notification's `?tab=management` deep link (spec T6)
    /// — scrolls straight to the management sections once they're available.
    let focusManagement: Bool

    init(
        tmdbId: Int, mediaType: String, title: String, posterPath: String?, libraryId: Int?,
        focusManagement: Bool = false
    ) {
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.title = title
        self.posterPath = posterPath
        self.libraryId = libraryId
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
    @State private var applyingManagementChange = false
    /// In-flight live-event management refresh, cancelled before the next starts
    /// so a burst of SSE events can't run overlapping refreshes.
    @State private var liveReloadTask: Task<Void, Never>?
    @State private var expandedFileSeasons: Set<Int> = []

    private let similarColumns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    private var showManagement: Bool {
        model.isAdmin && libraryId != nil
    }

    var body: some View {
        let base = scrollBody
            .background(Theme.base)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: model.libraryChangeToken) { _, _ in
                guard showManagement, managementItem != nil else { return }
                liveReloadTask?.cancel()
                liveReloadTask = Task { await refreshManagementData() }
            }
        return attachDialogs(attachSheets(base))
    }

    private var scrollBody: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    mainContent
                }
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
                if focusManagement, showManagement {
                    withAnimation(reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.spring) {
                        proxy.scrollTo("management", anchor: .top)
                    }
                }
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
                    availableSeasons: releaseSearchSeason.map { [$0] } ?? (details?.seasons?.map(\.seasonNumber) ?? [])
                )
                .environment(model)
            }
            .sheet(item: $menuReleaseSearch) { target in
                ReleaseSearchView(
                    query: target.query,
                    libraryMediaId: target.libraryMediaId,
                    tmdbId: target.tmdbId,
                    mediaType: target.mediaType,
                    availableSeasons: []
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
                "Delete file?",
                isPresented: Binding(
                    get: { pendingMovieFileDelete != nil },
                    set: {
                        if !$0 {
                            pendingMovieFileDelete = nil
                        }
                    }
                ),
                titleVisibility: .visible,
                presenting: pendingMovieFileDelete
            ) { file in
                Button("Delete file", role: .destructive) { Task { await deleteMovieFileAction(file) } }
                Button("Cancel", role: .cancel) {}
            } message: { file in
                Text("“\(file.fileName)” will be removed from disk.")
            }
            .confirmationDialog(
                "Delete episode file?",
                isPresented: Binding(
                    get: { pendingEpisodeDelete != nil },
                    set: {
                        if !$0 {
                            pendingEpisodeDelete = nil
                        }
                    }
                ),
                titleVisibility: .visible,
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
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        } else if let errorMessage, details == nil {
            ContentUnavailableView(
                "Couldn't load details",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
            .padding(.top, 28)
        } else {
            DetailHero(
                title: title,
                posterPath: posterPath,
                backdropPath: details?.primaryBackdropUrl,
                metaLine: metaLine,
                tagline: details?.tagline,
                inWatchlist: inWatchlist,
                watchlistPending: watchlistPending,
                onToggleWatchlist: { Task { await toggleWatchlist() } }
            )
            statusRow
            primaryAction
            DetailFactsStrip(details: details, ratings: ratings, mediaType: mediaType, loading: loading)
            overview
            DetailCastRow(credits: credits, loading: loading)
            if DetailWhereToWatch.hasContent(trailer: trailer, providers: providers) {
                DetailWhereToWatch(trailer: trailer, providers: providers)
            }
            if mediaType == "tv" {
                seasonsSection
            }
            if showManagement {
                managementSections
            }
            similarSection
        }
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

    private var statusRow: some View {
        HStack {
            if libraryId != nil || added {
                StatusBadge(text: "In library", tint: Theme.seed)
            } else if requested {
                StatusBadge(text: "Requested", tint: Theme.seed)
            } else if inWatchlist {
                StatusBadge(text: "Watchlist", tint: Theme.muted)
            } else {
                StatusBadge(text: "Not added", tint: Theme.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var primaryAction: some View {
        VStack(alignment: .leading, spacing: 8) {
            if libraryId == nil {
                if !requested, !added {
                    lampButton(
                        title: model.isAdmin ? "Add to library" : "Request",
                        systemImage: model.isAdmin ? "plus.circle.fill" : "plus.circle",
                        busy: requesting
                    ) {
                        Task { model.isAdmin ? await submitAdd() : await submitRequest() }
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
            } else if model.isAdmin {
                // In-library, "Search releases" is a management action, not the
                // screen's one lamp — compact bordered, content-width.
                HStack(spacing: 10) {
                    Button {
                        releaseSearchSeason = nil
                        showingReleaseSearch = true
                    } label: {
                        Label("Search releases", systemImage: "magnifyingglass")
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.apricot)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.horizontal, 16)
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
            .frame(maxWidth: .infinity)
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
                onEpisodeDeleteFile: { episode in pendingEpisodeDelete = episode }
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
            ContentUnavailableView(
                "Couldn't load management",
                systemImage: "exclamationmark.triangle",
                description: Text(managementError)
            )
            .padding(.top, 8)
        } else if let managementItem {
            managementControlsCard(managementItem)
                .id("management")
            managementFilesCard
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
        VStack(alignment: .leading, spacing: 12) {
            Text("Management")
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)

            Toggle("Monitored", isOn: Binding(
                get: { item.monitored },
                set: { newValue in Task { await applyMonitoredChange(newValue) } }
            ))
            .tint(Theme.terracotta)
            .disabled(applyingManagementChange)

            HStack {
                Text("Status")
                Spacer()
                LocalizedStatus.text(item.status)
                    .foregroundStyle(Theme.muted)
            }
            .font(.subheadline)

            Text("Status is controlled by grabs and scans, not edited manually.")
                .font(.caption2)
                .foregroundStyle(Theme.faint)

            Picker("Quality profile", selection: Binding(
                get: { item.qualityProfileId ?? 0 },
                set: { newValue in Task { await applyQualityProfileChange(newValue == 0 ? nil : newValue) } }
            )) {
                Text("None").tag(0)
                ForEach(qualityProfiles) { profile in
                    Text(profile.name).tag(profile.id)
                }
            }
            .pickerStyle(.menu)
            .disabled(applyingManagementChange)

            HStack(spacing: 10) {
                Button {
                    Task { await runRescan() }
                } label: {
                    Label("Rescan files", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
                .disabled(applyingManagementChange)

                Spacer(minLength: 0)

                Button(role: .destructive) {
                    pendingRemoveLibraryId = libraryId
                    pendingRemoveTitle = title
                    showingRemoveConfirm = true
                } label: {
                    Label("Remove from library", systemImage: "trash")
                }
                .buttonStyle(.bordered)
                .tint(Theme.terracotta)
                .disabled(applyingManagementChange)
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private var managementFilesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Files")
                    .font(.display(16))
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
            } else if mediaFilesType == "show" {
                VStack(spacing: 8) {
                    ForEach(groupedSeasonFiles, id: \.season) { group in
                        seasonFileGroup(group)
                    }
                }
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

    private func seasonFileGroup(_ group: (season: Int, files: [LibraryFileInfo])) -> some View {
        VStack(spacing: 0) {
            Button {
                toggleFileSeason(group.season)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: expandedFileSeasons.contains(group.season) ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.faint)
                    Group {
                        if group.season == 0 {
                            Text("Specials")
                        } else {
                            Text("Season \(group.season)")
                        }
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textStrong)
                    Spacer()
                    Text("\(group.files.count) files")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                }
                .padding(10)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)

            if expandedFileSeasons.contains(group.season) {
                VStack(spacing: 8) {
                    ForEach(group.files) { file in
                        fileRow(file, mode: .episode)
                    }
                }
                .padding(.top, 8)
            }
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: expandedFileSeasons.contains(group.season))
    }

    private func fileRow(_ file: LibraryFileInfo, mode: DetailFileRow.Mode) -> some View {
        DetailFileRow(
            file: file,
            mode: mode,
            isAdmin: model.isAdmin,
            onChanged: { Task { await refreshManagementData() } },
            onNotice: { managementNotice = $0; managementError = nil },
            onError: { managementError = $0 },
            onRequestDelete: { pendingMovieFileDelete = file }
        )
    }

    private var groupedSeasonFiles: [(season: Int, files: [LibraryFileInfo])] {
        let grouped = Dictionary(grouping: mediaFiles) { $0.season ?? 0 }
        return grouped
            .map { season, files in
                (
                    season: season,
                    files: files.sorted { lhs, rhs in
                        if lhs.episode != rhs.episode {
                            return (lhs.episode ?? 0) < (rhs.episode ?? 0)
                        }
                        return lhs.fileName.localizedCaseInsensitiveCompare(rhs.fileName) == .orderedAscending
                    }
                )
            }
            .sorted { $0.season < $1.season }
    }

    private var managementDownloadsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Download history")
                    .font(.display(16))
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
                    ForEach(downloads) { row in
                        DetailDownloadRow(
                            row: row,
                            busy: pendingDownloadActionId == row.id,
                            onAction: { action in Task { await performDownloadAction(row.id, action: action) } },
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

    private func toggleFileSeason(_ season: Int) {
        if expandedFileSeasons.contains(season) {
            expandedFileSeasons.remove(season)
        } else {
            expandedFileSeasons.insert(season)
        }
    }

    // MARK: Similar

    @ViewBuilder
    private var similarSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Similar titles")
                .font(.display(17))
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 16)
            similarBody
        }
    }

    @ViewBuilder
    private var similarBody: some View {
        if loadingSimilar {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        } else if let similarError {
            Text(similarError)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
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
            managementItem = try await client.updateLibraryMonitored(id: libraryId, monitored: monitored)
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
            managementItem = try await client.updateLibraryQualityProfile(id: libraryId, qualityProfileId: qualityProfileId)
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
        } catch {
            managementError = String(localized: "Could not clear failed downloads.")
        }
    }

    private func performDownloadAction(_ downloadHistoryId: Int, action: String) async {
        guard let libraryId, let client = model.api() else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.downloadAction(libraryId: libraryId, downloadHistoryId: downloadHistoryId, action: action)
            managementNotice = String(localized: "Download updated.")
            managementError = nil
            await refreshManagementData()
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
            managementNotice = String(localized: "Download entry removed.")
            managementError = nil
            await refreshManagementData()
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
            managementNotice = String(localized: "File deleted.")
            managementError = nil
            await refreshManagementData()
        } catch {
            managementError = String(localized: "Could not delete file.")
        }
    }

    private func removeLibraryItem(id: Int, deleteFiles: Bool) async {
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            try await client.removeFromLibrary(id: id, deleteFiles: deleteFiles)
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
            _ = try await client.updateLibraryMonitored(id: libraryId, monitored: !item.monitored)
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
        do {
            try await client.addToLibrary(tmdbId: tmdbId, type: mediaType == "tv" ? "show" : "movie")
            added = true
        } catch APIError.unauthorized {
            requestError = String(localized: "Admin only.")
        } catch let APIError.http(status) where status == 409 {
            added = true
        } catch {
            requestError = String(localized: "Could not add to library.")
        }
    }
}
