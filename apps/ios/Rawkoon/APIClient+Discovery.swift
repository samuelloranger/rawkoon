import Foundation
import RawkoonKit

extension APIClient {
    /// Discover
    func explore() async throws -> ExploreFeed {
        try await get("/api/medias/explore")
    }

    func tmdbSearch(q: String, kind: String? = nil) async throws -> TmdbSearchResponse {
        try await get("/api/medias/tmdb-search", query: ["q": q, "kind": kind])
    }

    /// Detail
    func mediaModal(mediaType: String, tmdbId: Int) async throws -> MediaModalResponse {
        try await get("/api/medias/modal/\(mediaType)/\(tmdbId)")
    }

    func similar(tmdbId: Int, mediaType: String, language: String? = nil) async throws -> [TmdbSearchItem] {
        let response: SimilarResponse = try await get("/api/medias/similar/\(tmdbId)", query: [
            "type": mediaType == "tv" ? "tv" : "movie",
            "language": language,
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
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }
}

private nonisolated struct SimilarResponse: Decodable {
    let items: [TmdbSearchItem]
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
