import SwiftUI

/// Expandable season → episode list. Info-only for viewers and not-in-library
/// titles; for admins on in-library shows it surfaces per-season and per-episode
/// actions through context menus (the one-primary-control rule keeps buttons off
/// the rows), and the season's real files fold in under its episodes. All
/// grabs/monitor/status/delete controls are admin-gated because the underlying
/// routes 403 for viewers.
struct DetailSeasonsSection: View {
    let seasons: [SeasonSummary]
    let episodesBySeason: [Int: [Episode]]
    /// Real library files keyed by season number (empty when not admin/in-library).
    let filesBySeason: [Int: [LibraryFileInfo]]
    let inLibrary: Bool
    let isAdmin: Bool

    let onSeasonAutoSearch: (Int) -> Void
    let onSeasonReleaseSearch: (Int) -> Void
    let onSeasonRetrySkipped: (Int) -> Void
    let onSeasonToggleMonitor: (Int, Bool) -> Void

    let onEpisodeAutoSearch: (Episode) -> Void
    let onEpisodeReleaseSearch: (Episode) -> Void
    let onEpisodeToggleMonitor: (Episode) -> Void
    let onEpisodeRetry: (Episode) -> Void
    let onEpisodeDeleteFile: (Episode) -> Void

    let onFileChanged: () -> Void
    let onFileNotice: (String) -> Void
    let onFileError: (String) -> Void

    @State private var expanded: Set<Int> = []

