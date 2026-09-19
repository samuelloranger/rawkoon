import RawkoonKit
import SwiftUI

/// Presented as a sheet from MediaDetailView. Interactive indexer search + grab.
struct ReleaseSearchView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let libraryMediaId: Int?
    let tmdbId: Int?
    let mediaType: String
    let availableSeasons: [Int]
    /// Expected release year, fed into the client-side rejection heuristic in
    /// search mode. The call site wires it separately; nil disables the year check.
    let mediaYear: Int?
    /// The library (English) title the sheet opened with — the base for the
    /// language/title picker; `searchQuery` may then change to another language.
    let localizedTitle: String
    /// TMDB original title + language code + per-language titles, for the picker
    /// (Phase 5). The original title lets the picker offer the original-language
    /// entry even when it has no distinct translation row (e.g. an English film
    /// stored under its French title).
    let originalTitle: String?
    let originalLanguage: String?
    let titleTranslations: [TitleTranslation]
    /// Fired after a successful grab so the presenter can refresh its download
    /// list — the grabbed row otherwise won't appear until the view is reopened.
    let onGrabbed: (() -> Void)?

    init(
        query: String,
        libraryMediaId: Int?,
        tmdbId: Int?,
        mediaType: String,
        availableSeasons: [Int] = [],
        mediaYear: Int? = nil,
        originalTitle: String? = nil,
        originalLanguage: String? = nil,
        titleTranslations: [TitleTranslation] = [],
        onGrabbed: (() -> Void)? = nil
    ) {
        self.onGrabbed = onGrabbed
        self.libraryMediaId = libraryMediaId
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.availableSeasons = availableSeasons.filter { $0 > 0 }.sorted()
        self.mediaYear = mediaYear
        localizedTitle = query
        self.originalTitle = originalTitle
        self.originalLanguage = originalLanguage
        self.titleTranslations = titleTranslations
        _searchQuery = State(initialValue: query)
        _sortBy = State(initialValue: libraryMediaId == nil ? .seeders : .quality)
    }

    /// Ordered search-title options (platform/EN/FR/original/allowlist), library
    /// titles being persisted in English — matches the web `LIBRARY_TITLE_LANGUAGE`.
    private var titleOptions: [InteractiveSearchLogic.TitleOption] {
        InteractiveSearchLogic.buildTitleOptions(
            localized: localizedTitle,
            localizedLanguage: "en",
            original: originalTitle,
            originalLanguage: originalLanguage,
            translations: titleTranslations.map {
                .init(languageCode: $0.languageCode, title: $0.title)
            }
        )
    }

    @State private var releases: [ReleaseItem] = []
    @State private var service: String?
    @State private var indexerWarnings: [IndexerWarning] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var grabError: String?
    @State private var adminOnlyNote: String?
    @State private var grabbingGuid: String?
    @State private var grabbedGuids: Set<String> = []
    /// Normalized titles already in the library's download history, so a matching
    /// release relabels its grab action to "Re-grab" (web parity).
    @State private var grabbedTitles: Set<String> = []
    @State private var blockingGuid: String?
    @State private var blockedGuids: Set<String> = []
    @State private var searchQuery = ""
    @State private var filterQuery = ""
    @State private var hideRejected = true
    @State private var showPacksOnly = false
    @State private var selectedSeason: Int?
    @State private var completeSeries = false
    @State private var sortBy: SearchSort = .seeders
    @State private var sortAscending = false
    @State private var includedTrackers: Set<String> = []
    @State private var excludedTrackers: Set<String> = []
    @State private var includedLanguages: Set<String> = []

    // AI-picks: the banner + row badge mirror the web `useAiPick`/`AiPickBanner`.
    @State private var aiEnabled = false
    @State private var aiPickLoading = false
    @State private var aiPick: AiPick?
    @State private var aiPickError: String?
    @State private var aiPickGrabbed = false
    @State private var aiPickDismissed = false
    /// Canonical guid-set the pick was last requested for, so the pick refires
    /// only when the non-rejected candidate set changes, not on every filter.
    @State private var lastAiPickKey: String?

    private enum SearchSort: String, CaseIterable, Identifiable {
        case quality, seeders, age, size, title

        var id: String {
            rawValue
        }

        var title: LocalizedStringKey {
            switch self {
            case .quality: "Profile score"
            case .seeders: "Seeders"
            case .age: "Age"
            case .size: "Size"
            case .title: "Title"
            }
        }

        var sortKey: InteractiveSearchLogic.SortKey {
            switch self {
            case .quality: .quality
            case .seeders: .seeders
            case .age: .age
            case .size: .size
            case .title: .title
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            grabber

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Releases")
                        .font(.display(22))
                        .foregroundStyle(Theme.textStrong)
                    Text(searchQuery)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .lineLimit(1)
                    if let service, !service.isEmpty {
                        Text(service)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Catalyst sheets don't swipe-to-dismiss, so a close control is the
                // only way out on Mac. (Size class is compact inside a sheet even on
                // Mac, so gate on the platform, not the width.)
                #if targetEnvironment(macCatalyst)
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(Theme.muted)
                            .symbolRenderingMode(.hierarchical)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                #endif
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 10)

            controls

            if let adminOnlyNote {
                Text(adminOnlyNote)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.terracotta)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }

            if !indexerWarnings.isEmpty {
                warningStrip
            }

            if let grabError {
                Text(grabError)
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }

            if aiEnabled, !aiPickDismissed {
                AiPickBanner(
                    aiPickLoading: aiPickLoading,
                    aiPickError: aiPickError,
                    aiPickedRelease: aiPickedRelease,
                    aiPickGrabbed: aiPickGrabbed,
                    aiPick: aiPick,
                    grabbingGuid: grabbingGuid,
                    onRetry: { await runAiPick(force: true) },
                    onGrab: { release in await grabFromBanner(release) },
                    onDismiss: { aiPickDismissed = true }
                )
            }

            content
        }
        .background(Theme.base)
        .task {
            await resolveAiGate()
            await loadGrabbedTitles()
            await search()
        }
        .onChange(of: selectedSeason) { _, _ in
            Task { await search() }
        }
        .onChange(of: completeSeries) { _, isOn in
            if isOn {
                selectedSeason = nil
            }
            Task { await search() }
        }
    }

    private var grabber: some View {
        Capsule()
            .fill(Theme.borderStrong)
            .frame(width: 40, height: 5)
            .padding(.top, 8)
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                searchField("Search releases", text: $searchQuery, onSubmit: {
                    Task { await search() }
                })

                if titleOptions.count > 1 {
                    titleLanguageMenu
                }

                Button {
                    Task { await search() }
                } label: {
                    if isLoading {
                        ProgressView()
                            .tint(Theme.onAccent)
                            .frame(width: 18, height: 18)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.terracotta)
                .disabled(isLoading)
            }

            HStack(spacing: 8) {
                searchField("Filter loaded releases", text: $filterQuery)
                filterMenu(title: sortBy.title, systemImage: sortAscending ? "arrow.up" : "arrow.down") {
                    ForEach(sortOptions) { option in
                        Button(option.title) { sortBy = option }
                    }
                    Divider()
                    Button(LocalizedStringKey(sortAscending ? "Descending" : "Ascending")) { sortAscending.toggle() }
                }
            }

            HStack(spacing: 12) {
                Toggle("Hide rejected", isOn: $hideRejected)
                if mediaType == "tv" {
                    Toggle("Packs only", isOn: $showPacksOnly)
                }
                Spacer()
            }
            .font(.footnote)
            .tint(Theme.terracotta)

            filterRow

            if mediaType == "tv", !availableSeasons.isEmpty {
                seasonRow
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    @ViewBuilder
    private var filterRow: some View {
        if !trackerOptions.isEmpty || !languageOptions.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if !trackerOptions.isEmpty {
                        filterChipMenu(title: "Include trackers", activeCount: includedTrackers.count) {
                            ForEach(trackerOptions) { option in
                                Toggle(option.label, isOn: includedTrackerBinding(option.key))
                            }
                        }
                        filterChipMenu(title: "Exclude trackers", activeCount: excludedTrackers.count) {
                            ForEach(trackerOptions) { option in
                                Toggle(option.label, isOn: excludedTrackerBinding(option.key))
                            }
                        }
                    }
                    if !languageOptions.isEmpty {
                        filterChipMenu(title: "Languages", activeCount: includedLanguages.count) {
                            ForEach(languageOptions) { option in
                                Toggle(option.label, isOn: includedLanguageBinding(option.key))
                            }
                        }
                    }
                    if hasActiveFilters {
                        Button {
                            includedTrackers.removeAll()
                            excludedTrackers.removeAll()
                            includedLanguages.removeAll()
                        } label: {
                            Text("Clear")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Theme.muted)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(Theme.raised, in: Capsule())
                                .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .fixedSize()
                    }
                }
            }
        }
    }

    private var hasActiveFilters: Bool {
        !includedTrackers.isEmpty || !excludedTrackers.isEmpty || !includedLanguages.isEmpty
    }

    /// Clears the filters that can hide results — shows rejected releases again
    /// and drops tracker/language filters. Mirrors the web `resetView`.
    private func resetView() {
        hideRejected = false
        includedTrackers.removeAll()
        excludedTrackers.removeAll()
        includedLanguages.removeAll()
    }

    private func filterChipMenu(
        title: LocalizedStringKey,
        activeCount: Int,
        @ViewBuilder content: () -> some View
    ) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 5) {
                Text(title).font(.subheadline.weight(.medium))
                if activeCount > 0 {
                    Text("\(activeCount)")
                        .font(.system(.caption2, design: .monospaced).weight(.semibold))
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.terracotta, in: Capsule())
                }
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(activeCount > 0 ? Theme.textStrong : Theme.muted)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(activeCount > 0 ? Theme.apricot.opacity(0.12) : Theme.raised, in: Capsule())
            .overlay(
                Capsule().strokeBorder(activeCount > 0 ? Theme.apricotSoft : Theme.borderStrong, lineWidth: 1)
            )
        }
        .fixedSize()
    }

    private func includedTrackerBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: {
                includedTrackers.contains(key)
            },
            set: { isOn in
                if isOn {
                    includedTrackers.insert(key)
                    excludedTrackers.remove(key)
                } else {
                    includedTrackers.remove(key)
                }
            }
        )
    }

    private func excludedTrackerBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: {
                excludedTrackers.contains(key)
            },
            set: { isOn in
                if isOn {
                    excludedTrackers.insert(key)
                    includedTrackers.remove(key)
                } else {
                    excludedTrackers.remove(key)
                }
            }
        )
    }

    private func includedLanguageBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: {
                includedLanguages.contains(key)
            },
            set: { isOn in
                if isOn {
                    includedLanguages.insert(key)
                } else {
                    includedLanguages.remove(key)
                }
            }
        )
    }

    private var seasonRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                seasonButton(title: "All", selected: selectedSeason == nil && !completeSeries) {
                    selectedSeason = nil
                    completeSeries = false
                }
                ForEach(availableSeasons, id: \.self) { season in
                    seasonButton(title: "S\(String(format: "%02d", season))", selected: selectedSeason == season) {
                        completeSeries = false
                        selectedSeason = (selectedSeason == season) ? nil : season
                    }
                }
                seasonButton(title: "Complete", selected: completeSeries, accent: Theme.apricotSoft) {
                    completeSeries.toggle()
                }
            }
        }
    }

    private func seasonButton(
        title: String,
        selected: Bool,
        accent: Color = Theme.terracotta,
        action: @escaping () -> Void
    ) -> some View {
        Button(title) {
            action()
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(selected ? accent.opacity(0.25) : Theme.raised, in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? accent : Theme.border, lineWidth: 1))
        .foregroundStyle(selected ? Theme.textStrong : Theme.muted)
        .font(.system(.caption, design: .monospaced))
    }

    private var warningStrip: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(indexerWarnings) { warning in
                Text("\(warning.name): \(warning.error)")
                    .font(.caption2)
                    .foregroundStyle(Theme.terracotta)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            VStack(spacing: 10) {
                ProgressView().tint(Theme.apricot)
                Text("Searching…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, releases.isEmpty {
            ContentUnavailableView {
                Label("Search failed", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if releases.isEmpty {
            ContentUnavailableView.search
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if filteredAndSortedReleases.isEmpty {
            // Results came back but the active filters (commonly "Hide rejected")
            // hide them all — say so and offer a reset, mirroring the web
            // "No matches" + Reset view empty state instead of a blank sheet.
            ContentUnavailableView {
                Label("No matches", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("\(releases.count) results are hidden by your filters.")
            } actions: {
                Button("Reset view") { resetView() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.terracotta)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(filteredAndSortedReleases) { release in
                        ReleaseRow(
                            release: release,
                            isGrabbing: grabbingGuid == release.guid,
                            isGrabbed: grabbedGuids.contains(release.guid),
                            alreadyGrabbed: isAlreadyGrabbed(release),
                            isBlocking: blockingGuid == release.guid,
                            isBlocked: blockedGuids.contains(release.guid),
                            isAiPick: release.guid == aiPickBadgeKey,
                            onGrab: { await grab(release) },
                            onBlock: { await block(release) }
                        )
                    }
                }
                .padding(16)
            }
        }
    }

    private var sortOptions: [SearchSort] {
        let hasQuality = releases.contains { $0.qualityScore != nil }
        return hasQuality ? SearchSort.allCases : SearchSort.allCases.filter { $0 != .quality }
    }

    private var trackerOptions: [InteractiveSearchLogic.FilterOption] {
        InteractiveSearchLogic.trackerOptions(indexers: releases.map(\.indexer))
    }

    private var languageOptions: [InteractiveSearchLogic.FilterOption] {
        InteractiveSearchLogic.languageOptions(languageLists: releases.map(\.languages))
    }

    private var filteredAndSortedReleases: [ReleaseItem] {
        // Search mode strips the query's trailing SxxExx/year suffix to a bare title
        // for the client rejection heuristic, mirroring the web picker.
        let expectedTitle = InteractiveSearchLogic.stripTitleSuffixes(searchQuery)
        let normalizedFilter = InteractiveSearchLogic.normalizeKey(filterQuery)

        let filtered = releases.filter { release in
            if hideRejected {
                if release.rejected == true {
                    return false
                }
                if libraryMediaId == nil, !expectedTitle.isEmpty,
                   InteractiveSearchLogic.isClientRejected(
                       releaseTitle: release.title,
                       expectedTitle: expectedTitle,
                       expectedYear: mediaYear
                   )
                {
                    return false
                }
            }

            if showPacksOnly || selectedSeason != nil || completeSeries {
                if !(release.isSeasonPack == true || release.isCompleteSeries == true) {
                    return false
                }
            }

            let trackerKey = trackerKey(for: release)
            if !includedTrackers.isEmpty, !includedTrackers.contains(trackerKey) {
                return false
            }
            if excludedTrackers.contains(trackerKey) {
                return false
            }

            if !includedLanguages.isEmpty {
                if languageKeys(for: release).isDisjoint(with: includedLanguages) {
                    return false
                }
            }

            if normalizedFilter.isEmpty {
                return true
            }
            let haystack = InteractiveSearchLogic.normalizeKey("\(release.title) \(release.indexer ?? "")")
            return haystack.contains(normalizedFilter)
        }

        let effectiveSort: SearchSort = sortOptions.contains(sortBy) ? sortBy : .seeders
        return InteractiveSearchLogic.sortReleases(
            filtered,
            by: effectiveSort.sortKey,
            dir: sortAscending ? .asc : .desc
        )
    }

    /// Normalized tracker key for `release`, matching `trackerOptions` bucketing.
    private func trackerKey(for release: ReleaseItem) -> String {
        let trimmed = release.indexer?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty
            ? InteractiveSearchLogic.unknownTrackerKey
            : InteractiveSearchLogic.normalizeKey(trimmed)
    }

    /// Normalized language keys for `release`, matching `languageOptions` bucketing.
    private func languageKeys(for release: ReleaseItem) -> Set<String> {
        if release.languages.isEmpty {
            return [InteractiveSearchLogic.unknownLanguageKey]
        }
        return Set(release.languages.map { InteractiveSearchLogic.normalizeKey($0) })
    }

    private func search() async {
        guard let client = model.api() else {
            errorMessage = String(localized: "Not connected.")
            return
        }
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedQuery.count < 2, selectedSeason == nil, !completeSeries {
            errorMessage = String(localized: "Search query must be at least 2 characters.")
            releases = []
            return
        }

        isLoading = true
        errorMessage = nil
        grabError = nil
        adminOnlyNote = nil
        indexerWarnings = []
        defer { isLoading = false }
        do {
            let response = try await client.interactiveSearch(
                q: trimmedQuery,
                libraryMediaId: libraryMediaId,
                season: completeSeries ? nil : selectedSeason,
                complete: completeSeries,
                tmdbId: tmdbId,
                mediaType: mediaType
            )
            releases = response.releases
            service = response.service
            indexerWarnings = response.indexerWarnings ?? []
        } catch APIError.unauthorized {
            adminOnlyNote = String(localized: "Admin only")
            releases = []
        } catch {
            errorMessage = String(localized: "Couldn't load releases. Check the server.")
            releases = []
        }
        // Fire-and-forget so the AI banner loads on its own timeline, decoupled
        // from the main search spinner (parity with the web's separate query).
        Task {
            await runAiPick()
        }
    }

    /// Resolves the AI gate once and pre-warms the model when enabled.
    private func resolveAiGate() async {
        guard let client = model.api() else {
            return
        }
        aiEnabled = await client.aiProviderEnabled()
        if aiEnabled {
            Task {
                await client.aiWarm()
            }
        }
    }

    /// Requests an AI pick for the current non-rejected candidates. Skips when
    /// the candidate guid-set is unchanged unless `force` (Retry) is set.
    private func runAiPick(force: Bool = false) async {
        guard aiEnabled, let client = model.api() else {
            return
        }
        let candidates = releases.filter { release in
            release.rejected != true
        }
        guard !candidates.isEmpty else {
            aiPick = nil
            aiPickError = nil
            aiPickLoading = false
            lastAiPickKey = nil
            return
        }
        let key = candidates.map(\.guid).sorted().joined(separator: ",")
        if !force, key == lastAiPickKey {
            return
        }
        lastAiPickKey = key
        aiPickDismissed = false
        aiPickGrabbed = false
        aiPickError = nil
        aiPick = nil
        aiPickLoading = true
        defer {
            aiPickLoading = false
        }
        let request = AiPickRequest(
            mediaContext: AiPickMediaContext(
                title: searchQuery,
                year: mediaYear,
                type: mediaType
            ),
            releases: candidates.map { release in
                AiPickCandidate(
                    key: release.guid,
                    title: release.title,
                    sizeBytes: release.sizeBytes,
                    seeders: release.seeders,
                    score: release.qualityScore
                )
            }
        )
        do {
            aiPick = try await client.aiPick(request)
        } catch {
            aiPickError = String(localized: "Could not get a response from AI")
        }
    }

    /// The release the AI picked, only if it's still in the current list.
    private var aiPickedRelease: ReleaseItem? {
        guard let key = aiPick?.releaseKey else {
            return nil
        }
        return releases.first { release in
            release.guid == key
        }
    }

    /// The guid the row badge highlights — nil once the banner is dismissed.
    private var aiPickBadgeKey: String? {
        guard aiEnabled, !aiPickDismissed else {
            return nil
        }
        return aiPick?.releaseKey
    }

    /// Grab initiated from the AI banner: reuses the row grab path, then shows a
    /// brief "Grabbed!" confirmation before auto-dismissing (parity with web).
    private func grabFromBanner(_ release: ReleaseItem) async {
        await grab(release)
        guard grabbedGuids.contains(release.guid) else {
            return
        }
        aiPickGrabbed = true
        try? await Task.sleep(for: .milliseconds(1800))
        aiPickDismissed = true
    }

    /// Normalized release-title key, matching the app's lowercase+trim convention.
    private func normalizedTitle(_ title: String) -> String {
        title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// A release counts as already grabbed if its title is in the library's
    /// download history or its guid was grabbed earlier this session.
    private func isAlreadyGrabbed(_ release: ReleaseItem) -> Bool {
        grabbedTitles.contains(normalizedTitle(release.title))
            || grabbedGuids.contains(release.guid)
    }

    /// Fetches the library's download history once and records the grabbed
    /// release titles, so matching releases relabel their action to "Re-grab".
    private func loadGrabbedTitles() async {
        guard let client = model.api(), let libraryMediaId else {
            return
        }
        guard let response = try? await client.downloads(libraryId: libraryMediaId) else {
            return
        }
        grabbedTitles = Set(response.items.map { item in
            normalizedTitle(item.releaseTitle)
        })
    }

    private func block(_ release: ReleaseItem) async {
        guard let client = model.api() else {
            return
        }
        blockingGuid = release.guid
        defer {
            blockingGuid = nil
        }
        do {
            try await client.blockRelease(
                BlocklistBody(
                    releaseTitle: release.title,
                    indexer: release.indexer,
                    mediaId: libraryMediaId,
                    episodeId: nil
                )
            )
            blockedGuids.insert(release.guid)
            grabError = nil
        } catch APIError.unauthorized {
            adminOnlyNote = String(localized: "Admin only")
        } catch {
            grabError = String(localized: "Block failed for \"\(release.title)\".")
        }
    }

    private func grab(_ release: ReleaseItem) async {
        guard let client = model.api() else { return }
        grabbingGuid = release.guid
        defer { grabbingGuid = nil }
        do {
            // Prefer the library grab: it hands the release to the download client
            // and records download history. The token endpoint only *resolves* the
            // release URL and, on a Jackett instance, enqueues nothing — so it is a
            // fallback for media-agnostic searches that have no library item yet.
            if let libraryMediaId, let downloadUrl = release.downloadUrl {
                let result = try await client.grabByUrl(
                    libraryId: libraryMediaId,
                    body: GrabUrlBody(
                        downloadUrl: downloadUrl,
                        releaseTitle: release.title,
                        episodeId: nil,
                        season: completeSeries ? nil : selectedSeason,
                        indexer: release.indexer,
                        qualityParsed: release.parsedQuality,
                        sizeBytes: release.sizeBytes,
                        isUpgrade: nil
                    )
                )
                if !result.grabbed {
                    grabError = result.reason ?? String(localized: "Grab failed for \"\(release.title)\".")
                    return
                }
            } else if let token = release.downloadToken {
                let result = try await client.grabByToken(token)
                if !result.grabbed {
                    grabError = result.reason ?? String(localized: "Grab failed for \"\(release.title)\".")
                    return
                }
            } else {
                grabError = String(localized: "This release can't be grabbed.")
                return
            }
            grabbedGuids.insert(release.guid)
            grabError = nil
            onGrabbed?()
            await loadGrabbedTitles()
        } catch APIError.unauthorized {
            adminOnlyNote = String(localized: "Admin only")
        } catch {
            grabError = String(localized: "Grab failed for \"\(release.title)\".")
        }
    }

    /// Language/title picker: private trackers name releases under localized
    /// titles, so the user can search by another language's title. Selecting one
    /// swaps `searchQuery` and re-runs the server search (web `SearchTitleSelect`).
    private var titleLanguageMenu: some View {
        let current = titleOptions.first { $0.query == searchQuery }
        let code = (current?.languageCode ?? "en").uppercased()
        return Menu {
            ForEach(titleOptions) { option in
                Button {
                    searchQuery = option.query
                    Task { await search() }
                } label: {
                    if option.isOriginal {
                        Label("\(option.languageCode.uppercased()) · \(option.query) (original)", systemImage: "globe")
                    } else {
                        Text("\(option.languageCode.uppercased()) · \(option.query)")
                    }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "globe").font(.caption2)
                Text(code).font(.subheadline.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
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
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
        }
    }

    private func searchField(_ placeholder: String, text: Binding<String>, onSubmit: (() -> Void)? = nil) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(Theme.muted)
            TextField(placeholder, text: text)
                .foregroundStyle(Theme.textStrong)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit {
                    onSubmit?()
                }
            if !text.wrappedValue.isEmpty {
                Button {
                    text.wrappedValue = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.faint)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }
}
