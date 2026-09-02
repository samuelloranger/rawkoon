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
        _vm = State(initialValue: MediaDetailViewModel(
            tmdbId: tmdbId,
            mediaType: mediaType,
            title: title,
            posterPath: posterPath,
            libraryId: libraryId
        ))
    }

    @State private var vm: MediaDetailViewModel

    @State private var showingReleaseSearch = false
    @State private var showingRemoveConfirm = false
    @State private var menuReleaseSearch: ReleaseSearchPresentation?
    @State private var pendingRemoveLibraryId: Int?
    @State private var pendingRemoveTitle = ""
    @State private var similarMenuDetail: TmdbSearchItem?

    @State private var expandedFileIDs: Set<Int> = []
    @State private var expandedFileSeasons: Set<Int> = []

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
                if vm.details == nil {
                    guard let client = model.api() else {
                        vm.errorMessage = "Not logged in."
                        return
                    }
                    await vm.fetchDetails(client: client)
                }
            }
            .onChange(of: activeTab) { tab in
                guard tab == .similar, vm.similarItems.isEmpty, !vm.loadingSimilar else { return }
                Task {
                    guard let client = model.api() else {
                        vm.similarError = "Not logged in."
                        return
                    }
                    await vm.fetchSimilar(client: client)
                }
            }
            .onChange(of: activeTab) { tab in
                guard tab == .management, vm.managementItem == nil else { return }
                Task {
                    guard libraryId != nil, model.isAdmin else { return }
                    guard let client = model.api() else {
                        vm.managementError = "Not logged in."
                        return
                    }
                    await vm.refreshManagementData(client: client, isAdmin: model.isAdmin)
                }
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
                    availableSeasons: vm.details?.seasons?.map(\.seasonNumber) ?? []
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
                    Task {
                        guard let client = model.api() else { return }
                        switch await vm.removeLibraryItem(client: client, id: targetId, deleteFiles: deleteFiles) {
                        case .dismissed:
                            dismiss()
                        case .refreshedOthers:
                            await vm.fetchSimilar(client: client)
                        case .failed:
                            break
                        }
                    }
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
        if vm.loading, vm.details == nil {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        } else if let errorMessage = vm.errorMessage, vm.details == nil {
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
                AsyncImage(url: model.absoluteURL(vm.details?.primaryBackdropUrl)) { image in
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
                        Text(vm.metaLine)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.faint)
                        if let tagline = vm.details?.tagline, !tagline.isEmpty {
                            Text(tagline)
                                .font(.caption.italic())
                                .foregroundStyle(Theme.muted)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                    Button {
                        Task {
                            guard let client = model.api() else {
                                vm.requestError = "Not logged in."
                                return
                            }
                            await vm.toggleWatchlist(client: client)
                        }
                    } label: {
                        Image(systemName: vm.inWatchlist ? "bookmark.fill" : "bookmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(vm.inWatchlist ? Theme.terracotta : Theme.textStrong)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                            .background(Theme.base.opacity(0.55), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(vm.inWatchlist ? "Remove from watchlist" : "Add to watchlist")
                    .disabled(vm.watchlistPending)
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

    // MARK: Status + tabs

    private var statusRow: some View {
        HStack {
            if libraryId != nil || vm.added {
                StatusBadge(text: "In library", tint: Theme.seed)
            } else if vm.requested {
                StatusBadge(text: "Requested", tint: Theme.seed)
            } else if vm.inWatchlist {
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
        if let overview = vm.details?.overview, !overview.isEmpty {
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
                if !vm.requested, !vm.added {
                    Button {
                        Task {
                            guard let client = model.api() else {
                                vm.requestError = "Not logged in."
                                return
                            }
                            if model.isAdmin {
                                await vm.submitAdd(client: client)
                            } else {
                                await vm.submitRequest(client: client)
                            }
                        }
                    } label: {
                        Group {
                            if vm.requesting {
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
                    .disabled(vm.requesting)
                } else if vm.requested {
                    Text("We'll notify you when this is in the library. See Requests in Library.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
                if let requestError = vm.requestError {
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
        if vm.loadingSimilar {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        } else if let similarError = vm.similarError {
            ContentUnavailableView(
                "Couldn't load similar titles",
                systemImage: "exclamationmark.triangle",
                description: Text(similarError)
            )
            .padding(.top, 16)
        } else if vm.similarItems.isEmpty {
            ContentUnavailableView(
                "No similar titles",
                systemImage: "sparkles",
                description: Text("Try checking back later.")
            )
            .padding(.top, 16)
        } else {
            LazyVGrid(columns: similarColumns, spacing: 14) {
                ForEach(vm.similarItems) { item in
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
        } else if vm.managementLoading, vm.managementItem == nil {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        } else if let managementError = vm.managementError, vm.managementItem == nil {
            ContentUnavailableView(
                "Couldn't load management",
                systemImage: "exclamationmark.triangle",
                description: Text(managementError)
            )
            .padding(.top, 12)
        } else if let managementItem = vm.managementItem {
            VStack(alignment: .leading, spacing: 12) {
                managementSummaryCard(managementItem)
                managementControlsCard(managementItem)
                managementFilesCard
                managementDownloadsCard
                if let managementNotice = vm.managementNotice {
                    Text(managementNotice)
                        .font(.caption)
                        .foregroundStyle(Theme.apricotSoft)
                        .padding(.horizontal, 16)
                }
                if let managementError = vm.managementError {
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
                    Task {
                        guard let client = model.api() else { return }
                        await vm.applyMonitoredChange(client: client, newValue)
                    }
                }
            ))
            .tint(Theme.terracotta)
            .disabled(vm.applyingManagementChange)

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
                    Task {
                        guard let client = model.api() else { return }
                        await vm.applyQualityProfileChange(client: client, newValue == 0 ? nil : newValue)
                    }
                }
            )) {
                Text("None").tag(0)
                ForEach(vm.qualityProfiles) { profile in
                    Text(profile.name).tag(profile.id)
                }
            }
            .pickerStyle(.menu)
            .disabled(vm.applyingManagementChange)

            HStack(spacing: 8) {
                Button {
                    Task {
                        guard let client = model.api() else { return }
                        await vm.runRescan(client: client, isAdmin: model.isAdmin)
                    }
                } label: {
                    Label("Rescan files", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
                .disabled(vm.applyingManagementChange)

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
            .disabled(vm.applyingManagementChange)
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
                Text("\(vm.mediaFiles.count)")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }

            if vm.mediaFiles.isEmpty {
                Text("No file metadata yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else if vm.mediaFilesType == "show" {
                VStack(spacing: 8) {
                    ForEach(vm.groupedSeasonFiles, id: \.season) { group in
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
                    ForEach(vm.mediaFiles) { file in
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
                            if let res = vm.resolutionText(for: file) {
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
                            if let res = vm.resolutionText(for: file) {
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
        VStack(alignment: .leading, spacing: 6) {
            lineItem("Path", file.filePath)
            lineItem("Release group", file.releaseGroup ?? "Unknown")
            lineItem("Codec", [file.videoCodec, file.videoProfile].compactMap(\.self).joined(separator: " · "))
            lineItem("Source", file.source ?? "Unknown")
            lineItem("HDR", file.hdrFormat ?? "None")
            lineItem("Bit depth", file.bitDepth.map { "\($0)-bit" } ?? "Unknown")
            lineItem("Frame rate", file.frameRate.map { String(format: "%.2f fps", $0) } ?? "Unknown")
            lineItem("Video bitrate", file.videoBitrate.map { "\($0) kbps" } ?? "Unknown")
            lineItem("Audio tracks", vm.trackSummary(file.audioTracks))
            lineItem("Subtitle tracks", vm.subtitleSummary(file.subtitleTracks))
            if let scanned = vm.scannedDate(file.scannedAt) {
                lineItem("Scanned", scanned)
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
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
                    Task {
                        guard let client = model.api() else { return }
                        await vm.clearFailedDownloadsAction(client: client, isAdmin: model.isAdmin)
                    }
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.apricot)
                .disabled(vm.applyingManagementChange)
            }

            if vm.downloads.isEmpty {
                Text("No download history yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(vm.downloads) { row in
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
                    Text(vm.metaLine(for: row))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
                Spacer()
                if vm.pendingDownloadActionId == row.id {
                    ProgressView().tint(Theme.muted)
                } else if isActive {
                    Button(isPaused ? "Resume" : "Pause") {
                        Task {
                            guard let client = model.api() else { return }
                            await vm.performDownloadAction(client: client, row.id, action: isPaused ? "resume" : "pause", isAdmin: model.isAdmin)
                        }
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
                            guard let client = model.api() else { return }
                            if isActive {
                                await vm.performDownloadAction(client: client, row.id, action: "remove", isAdmin: model.isAdmin)
                            } else {
                                await vm.deleteDownloadEntryAction(client: client, row.id, isAdmin: model.isAdmin)
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

    // MARK: Details (movies)

    @ViewBuilder
    private var detailsSection: some View {
        if vm.hasDetailsToShow {
            VStack(alignment: .leading, spacing: 10) {
                Text("Details")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)

                VStack(spacing: 0) {
                    if let voteAverage = vm.details?.voteAverage, voteAverage > 0 {
                        detailRow(label: "Rating", value: String(format: "%.1f/10", voteAverage))
                    }
                    if let status = vm.details?.status, !status.isEmpty {
                        detailRow(label: "Status", value: status)
                    }
                    if let runtime = vm.details?.runtime, runtime > 0 {
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
        if let seasons = vm.details?.seasons, !seasons.isEmpty {
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
        let episodes = vm.episodesBySeason[season.seasonNumber]
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

    // MARK: Similar-menu dispatch

    private func handleSimilarMenu(_ action: MediaPosterMenuAction, item: TmdbSearchItem) {
        switch action {
        case .toggleMonitored:
            guard let libraryId = item.libraryId else { return }
            Task {
                guard let client = model.api() else { return }
                await vm.toggleSimilarMonitored(client: client, libraryId: libraryId)
            }
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
}
