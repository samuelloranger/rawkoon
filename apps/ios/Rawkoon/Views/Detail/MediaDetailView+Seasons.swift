import RawkoonKit
import SwiftUI

extension MediaDetailView {
    // MARK: Seasons (interactive)

    /// Info tab: admins on in-library shows get a compact summary (the controls
    /// live in Files); everyone else keeps the read-only list.
    @ViewBuilder
    var seasonsSection: some View {
        if libraryId != nil, model.isAdmin, showManagement {
            seasonsSummary
        } else {
            seasonsList(manage: false)
        }
    }

    @ViewBuilder
    private var seasonsSummary: some View {
        let seasons = (details?.seasons ?? []).filter { $0.seasonNumber != 0 || ($0.episodeCount ?? 0) > 0 }
        if !seasons.isEmpty {
            let all = episodesBySeason.values.flatMap(\.self)
            let downloaded = all.filter { $0.status == "downloaded" }.count
            Button {
                withRawkoonMotion(.easeInOut(duration: 0.15)) { detailTab = .files }
            } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Seasons").font(.display(17)).foregroundStyle(Theme.textStrong)
                        Text(all.isEmpty ? String(localized: "\(seasons.count) seasons") : String(localized: "\(downloaded)/\(all.count)"))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                    Text("View in Files").font(.subheadline.weight(.medium)).foregroundStyle(Theme.apricot)
                    Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.apricot)
                }
                .padding(12)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
        }
    }

    /// The seasons as the strip draws them: TMDB's air dates, with episode counts from the library once loaded.
    var manageSeasonInfos: [SeasonInfo] {
        SeasonPlan.regular((details?.seasons ?? []).map { season in
            SeasonInfo(
                number: season.seasonNumber,
                episodes: episodesBySeason[season.seasonNumber]?.count ?? season.episodeCount ?? 0,
                airDate: season.airDate
            )
        })
    }

    /// What the show monitors now: a season counts when any of its episodes is monitored.
    func currentSeasonDraft(_ item: LibraryMedia) -> SeasonDraft {
        let picked = Set(episodesBySeason.filter { $0.key >= 1 && $0.value.contains(where: \.monitored) }.keys)
        return SeasonDraft(mode: .pick, picked: picked, monitorNew: item.monitorNewSeasons ?? true)
    }

    var manageSeasonsButton: some View {
        Button {
            showingManageSeasons = true
        } label: {
            HStack {
                Label("Manage seasons", systemImage: "slider.horizontal.3")
                    .font(.subheadline.weight(.medium))
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.bold))
            }
            .foregroundStyle(Theme.apricot)
            .padding(12)
            .frame(minHeight: 44)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .requiresConnection(model.isOffline)
    }

    /// Files tab: the full per-season controls.
    var manageSeasonsSection: some View {
        seasonsList(manage: true)
    }

    @ViewBuilder
    func seasonsList(manage: Bool) -> some View {
        if let seasons = details?.seasons, !seasons.isEmpty {
            DetailSeasonsSection(
                seasons: seasons,
                episodesBySeason: episodesBySeason,
                filesBySeason: filesBySeason,
                inLibrary: libraryId != nil,
                isAdmin: model.isAdmin,
                manage: manage,
                onSeasonAutoSearch: { season in await seasonAutoSearch(season) },
                onSeasonReleaseSearch: { season in
                    releaseSearchSeason = season
                    showingReleaseSearch = true
                },
                onSeasonRetrySkipped: { season in Task { await seasonRetrySkipped(season) } },
                onSeasonToggleMonitor: { season, value in Task { await seasonToggleMonitor(season, value) } },
                onSeasonReencode: { season in
                    if let libraryId {
                        reencodeTarget = ReencodeTarget(
                            selection: TranscodeSelection(mediaId: libraryId, season: season),
                            subtitle: "\(title) · " + String(localized: "Season \(season)")
                        )
                    }
                },
                onFileReencode: { file in
                    reencodeTarget = ReencodeTarget(
                        selection: TranscodeSelection(fileIds: [file.id]),
                        subtitle: file.fileName
                    )
                },
                onEpisodeAutoSearch: { episode in Task { await episodeAutoSearch(episode) } },
                onEpisodeReleaseSearch: { episode in
                    releaseSearchSeason = episode.season
                    releaseSearchEpisode = episode.episode
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
}
