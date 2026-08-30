import Foundation

// MARK: - Discover / TMDB
//
// JSON is snake_case; the media decoder uses `.convertFromSnakeCase`, so Swift
// camelCase properties map automatically. Dates stay as ISO strings and are
// formatted in the view layer. Codable ignores JSON keys not listed here, so
// each struct declares only the fields the app actually uses.

struct TmdbSearchItem: Decodable, Identifiable, Hashable, Sendable {
    let id: String            // "${media_type}-${tmdb_id}"
    let tmdbId: Int
    let mediaType: String     // "movie" | "tv"
    let title: String
    let releaseYear: Int?
    let posterUrl: String?
    let overview: String?
    let voteAverage: Double?
    let alreadyExists: Bool?
    let canAdd: Bool?
    let libraryId: Int?
}

struct ExploreFeed: Decodable, Sendable {
    let trending: [TmdbSearchItem]?
    let popularMovies: [TmdbSearchItem]?
    let popularShows: [TmdbSearchItem]?
    let upcomingMovies: [TmdbSearchItem]?
    let nowPlaying: [TmdbSearchItem]?
    let topRatedMovies: [TmdbSearchItem]?
    let topRatedShows: [TmdbSearchItem]?
    let recommended: [TmdbSearchItem]?

    /// Named sections in a sensible display order, empty ones dropped.
    var sections: [(title: String, items: [TmdbSearchItem])] {
        [
            ("Trending", trending),
            ("Popular movies", popularMovies),
            ("Popular shows", popularShows),
            ("Now playing", nowPlaying),
            ("Upcoming", upcomingMovies),
            ("Top rated movies", topRatedMovies),
            ("Top rated shows", topRatedShows),
            ("Recommended", recommended),
        ].compactMap { name, items in
            guard let items, !items.isEmpty else { return nil }
            return (name, items)
        }
    }
}

struct TmdbSearchResponse: Decodable, Sendable {
    let enabled: Bool?
    let items: [TmdbSearchItem]
}

// MARK: - Media detail (TMDB modal)

struct MediaModalResponse: Decodable, Sendable {
    let watchlistStatus: Bool?
    let watchlistId: Int?
    let details: TmdbMediaDetails
}

struct TmdbMediaDetails: Decodable, Sendable {
    let runtime: Int?
    let overview: String?
    let voteAverage: Double?
    let numberOfSeasons: Int?
    let numberOfEpisodes: Int?
    let releaseDate: String?
    let firstAirDate: String?
    let tagline: String?
    let status: String?
    let genres: [NamedRef]?
    let primaryBackdropUrl: String?
    let seasons: [SeasonSummary]?
}

struct NamedRef: Decodable, Hashable, Sendable {
    let id: Int
    let name: String
}

struct SeasonSummary: Decodable, Hashable, Sendable {
    let seasonNumber: Int
    let name: String
    let episodeCount: Int
}

// MARK: - Library episodes (TV)

struct EpisodesResponse: Decodable, Sendable {
    let seasons: [SeasonEpisodes]
}

struct SeasonEpisodes: Decodable, Sendable, Identifiable {
    let season: Int
    let episodes: [Episode]
    var id: Int { season }
}

struct Episode: Decodable, Identifiable, Sendable {
    let id: Int
    let season: Int
    let episode: Int
    let title: String?
    let airDate: String?
    let status: String
    let monitored: Bool
    let downloadedAt: String?
}

// MARK: - Library media (movies / shows)

struct LibraryMedia: Decodable, Identifiable, Sendable {
    let id: Int
    let tmdbId: Int
    let type: String          // "movie" | "show"
    let title: String
    let year: Int?
    let status: String        // wanted / downloading / downloaded / missing …
    let monitored: Bool
    let posterUrl: String?
    let overview: String?
    let qualityProfileId: Int?
    let totalSizeBytes: String?   // bigint serialized as string
    let episodeCount: Int?
    let downloadedEpisodeCount: Int?
    let seasonCount: Int?
    let durationSecs: Double?
}

struct LibraryListResponse: Decodable, Sendable {
    let items: [LibraryMedia]
    let movieCount: Int?
    let showCount: Int?
    let hasMore: Bool?
}

// MARK: - Requests

struct MediaRequest: Decodable, Identifiable, Sendable {
    let id: Int
    let tmdbId: Int
    let type: String          // "movie" | "show"
    let title: String
    let posterUrl: String?
    let year: Int?
    let status: String        // pending | approved | denied
    let requestedBy: RequestedBy?
    let denyReason: String?
    let createdAt: String
}

struct RequestedBy: Decodable, Sendable {
    let id: String
    let name: String?
}

struct RequestsResponse: Decodable, Sendable {
    let requests: [MediaRequest]
}

struct CreateRequestBody: Encodable, Sendable {
    let tmdbId: Int
    let type: String          // "movie" | "show" (NOT "tv")
    let title: String
    let posterUrl: String?
    let year: Int?
}

// MARK: - Interactive release search + grab

struct InteractiveSearchResponse: Decodable, Sendable {
    let success: Bool
    let service: String?
    let releases: [ReleaseItem]
}

struct ReleaseItem: Decodable, Identifiable, Sendable {
    let guid: String
    let title: String
    let indexer: String?
    let protocolType: String?
    let sizeBytes: Int?
    let age: Int?
    let seeders: Int?
    let leechers: Int?
    let rejected: Bool?
    let downloadToken: String?
    let downloadUrl: String?
    let isSeasonPack: Bool?
    let freeleech: Bool?

    var id: String { guid }

    // `.convertFromSnakeCase` maps most keys; only `protocol` (a Swift keyword)
    // needs an explicit key. Raw values are the POST-conversion camelCase forms.
    enum CodingKeys: String, CodingKey {
        case guid, title, indexer, age, seeders, leechers, rejected, freeleech
        case protocolType = "protocol"
        case sizeBytes, downloadToken, downloadUrl, isSeasonPack
    }
}

struct GrabTokenBody: Encodable, Sendable {
    let token: String
}

struct GrabUrlBody: Encodable, Sendable {
    let downloadUrl: String
    let releaseTitle: String
    let episodeId: Int?
}

// MARK: - Downloads / activity / calendar

struct DownloadsResponse: Decodable, Sendable {
    let items: [DownloadHistoryItem]
}

struct DownloadHistoryItem: Decodable, Identifiable, Sendable {
    let id: Int
    let releaseTitle: String
    let indexer: String?
    let grabbedAt: String
    let completedAt: String?
    let failed: Bool
    let episodeId: Int?
    let live: LiveDownload?
}

struct LiveDownload: Decodable, Sendable {
    let progress: Double          // 0...1
    let downloadSpeed: Double     // bytes/s
    let etaSeconds: Int?
    let state: String
}

struct SpeedResponse: Decodable, Sendable {
    let enabled: Bool
    let connected: Bool
    let dlSpeed: Double
    let ulSpeed: Double
}

struct ActivityFeedResponse: Decodable, Sendable {
    let activities: [ActivityRecord]
    let hasMore: Bool?
}

struct ActivityRecord: Decodable, Sendable {
    let type: String?
    let service: String?
    let completedAt: String?
    let releaseTitle: String?
    let message: String?
    let success: Bool?
}

struct UpcomingResponse: Decodable, Sendable {
    let enabled: Bool
    let items: [UpcomingItem]
}

struct UpcomingItem: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let mediaType: String
    let releaseDate: String?
    let posterUrl: String?
    let overview: String?
    let seasonNumber: Int?
    let episodeNumber: Int?
}