    private var visibleSeasons: [SeasonSummary] {
        seasons
            .sorted { $0.seasonNumber < $1.seasonNumber }
            .filter { $0.seasonNumber != 0 || ($0.episodeCount ?? 0) > 0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Seasons")
                .font(.display(17))
                .foregroundStyle(Theme.textStrong)

            VStack(spacing: 8) {
                ForEach(visibleSeasons, id: \.seasonNumber) { season in
                    seasonBlock(season)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func seasonBlock(_ season: SeasonSummary) -> some View {
        let episodes = episodesBySeason[season.seasonNumber] ?? []
        let downloaded = episodes.filter { $0.status == "downloaded" }.count
        let total = episodes.isEmpty ? (season.episodeCount ?? 0) : episodes.count
        let isExpanded = expanded.contains(season.seasonNumber)
        let canManage = inLibrary && isAdmin

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    toggle(season.seasonNumber)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.faint)
                        Text(season.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.textStrong)
                        Spacer(minLength: 0)
                        Text(countLabel(downloaded: downloaded, total: total, season: season))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if canManage {
                    seasonMenu(season, episodes: episodes)
                }
            }

            if inLibrary, total > 0 {
                DuskProgress(value: Double(downloaded) / Double(total))
            }

            if isExpanded {
                let files = filesBySeason[season.seasonNumber] ?? []
                let filesByEp = Dictionary(grouping: files.filter { $0.episode != nil }, by: { $0.episode! })
                mergedEpisodeList(episodes, filesByEp: filesByEp, canManage: canManage)
                let orphans = files.filter { file in
                    guard let ep = file.episode else { return true }
                    return !episodes.contains { $0.episode == ep }
                }
                if !orphans.isEmpty {
                    otherFilesList(orphans)
                }
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        .rawkoonMotion(RawkoonMotion.snappy, value: isExpanded)
    }

    private func countLabel(downloaded: Int, total: Int, season: SeasonSummary) -> String {
        inLibrary ? String(localized: "\(downloaded)/\(total)") : String(localized: "\(season.episodeCount ?? 0) episodes")
    }

    private func seasonMenu(_ season: SeasonSummary, episodes: [Episode]) -> some View {
        let monitored = !episodes.isEmpty && episodes.allSatisfy(\.monitored)
        return Menu {
            Button {
                onSeasonAutoSearch(season.seasonNumber)
            } label: {
                Label("Auto search season", systemImage: "sparkle.magnifyingglass")
            }
            Button {
                onSeasonReleaseSearch(season.seasonNumber)
            } label: {
                Label("Search releases…", systemImage: "magnifyingglass")
            }
            Button {
                onSeasonRetrySkipped(season.seasonNumber)
            } label: {
                Label("Retry skipped", systemImage: "arrow.clockwise")
            }
            if !episodes.isEmpty {
                Button {
                    onSeasonToggleMonitor(season.seasonNumber, !monitored)
                } label: {
                    Label(
                        monitored ? "Unmonitor season" : "Monitor season",
                        systemImage: monitored ? "bell.slash" : "bell"
                    )
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
    }

    /// One row per episode: episodes with a matching library file merge that
    /// file's expandable technical detail in place; episodes without one keep
    /// the plain info row. Files with no matching episode fall to "Other files".
    @ViewBuilder
    private func mergedEpisodeList(
        _ episodes: [Episode],
        filesByEp: [Int: [LibraryFileInfo]],
        canManage: Bool
    ) -> some View {
        if episodes.isEmpty {
            Text(inLibrary ? "No episode data yet." : "Episode details appear once this is in your library.")
                .font(.caption)
                .foregroundStyle(Theme.faint)
        } else {
            VStack(spacing: 6) {
                ForEach(episodes.sorted { $0.episode < $1.episode }) { episode in
                    if let files = filesByEp[episode.episode], !files.isEmpty {
                        mergedEpisodeRow(episode, files: files, canManage: canManage)
                    } else {
                        episodeRow(episode, canManage: canManage)
                    }
                }
            }
        }
    }

    /// A short "Sep 12"-style date shown only for an episode that hasn't aired
    /// yet, mirroring the web episode rows. `airDate` is a day-only ISO string.
    private func futureAirDateLabel(_ episode: Episode) -> String? {
        guard let raw = episode.airDate, !raw.isEmpty else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        parser.timeZone = .current
        guard let date = parser.date(from: raw) else { return nil }
        let calendar = Calendar.current
        guard calendar.startOfDay(for: date) > calendar.startOfDay(for: Date()) else { return nil }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// An episode whose file is present: a slim status header (episode status +
    /// monitor state) with the file's full expandable detail folded in below.
    private func mergedEpisodeRow(_ episode: Episode, files: [LibraryFileInfo], canManage: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("E\(String(format: "%02d", episode.episode))")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                statusBadge(episode.status, tint: statusTint(episode.status))
                if !episode.monitored {
                    Label("Unmonitored", systemImage: "bell.slash")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.faint)
                }
                Spacer(minLength: 0)
                if let air = futureAirDateLabel(episode) {
                    Text(air)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
            ForEach(files) { file in
                DetailFileRow(
                    file: file,
                    mode: .episode,
                    isAdmin: isAdmin,
                    onChanged: onFileChanged,
                    onNotice: onFileNotice,
                    onError: onFileError,
                    onRequestDelete: {}
                )
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
        .contextMenu {
            if canManage {
                episodeMenu(episode)
            }
        }
    }

    /// Library files that match no episode (specials, mislabeled grabs) — kept
    /// visible so nothing on disk is hidden.
    private func otherFilesList(_ files: [LibraryFileInfo]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Other files")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .padding(.top, 2)
            ForEach(files.sorted { ($0.episode ?? 0) < ($1.episode ?? 0) }) { file in
                DetailFileRow(
                    file: file,
                    mode: .episode,
                    isAdmin: isAdmin,
                    onChanged: onFileChanged,
                    onNotice: onFileNotice,
                    onError: onFileError,
                    onRequestDelete: {}
                )
            }
        }
    }

    private func episodeRow(_ episode: Episode, canManage: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("E\(String(format: "%02d", episode.episode))")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .frame(width: 30, alignment: .leading)

            VStack(alignment: .leading, spacing: 3) {
                Text(episode.title ?? String(localized: "Episode \(episode.episode)"))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    statusBadge(episode.status, tint: statusTint(episode.status))
                    if !episode.monitored {
                        Label("Unmonitored", systemImage: "bell.slash")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.faint)
                    }
                }
            }
            Spacer(minLength: 0)
            if let air = futureAirDateLabel(episode) {
                Text(air)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
        .contextMenu {
            if canManage {
                episodeMenu(episode)
            }
        }
    }

    @ViewBuilder
    private func episodeMenu(_ episode: Episode) -> some View {
        Button {
            onEpisodeAutoSearch(episode)
        } label: {
            Label("Auto search", systemImage: "sparkle.magnifyingglass")
        }
        Button {
            onEpisodeReleaseSearch(episode)
        } label: {
            Label("Search releases…", systemImage: "magnifyingglass")
        }
        Button {
            onEpisodeToggleMonitor(episode)
        } label: {
            Label(
                episode.monitored ? "Unmonitor" : "Monitor",
                systemImage: episode.monitored ? "bell.slash" : "bell"
            )
        }
        if episode.status != "wanted" {
            Button {
                onEpisodeRetry(episode)
            } label: {
                Label("Retry (mark wanted)", systemImage: "arrow.clockwise")
            }
        }
        if episode.status == "downloaded" {
            Button(role: .destructive) {
                onEpisodeDeleteFile(episode)
            } label: {
                Label("Delete file", systemImage: "trash")
            }
        }
    }

    private func statusTint(_ status: String) -> Color {
        switch status {
        case "downloaded": Theme.seed
        case "downloading", "upgrading": Theme.importing
        case "wanted": Theme.apricotSoft
        default: Theme.muted
        }
    }

    private func toggle(_ season: Int) {
        if expanded.contains(season) {
            expanded.remove(season)
        } else {
            expanded.insert(season)
        }
    }
}
