import RawkoonKit
import SwiftUI

/// Presented as a sheet from MediaDetailView. Interactive indexer search + grab.
struct ReleaseSearchView: View {
    @Environment(AppModel.self) private var model

    let libraryMediaId: Int?
    let tmdbId: Int?
    let mediaType: String
    let availableSeasons: [Int]
    /// Expected release year, fed into the client-side rejection heuristic in
    /// search mode. The call site wires it separately; nil disables the year check.
    let mediaYear: Int?

    init(
        query: String,
        libraryMediaId: Int?,
        tmdbId: Int?,
        mediaType: String,
        availableSeasons: [Int] = [],
        mediaYear: Int? = nil
    ) {
        self.libraryMediaId = libraryMediaId
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.availableSeasons = availableSeasons.filter { $0 > 0 }.sorted()
        self.mediaYear = mediaYear
        _searchQuery = State(initialValue: query)
        _sortBy = State(initialValue: libraryMediaId == nil ? .seeders : .quality)
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

            content
        }
        .background(Theme.base)
        .task {
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
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(filteredAndSortedReleases) { release in
                        ReleaseRow(
                            release: release,
                            isGrabbing: grabbingGuid == release.guid,
                            isGrabbed: grabbedGuids.contains(release.guid),
                            onGrab: { await grab(release) }
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
                   ) {
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
    }

    private func grab(_ release: ReleaseItem) async {
        guard let client = model.api() else { return }
        grabbingGuid = release.guid
        defer { grabbingGuid = nil }
        do {
            if let token = release.downloadToken {
                try await client.grabByToken(token)
            } else if let libraryMediaId, let downloadUrl = release.downloadUrl {
                try await client.grabByUrl(
                    libraryId: libraryMediaId,
                    body: GrabUrlBody(
                        downloadUrl: downloadUrl,
                        releaseTitle: release.title,
                        episodeId: nil,
                        indexer: release.indexer,
                        qualityParsed: release.parsedQuality,
                        sizeBytes: release.sizeBytes,
                        isUpgrade: nil
                    )
                )
            } else {
                grabError = String(localized: "This release can't be grabbed.")
                return
            }
            grabbedGuids.insert(release.guid)
            grabError = nil
        } catch APIError.unauthorized {
            adminOnlyNote = String(localized: "Admin only")
        } catch {
            grabError = String(localized: "Grab failed for \"\(release.title)\".")
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

// MARK: - Row

private struct ReleaseRow: View {
    @Environment(\.openURL) private var openURL

    let release: ReleaseItem
    let isGrabbing: Bool
    let isGrabbed: Bool
    let onGrab: () async -> Void

    private var isRejected: Bool {
        release.rejected == true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                titleView
                Spacer(minLength: 8)
                grabButton
            }

            badgeStrip

            if isRejected {
                rejectionReasons
            }

            if !isRejected, let breakdown = release.scoreBreakdown {
                ScoreBreakdownPanel(breakdown: breakdown)
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(isRejected ? Theme.apricotSoft : Theme.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var titleView: some View {
        if let infoURL = release.infoURL, let url = URL(string: infoURL) {
            Button {
                openURL(url)
            } label: {
                Text(release.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textStrong)
                    .underline()
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)
        } else {
            Text(release.title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.text)
                .lineLimit(2)
        }
    }

    private var badgeStrip: some View {
        FlowLayout(spacing: 6) {
            if release.isCompleteSeries == true {
                BadgeChip(text: "Intégrale", fg: Theme.apricotSoft, bg: Theme.apricot.opacity(0.12))
            }
            if release.isSeasonPack == true, release.isCompleteSeries != true {
                BadgeChip(text: "Season pack", fg: Theme.apricotSoft, bg: Theme.apricot.opacity(0.12))
            }
            if let indexer = release.indexer, !indexer.isEmpty {
                BadgeChip(text: indexer)
            }
            if let sizeText {
                BadgeChip(text: sizeText)
            }
            if let parsedQualityText {
                BadgeChip(text: parsedQualityText)
            }
            if let hdr = release.parsedQuality?.hdr, !hdr.isEmpty {
                BadgeChip(text: hdr, fg: Theme.apricotSoft, bg: Theme.apricot.opacity(0.14))
            }
            if release.freeleech == true {
                BadgeChip(text: "FL", fg: Theme.seed, bg: Theme.seed.opacity(0.14))
            }
            if let qualityScore = release.qualityScore {
                BadgeChip(
                    text: "Score \(Int(qualityScore.rounded()))",
                    fg: Theme.apricotSoft,
                    bg: Theme.apricot.opacity(0.12)
                )
            }
            if let age = release.age {
                BadgeChip(text: "Age: \(age)d")
            }
            if let seedLeechText {
                BadgeChip(text: seedLeechText, fg: Theme.seed)
            }
            if !release.languages.isEmpty {
                BadgeChip(text: release.languages.joined(separator: ", "))
            }
        }
    }

    private var rejectionReasons: some View {
        VStack(alignment: .leading, spacing: 2) {
            let codes = release.qualityRejectionReasons ?? []
            if codes.isEmpty {
                if let reason = release.rejectionReason, !reason.isEmpty {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(Theme.terracotta)
                        .lineLimit(2)
                }
            } else {
                ForEach(codes, id: \.self) { code in
                    Text(ReleaseScoringLabels.rejectionLabel(code))
                        .font(.caption2)
                        .foregroundStyle(Theme.terracotta)
                        .lineLimit(2)
                }
            }
        }
    }

    @ViewBuilder
    private var grabButton: some View {
        if isGrabbed {
            Label("Grabbed", systemImage: "checkmark.circle.fill")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.seed)
        } else if isGrabbing {
            ProgressView()
                .tint(Theme.apricot)
                .frame(width: 20, height: 20)
        } else {
            Button {
                Task { await onGrab() }
            } label: {
                Text("Grab")
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(Theme.terracotta, in: Capsule())
            }
        }
    }

    /// Server parsed quality as `resolutionp · source · codec`, dropping empties.
    private var parsedQualityText: String? {
        guard let parsed = release.parsedQuality else {
            return nil
        }
        var parts: [String] = []
        if let resolution = parsed.resolution {
            parts.append("\(resolution)p")
        }
        if let source = parsed.source, !source.isEmpty {
            parts.append(source)
        }
        if let codec = parsed.codec, !codec.isEmpty {
            parts.append(codec)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var sizeText: String? {
        guard let bytes = release.sizeBytes else {
            return nil
        }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private var seedLeechText: String? {
        guard release.seeders != nil || release.leechers != nil else {
            return nil
        }
        let seeders = release.seeders.map(String.init) ?? "–"
        let leechers = release.leechers.map(String.init) ?? "–"
        return "S/L: \(seeders)/\(leechers)"
    }
}

// MARK: - Score breakdown

private struct ScoreBreakdownPanel: View {
    let breakdown: ScoreBreakdown
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                if let total = breakdown.total {
                    row(label: "Total", value: total, emphasized: true)
                }
                ForEach(breakdown.components) { component in
                    row(label: ReleaseScoringLabels.componentLabel(component.code), value: component.value)
                }
                if !breakdown.matchedFormats.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(breakdown.matchedFormats, id: \.self) { format in
                            BadgeChip(text: format, fg: Theme.apricotSoft, bg: Theme.apricot.opacity(0.12))
                        }
                    }
                }
            }
            .padding(.top, 6)
        } label: {
            Text("Score breakdown")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
        }
        .tint(Theme.muted)
    }

    private func row(label: String, value: Int, emphasized: Bool = false) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(emphasized ? Theme.textStrong : Theme.muted)
            Spacer(minLength: 8)
            Text(signed(value))
                .font(.system(.caption2, design: .monospaced).weight(emphasized ? .semibold : .regular))
                .foregroundStyle(value >= 0 ? Theme.seed : Theme.terracotta)
        }
    }

    private func signed(_ value: Int) -> String {
        value > 0 ? "+\(value)" : "\(value)"
    }
}

// MARK: - Badge chip + wrapping layout

private struct BadgeChip: View {
    let text: String
    var fg: Color = Theme.muted
    var bg: Color = Theme.well

    var body: some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(bg, in: Capsule())
            .lineLimit(1)
            .fixedSize()
    }
}

/// Left-to-right wrapping layout for the badge strip so chips flow onto new rows
/// instead of overflowing the card width.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .greatestFiniteMagnitude
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                totalWidth = max(totalWidth, rowWidth)
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        totalWidth = max(totalWidth, rowWidth)
        return CGSize(width: totalWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
