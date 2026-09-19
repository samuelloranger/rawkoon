import Foundation
import RawkoonKit

// Movies/TV API methods — discover, library CRUD, episodes/files/remux,
// interactive search + grab, requests, dashboard widgets, and the live
// library SSE streams — plus their DTOs. Split out of APIClient.swift to
// stay under the file_length lint threshold (spec §4.2).

extension APIClient {
    /// Migration job status stream. Kept as its own named method (rather than
    /// a bare `sseStream` call at the use site) so `ArrLibraryImportView` reads
    /// the same as before this was generalized.
    func libraryMigrateStatusStream() -> AsyncThrowingStream<MigrateStatusDTO, Error> {
        sseStream("/api/library/migrate/status")
    }

    /// Live library/book change feed. The handshake (`{connected:true,...}`)
    /// decodes but carries no id, so it is filtered out here rather than at
    /// each call site.
    func libraryEventsStream() -> AsyncThrowingStream<LibraryEvent, Error> {
        let raw: AsyncThrowingStream<LibraryEventDTO, Error> = sseStream("/api/library/events")
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in raw {
                        if let mapped = LibraryEvent.from(event) {
                            continuation.yield(mapped)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Admin: add a movie/show to the library directly from TMDB.
    @discardableResult
    func addToLibrary(tmdbId: Int, type: String) async throws -> LibraryMedia {
        nonisolated struct Body: Encodable { let tmdbId: Int; let type: String }
        let response: LibraryItemResponse = try await post("/api/library", body: Body(tmdbId: tmdbId, type: type))
        return response.item
    }

    func tmdbSearch(q: String, kind: String? = nil) async throws -> TmdbSearchResponse {
        try await get(
            "/api/medias/tmdb-search",
            query: ["q": q, "kind": kind, "language": Self.tmdbLanguage]
        )
    }

    /// Discover deck (swipe)
    func discoverDeck(exclude: [Int], limit: Int = 20, language: String? = nil) async throws -> DiscoverDeckResponse {
        let excludeParam = exclude.isEmpty ? nil : exclude.map(String.init).joined(separator: ",")
        return try await get(
            "/api/medias/discover/deck",
            query: ["limit": String(limit), "exclude": excludeParam, "language": language ?? Self.tmdbLanguage]
        )
    }

    func dismissDiscover(tmdbId: Int, type: String) async throws {
        nonisolated struct Body: Encodable { let tmdbId: Int; let type: String }
        try await postExpectOK("/api/medias/discover/dismiss", body: Body(tmdbId: tmdbId, type: type))
    }

    /// Explore filter grid
    func discoverGrid(
        type: String,
        providerId: Int? = nil,
        genreId: Int? = nil,
        sortBy: String? = nil,
        page: Int = 1,
        language: String? = nil,
        originalLanguage: String? = nil
    ) async throws -> DiscoverMediasResponse {
        try await get(
            "/api/medias/discover",
            query: [
                "type": type,
                "provider_id": providerId.map(String.init),
                "genre_id": genreId.map(String.init),
                "sort_by": sortBy,
                "page": String(page),
                "language": language ?? Self.tmdbLanguage,
                "original_language": originalLanguage,
            ]
        )
    }

    func genres(type: String) async throws -> [Genre] {
        let response: GenresResponse = try await get("/api/medias/genres", query: ["type": type])
        return response.genres
    }

    func streamingProviders(type: String) async throws -> [StreamingProvider] {
        let response: StreamingProvidersResponse = try await get(
            "/api/medias/streaming-providers",
            query: ["type": type]
        )
        return response.providers
    }

    /// Detail
    func mediaModal(mediaType: String, tmdbId: Int) async throws -> MediaModalResponse {
        try await get(
            "/api/medias/modal/\(mediaType)/\(tmdbId)",
            query: ["language": Self.tmdbLanguage]
        )
    }

    /// Library (movies / shows)
    func libraryList(
        type: String? = nil, status: String? = nil, q: String? = nil, page: Int? = nil, limit: Int? = nil,
        sortBy: String? = nil, sortDir: String? = nil
    ) async throws -> LibraryListResponse {
        try await get("/api/library", query: [
            "type": type, "status": status, "q": q,
            "page": page.map(String.init),
            "limit": limit.map(String.init),
            "sort_by": sortBy, "sort_dir": sortDir,
            "title_language": Self.titleLanguage,
        ])
    }

    func libraryItem(id: Int) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await get(
            "/api/library/item/\(id)",
            query: ["title_language": Self.titleLanguage]
        )
        return response.item
    }

    func updateLibraryMonitored(id: Int, monitored: Bool) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await patch(
            "/api/library/\(id)/monitored",
            body: UpdateLibraryMonitoredBody(monitored: monitored)
        )
        return response.item
    }

    func updateLibraryQualityProfile(id: Int, qualityProfileId: Int?) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await patch(
            "/api/library/\(id)/quality-profile",
            body: UpdateLibraryQualityProfileBody(qualityProfileId: qualityProfileId)
        )
        return response.item
    }

