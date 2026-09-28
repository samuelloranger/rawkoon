import RawkoonKit
import SwiftUI

extension MediaDetailView {
    // MARK: Networking

    /// Paints details, similar titles, episodes and management from the last
    /// saved responses, so the screen has content before (or without) the network.
    func hydrateFromCache() {
        guard let client = model.api() else { return }
        if details == nil, let cached = client.cached(Endpoints.mediaModal(mediaType: mediaType, tmdbId: tmdbId)) {
            applyModal(cached.value)
        }
        if similarItems.isEmpty, let cached = client.cached(Endpoints.similar(tmdbId: tmdbId, mediaType: mediaType)) {
            similarItems = cached.value.items
        }
        if mediaType == "tv", let libraryId, episodesBySeason.isEmpty,
           let cached = client.cached(Endpoints.libraryEpisodes(id: libraryId))
        {
            applyEpisodes(cached.value)
        }
        hydrateManagementFromCache(client: client)
    }

    func applyModal(_ response: MediaModalResponse) {
        details = response.details
        credits = response.credits
        trailer = response.trailer
        providers = response.providers
        ratings = response.ratings
        inWatchlist = response.watchlistStatus == true
    }

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
            applyModal(response)
            detailsUnreachable = false
            await fetchMissingPoster(client: client)

            if mediaType == "tv", let libraryId {
                await reloadEpisodes(client: client, libraryId: libraryId)
            }
        } catch APIError.unauthorized {
            errorMessage = String(localized: "Sign in required.")
        } catch {
            // Saved details stay on screen; only an empty screen reports the failure.
            if (error as? APIError)?.isNetworkFailure == true {
                detailsUnreachable = details == nil
            } else {
                errorMessage = String(localized: "Could not load details.")
            }
        }
    }

    func fetchSimilar() async {
        guard let client = model.api() else {
            similarError = String(localized: "Not logged in.")
            return
        }
        if similarItems.isEmpty, let cached = client.cached(Endpoints.similar(tmdbId: tmdbId, mediaType: mediaType)) {
            similarItems = cached.value.items
        }
        loadingSimilar = true
        similarError = nil
        defer { loadingSimilar = false }

        do {
            similarItems = try await client.similar(tmdbId: tmdbId, mediaType: mediaType)
        } catch {
            // A failed refresh keeps the titles already shown.
            guard similarItems.isEmpty else { return }
            if case APIError.unauthorized = error {
                similarError = String(localized: "Sign in required.")
            } else if let apiError = error as? APIError, apiError.isNetworkFailure {
                similarError = apiError.userMessage()
            } else {
                similarError = String(localized: "Could not load similar titles.")
            }
        }
    }

    var store: ServerStateStore {
        model.serverStateStore
    }

    var resolvedPosterPath: String? {
        posterPath ?? managementItem?.posterUrl ?? fetchedPosterPath
    }

    func fetchMissingPoster(client: APIClient) async {
        guard resolvedPosterPath == nil, let libraryId,
              let item = try? await client.libraryItem(id: libraryId)
        else { return }
        fetchedPosterPath = item.posterUrl
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
        hydrateManagementFromCache(client: client)
        managementLoading = true
        managementError = nil
        defer { managementLoading = false }

        async let itemRequest = client.libraryItem(id: libraryId)
        async let profileRequest = client.qualityProfiles()
        async let filesRequest = client.libraryFiles(id: libraryId)
        async let downloadsRequest = client.downloads(libraryId: libraryId)

        // Each part lands on its own, so one failing request can't blank the rest.
        var failure: Error?
        do {
            let item = try await itemRequest
            managementItem = item
            store.seedLibraryItem(item)
        } catch { failure = error }
        do {
            let profileResponse = try await profileRequest
            qualityProfiles = profileResponse.profiles
        } catch { failure = failure ?? error }
        do {
            let filesResponse = try await filesRequest
            mediaFilesType = filesResponse.mediaType
            mediaFiles = filesResponse.files
        } catch { failure = failure ?? error }
        do {
            let downloadsResponse = try await downloadsRequest
            downloads = downloadsResponse.items
        } catch { failure = failure ?? error }

        guard let failure else { return }
        let apiError = failure as? APIError
        if case .unauthorized? = apiError {
            managementError = String(localized: "Admin only.")
        } else if apiError?.isNetworkFailure == true {
            // Offline with saved data: the strip already says so.
            if managementItem == nil {
                managementError = apiError?.userMessage()
            }
        } else {
            managementError = String(localized: "Could not load management data.")
        }
    }

    /// Seeds the Manage tab from the store and the saved responses.
    func hydrateManagementFromCache(client: APIClient) {
        guard let libraryId, model.isAdmin else { return }
        if managementItem == nil {
            managementItem = store.libraryItem(libraryId).value ?? client.cachedLibraryItem(id: libraryId)?.value
        }
        if qualityProfiles.isEmpty, let cached = client.cached(Endpoints.qualityProfiles) {
            qualityProfiles = cached.value.profiles
        }
        if mediaFiles.isEmpty, let cached = client.cached(Endpoints.libraryFiles(id: libraryId)) {
            mediaFilesType = cached.value.mediaType
            mediaFiles = cached.value.files
        }
        if downloads.isEmpty, let cached = client.cached(Endpoints.libraryDownloads(id: libraryId)) {
            downloads = cached.value.items
        }
    }

    func reloadEpisodes(client: APIClient, libraryId: Int) async {
        do {
            let response = try await client.libraryEpisodes(id: libraryId)
            applyEpisodes(response)
        } catch {
            // Non-fatal: seasons still render with episode counts from TMDB.
        }
    }

    func applyEpisodes(_ response: EpisodesResponse) {
        var map: [Int: [Episode]] = [:]
        for season in response.seasons {
            map[season.season] = season.episodes
        }
        episodesBySeason = map
    }

    func reloadEpisodes() async {
        guard mediaType == "tv", let libraryId, let client = model.api() else { return }
        await reloadEpisodes(client: client, libraryId: libraryId)
    }
}
