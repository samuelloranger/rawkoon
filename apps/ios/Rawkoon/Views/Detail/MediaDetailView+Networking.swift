import RawkoonKit
import SwiftUI

extension MediaDetailView {
    // MARK: Networking

    func fetchDetails() async {
        guard let client = model.api() else {
            errorMessage = String(localized: "Not logged in.")
            return
        }
        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            let response = try await client.mediaModal(mediaType: mediaType, tmdbId: tmdbId)
            details = response.details
            credits = response.credits
            trailer = response.trailer
            providers = response.providers
            ratings = response.ratings
            inWatchlist = response.watchlistStatus == true

            if mediaType == "tv", let libraryId {
                await reloadEpisodes(client: client, libraryId: libraryId)
            }
        } catch APIError.unauthorized {
            errorMessage = String(localized: "Sign in required.")
        } catch {
            errorMessage = String(localized: "Could not load details.")
        }
    }

    func fetchSimilar() async {
        guard let client = model.api() else {
            similarError = String(localized: "Not logged in.")
            return
        }
        loadingSimilar = true
        similarError = nil
        defer { loadingSimilar = false }

        do {
            similarItems = try await client.similar(tmdbId: tmdbId, mediaType: mediaType)
        } catch APIError.unauthorized {
            similarError = String(localized: "Sign in required.")
        } catch {
            similarError = String(localized: "Could not load similar titles.")
        }
    }

    var store: ServerStateStore {
        model.serverStateStore
    }

    /// Download rows with server-pushed live progress overlaid. Reading
    /// `model.downloadProgress` here makes the section re-render on each
    /// `.downloadProgress` SSE event, so the progress bar tracks the live value
    /// between fetches — no client poll.
    var liveDownloads: [DownloadHistoryItem] {
        guard let libraryId, let progress = model.downloadProgress[libraryId]
        else { return downloads }
        return overlayDownloadProgress(downloads, progress: progress)
    }

    func refreshManagementData() async {
        guard let libraryId, model.isAdmin else { return }
        guard let client = model.api() else {
            managementError = String(localized: "Not logged in.")
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
            store.seedLibraryItem(item)
            qualityProfiles = profileResponse.profiles
            mediaFilesType = filesResponse.mediaType
            mediaFiles = filesResponse.files
            downloads = downloadsResponse.items
        } catch APIError.unauthorized {
            managementError = String(localized: "Admin only.")
        } catch {
            managementError = String(localized: "Could not load management data.")
        }
    }

    func reloadEpisodes(client: APIClient, libraryId: Int) async {
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

    func reloadEpisodes() async {
        guard mediaType == "tv", let libraryId, let client = model.api() else { return }
        await reloadEpisodes(client: client, libraryId: libraryId)
    }
}
