import Foundation
import RawkoonKit

extension APIClient {
    func clearFailedDownloads(libraryId: Int) async throws -> Int {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/failed",
            method: "DELETE",
            requiresAuth: true
        )
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        let payload: DeleteCountResponse
        do { payload = try APIClient.mediaDecoder.decode(DeleteCountResponse.self, from: data) }
        catch { throw APIError.decode }
        return payload.deleted
    }

    func deleteDownloadEntry(libraryId: Int, downloadHistoryId: Int) async throws {
        let request = try makeRequest(
            path: "/api/library/\(libraryId)/downloads/\(downloadHistoryId)",
            method: "DELETE",
            requiresAuth: true
        )
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
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
        let (_, response) = try await postRaw("/api/library/\(libraryId)/downloads/\(downloadHistoryId)/action", body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
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

    func grabByToken(_ token: String) async throws {
        try await postExpectOK("/api/medias/interactive-search/download", body: GrabTokenBody(token: token))
    }

    func grabByUrl(libraryId: Int, body: GrabUrlBody) async throws {
        try await postExpectOK("/api/library/\(libraryId)/grab", body: body)
    }

    /// Downloads / activity / calendar
    func downloads(libraryId: Int) async throws -> DownloadsResponse {
        try await get("/api/library/\(libraryId)/downloads")
    }

    func speed() async throws -> SpeedResponse {
        try await get("/api/dashboard/downloads/speed")
    }

    func activityFeed(limit: Int = 50) async throws -> ActivityFeedResponse {
        try await get("/api/dashboard/activities/feed", query: ["limit": String(limit)])
    }

    func upcoming() async throws -> UpcomingResponse {
        try await get("/api/dashboard/upcoming")
    }

    func nowPlaying() async throws -> NowPlayingResponse {
        try await get("/api/dashboard/jellyfin/now-playing")
    }

    func rssStatus() async throws -> RssStatusResponse {
        try await get("/api/library/rss-status")
    }
}

nonisolated private struct DeleteCountResponse: Decodable {
    let deleted: Int
}
