import SwiftUI

// Pushed from Discover and Library. `mediaType` is TMDB-style ("movie"/"tv").
// `libraryId` is non-nil when the title is already in the library.
struct MediaDetailView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    let tmdbId: Int
    let mediaType: String
    let title: String
    let posterPath: String?
    let libraryId: Int?

    init(tmdbId: Int, mediaType: String, title: String, posterPath: String?, libraryId: Int?) {
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.title = title
        self.posterPath = posterPath
        self.libraryId = libraryId
    }

    @State private var details: TmdbMediaDetails?
    @State private var loading = false
    @State private var errorMessage: String?

    @State private var requesting = false
    @State private var requested = false
    @State private var added = false
    @State private var requestError: String?
    @State private var watchlistPending = false
    @State private var inWatchlist = false

    @State private var showingReleaseSearch = false

    @State private var episodesBySeason: [Int: [Episode]] = [:]
    @State private var similarItems: [TmdbSearchItem] = []
    @State private var loadingSimilar = false
    @State private var similarError: String?

    @State private var managementItem: LibraryMedia?
    @State private var managementLoading = false
    @State private var managementError: String?
    @State private var managementNotice: String?
    @State private var qualityProfiles: [QualityProfile] = []
    @State private var downloads: [DownloadHistoryItem] = []
    @State private var pendingDownloadActionId: Int?
    @State private var applyingManagementChange = false
    @State private var removeFilesOnDelete = false

    @State private var activeTab: DetailTab = .info

    private enum DetailTab: String, CaseIterable, Identifiable {
        case info = "Info"
        case similar = "Similar"
        case search = "Search"
        case management = "Management"
        case actions = "Actions"
        var id: String { rawValue }
    }

    private enum MutableLibraryStatus: String, CaseIterable, Identifiable {
        case wanted, downloading, downloaded, skipped

        var id: String { rawValue }

        var label: String {
            switch self {
            case .wanted: return "Missing"
            case .downloading: return "Downloading"
            case .downloaded: return "Downloaded"
            case .skipped: return "Skipped"
            }
        }
    }

    private let similarColumns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    private let managementColumns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if loading && details == nil {
                    ProgressView().tint(Theme.apricot)
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
                    hero
                    statusRow
                    tabs
                    tabContent
                }
            }
            .padding(.bottom, 24)
        }
        .background(Theme.base)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if details == nil {
                await fetchDetails()
            }
        }
        .onChange(of: activeTab) { _, tab in
            guard tab == .similar, similarItems.isEmpty, !loadingSimilar else { return }
            Task { await fetchSimilar() }
        }
        .onChange(of: activeTab) { _, tab in
            guard tab == .management, managementItem == nil else { return }
            Task { await refreshManagementData() }
        }
        .onChange(of: availableTabKey) { _, _ in
            if !availableTabs.contains(activeTab) {
                activeTab = availableTabs.first ?? .info
            }
        }
        .sheet(isPresented: $showingReleaseSearch) {
            ReleaseSearchView(query: title, libraryMediaId: libraryId, tmdbId: tmdbId, mediaType: mediaType)
                .environmentObject(model)
        }
    }

    private var availableTabs: [DetailTab] {
        var tabs: [DetailTab] = [.info, .similar]
        if model.isAdmin, libraryId != nil {
            tabs.append(.search)
            tabs.append(.management)
        } else {
            tabs.append(.actions)
        }
        return tabs
    }

    private var availableTabKey: String {
        availableTabs.map(\.rawValue).joined(separator: "|")
    }

    // MARK: Hero

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                AsyncImage(url: model.absoluteURL(details?.primaryBackdropUrl)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Theme.raised
                }
                .frame(height: 200)
                .clipped()

                LinearGradient(
                    colors: [.clear, Theme.base],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 200)

                HStack(alignment: .bottom, spacing: 14) {
                    posterThumb
                    VStack(alignment: .leading, spacing: 6) {
                        Text(title)
                            .font(.display(22))
                            .foregroundStyle(Theme.textStrong)
                            .lineLimit(3)
                        Text(metaLine)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.faint)
                        if let tagline = details?.tagline, !tagline.isEmpty {
                            Text(tagline)
                                .font(.caption.italic())
                                .foregroundStyle(Theme.muted)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                    Button {
                        Task { await toggleWatchlist() }
                    } label: {
                        Image(systemName: inWatchlist ? "bookmark.fill" : "bookmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(inWatchlist ? Theme.apricot : Theme.textStrong)
                            .frame(width: 34, height: 34)
                            .background(Theme.base.opacity(0.55), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(watchlistPending)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .frame(height: 200)
        }
    }

    private var posterThumb: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Theme.raised)
            .frame(width: 84, height: 126)
            .overlay(
                AsyncImage(url: model.absoluteURL(posterPath)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    LinearGradient(
                        colors: [Theme.terracottaDeep, Theme.apricot],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                }
                .frame(width: 84, height: 126)
                .clipped()
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
    }

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

    // MARK: Status + tabs

    private var statusRow: some View {
        HStack {
            if libraryId != nil || added {
                StatusBadge(text: "In library", tint: Theme.seed)
            } else if requested {
                StatusBadge(text: "Requested", tint: Theme.seed)
            } else if inWatchlist {
                StatusBadge(text: "Watchlist", tint: Theme.apricot)
            } else {
                StatusBadge(text: "Not added", tint: Theme.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
    }

    private var tabs: some View {
        Picker("Section", selection: $activeTab) {
            ForEach(availableTabs) { tab in
                Text(tab.rawValue).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var tabContent: some View {
        switch activeTab {
        case .info:
            infoTab
        case .similar:
            similarTab
        case .search:
            searchTab
        case .management:
            managementTab
        case .actions:
            actionsTab
        }
    }

    @ViewBuilder
    private var infoTab: some View {
        if let overview = details?.overview, !overview.isEmpty {
            Text(overview)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
        }
        if mediaType == "tv" {
            seasonsSection
        } else {
            detailsSection
        }
    }

    private var actionsTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            primaryAction
            if libraryId == nil && !inWatchlist {
                Text("Tip: add this title to your watchlist if you're not ready to request it yet.")
                    .font(.footnote)
                    .foregroundStyle(Theme.faint)
                    .padding(.horizontal, 16)
            }
        }
    }

    @ViewBuilder
    private var searchTab: some View {
        if libraryId == nil {
            ContentUnavailableView(
                "Add first",
                systemImage: "plus.circle",
                description: Text("Add this title to your library to run release searches.")
            )
            .padding(.top, 12)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Search and grab releases from your configured indexers.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                Button {
                    showingReleaseSearch = true
                } label: {
                    Label("Open interactive search", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity)
                        .frame(height: 24)
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var similarTab: some View {
        if loadingSimilar {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        } else if let similarError {
            ContentUnavailableView(
                "Couldn't load similar titles",
                systemImage: "exclamationmark.triangle",
                description: Text(similarError)
            )
            .padding(.top, 16)
        } else if similarItems.isEmpty {
            ContentUnavailableView(
                "No similar titles",
                systemImage: "sparkles",
                description: Text("Try checking back later.")
            )
            .padding(.top, 16)
        } else {
            LazyVGrid(columns: similarColumns, spacing: 14) {
                ForEach(similarItems) { item in
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            title: item.title,
                            posterPath: item.posterUrl,
                            libraryId: item.libraryId
                        )
                    } label: {
                        MediaPosterCard(title: item.title, posterURL: model.absoluteURL(item.posterUrl)) {
                            if item.alreadyExists == true {
                                Circle().fill(Theme.seed).frame(width: 22, height: 22)
                                    .overlay(Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: 0x10231a)))
                            } else {
                                Circle().fill(Theme.apricot).frame(width: 22, height: 22)
                                    .overlay(Image(systemName: "plus").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.onAccent))
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var managementTab: some View {
        if !model.isAdmin || libraryId == nil {
            ContentUnavailableView(
                "Admin only",
                systemImage: "lock",
                description: Text("Media management controls are available for admins on in-library titles.")
            )
            .padding(.top, 12)
        } else if managementLoading && managementItem == nil {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        } else if let managementError, managementItem == nil {
            ContentUnavailableView(
                "Couldn't load management",
                systemImage: "exclamationmark.triangle",
                description: Text(managementError)
            )
            .padding(.top, 12)
        } else if let managementItem {
            VStack(alignment: .leading, spacing: 12) {
                managementSummaryCard(managementItem)
                managementControlsCard(managementItem)
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
    }

    private func managementSummaryCard(_ item: LibraryMedia) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Current state")
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)
            LazyVGrid(columns: managementColumns, spacing: 8) {
                statPill("Status", value: item.status.capitalized)
                statPill("Type", value: item.type == "show" ? "TV show" : "Movie")
                statPill("Year", value: item.year.map(String.init) ?? "Unknown")
                statPill("Monitored", value: item.monitored ? "Yes" : "No")
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private func statPill(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
            Text(value)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.textStrong)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
    }

    private func managementControlsCard(_ item: LibraryMedia) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle("Monitored", isOn: Binding(
                get: { item.monitored },
                set: { newValue in
                    Task { await applyMonitoredChange(newValue) }
                }
            ))
            .tint(Theme.apricot)
            .disabled(applyingManagementChange)

            if let currentStatus = MutableLibraryStatus(rawValue: item.status) {
                Picker("Status", selection: Binding(
                    get: { currentStatus },
                    set: { newValue in
                        Task { await applyStatusChange(newValue.rawValue) }
                    }
                )) {
                    ForEach(MutableLibraryStatus.allCases) { status in
                        Text(status.label).tag(status)
                    }
                }
                .pickerStyle(.menu)
                .disabled(applyingManagementChange)
            } else {
                HStack {
                    Text("Status")
                    Spacer()
                    Text(item.status.capitalized)
                        .foregroundStyle(Theme.muted)
                }
                .font(.subheadline)
            }

            Picker("Quality profile", selection: Binding(
                get: { item.qualityProfileId ?? 0 },
                set: { newValue in
                    Task { await applyQualityProfileChange(newValue == 0 ? nil : newValue) }
                }
            )) {
                Text("None").tag(0)
                ForEach(qualityProfiles) { profile in
                    Text(profile.name).tag(profile.id)
                }
            }
            .pickerStyle(.menu)
            .disabled(applyingManagementChange)

            HStack(spacing: 8) {
                Button {
                    Task { await runRescan() }
                } label: {
                    Label("Rescan files", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
                .disabled(applyingManagementChange)

                Button {
                    showingReleaseSearch = true
                } label: {
                    Label("Search releases", systemImage: "magnifyingglass")
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }

            Toggle("Delete files on remove", isOn: $removeFilesOnDelete)
                .font(.footnote)
                .tint(Theme.apricot)

            Button(role: .destructive) {
                Task { await removeFromLibraryAction() }
            } label: {
                Label("Remove from library", systemImage: "trash")
                    .frame(maxWidth: .infinity)
                    .frame(height: 22)
            }
            .buttonStyle(.bordered)
            .tint(Theme.terracotta)
            .disabled(applyingManagementChange)
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
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
                        downloadHistoryRow(row)
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private func downloadHistoryRow(_ row: DownloadHistoryItem) -> some View {
        let isActive = row.live != nil && !row.failed && row.completedAt == nil
        let isPaused = row.live?.state.lowercased().contains("pause") == true

        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.releaseTitle)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    Text(metaLine(for: row))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
                Spacer()
                if pendingDownloadActionId == row.id {
                    ProgressView().tint(Theme.apricot)
                } else if isActive {
                    Button(isPaused ? "Resume" : "Pause") {
                        Task { await performDownloadAction(row.id, action: isPaused ? "resume" : "pause") }
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.apricot)
                }
            }

            if let live = row.live {
                DuskProgress(value: live.progress)
                HStack(spacing: 10) {
                    Text("↓ \(formatSpeed(live.downloadSpeed))")
                    Text("\(Int(live.progress * 100))%")
                    Text(live.state)
                }
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
            }

            if let failReason = row.failReason, !failReason.isEmpty {
                Text(failReason)
                    .font(.caption2)
                    .foregroundStyle(Theme.terracotta)
                    .lineLimit(2)
            } else if let postProcessError = row.postProcessError, !postProcessError.isEmpty {
                Text(postProcessError)
                    .font(.caption2)
                    .foregroundStyle(Theme.terracotta)
                    .lineLimit(2)
            }

            if row.failed || row.postProcessError != nil || isActive {
                HStack {
                    Spacer()
                    Button("Remove") {
                        Task {
                            if isActive {
                                await performDownloadAction(row.id, action: "remove")
                            } else {
                                await deleteDownloadEntryAction(row.id)
                            }
                        }
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.terracotta)
                }
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
    }

    private func metaLine(for row: DownloadHistoryItem) -> String {
        var parts: [String] = []
        if let indexer = row.indexer, !indexer.isEmpty {
            parts.append(indexer)
        }
        if row.failed {
            parts.append("failed")
        } else if row.completedAt != nil {
            parts.append("completed")
        } else if row.live != nil {
            parts.append("active")
        }
        if row.aiPicked == true {
            parts.append("AI pick")
        }
        return parts.joined(separator: " · ")
    }

    private func formatSpeed(_ bytesPerSecond: Double) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return "\(formatter.string(fromByteCount: Int64(bytesPerSecond)))/s"
    }

    @ViewBuilder
    private var primaryAction: some View {
        VStack(alignment: .leading, spacing: 8) {
            if libraryId == nil {
                if !requested && !added {
                    Button {
                        Task { model.isAdmin ? await submitAdd() : await submitRequest() }
                    } label: {
                        Group {
                            if requesting {
                                ProgressView().tint(Theme.onAccent)
                            } else {
                                Label(model.isAdmin ? "Add to library" : "Request",
                                      systemImage: model.isAdmin ? "plus.circle.fill" : "plus.circle")
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 26)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.apricot)
                    .foregroundStyle(Theme.onAccent)
                    .fontWeight(.semibold)
                    .disabled(requesting)
                }
                if let requestError {
                    Text(requestError)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            } else {
                Button {
                    showingReleaseSearch = true
                } label: {
                    Label("Search releases", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity)
                        .frame(height: 22)
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: Details (movies)

    @ViewBuilder
    private var detailsSection: some View {
        if hasDetailsToShow {
            VStack(alignment: .leading, spacing: 10) {
                Text("Details")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)

                VStack(spacing: 0) {
                    if let voteAverage = details?.voteAverage, voteAverage > 0 {
                        detailRow(label: "Rating", value: String(format: "%.1f/10", voteAverage))
                    }
                    if let status = details?.status, !status.isEmpty {
                        detailRow(label: "Status", value: status)
                    }
                    if let runtime = details?.runtime, runtime > 0 {
                        let hours = runtime / 60
                        let minutes = runtime % 60
                        let runtimeText = hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
                        detailRow(label: "Runtime", value: runtimeText)
                    }
                }
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
            }
            .padding(.horizontal, 16)
        }
    }

    private var hasDetailsToShow: Bool {
        (details?.voteAverage ?? 0) > 0
            || !(details?.status ?? "").isEmpty
            || (details?.runtime ?? 0) > 0
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack {
            Text(label.uppercased())
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
            Spacer()
            Text(value)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(Theme.text)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            Divider().overlay(Theme.border)
        }
    }

    // MARK: Seasons

    @ViewBuilder
    private var seasonsSection: some View {
        if let seasons = details?.seasons, !seasons.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Seasons")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)

                VStack(spacing: 8) {
                    ForEach(seasons.sorted(by: { $0.seasonNumber < $1.seasonNumber }), id: \.seasonNumber) { season in
                        if season.seasonNumber != 0 || season.episodeCount > 0 {
                            seasonRow(season)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func seasonRow(_ season: SeasonSummary) -> some View {
        let episodes = episodesBySeason[season.seasonNumber]
        let downloaded = episodes?.filter { $0.status == "downloaded" }.count
        let total = episodes?.count ?? season.episodeCount

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(season.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                if libraryId != nil {
                    Text("\(downloaded ?? 0)/\(total)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                } else {
                    Text("\(season.episodeCount) episodes")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                }
            }
            if libraryId != nil, total > 0 {
                DuskProgress(value: Double(downloaded ?? 0) / Double(total))
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: Networking

    private func fetchDetails() async {
        guard let client = model.api() else {
            errorMessage = "Not logged in."
            return
        }
        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            let response = try await client.mediaModal(mediaType: mediaType, tmdbId: tmdbId)
            details = response.details
            inWatchlist = response.watchlistStatus == true

            if mediaType == "tv", let libraryId {
                await fetchEpisodes(client: client, libraryId: libraryId)
            }
        } catch APIError.unauthorized {
            errorMessage = "Sign in required."
        } catch {
            errorMessage = "Could not load details."
        }
    }

    private func fetchSimilar() async {
        guard let client = model.api() else {
            similarError = "Not logged in."
            return
        }
        loadingSimilar = true
        similarError = nil
        defer { loadingSimilar = false }

        do {
            let response = try await client.similar(tmdbId: tmdbId, mediaType: mediaType)
            similarItems = response
        } catch APIError.unauthorized {
            similarError = "Sign in required."
        } catch {
            similarError = "Could not load similar titles."
        }
    }

    private func refreshManagementData() async {
        guard let libraryId, model.isAdmin else { return }
        guard let client = model.api() else {
            managementError = "Not logged in."
            return
        }
        managementLoading = true
        managementError = nil
        defer { managementLoading = false }

        do {
            async let itemRequest = client.libraryItem(id: libraryId)
            async let profileRequest = client.qualityProfiles()
            async let downloadsRequest = client.downloads(libraryId: libraryId)

            let item = try await itemRequest
            let profileResponse = try await profileRequest
            let downloadsResponse = try await downloadsRequest

            managementItem = item
            qualityProfiles = profileResponse.profiles
            downloads = downloadsResponse.items
        } catch APIError.unauthorized {
            managementError = "Admin only."
        } catch {
            managementError = "Could not load management data."
        }
    }

    private func applyMonitoredChange(_ monitored: Bool) async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            managementItem = try await client.updateLibraryMonitored(id: libraryId, monitored: monitored)
            managementNotice = "Monitoring updated."
            managementError = nil
        } catch {
            managementError = "Could not update monitoring."
        }
    }

    private func applyStatusChange(_ status: String) async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            managementItem = try await client.updateLibraryStatus(id: libraryId, status: status)
            managementNotice = "Status updated."
            managementError = nil
        } catch {
            managementError = "Could not update status."
        }
    }

    private func applyQualityProfileChange(_ qualityProfileId: Int?) async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            managementItem = try await client.updateLibraryQualityProfile(id: libraryId, qualityProfileId: qualityProfileId)
            managementNotice = "Quality profile updated."
            managementError = nil
        } catch {
            managementError = "Could not update quality profile."
        }
    }

    private func runRescan() async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let result = try await client.rescanLibraryItem(id: libraryId)
            managementNotice = "Rescan complete: \(result.rescanned) rescanned, \(result.imported) imported, \(result.deleted) deleted."
            managementError = nil
            await refreshManagementData()
        } catch {
            managementError = "Rescan failed."
        }
    }

    private func clearFailedDownloadsAction() async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let deleted = try await client.clearFailedDownloads(libraryId: libraryId)
            managementNotice = deleted == 0 ? "No failed downloads to clear." : "Cleared \(deleted) failed downloads."
            managementError = nil
            await refreshManagementData()
        } catch {
            managementError = "Could not clear failed downloads."
        }
    }

    private func performDownloadAction(_ downloadHistoryId: Int, action: String) async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.downloadAction(
                libraryId: libraryId,
                downloadHistoryId: downloadHistoryId,
                action: action
            )
            managementNotice = "Download updated."
            managementError = nil
            await refreshManagementData()
        } catch {
            managementError = "Could not update download."
        }
    }

    private func deleteDownloadEntryAction(_ downloadHistoryId: Int) async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.deleteDownloadEntry(libraryId: libraryId, downloadHistoryId: downloadHistoryId)
            managementNotice = "Download entry removed."
            managementError = nil
            await refreshManagementData()
        } catch {
            managementError = "Could not remove download entry."
        }
    }

    private func removeFromLibraryAction() async {
        guard let libraryId else { return }
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            try await client.removeFromLibrary(id: libraryId, deleteFiles: removeFilesOnDelete)
            dismiss()
        } catch {
            managementError = "Could not remove from library."
        }
    }

    private func toggleWatchlist() async {
        guard let client = model.api() else {
            requestError = "Not logged in."
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
            requestError = "Sign in required."
        } catch {
            requestError = "Could not update watchlist."
        }
    }

    private func fetchEpisodes(client: APIClient, libraryId: Int) async {
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

    private func submitRequest() async {
        guard let client = model.api() else {
            requestError = "Not logged in."
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
            year: yearValue
        )

        do {
            _ = try await client.createRequest(body)
            requested = true
        } catch APIError.unauthorized {
            requestError = "Sign in required."
        } catch APIError.http(let status) where status == 409 {
            requestError = "Already requested."
        } catch {
            requestError = "Could not submit request."
        }
    }

    // Admin: add straight to the library from TMDB.
    private func submitAdd() async {
        guard let client = model.api() else {
            requestError = "Not logged in."
            return
        }
        requesting = true
        requestError = nil
        defer { requesting = false }
        do {
            try await client.addToLibrary(tmdbId: tmdbId, type: mediaType == "tv" ? "show" : "movie")
            added = true
        } catch APIError.unauthorized {
            requestError = "Admin only."
        } catch APIError.http(let status) where status == 409 {
            added = true
        } catch {
            requestError = "Could not add to library."
        }
    }
}
