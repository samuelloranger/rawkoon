import Foundation

/// Feed and browse GETs whose screens paint from the cache. Each mirrors the
/// path + query its `APIClient` method sends, so both read the same cache entry.
nonisolated extension Endpoints {
    static let requests = Endpoint<RequestsResponse>(path: "/api/requests")
    static let systemFeatures = Endpoint<SystemFeatures>(path: "/api/system/features")
    static let bookDiscoverySources = Endpoint<BookDiscoverySourcesResponse>(path: "/api/books/discovery/sources")

    static func bookDiscovery(source: String, list: String) -> Endpoint<BookDiscoveryResponse> {
        Endpoint(path: "/api/books/discovery", query: ["source": source, "list": list])
    }

    static func genres(type: String) -> Endpoint<GenresResponse> {
        Endpoint(path: "/api/medias/genres", query: ["type": type])
    }

    static func streamingProviders(type: String) -> Endpoint<StreamingProvidersResponse> {
        Endpoint(path: "/api/medias/streaming-providers", query: ["type": type])
    }

    static func discoverGrid(
        type: String,
        providerId: Int? = nil,
        genreId: Int? = nil,
        sortBy: String? = nil,
        page: Int = 1,
        language: String? = nil,
        originalLanguage: String? = nil
    ) -> Endpoint<DiscoverMediasResponse> {
        Endpoint(path: "/api/medias/discover", query: [
            "type": type,
            "provider_id": providerId.map(String.init),
            "genre_id": genreId.map(String.init),
            "sort_by": sortBy,
            "page": String(page),
            "language": language ?? APIClient.tmdbLanguage,
            "original_language": originalLanguage,
        ])
    }
}
