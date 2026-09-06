import SwiftUI

/// Expandable season → episode list. Info-only for viewers and not-in-library
/// titles; for admins on in-library shows it surfaces per-season and per-episode
/// actions through context menus (the one-primary-control rule keeps buttons off
/// the rows). All grabs/monitor/status/delete controls are admin-gated because
/// the underlying routes 403 for viewers.
struct DetailSeasonsSection: View {
    let seasons: [SeasonSummary]
    let episodesBySeason: [Int: [Episode]]
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
                episodeList(episodes, canManage: canManage)
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

    @ViewBuilder
    private func episodeList(_ episodes: [Episode], canManage: Bool) -> some View {
        if episodes.isEmpty {
            Text(inLibrary ? "No episode data yet." : "Episode details appear once this is in your library.")
                .font(.caption)
                .foregroundStyle(Theme.faint)
        } else {
            VStack(spacing: 6) {
                ForEach(episodes.sorted { $0.episode < $1.episode }) { episode in
                    episodeRow(episode, canManage: canManage)
                }
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
