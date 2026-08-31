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
    let id: String            // "${media_type}-${tmdb_id}…"
    let title: String
    let mediaType: String
    let releaseDate: String?
    let posterUrl: String?
    let overview: String?
    let seasonNumber: Int?
    let episodeNumber: Int?
    let libraryId: Int?

    /// TMDB id parsed from the composite `id` (first run of digits).
    var tmdbId: Int? {
        let digits = id.drop { !$0.isNumber }.prefix { $0.isNumber }
        return Int(digits)
    }
}

// MARK: - Management (settings hub)

struct QualityProfile: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String
    let minResolution: Int?
    let cutoffResolution: Int?
    let maxSizeGb: Double?
    let minSeeders: Int?
    let requireHdr: Bool?
    let preferHdr: Bool?
}

struct QualityProfilesResponse: Decodable, Sendable {
    let profiles: [QualityProfile]
}

struct Indexer: Decodable, Identifiable, Sendable {
    let id: Int
    let slug: String
    let name: String
    let protocolType: String?
    let enabled: Bool
    let privacy: String?

    enum CodingKeys: String, CodingKey {
        case id, slug, name, enabled, privacy
        case protocolType = "protocol"
    }
}

struct IndexersResponse: Decodable, Sendable {
    let indexers: [Indexer]
}

struct DownloadClientIntegration: Decodable, Sendable {
    let enabled: Bool
    let clientType: String?
    let websiteUrl: String?
    let username: String?
    let passwordSet: Bool?
    let label: String?
    let savePath: String?
}

struct DownloadClientResponse: Decodable, Sendable {
    let integration: DownloadClientIntegration
}

struct AdminUser: Decodable, Identifiable, Sendable {
    let id: String
    let email: String
    let firstName: String?
    let lastName: String?
    let isAdmin: Bool
    let locale: String?
    let createdAt: String?
    let lastLogin: String?
}

struct AdminUsersResponse: Decodable, Sendable {
    let success: Bool?
    let users: [AdminUser]
}

struct SystemVersion: Decodable, Sendable {
    let version: String
}

struct SessionUser: Decodable, Sendable {
    let email: String?
    let name: String?
    let firstName: String?
    let lastName: String?
    let isAdmin: Bool?
}

struct SessionResponse: Decodable, Sendable {
    let user: SessionUser?
}

struct ApproveRequestBody: Encodable, Sendable {
    let qualityProfileId: Int
}

struct DenyRequestBody: Encodable, Sendable {
    let denyReason: String?
}

struct NotificationPrefsBody: Encodable, Sendable {
    let notificationPreferences: [String: Bool]
}

// MARK: - Book editions: add + release search + grab (audiobook onto an ebook)

struct BookRelease: Decodable, Identifiable, Sendable {
    let guid: String
    let title: String
    let indexer: String?
    let sizeBytes: Int?
    let seeders: Int?
    let age: Int?
    let downloadUrl: String?
    let magnetUrl: String?
    let format: String?
    let audioBitrate: Int?
    let language: String?
    let isRetail: Bool?
    let score: Double?
    let rejected: Bool?
    let rejections: [String]?
    var id: String { guid }
}

struct BookReleasesResponse: Decodable, Sendable {
    let releases: [BookRelease]
}

struct CreateBookEditionBody: Encodable, Sendable {
    let kind: String            // "audiobook" | "ebook"
    let monitored: Bool
}

struct BookGrabBody: Encodable, Sendable {
    let releaseTitle: String
    let downloadUrl: String?
    let magnetUrl: String?
    let indexer: String?
}

// MARK: - Home / dashboard widgets

struct NowPlayingResponse: Decodable, Sendable {
    let enabled: Bool
    let sessions: [NowPlayingSession]?
}

struct NowPlayingSession: Decodable, Identifiable, Sendable {
    let sessionId: String
    let user: String?
    let device: String?
    let title: String?
    let posterUrl: String?
    let progressPct: Double?
    let paused: Bool?
    var id: String { sessionId }
}

struct LibraryAttentionResponse: Decodable, Sendable {
    let items: [AttentionItem]
}

struct AttentionItem: Decodable, Identifiable, Sendable {
    let id: Int
    let kind: String?
    let mediaId: Int?
    let mediaTitle: String?
    let mediaType: String?
    let detail: String?
}

struct RssStatusResponse: Decodable, Sendable {
    let lastRun: RssRun?
    let nextRunAt: String?
}

struct RssRun: Decodable, Sendable {
    let status: String?
    let completedAt: String?
    let releasesFound: Int?
    let releasesGrabbed: Int?
    let releasesGrabbedByAi: Int?
    let error: String?
}

// MARK: - APNs device registration

struct ApnsDeviceInfo: Encodable, Sendable {
    let deviceName: String?
    let osVersion: String?
    let appVersion: String?
    let bundleId: String?
}

struct ApnsRegisterBody: Encodable, Sendable {
    let deviceToken: String
    let deviceInfo: ApnsDeviceInfo
}

// MARK: - SSO / OAuth providers

struct SsoProvider: Decodable, Identifiable, Sendable {
    let slug: String
    let name: String
    let iconUrl: String?
    var id: String { slug }
}

struct SsoProvidersResponse: Decodable, Sendable {
    let providers: [SsoProvider]
}
