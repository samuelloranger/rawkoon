import Foundation

/// A GET described once, so the live fetch and the cached read of the same
/// screen always agree on the cache key.
nonisolated struct Endpoint<Response: Decodable & Sendable>: Sendable {
    let path: String
    var query: [String: String?] = [:]
}

extension APIClient {
    func get<T>(_ endpoint: Endpoint<T>) async throws -> T {
        try await get(endpoint.path, query: endpoint.query)
    }

    /// The last saved response for `endpoint`, without touching the network.
    nonisolated func cached<T>(_ endpoint: Endpoint<T>) -> Cached<T>? {
        cached(endpoint.path, query: endpoint.query)
    }
}

/// The browsing endpoints screens paint from the cache before refetching.
nonisolated enum Endpoints {
    static let currentUser = Endpoint<SessionResponse>(path: "/api/auth/me")
    static let upcoming = Endpoint<UpcomingResponse>(path: "/api/dashboard/upcoming")
    static let libraryAttention = Endpoint<LibraryAttentionResponse>(path: "/api/library/attention")
    static let rssStatus = Endpoint<RssStatusResponse>(path: "/api/library/rss-status")
    static let systemVersion = Endpoint<SystemVersion>(path: "/api/system/version")
    static let listeningStats = Endpoint<ListeningStats>(path: "/api/books/listening-stats")

    static func libraryList(
        type: String? = nil, status: String? = nil, q: String? = nil, page: Int? = nil, limit: Int? = nil,
        sortBy: String? = nil, sortDir: String? = nil
    ) -> Endpoint<LibraryListResponse> {
        Endpoint(path: "/api/library", query: [
            "type": type, "status": status, "q": q,
            "page": page.map(String.init),
            "limit": limit.map(String.init),
            "sort_by": sortBy, "sort_dir": sortDir,
            "title_language": APIClient.titleLanguage,
        ])
    }

    static func recentlyAdded(limit: Int = 24) -> Endpoint<LibraryListResponse> {
        libraryList(limit: limit, sortBy: "added_at", sortDir: "desc")
    }

    static func discoverDeck(
        exclude: [Int] = [], limit: Int = 20, language: String? = nil
    ) -> Endpoint<DiscoverDeckResponse> {
        let excludeParam = exclude.isEmpty ? nil : exclude.map(String.init).joined(separator: ",")
        return Endpoint(
            path: "/api/medias/discover/deck",
            query: ["limit": String(limit), "exclude": excludeParam, "language": language ?? APIClient.tmdbLanguage]
        )
    }

    static func mediaModal(mediaType: String, tmdbId: Int) -> Endpoint<MediaModalResponse> {
        Endpoint(path: "/api/medias/modal/\(mediaType)/\(tmdbId)", query: ["language": APIClient.tmdbLanguage])
    }

    static func activityFeed(
        limit: Int = 50, service: String? = nil, type: String? = nil
    ) -> Endpoint<ActivityFeedResponse> {
        Endpoint(path: "/api/dashboard/activities/feed", query: [
            "limit": String(limit),
            "service": service,
            "type": type,
        ])
    }

    static func notifications(
        page: Int? = nil, limit: Int? = nil, read: Bool? = nil
    ) -> Endpoint<NotificationsResponseDTO> {
        Endpoint(path: "/api/notifications", query: [
            "page": page.map(String.init),
            "limit": limit.map(String.init),
            "read": read.map { $0 ? "true" : "false" },
        ])
    }
}
