import RawkoonKit
import SwiftUI

extension MediaDetailView {
    // MARK: Management actions

    func applyMonitoredChange(_ monitored: Bool) async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            managementItem = try await store.updateMonitored(
                id: libraryId,
                monitored: monitored,
                request: { try await client.updateLibraryMonitored(id: libraryId, monitored: monitored) }
            )
            managementNotice = String(localized: "Monitoring updated.")
            managementError = nil
        } catch {
            managementError = String(localized: "Could not update monitoring.")
        }
    }

    func applyQualityProfileChange(_ qualityProfileId: Int?) async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            managementItem = try await store.updateQualityProfile(
                id: libraryId,
                qualityProfileId: qualityProfileId,
                request: { try await client.updateLibraryQualityProfile(id: libraryId, qualityProfileId: qualityProfileId) }
            )
            managementNotice = String(localized: "Quality profile updated.")
            managementError = nil
        } catch {
            managementError = String(localized: "Could not update quality profile.")
        }
    }

    func runRescan() async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let result = try await client.rescanLibraryItem(id: libraryId)
            managementNotice = String(localized: "Rescan complete: \(result.rescanned) rescanned, \(result.imported) imported, \(result.deleted) deleted.")
            managementError = nil
            await refreshManagementData()
        } catch {
            managementError = String(localized: "Rescan failed.")
        }
    }

    func clearFailedDownloadsAction() async {
        guard let libraryId, let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            let deleted = try await client.clearFailedDownloads(libraryId: libraryId)
            managementNotice = deleted == 0 ? String(localized: "No failed downloads to clear.") : String(localized: "Cleared \(deleted) failed downloads.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not clear failed downloads.")
        }
    }

    func performDownloadAction(_ downloadHistoryId: Int, action: String, deleteFiles: Bool = false) async {
        guard let libraryId, let client = model.api() else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.downloadAction(
                libraryId: libraryId,
                downloadHistoryId: downloadHistoryId,
                action: action,
                deleteFiles: deleteFiles
            )
            store.invalidateDownloadHistory(itemID: libraryId)
            managementNotice = String(localized: "Download updated.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not update download.")
        }
    }

    func deleteDownloadEntryAction(_ downloadHistoryId: Int) async {
        guard let libraryId, let client = model.api() else { return }
        pendingDownloadActionId = downloadHistoryId
        defer { pendingDownloadActionId = nil }
        do {
            try await client.deleteDownloadEntry(libraryId: libraryId, downloadHistoryId: downloadHistoryId)
            store.invalidateDownloadHistory(itemID: libraryId)
            managementNotice = String(localized: "Download entry removed.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not remove download entry.")
        }
    }

    func deleteMovieFileAction(_ file: LibraryFileInfo) async {
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            try await client.deleteMovieFile(fileId: file.id)
            if let libraryId {
                store.invalidateLibraryRollup(itemID: libraryId)
            }
            managementNotice = String(localized: "File deleted.")
            managementError = nil
            await refreshManagementData()
            recordLibraryChangeFeedback()
        } catch {
            managementError = String(localized: "Could not delete file.")
        }
    }

    func removeLibraryItem(id: Int, deleteFiles: Bool) async {
        guard let client = model.api() else { return }
        applyingManagementChange = true
        defer { applyingManagementChange = false }
        do {
            try await store.removeLibraryItem(
                id: id,
                request: { try await client.removeFromLibrary(id: id, deleteFiles: deleteFiles) }
            )
            if id == libraryId {
                dismiss()
            } else {
                await fetchSimilar()
            }
        } catch {
            if id == libraryId {
                managementError = String(localized: "Could not remove from library.")
            } else {
                similarError = String(localized: "Could not remove from library.")
            }
        }
    }

    // MARK: Season / episode actions (admin)

    func seasonAutoSearch(_ season: Int) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            let result = try await client.searchSeason(id: libraryId, season: season)
            reportGrab(result)
            await reloadEpisodes()
            await refreshManagementData()
        } catch {
            model.toast(String(localized: "Season search failed."), style: .error)
        }
    }

    func seasonRetrySkipped(_ season: Int) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            let retried = try await client.retrySkippedSeason(id: libraryId, season: season)
            model.toast(String(localized: "Reset \(retried) skipped episodes."), style: .success)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not retry skipped episodes."), style: .error)
        }
    }

    func seasonToggleMonitor(_ season: Int, _ monitored: Bool) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            _ = try await client.setSeasonMonitored(id: libraryId, season: season, monitored: monitored)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not update monitoring."), style: .error)
        }
    }

    func episodeAutoSearch(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            let result = try await client.searchEpisode(id: libraryId, episodeId: episode.id)
            reportGrab(result)
            await reloadEpisodes()
            await refreshManagementData()
        } catch {
            model.toast(String(localized: "Episode search failed."), style: .error)
        }
    }

    func episodeToggleMonitor(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            _ = try await client.setEpisodeMonitored(id: libraryId, episodeId: episode.id, monitored: !episode.monitored)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not update monitoring."), style: .error)
        }
    }

    func episodeRetry(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            _ = try await client.setEpisodeStatus(id: libraryId, episodeId: episode.id, status: "wanted")
            model.toast(String(localized: "Episode marked wanted."), style: .success)
            await reloadEpisodes()
        } catch {
            model.toast(String(localized: "Could not update episode."), style: .error)
        }
    }

    func deleteEpisodeFileAction(_ episode: Episode) async {
        guard let libraryId, let client = model.api() else { return }
        do {
            try await client.deleteEpisodeFile(id: libraryId, episodeId: episode.id)
            store.invalidateLibraryRollup(itemID: libraryId)
            model.toast(String(localized: "Episode file deleted."), style: .success)
            await reloadEpisodes()
            await refreshManagementData()
        } catch {
            model.toast(String(localized: "Could not delete episode file."), style: .error)
        }
    }

    func reportGrab(_ result: LibrarySearchResponse) {
        if result.grabbed {
            model.toast(String(localized: "Grabbed \(result.releaseTitle ?? "a release")."), style: .success)
        } else {
            model.toast(result.reason ?? String(localized: "No release grabbed."), style: .info)
        }
    }

    // MARK: Similar menu

    func handleSimilarMenu(_ action: MediaPosterMenuAction, item: TmdbSearchItem) {
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

    func toggleSimilarMonitored(libraryId: Int) async {
        guard let client = model.api(), !busySimilarLibraryIds.contains(libraryId) else { return }
        busySimilarLibraryIds.insert(libraryId)
        do {
            let item = try await client.libraryItem(id: libraryId)
            _ = try await store.updateMonitored(
                id: libraryId,
                monitored: !item.monitored,
                request: { try await client.updateLibraryMonitored(id: libraryId, monitored: !item.monitored) }
            )
            await fetchSimilar()
            model.toast(String(localized: "Updated monitoring."), style: .success)
        } catch {
            model.toast(String(localized: "Could not update monitoring."), style: .error)
        }
        busySimilarLibraryIds.remove(libraryId)
    }

    // MARK: Watchlist / request / add

    func toggleWatchlist() async {
        guard let client = model.api() else {
            requestError = String(localized: "Not logged in.")
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
            recordLibraryChangeFeedback()
        } catch APIError.unauthorized {
            requestError = String(localized: "Sign in required.")
        } catch {
            requestError = String(localized: "Could not update watchlist.")
        }
    }

    func submitRequest() async {
        guard let client = model.api() else {
            requestError = String(localized: "Not logged in.")
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
            year: yearValue,
            googleVolumeId: nil,
            author: nil
        )

        do {
            _ = try await client.createRequest(body)
            requested = true
        } catch APIError.unauthorized {
            requestError = String(localized: "Sign in required.")
        } catch let APIError.http(status) where status == 409 {
            requestError = String(localized: "Already requested.")
        } catch {
            requestError = String(localized: "Could not submit request.")
        }
    }

    // Admin: add straight to the library from TMDB.
    func submitAdd() async {
        guard let client = model.api() else {
            requestError = String(localized: "Not logged in.")
            return
        }
        requesting = true
        requestError = nil
        defer { requesting = false }
        let type = mediaType == "tv" ? "show" : "movie"
        do {
            // The store shows an `Adding…` row in Library immediately and swaps in
            // the server's created item — or drops it again if the add fails.
            let item = try await model.serverStateStore.addToLibrary(
                provisional: .provisional(
                    tmdbId: tmdbId,
                    type: type,
                    title: title,
                    year: yearValue,
                    posterUrl: posterPath,
                    overview: details?.overview
                ),
                request: { try await client.addToLibrary(tmdbId: tmdbId, type: type) }
            )
            added = true
            // Reveal the admin tabs (Manage hosts the grab surface) in place, land
            // there, and load its data — no reopen needed to grab what was just added.
            libraryId = item.id
            recordLibraryChangeFeedback()
            if showManagement {
                detailTab = .manage
                await refreshManagementData()
            }
        } catch APIError.unauthorized {
            requestError = String(localized: "Admin only.")
        } catch let APIError.http(status) where status == 409 {
            added = true
        } catch {
            requestError = String(localized: "Could not add to library.")
        }
    }

    func recordLibraryChangeFeedback() {
        libraryChangeFeedback &+= 1
    }
}