    /// Admin: set or clear per-media display overrides (title, sort title, year,
    /// overview, poster, backdrop). A `.clear` field removes the override; an
    /// omitted field is left untouched (mirrors the web overrides editor).
    func updateLibraryOverrides(id: Int, body: UpdateLibraryOverridesBody) async throws -> LibraryMedia {
        let response: LibraryItemResponse = try await patch(
            "/api/library/\(id)/overrides",
            body: body
        )
        return response.item
    }

    /// Poster or backdrop candidates (TMDB + fanart) for the artwork picker.
    func libraryArtworkCandidates(id: Int, kind: String) async throws -> [ArtworkCandidate] {
        let response: ArtworkCandidatesResponse = try await get(
            "/api/library/\(id)/images",
            query: ["kind": kind]
        )
        return response.candidates
    }

    func rescanLibraryItem(id: Int) async throws -> (
        rescanned: Int,
        skipped: Int,
        failed: Int,
        deleted: Int,
        imported: Int,
        requeued: Int
    ) {
        let response: RescanResponse = try await post("/api/library/\(id)/rescan", body: EmptyBody())
        return (
            rescanned: response.rescanned,
            skipped: response.skipped,
            failed: response.failed,
            deleted: response.deleted,
            imported: response.imported,
            requeued: response.requeued
        )
    }

