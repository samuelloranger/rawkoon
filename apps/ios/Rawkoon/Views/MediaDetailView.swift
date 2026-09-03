import RawkoonKit
import SwiftUI

/// Pushed from Discover and Library. `mediaType` is TMDB-style ("movie"/"tv").
/// `libraryId` is non-nil when the title is already in the library.
struct MediaDetailView: View {
    @Environment(AppModel.self) private var model
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
    @State private var showingRemoveConfirm = false
    @State private var menuReleaseSearch: ReleaseSearchPresentation?
    @State private var pendingRemoveLibraryId: Int?
    @State private var pendingRemoveTitle = ""
    @State private var similarMenuDetail: TmdbSearchItem?

    @State private var episodesBySeason: [Int: [Episode]] = [:]
    @State private var similarItems: [TmdbSearchItem] = []
    @State private var loadingSimilar = false
    @State private var similarError: String?

    @State private var managementItem: LibraryMedia?
    @State private var managementLoading = false
    @State private var managementError: String?
    @State private var managementNotice: String?
    @State private var qualityProfiles: [QualityProfile] = []
    @State private var mediaFiles: [LibraryFileInfo] = []
    @State private var mediaFilesType: String = "movie"
    @State private var downloads: [DownloadHistoryItem] = []
    @State private var pendingDownloadActionId: Int?
    @State private var applyingManagementChange = false
    @State private var expandedFileIDs: Set<Int> = []
    @State private var expandedFileSeasons: Set<Int> = []

    @State private var remuxFileId: Int?
    @State private var remuxKeepAudio: Set<Int> = []
    @State private var remuxKeepSubtitle: Set<Int> = []
    @State private var remuxStarting = false
    @State private var remuxRunning = false

    @State private var activeTab: DetailTab = .info

    private enum DetailTab: String, CaseIterable, Identifiable {
        case info = "Info"
        case similar = "Similar"
        case search = "Search"
        case management = "Management"
        var id: String {
            rawValue
        }
    }

