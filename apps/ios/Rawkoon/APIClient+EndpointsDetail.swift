import Foundation

/// The detail-screen GETs, spelled exactly as `APIClient+Media` / `+System` send
/// them so the cached read hits the same key as the live fetch.
nonisolated extension Endpoints {
    static func similar(tmdbId: Int, mediaType: String) -> Endpoint<SimilarTitlesResponse> {
        Endpoint(path: "/api/medias/similar/\(tmdbId)", query: [
            "type": mediaType == "tv" ? "tv" : "movie",
            "language": APIClient.tmdbLanguage,
        ])
    }

    static func libraryEpisodes(id: Int) -> Endpoint<EpisodesResponse> {
        Endpoint(path: "/api/library/\(id)/episodes")
    }

    static func libraryFiles(id: Int) -> Endpoint<LibraryFilesResponse> {
        Endpoint(path: "/api/library/\(id)/files")
    }

    static func libraryDownloads(id: Int) -> Endpoint<DownloadsResponse> {
        Endpoint(path: "/api/library/\(id)/downloads")
    }
}

/// Mirrors the private `SimilarResponse` the live fetch decodes.
nonisolated struct SimilarTitlesResponse: Decodable, Sendable {
    let items: [TmdbSearchItem]
}
