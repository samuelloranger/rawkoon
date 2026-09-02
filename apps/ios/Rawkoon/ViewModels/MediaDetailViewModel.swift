import Foundation
import Observation
import RawkoonKit

/// Data-state and non-rendering (network/decision) logic extracted from
/// `MediaDetailView`. Holds no reference to `AppModel` and never reads
/// `@Environment` — every dependency on live app state (the resolved
/// `APIClient`, `model.isAdmin`) is passed in by the view at the call site.
/// SwiftUI-only coupling (`dismiss()`, `.onChange` wiring, the
/// `navigationDestination`/`.sheet` bindings, `handleSimilarMenu`) stays in
/// the view.
@MainActor
@Observable
final class MediaDetailViewModel {
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

    var details: TmdbMediaDetails?
    var loading = false
    var errorMessage: String?

    var requesting = false
    var requested = false
    var added = false
    var requestError: String?
    var watchlistPending = false
    var inWatchlist = false

    var episodesBySeason: [Int: [Episode]] = [:]
    var similarItems: [TmdbSearchItem] = []
    var loadingSimilar = false
    var similarError: String?

    var managementItem: LibraryMedia?
    var managementLoading = false
    var managementError: String?
    var managementNotice: String?
    var qualityProfiles: [QualityProfile] = []
    var mediaFiles: [LibraryFileInfo] = []
    var mediaFilesType: String = "movie"
    var downloads: [DownloadHistoryItem] = []
    var pendingDownloadActionId: Int?
    var applyingManagementChange = false

    // MARK: Pure derivations

    var metaLine: String {
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

    var yearValue: Int? {
        let raw = mediaType == "tv" ? details?.firstAirDate : details?.releaseDate
        guard let raw, raw.count >= 4 else { return nil }
        return Int(raw.prefix(4))
    }

    var hasDetailsToShow: Bool {
        (details?.voteAverage ?? 0) > 0
            || !(details?.status ?? "").isEmpty
            || (details?.runtime ?? 0) > 0
    }

    var groupedSeasonFiles: [(season: Int, files: [LibraryFileInfo])] {
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

    func trackSummary(_ tracks: [LibraryAudioTrack]) -> String {
        guard !tracks.isEmpty else { return "None" }
        let names = tracks.compactMap { $0.languageName ?? $0.language }.filter { !$0.isEmpty }
        if names.isEmpty {
            return "\(tracks.count)"
        }
        return "\(tracks.count) (\(names.joined(separator: ", ")))"
    }

    func subtitleSummary(_ tracks: [LibrarySubtitleTrack]) -> String {
        guard !tracks.isEmpty else { return "None" }
        let names = tracks.compactMap { $0.languageName ?? $0.language }.filter { !$0.isEmpty }
        if names.isEmpty {
            return "\(tracks.count)"
        }
        return "\(tracks.count) (\(names.joined(separator: ", ")))"
    }

    func resolutionText(for file: LibraryFileInfo) -> String? {
        if let res = file.resolution {
            return "\(res)p"
        }
        if let width = file.width, let height = file.height {
            return "\(width)x\(height)"
        }
        return nil
    }

    func scannedDate(_ isoDate: String) -> String? {
        guard let date = ISO8601DateFormatter().date(from: isoDate) else { return nil }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }

    func metaLine(for row: DownloadHistoryItem) -> String {
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

    // MARK: Networking

    func fetchDetails(client: APIClient) async {
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

    func fetchSimilar(client: APIClient) async {
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

    func refreshManagementData(client: APIClient, isAdmin: Bool) async {
        guard let libraryId, isAdmin else { return }
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

    func applyMonitoredChange(client: APIClient, _ monitored: Bool) async {
        guard let libraryId else { return }
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

    func applyQualityProfileChange(client: APIClient, _ qualityProfileId: Int?) async {
        guard let libraryId else { return }
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

    func runRescan(client: APIClient, isAdmin: Bool) async {
        guard let libraryId else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let result = try await client.rescanLibraryItem(id: libraryId)
            managementNotice = "Rescan complete: \(result.rescanned) rescanned, \(result.imported) imported, \(result.deleted) deleted."
            managementError = nil
            await refreshManagementData(client: client, isAdmin: isAdmin)
        } catch {
            managementError = "Rescan failed."
        }
    }

    func clearFailedDownloadsAction(client: APIClient, isAdmin: Bool) async {
        guard let libraryId else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let deleted = try await client.clearFailedDownloads(libraryId: libraryId)
            managementNotice = deleted == 0 ? "No failed downloads to clear." : "Cleared \(deleted) failed downloads."
            managementError = nil
            await refreshManagementData(client: client, isAdmin: isAdmin)
        } catch {
            managementError = "Could not clear failed downloads."
        }
    }

    func performDownloadAction(client: APIClient, _ downloadHistoryId: Int, action: String, isAdmin: Bool) async {
        guard let libraryId else { return }
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
            await refreshManagementData(client: client, isAdmin: isAdmin)
        } catch {
            managementError = "Could not update download."
        }
    }

    func deleteDownloadEntryAction(client: APIClient, _ downloadHistoryId: Int, isAdmin: Bool) async {
        guard let libraryId else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.deleteDownloadEntry(libraryId: libraryId, downloadHistoryId: downloadHistoryId)
            managementNotice = "Download entry removed."
            managementError = nil
            await refreshManagementData(client: client, isAdmin: isAdmin)
        } catch {
            managementError = "Could not remove download entry."
        }
    }

    /// Returns whether the removed item is the one currently displayed by
    /// this view — the view calls `dismiss()` when true, or refreshes the
    /// similar-titles list when false.
    func removeLibraryItem(client: APIClient, id: Int, deleteFiles: Bool) async -> Bool {
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            try await client.removeFromLibrary(id: id, deleteFiles: deleteFiles)
            return id == libraryId
        } catch {
            if id == libraryId {
                managementError = "Could not remove from library."
            } else {
                similarError = "Could not remove from library."
            }
            return false
        }
    }

    func toggleSimilarMonitored(client: APIClient, libraryId: Int) async {
        do {
            let item = try await client.libraryItem(id: libraryId)
            _ = try await client.updateLibraryMonitored(id: libraryId, monitored: !item.monitored)
            await fetchSimilar(client: client)
        } catch {
            similarError = "Could not update monitoring."
        }
    }

    func toggleWatchlist(client: APIClient) async {
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

    func fetchEpisodes(client: APIClient, libraryId: Int) async {
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

    func submitRequest(client: APIClient) async {
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
    func submitAdd(client: APIClient) async {
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