    private let similarColumns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    private let managementColumns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        rootScroll
            .background(Theme.base)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .task {
                if details == nil {
                    await fetchDetails()
                }
            }
            .onChange(of: activeTab) { tab in
                guard tab == .similar, similarItems.isEmpty, !loadingSimilar else { return }
                Task { await fetchSimilar() }
            }
            .onChange(of: activeTab) { tab in
                guard tab == .management, managementItem == nil else { return }
                Task { await refreshManagementData() }
            }
            .onChange(of: availableTabKey) { _ in
                if !availableTabs.contains(activeTab) {
                    activeTab = availableTabs.first ?? .info
                }
            }
            .sheet(isPresented: $showingReleaseSearch) {
                ReleaseSearchView(
                    query: title,
                    libraryMediaId: libraryId,
                    tmdbId: tmdbId,
                    mediaType: mediaType,
                    availableSeasons: details?.seasons?.map(\.seasonNumber) ?? []
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

    private var rootScroll: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                mainContent
            }
            .padding(.bottom, 24)
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
            hero
            statusRow
            primaryAction
            tabs
            tabContent
        }
    }

    private var availableTabs: [DetailTab] {
        var tabs: [DetailTab] = [.info, .similar]
        if model.isAdmin, libraryId != nil {
            tabs.append(.search)
            tabs.append(.management)
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
                            .foregroundStyle(inWatchlist ? Theme.terracotta : Theme.textStrong)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                            .background(Theme.base.opacity(0.55), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(inWatchlist ? "Remove from watchlist" : "Add to watchlist")
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
                StatusBadge(text: "Watchlist", tint: Theme.muted)
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

    @ViewBuilder
    private var primaryAction: some View {
        VStack(alignment: .leading, spacing: 8) {
            if libraryId == nil {
                if !requested, !added {
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
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.terracotta)
                    .foregroundStyle(Theme.onAccent)
                    .fontWeight(.semibold)
                    .disabled(requesting)
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
                Button {
                    showingReleaseSearch = true
                } label: {
                    Label("Search releases", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
            }
        }
        .padding(.horizontal, 16)
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
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var similarTab: some View {
        if loadingSimilar {
            ProgressView().tint(Theme.muted)
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
                        MediaPosterCard(
                            title: item.title,
                            posterURL: model.absoluteURL(item.posterUrl),
                            menuItems: mediaPosterMenuItems(
                                inLibrary: item.libraryId != nil,
                                isAdmin: model.isAdmin
                            ),
                            onMenuAction: { handleSimilarMenu($0, item: item) }
                        ) {
                            if item.alreadyExists == true {
                                Circle().fill(Theme.seed).frame(width: 22, height: 22)
                                    .overlay(Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: 0x10231A)))
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
        } else if managementLoading, managementItem == nil {
            ProgressView().tint(Theme.muted)
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
            .tint(Theme.terracotta)
            .disabled(applyingManagementChange)

            HStack {
                Text("Status")
                Spacer()
                Text(item.status.capitalized)
                    .foregroundStyle(Theme.muted)
            }
            .font(.subheadline)

            Text("Status is controlled by grabs and scans, not edited manually.")
                .font(.caption2)
                .foregroundStyle(Theme.faint)

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
                .tint(Theme.muted)
                .disabled(applyingManagementChange)

                Button {
                    showingReleaseSearch = true
                } label: {
                    Label("Search releases", systemImage: "magnifyingglass")
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
            }

            Button(role: .destructive) {
                pendingRemoveLibraryId = libraryId
                pendingRemoveTitle = title
                showingRemoveConfirm = true
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
                        VStack(spacing: 0) {
                            Button {
                                toggleFileSeason(group.season)
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: expandedFileSeasons.contains(group.season) ? "chevron.down" : "chevron.right")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(Theme.faint)
                                    Text(group.season == 0 ? "Specials" : "Season \(group.season)")
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
                                        seasonFileRow(file)
                                    }
                                }
                                .padding(.top, 8)
                            }
                        }
                    }
                }
            } else {
                VStack(spacing: 8) {
                    ForEach(mediaFiles) { file in
                        movieFileRow(file)
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
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

    private func seasonFileRow(_ file: LibraryFileInfo) -> some View {
        VStack(spacing: 0) {
            Button {
                toggleFileDetails(file.id)
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Text(file.episode.map { "E\(String(format: "%02d", $0))" } ?? "--")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .frame(width: 30, alignment: .leading)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(file.episodeTitle ?? file.fileName)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Theme.textStrong)
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            Text(Formatters.bytesEcho(file.sizeBytes))
                            if let duration = Formatters.durationCompact(file.durationSecs) {
                                Text(duration)
                            }
                            if let res = resolutionText(for: file) {
                                Text(res)
                            }
                        }
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Image(systemName: expandedFileIDs.contains(file.id) ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.faint)
                }
                .padding(10)
                .background(Theme.base.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)

            if expandedFileIDs.contains(file.id) {
                fileDetailBlock(file)
                    .padding(.top, 8)
            }
        }
    }

    private func movieFileRow(_ file: LibraryFileInfo) -> some View {
        VStack(spacing: 0) {
            Button {
                toggleFileDetails(file.id)
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(file.fileName)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Theme.textStrong)
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            Text(Formatters.bytesEcho(file.sizeBytes))
                            if let duration = Formatters.durationCompact(file.durationSecs) {
                                Text(duration)
                            }
                            if let res = resolutionText(for: file) {
                                Text(res)
                            }
                        }
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Image(systemName: expandedFileIDs.contains(file.id) ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.faint)
                }
                .padding(10)
                .background(Theme.base.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)

            if expandedFileIDs.contains(file.id) {
                fileDetailBlock(file)
                    .padding(.top, 8)
            }
        }
    }

    private func fileDetailBlock(_ file: LibraryFileInfo) -> some View {
        let isMkv = file.fileName.lowercased().hasSuffix(".mkv")
        let canRemux = model.isAdmin && isMkv && file.audioTracks.count > 1

        return VStack(alignment: .leading, spacing: 6) {
            lineItem("Path", file.filePath)
            lineItem("Release group", file.releaseGroup ?? "Unknown")
            lineItem("Codec", [file.videoCodec, file.videoProfile].compactMap(\.self).joined(separator: " · "))
            lineItem("Source", file.source ?? "Unknown")
            lineItem("HDR", file.hdrFormat ?? "None")
            lineItem("Bit depth", file.bitDepth.map { "\($0)-bit" } ?? "Unknown")
            lineItem("Frame rate", file.frameRate.map { String(format: "%.2f fps", $0) } ?? "Unknown")
            lineItem("Video bitrate", file.videoBitrate.map { "\($0) kbps" } ?? "Unknown")

            audioTracksBlock(file.audioTracks)
            subtitleTracksBlock(file.subtitleTracks)

            HStack {
                if let scanned = scannedDate(file.scannedAt) {
                    Text("Scanned \(scanned)")
                        .font(.caption2)
                        .foregroundStyle(Theme.faint)
                }
                Spacer()
                if canRemux, remuxFileId != file.id {
                    Button {
                        openRemux(file)
                    } label: {
                        Label("Remux", systemImage: "shuffle")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.apricot)
                }
            }
            .padding(.top, 2)

            if remuxFileId == file.id {
                remuxPanel(file)
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private func audioTracksBlock(_ tracks: [LibraryAudioTrack]) -> some View {
        if tracks.isEmpty {
            lineItem("Audio", "None")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("Audio (\(tracks.count))")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                ForEach(tracks) { tr in
                    trackRow(
                        lang: audioLanguage(tr),
                        details: audioDetails(tr),
                        badges: audioBadges(tr)
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func subtitleTracksBlock(_ tracks: [LibrarySubtitleTrack]) -> some View {
        if tracks.isEmpty {
            lineItem("Subtitles", "None")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("Subtitles (\(tracks.count))")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                ForEach(tracks) { tr in
                    trackRow(
                        lang: subtitleLanguage(tr),
                        details: subtitleDetails(tr),
                        badges: subtitleBadges(tr)
                    )
                }
            }
        }
    }

    private func trackRow(lang: String, details: String, badges: [(String, Color)]) -> some View {
        HStack(spacing: 8) {
            Text(lang)
                .font(.caption2.weight(.medium))
                .foregroundStyle(Theme.muted)
                .frame(width: 96, alignment: .leading)
                .lineLimit(1)
            Text(details.isEmpty ? "—" : details)
                .font(.caption2)
                .foregroundStyle(Theme.faint)
                .lineLimit(1)
            Spacer(minLength: 0)
            ForEach(Array(badges.enumerated()), id: \.offset) { _, badge in
                trackBadge(badge.0, color: badge.1)
            }
        }
    }

    private func trackBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private func frenchLabel(_ lang: String?) -> String? {
        guard let lang else { return nil }
        switch lang.uppercased() {
        case "VFF": return "VFF (France)"
        case "VFQ": return "VFQ (Québec)"
        case "VFI": return "VFI (International)"
        case "VF2": return "VF2"
        case "TRUEFRENCH": return "TRUEFRENCH"
        default: return nil
        }
    }

    private func audioLanguage(_ tr: LibraryAudioTrack) -> String {
        frenchLabel(tr.language) ?? tr.languageName ?? tr.language ?? "—"
    }

    private func audioDetails(_ tr: LibraryAudioTrack) -> String {
        [
            tr.codec,
            tr.channelLayout ?? tr.channels.map { "\($0)ch" },
            tr.bitrateKbps.map { "\($0) kbps" },
        ]
        .compactMap(\.self)
        .joined(separator: " · ")
    }

    private func audioBadges(_ tr: LibraryAudioTrack) -> [(String, Color)] {
        var badges: [(String, Color)] = []
        if tr.isDefault {
            badges.append(("Default", Theme.apricot))
        }
        if tr.forced {
            badges.append(("Forced", Theme.muted))
        }
        return badges
    }

    private func subtitleLanguage(_ tr: LibrarySubtitleTrack) -> String {
        frenchLabel(tr.language) ?? tr.languageName ?? tr.language ?? "—"
    }

    private func subtitleDetails(_ tr: LibrarySubtitleTrack) -> String {
        [tr.format, tr.title]
            .compactMap(\.self)
            .joined(separator: " · ")
    }

    private func subtitleBadges(_ tr: LibrarySubtitleTrack) -> [(String, Color)] {
        var badges: [(String, Color)] = []
        if tr.forced {
            badges.append(("Forced", Theme.muted))
        }
        if tr.hearingImpaired {
            badges.append(("HI", Theme.muted))
        }
        return badges
    }

    // MARK: Remux

    @ViewBuilder
    private func remuxPanel(_ file: LibraryFileInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("REMUX")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)

            VStack(alignment: .leading, spacing: 6) {
                Text("Keep audio tracks")
                    .font(.caption2)
                    .foregroundStyle(Theme.faint)
                ForEach(file.audioTracks) { tr in
                    remuxToggleRow(
                        kept: remuxKeepAudio.contains(tr.index),
                        lang: audioLanguage(tr),
                        details: audioDetails(tr)
                    ) { toggleRemuxAudio(tr.index) }
                }
            }

            if !file.subtitleTracks.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Keep subtitle tracks")
                        .font(.caption2)
                        .foregroundStyle(Theme.faint)
                    ForEach(file.subtitleTracks) { tr in
                        remuxToggleRow(
                            kept: remuxKeepSubtitle.contains(tr.index),
                            lang: subtitleLanguage(tr),
                            details: subtitleDetails(tr)
                        ) { toggleRemuxSubtitle(tr.index) }
                    }
                }
            }

            HStack(spacing: 12) {
                if remuxRunning || remuxStarting {
                    ProgressView().tint(Theme.muted)
                    Text(remuxStarting ? "Starting…" : "Remuxing…")
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                } else {
                    Button("Start remux") {
                        Task { await startRemux(file) }
                    }
                    .font(.caption.weight(.medium))
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.apricot)
                    .disabled(remuxKeepAudio.isEmpty)
                    Button("Cancel") { closeRemux() }
                        .font(.caption)
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.faint)
                }
            }
            .padding(.top, 2)
        }
        .padding(10)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 10))
    }

    private func remuxToggleRow(
        kept: Bool,
        lang: String,
        details: String,
        toggle: @escaping () -> Void
    ) -> some View {
        Button(action: toggle) {
            HStack(spacing: 8) {
                Image(systemName: kept ? "checkmark.square.fill" : "square")
                    .font(.caption)
                    .foregroundStyle(kept ? Theme.apricot : Theme.faint)
                Text(lang)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 90, alignment: .leading)
                    .lineLimit(1)
                Text(details.isEmpty ? "—" : details)
                    .font(.caption2)
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .opacity(kept ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(remuxRunning || remuxStarting)
    }

    private func openRemux(_ file: LibraryFileInfo) {
        remuxFileId = file.id
        remuxKeepAudio = Set(file.audioTracks.map(\.index))
        remuxKeepSubtitle = Set(file.subtitleTracks.map(\.index))
        remuxStarting = false
        remuxRunning = false
    }

    private func closeRemux() {
        remuxFileId = nil
        remuxKeepAudio = []
        remuxKeepSubtitle = []
        remuxStarting = false
        remuxRunning = false
    }

    private func toggleRemuxAudio(_ index: Int) {
        if remuxKeepAudio.contains(index) {
            if remuxKeepAudio.count <= 1 {
                return
            } // keep at least one audio track
            remuxKeepAudio.remove(index)
        } else {
            remuxKeepAudio.insert(index)
        }
    }

    private func toggleRemuxSubtitle(_ index: Int) {
        if remuxKeepSubtitle.contains(index) {
            remuxKeepSubtitle.remove(index)
        } else {
            remuxKeepSubtitle.insert(index)
        }
    }

    private func startRemux(_ file: LibraryFileInfo) async {
        guard let client = model.api() else {
            managementError = "Not logged in."
            return
        }
        remuxStarting = true
        do {
            _ = try await client.remuxFile(
                fileId: file.id,
                keepAudioTrackIndices: remuxKeepAudio.sorted(),
                keepSubtitleTrackIndices: remuxKeepSubtitle.sorted()
            )
            remuxStarting = false
            remuxRunning = true
            managementError = nil
            await pollRemux(fileId: file.id)
        } catch {
            remuxStarting = false
            managementError = "Could not start remux."
        }
    }

    private func pollRemux(fileId: Int) async {
        guard let client = model.api() else { return }
        for _ in 0 ..< 150 { // ~5 min cap at a 2s interval
            try? await Task.sleep(for: .seconds(2))
            if remuxFileId != fileId {
                return
            } // panel closed
            guard let status = try? await client.remuxFileStatus(fileId: fileId) else { continue }
            switch status.state {
            case "completed":
                switch status.result?.status {
                case "remuxed": managementNotice = "Remux complete."
                case "skipped": managementNotice = "Remux skipped — nothing to change."
                default: managementError = status.result?.message ?? "Remux failed."
                }
                closeRemux()
                await refreshManagementData()
                return
            case "failed":
                managementError = status.error ?? "Remux failed."
                closeRemux()
                await refreshManagementData()
                return
            default:
                continue
            }
        }
        remuxRunning = false
        managementNotice = "Remux still running in the background."
    }

    private func lineItem(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .frame(width: 90, alignment: .leading)
            Text(value.isEmpty ? "Unknown" : value)
                .font(.caption2)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
    }

    private func resolutionText(for file: LibraryFileInfo) -> String? {
        if let res = file.resolution {
            return "\(res)p"
        }
        if let width = file.width, let height = file.height {
            return "\(width)x\(height)"
        }
        return nil
    }

    private func scannedDate(_ isoDate: String) -> String? {
        guard let date = ISO8601DateFormatter().date(from: isoDate) else { return nil }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }

    private func toggleFileDetails(_ fileId: Int) {
        if expandedFileIDs.contains(fileId) {
            expandedFileIDs.remove(fileId)
        } else {
            expandedFileIDs.insert(fileId)
        }
    }

    private func toggleFileSeason(_ season: Int) {
        if expandedFileSeasons.contains(season) {
            expandedFileSeasons.remove(season)
        } else {
            expandedFileSeasons.insert(season)
        }
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
                    ProgressView().tint(Theme.muted)
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
                    Text("↓ \(Formatters.speed(live.downloadSpeed, useAll: false))")
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
                managementError = "Could not remove from library."
            } else {
                similarError = "Could not remove from library."
            }
        }
    }

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
        guard let client = model.api() else { return }
        do {
            let item = try await client.libraryItem(id: libraryId)
            _ = try await client.updateLibraryMonitored(id: libraryId, monitored: !item.monitored)
            await fetchSimilar()
        } catch {
            similarError = "Could not update monitoring."
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
        } catch let APIError.http(status) where status == 409 {
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
        } catch let APIError.http(status) where status == 409 {
            added = true
        } catch {
            requestError = "Could not add to library."
        }
    }
}
