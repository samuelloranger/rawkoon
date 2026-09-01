import SwiftUI

/// Presented as a sheet from MediaDetailView. Interactive indexer search + grab.
struct ReleaseSearchView: View {
    @EnvironmentObject private var model: AppModel

    let libraryMediaId: Int?
    let tmdbId: Int?
    let mediaType: String
    let availableSeasons: [Int]

    init(query: String, libraryMediaId: Int?, tmdbId: Int?, mediaType: String, availableSeasons: [Int] = []) {
        self.libraryMediaId = libraryMediaId
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.availableSeasons = availableSeasons.filter { $0 > 0 }.sorted()
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

    private enum SearchSort: String, CaseIterable, Identifiable {
        case quality, seeders, age, size, title

        var id: String { rawValue }

        var label: String {
            switch self {
            case .quality: return "Quality"
            case .seeders: return "Seeders"
            case .age: return "Age"
            case .size: return "Size"
            case .title: return "Title"
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
                filterMenu(title: sortBy.label, systemImage: sortAscending ? "arrow.up" : "arrow.down") {
                    ForEach(sortOptions) { option in
                        Button(option.label) { sortBy = option }
                    }
                    Divider()
                    Button(sortAscending ? "Descending" : "Ascending") { sortAscending.toggle() }
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

            if mediaType == "tv", !availableSeasons.isEmpty {
                seasonRow
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
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

    private var filteredAndSortedReleases: [ReleaseItem] {
        let normalizedFilter = filterQuery
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        var list = releases.filter { release in
            if hideRejected && (release.rejected == true) {
                return false
            }
            if showPacksOnly || selectedSeason != nil || completeSeries {
                if !(release.isSeasonPack == true || release.isCompleteSeries == true) {
                    return false
                }
            }
            if normalizedFilter.isEmpty {
                return true
            }
            let haystack = ([release.title, release.indexer ?? ""] + release.languages)
                .joined(separator: " ")
                .lowercased()
            return haystack.contains(normalizedFilter)
        }

        let effectiveSort: SearchSort = sortOptions.contains(sortBy) ? sortBy : .seeders
        list.sort { lhs, rhs in
            let direction: (Bool) -> Bool = { comparison in
                sortAscending ? !comparison : comparison
            }
            switch effectiveSort {
            case .quality:
                let lRejected = lhs.rejected == true
                let rRejected = rhs.rejected == true
                if lRejected != rRejected {
                    return lRejected ? false : true
                }
                let lScore = lhs.qualityScore ?? -Double.greatestFiniteMagnitude
                let rScore = rhs.qualityScore ?? -Double.greatestFiniteMagnitude
                if lScore != rScore {
                    return sortAscending ? lScore < rScore : lScore > rScore
                }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            case .seeders:
                let l = lhs.seeders ?? -1
                let r = rhs.seeders ?? -1
                if l != r { return sortAscending ? l < r : l > r }
            case .age:
                let l = lhs.age ?? Int.max
                let r = rhs.age ?? Int.max
                if l != r { return sortAscending ? l < r : l > r }
            case .size:
                let l = lhs.sizeBytes ?? -1
                let r = rhs.sizeBytes ?? -1
                if l != r { return sortAscending ? l < r : l > r }
            case .title:
                break
            }
            let cmp = lhs.title.localizedCaseInsensitiveCompare(rhs.title)
            if cmp == .orderedSame {
                return lhs.guid < rhs.guid
            }
            return direction(cmp == .orderedAscending)
        }
        return list
    }

    private func search() async {
        guard let client = model.api() else {
            errorMessage = "Not connected."
            return
        }
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedQuery.count < 2, selectedSeason == nil, !completeSeries {
            errorMessage = "Search query must be at least 2 characters."
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
            adminOnlyNote = "Admin only"
            releases = []
        } catch {
            errorMessage = "Couldn't load releases. Check the server."
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
                    body: GrabUrlBody(downloadUrl: downloadUrl, releaseTitle: release.title, episodeId: nil)
                )
            } else {
                grabError = "This release can't be grabbed."
                return
            }
            grabbedGuids.insert(release.guid)
            grabError = nil
        } catch APIError.unauthorized {
            adminOnlyNote = "Admin only"
        } catch {
            grabError = "Grab failed for \"\(release.title)\"."
        }
    }

    private func filterMenu<Content: View>(title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
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
    let release: ReleaseItem
    let isGrabbing: Bool
    let isGrabbed: Bool
    let onGrab: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(release.title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.text)
                .lineLimit(2)

            HStack(spacing: 8) {
                Text(quality)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Theme.well, in: Capsule())

                if let qualityScore = release.qualityScore {
                    Text("Q\(Int(qualityScore.rounded()))")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.apricotSoft)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Theme.apricot.opacity(0.12), in: Capsule())
                }

                if release.freeleech == true {
                    Text("Freeleech")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.seed)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Theme.seed.opacity(0.14), in: Capsule())
                }

                if let sizeText {
                    Text(sizeText)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                }

                Text("\(release.seeders ?? 0) up")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.seed)

                Spacer(minLength: 8)

                grabButton
            }

            Text(metaLine)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)

            if release.rejected == true, let reason = release.rejectionReason, !reason.isEmpty {
                Text(reason)
                    .font(.caption2)
                    .foregroundStyle(Theme.terracotta)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
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

    private var quality: String {
        let title = release.title.lowercased()
        let markers: [(String, String)] = [
            ("2160p", "2160p"),
            ("1080p", "1080p"),
            ("720p", "720p"),
            ("web-dl", "WEB-DL"),
            ("webdl", "WEB-DL"),
            ("bluray", "BluRay"),
            ("blu-ray", "BluRay"),
        ]
        for (needle, label) in markers where title.contains(needle) {
            return label
        }
        return release.protocolType ?? ""
    }

    private var sizeText: String? {
        guard let bytes = release.sizeBytes else { return nil }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private var metaLine: String {
        var parts: [String] = []
        if let indexer = release.indexer, !indexer.isEmpty {
            parts.append(indexer)
        }
        if let age = release.age {
            parts.append("\(age)d")
        }
        if !release.languages.isEmpty {
            parts.append(release.languages.joined(separator: ", "))
        }
        return parts.joined(separator: " · ")
    }
}