    func removeFromLibrary(id: Int, deleteFiles: Bool) async throws {
        let query = deleteFiles ? "?delete_files=true" : ""
        let request = try makeRequest(
            path: "/api/library/\(id)\(query)",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    func clearFailedDownloads(libraryId: Int) async throws -> Int {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/failed",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
        let payload: DeleteCountResponse = try decodeJSON(data)
        return payload.deleted
    }

    func deleteDownloadEntry(libraryId: Int, downloadHistoryId: Int) async throws {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/\(downloadHistoryId)",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    func downloadAction(
        libraryId: Int,
        downloadHistoryId: Int,
        action: String,
        deleteFiles: Bool = false
    ) async throws {
        let body: [String: Any] = [
            "action": action,
            "delete_files": deleteFiles,
        ]
        let (data, response) = try await postRaw("/api/library/\(libraryId)/downloads/\(downloadHistoryId)/action", body: body)
        try checkStatus(data, response)
    }

    func similar(tmdbId: Int, mediaType: String, language: String? = nil) async throws -> [TmdbSearchItem] {
        let response: SimilarResponse = try await get("/api/medias/similar/\(tmdbId)", query: [
            "type": mediaType == "tv" ? "tv" : "movie",
            "language": language ?? Self.tmdbLanguage,
        ])
        return response.items
    }

    func addToWatchlist(
        tmdbId: Int,
        mediaType: String,
        title: String,
        posterURL: String?,
        overview: String?,
        releaseYear: Int?,
        voteAverage: Double?,
        releaseDate: String?
    ) async throws {
        try await postExpectOK("/api/medias/watchlist", body: WatchlistAddBody(
            tmdbId: tmdbId,
            mediaType: mediaType == "tv" ? "tv" : "movie",
            title: title,
            posterUrl: posterURL,
            overview: overview,
            releaseYear: releaseYear,
            voteAverage: voteAverage,
            releaseDate: releaseDate
        ))
    }

    func removeFromWatchlist(tmdbId: Int, mediaType: String) async throws {
        let request = try makeRequest(
            path: "/api/medias/watchlist/\(tmdbId)?type=\(mediaType == "tv" ? "tv" : "movie")",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        try checkStatus(data, response)
    }

    func libraryEpisodes(id: Int) async throws -> EpisodesResponse {
        try await get("/api/library/\(id)/episodes")
    }

    func libraryFiles(id: Int) async throws -> LibraryFilesResponse {
        try await get("/api/library/\(id)/files")
    }

    func remuxFile(
        fileId: Int,
        keepAudioTrackIndices: [Int],
        keepSubtitleTrackIndices: [Int]
    ) async throws -> RemuxStartResponse {
        try await post(
            "/api/library/files/\(fileId)/remux",
            body: RemuxRequest(
                keepAudioTrackIndices: keepAudioTrackIndices,
                keepSubtitleTrackIndices: keepSubtitleTrackIndices
            )
        )
    }

    func remuxFileStatus(fileId: Int) async throws -> RemuxFileStatus {
        try await get("/api/library/files/\(fileId)/remux/status")
    }

    /// Manual release search + grab for a whole season (best season pack).
    func searchSeason(id: Int, season: Int, searchQuery: String? = nil) async throws -> LibrarySearchResponse {
        try await post(
            "/api/library/\(id)/seasons/\(season)/search",
            body: LibrarySearchBody(searchQuery: searchQuery)
        )
    }

    /// Manual release search + grab for a single episode.
    func searchEpisode(id: Int, episodeId: Int, searchQuery: String? = nil) async throws -> LibrarySearchResponse {
        try await post(
            "/api/library/\(id)/episodes/\(episodeId)/search",
            body: LibrarySearchBody(searchQuery: searchQuery)
        )
    }

    /// Resets every "skipped" episode in a season back to "wanted" so it's picked up again.
    func retrySkippedSeason(id: Int, season: Int) async throws -> Int {
        let response: RetriedResponse = try await post(
            "/api/library/\(id)/seasons/\(season)/retry-skipped",
            body: EmptyBody()
        )
        return response.retried
    }

    func setEpisodeMonitored(id: Int, episodeId: Int, monitored: Bool) async throws -> Bool {
        let response: EpisodeMonitoredResponse = try await patch(
            "/api/library/\(id)/episodes/\(episodeId)/monitored",
            body: UpdateLibraryMonitoredBody(monitored: monitored)
        )
        return response.episode.monitored
    }

    /// Bulk toggle monitoring for every episode in a season. Returns the number of episodes updated.
    func setSeasonMonitored(id: Int, season: Int, monitored: Bool) async throws -> Int {
        let response: SeasonMonitoredResponse = try await patch(
            "/api/library/\(id)/seasons/\(season)/monitored",
            body: UpdateLibraryMonitoredBody(monitored: monitored)
        )
        return response.updated
    }

    /// Resets an episode's status (e.g. "wanted" to retry a skipped episode).
    func setEpisodeStatus(id: Int, episodeId: Int, status: String) async throws -> String {
        let response: EpisodeStatusResponse = try await patch(
            "/api/library/\(id)/episodes/\(episodeId)/status",
            body: UpdateLibraryStatusBody(status: status)
        )
        return response.episode.status
    }

    /// Removes an episode's files (row + disk) and resets it to "wanted".
    func deleteEpisodeFile(id: Int, episodeId: Int) async throws {
        try await deleteExpectOK("/api/library/\(id)/episodes/\(episodeId)", query: ["delete_file": "true"])
    }

    /// Removes a single `MediaFile` row (movies) and its file on disk.
    func deleteMovieFile(fileId: Int) async throws {
        try await deleteExpectOK("/api/library/files/\(fileId)", query: ["delete_file": "true"])
    }

    /// Requests
    func requestsList() async throws -> RequestsResponse {
        try await get("/api/requests")
    }

    func createRequest(_ body: CreateRequestBody) async throws -> [String: Int] {
        try await post("/api/requests", body: body)
    }

    /// Interactive release search + grab
    func interactiveSearch(
        q: String,
        libraryMediaId: Int? = nil,
        season: Int? = nil,
        complete: Bool = false,
        tmdbId: Int? = nil,
        mediaType: String? = nil
    ) async throws -> InteractiveSearchResponse {
        try await get("/api/medias/interactive-search", query: [
            "q": q,
            "library_media_id": libraryMediaId.map(String.init),
            "season": season.map(String.init),
            "complete": complete ? "true" : nil,
            "tmdb_id": tmdbId.map(String.init),
            "media_type": mediaType,
        ])
    }

    /// Returns the grab result: the route replies 200 with `{grabbed:false, reason}`
    /// on a post-validation failure, so the caller must check `grabbed`, not status.
    func grabByToken(_ token: String) async throws -> LibrarySearchResponse {
        try await post("/api/medias/interactive-search/download", body: GrabTokenBody(token: token))
    }

    func grabByUrl(libraryId: Int, body: GrabUrlBody) async throws -> LibrarySearchResponse {
        try await post("/api/library/\(libraryId)/grab", body: body)
    }

    /// Whether the AI Provider integration is enabled — gates the AI-pick UI.
    func aiProviderEnabled() async -> Bool {
        do {
            let response: AiProviderIntegrationResponse = try await get("/api/integrations/ai-provider")
            return response.integration.enabled
        } catch {
            return false
        }
    }

    /// Fire-and-forget: loads the model into VRAM so the first real pick is fast.
    func aiWarm() async {
        guard let request = try? makeRequest(path: "/api/medias/search/ai-warm", method: "GET", requiresAuth: true) else { return }
        _ = try? await perform(request)
    }

    func aiPick(_ body: AiPickRequest) async throws -> AiPick {
        try await post("/api/medias/search/ai-pick", body: body)
    }

    func blockRelease(_ body: BlocklistBody) async throws {
        try await postExpectOK("/api/medias/blocklist", body: body)
    }

    /// Downloads / activity / calendar
    func downloads(libraryId: Int) async throws -> DownloadsResponse {
        try await get("/api/library/\(libraryId)/downloads")
    }

    func speed() async throws -> SpeedResponse {
        try await get("/api/dashboard/downloads/speed")
    }

    func activityFeed(limit: Int = 50, service: String? = nil, type: String? = nil) async throws -> ActivityFeedResponse {
        try await get("/api/dashboard/activities/feed", query: [
            "limit": String(limit),
            "service": service,
            "type": type,
        ])
    }

    func upcoming() async throws -> UpcomingResponse {
        try await get("/api/dashboard/upcoming")
    }

    /// Home widgets
    func recentlyAdded(limit: Int = 24) async throws -> LibraryListResponse {
        try await libraryList(limit: limit, sortBy: "added_at", sortDir: "desc")
    }

    func nowPlaying() async throws -> NowPlayingResponse {
        try await get("/api/dashboard/jellyfin/now-playing")
    }

    func libraryAttention() async throws -> LibraryAttentionResponse {
        try await get("/api/library/attention")
    }

    func rssStatus() async throws -> RssStatusResponse {
        try await get("/api/library/rss-status")
    }

    func approveRequest(id: Int, qualityProfileId: Int) async throws {
        try await postExpectOK("/api/requests/\(id)/approve", body: ApproveRequestBody(qualityProfileId: qualityProfileId))
    }

    func denyRequest(id: Int, reason: String?) async throws {
        try await postExpectOK("/api/requests/\(id)/deny", body: DenyRequestBody(denyReason: reason))
    }
}

private nonisolated struct LibraryItemResponse: Decodable {
    let item: LibraryMedia
}

private nonisolated struct SimilarResponse: Decodable {
    let items: [TmdbSearchItem]
}

private nonisolated struct UpdateLibraryMonitoredBody: Encodable {
    let monitored: Bool
}

private nonisolated struct UpdateLibraryStatusBody: Encodable {
    let status: String
}

private nonisolated struct UpdateLibraryQualityProfileBody: Encodable {
    let qualityProfileId: Int?
}

private nonisolated struct DeleteCountResponse: Decodable {
    let deleted: Int
}

private nonisolated struct LibrarySearchBody: Encodable {
    let searchQuery: String?
}

private nonisolated struct RetriedResponse: Decodable {
    let retried: Int
}

private nonisolated struct EpisodeMonitoredPayload: Decodable {
    let id: Int
    let monitored: Bool
}

private nonisolated struct EpisodeMonitoredResponse: Decodable {
    let episode: EpisodeMonitoredPayload
}

private nonisolated struct SeasonMonitoredResponse: Decodable {
    let updated: Int
}

private nonisolated struct EpisodeStatusPayload: Decodable {
    let id: Int
    let status: String
    let searchAttempts: Int
}

private nonisolated struct EpisodeStatusResponse: Decodable {
    let episode: EpisodeStatusPayload
}

private nonisolated struct RescanResponse: Decodable {
    let rescanned: Int
    let skipped: Int
    let failed: Int
    let deleted: Int
    let imported: Int
    let requeued: Int
}

private nonisolated struct WatchlistAddBody: Encodable {
    let tmdbId: Int
    let mediaType: String
    let title: String
    let posterUrl: String?
    let overview: String?
    let releaseYear: Int?
    let voteAverage: Double?
    let releaseDate: String?
}
