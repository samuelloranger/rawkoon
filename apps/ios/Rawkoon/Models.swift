import Foundation

// MARK: - Discover / TMDB

//
// JSON is snake_case; the media decoder uses `.convertFromSnakeCase`, so Swift
// camelCase properties map automatically. Dates stay as ISO strings and are
// formatted in the view layer. Codable ignores JSON keys not listed here, so
// each struct declares only the fields the app actually uses.

nonisolated struct TmdbSearchItem: Decodable, Identifiable, Hashable, Sendable {
    let id: String // "${media_type}-${tmdb_id}"
    let tmdbId: Int
    let mediaType: String // "movie" | "tv"
    let title: String
    let releaseYear: Int?
    let posterUrl: String?
    let overview: String?
    let voteAverage: Double?
    let alreadyExists: Bool?
    let canAdd: Bool?
    let libraryId: Int?
}

nonisolated struct ExploreFeed: Decodable, Sendable {
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

nonisolated struct TmdbSearchResponse: Decodable, Sendable {
    let enabled: Bool?
    let items: [TmdbSearchItem]
}

nonisolated struct BookSearchHit: Decodable, Identifiable, Hashable, Sendable {
    var id: String {
        googleVolumeId
    }

    let googleVolumeId: String
    let title: String
    let subtitle: String?
    let authors: [String]
    let publishedYear: Int?
    let coverUrl: String?
    let overview: String?
    let inLibrary: Bool
    let libraryBookId: Int?
}

nonisolated struct BookSearchResponse: Decodable, Sendable {
    let results: [BookSearchHit]
}

// MARK: - Media detail (TMDB modal)

nonisolated struct MediaModalResponse: Decodable, Sendable {
    let watchlistStatus: Bool?
    let watchlistId: Int?
    let details: TmdbMediaDetails
}

nonisolated struct TmdbMediaDetails: Decodable, Sendable {
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

nonisolated struct NamedRef: Decodable, Hashable, Sendable {
    let id: Int
    let name: String
}

nonisolated struct SeasonSummary: Decodable, Hashable, Sendable {
    let seasonNumber: Int
    let name: String
    let episodeCount: Int
}

// MARK: - Library episodes (TV)

nonisolated struct EpisodesResponse: Decodable, Sendable {
    let seasons: [SeasonEpisodes]
}

nonisolated struct SeasonEpisodes: Decodable, Sendable, Identifiable {
    let season: Int
    let episodes: [Episode]
    var id: Int {
        season
    }
}

nonisolated struct Episode: Decodable, Identifiable, Sendable {
    let id: Int
    let season: Int
    let episode: Int
    let title: String?
    let airDate: String?
    let status: String
    let monitored: Bool
    let downloadedAt: String?
}

// MARK: - Library file metadata

nonisolated struct LibraryAudioTrack: Decodable, Identifiable, Sendable {
    let index: Int
    let language: String?
    let languageName: String?
    let title: String?
    let codec: String?
    let channels: Int?
    let channelLayout: String?
    let bitrateKbps: Int?
    let isDefault: Bool
    let forced: Bool

    var id: Int {
        index
    }

    enum CodingKeys: String, CodingKey {
        case index, language, languageName, title, codec, channels, channelLayout, bitrateKbps, forced
        case isDefault = "default"
    }
}

nonisolated struct LibrarySubtitleTrack: Decodable, Identifiable, Sendable {
    let index: Int
    let language: String?
    let languageName: String?
    let title: String?
    let format: String?
    let forced: Bool
    let hearingImpaired: Bool

    var id: Int {
        index
    }
}

nonisolated struct LibraryFileInfo: Decodable, Identifiable, Sendable {
    let id: Int
    let fileName: String
    let filePath: String
    let sizeBytes: String
    let durationSecs: Double?
    let releaseGroup: String?
    let videoCodec: String?
    let videoProfile: String?
    let width: Int?
    let height: Int?
    let frameRate: Double?
    let bitDepth: Int?
    let videoBitrate: Int?
    let hdrFormat: String?
    let resolution: Int?
    let source: String?
    let audioTracks: [LibraryAudioTrack]
    let subtitleTracks: [LibrarySubtitleTrack]
    let scannedAt: String
    let season: Int?
    let episode: Int?
    let episodeTitle: String?

    enum CodingKeys: String, CodingKey {
        case id, fileName, filePath, sizeBytes, durationSecs, releaseGroup, videoCodec, videoProfile, width, height
        case frameRate, bitDepth, videoBitrate, hdrFormat, resolution, source
        case audioTracks, subtitleTracks, scannedAt, season, episode, episodeTitle
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        fileName = try c.decode(String.self, forKey: .fileName)
        filePath = try c.decode(String.self, forKey: .filePath)
        sizeBytes = try c.decode(String.self, forKey: .sizeBytes)
        durationSecs = try c.decodeIfPresent(Double.self, forKey: .durationSecs)
        releaseGroup = try c.decodeIfPresent(String.self, forKey: .releaseGroup)
        videoCodec = try c.decodeIfPresent(String.self, forKey: .videoCodec)
        videoProfile = try c.decodeIfPresent(String.self, forKey: .videoProfile)
        width = try c.decodeIfPresent(Int.self, forKey: .width)
        height = try c.decodeIfPresent(Int.self, forKey: .height)
        frameRate = try c.decodeIfPresent(Double.self, forKey: .frameRate)
        bitDepth = try c.decodeIfPresent(Int.self, forKey: .bitDepth)
        videoBitrate = try c.decodeIfPresent(Int.self, forKey: .videoBitrate)
        hdrFormat = try c.decodeIfPresent(String.self, forKey: .hdrFormat)
        resolution = try c.decodeIfPresent(Int.self, forKey: .resolution)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        audioTracks = (try? c.decode([LibraryAudioTrack].self, forKey: .audioTracks)) ?? []
        subtitleTracks = (try? c.decode([LibrarySubtitleTrack].self, forKey: .subtitleTracks)) ?? []
        scannedAt = try c.decode(String.self, forKey: .scannedAt)
        season = try c.decodeIfPresent(Int.self, forKey: .season)
        episode = try c.decodeIfPresent(Int.self, forKey: .episode)
        episodeTitle = try c.decodeIfPresent(String.self, forKey: .episodeTitle)
    }
}

nonisolated struct LibraryFilesResponse: Decodable, Sendable {
    let mediaType: String
    let files: [LibraryFileInfo]
}

// MARK: - Library media (movies / shows)

nonisolated struct LibraryMedia: Decodable, Identifiable, Sendable {
    let id: Int
    let tmdbId: Int
    let type: String // "movie" | "show"
    let title: String
    let year: Int?
    let status: String // wanted / downloading / downloaded / missing …
    let monitored: Bool
    let posterUrl: String?
    let overview: String?
    let qualityProfileId: Int?
    let totalSizeBytes: String? // bigint serialized as string
    let episodeCount: Int?
    let downloadedEpisodeCount: Int?
    let seasonCount: Int?
    let durationSecs: Double?
}

nonisolated struct LibraryListResponse: Decodable, Sendable {
    let items: [LibraryMedia]
    let movieCount: Int?
    let showCount: Int?
    let hasMore: Bool?
}

// MARK: - Requests

nonisolated struct MediaRequest: Decodable, Identifiable, Sendable {
    let id: Int
    let tmdbId: Int
    let type: String // "movie" | "show"
    let title: String
    let posterUrl: String?
    let year: Int?
    let status: String // pending | approved | denied
    let requestedBy: RequestedBy?
    let denyReason: String?
    let createdAt: String
}

nonisolated struct RequestedBy: Decodable, Sendable {
    let id: String
    let name: String?
}

nonisolated struct RequestsResponse: Decodable, Sendable {
    let requests: [MediaRequest]
}

nonisolated struct CreateRequestBody: Encodable, Sendable {
    let tmdbId: Int
    let type: String // "movie" | "show" (NOT "tv")
    let title: String
    let posterUrl: String?
    let year: Int?
}

// MARK: - Interactive release search + grab

nonisolated struct InteractiveSearchResponse: Decodable, Sendable {
    let success: Bool
    let service: String?
    let releases: [ReleaseItem]
    let indexerWarnings: [IndexerWarning]?
}

nonisolated struct IndexerWarning: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let error: String
}

nonisolated struct ReleaseItem: Decodable, Identifiable, Sendable {
    let guid: String
    let title: String
    let indexer: String?
    let indexerId: Int?
    let languages: [String]
    let protocolType: String?
    let sizeBytes: Int?
    let age: Int?
    let seeders: Int?
    let leechers: Int?
    let rejected: Bool?
    let rejectionReason: String?
    let infoURL: String?
    let downloadToken: String?
    let downloadUrl: String?
    let isSeasonPack: Bool?
    let isCompleteSeries: Bool?
    let freeleech: Bool?
    let qualityScore: Double?

    var id: String {
        guid
    }

    /// `.convertFromSnakeCase` maps most keys; only `protocol` (a Swift keyword)
    /// needs an explicit key. Raw values are the POST-conversion camelCase forms.
    enum CodingKeys: String, CodingKey {
        case guid, title, indexer, indexerId, languages, age, seeders, leechers, rejected, rejectionReason, freeleech, qualityScore
        case protocolType = "protocol"
        case sizeBytes, infoURL = "infoUrl", downloadToken, downloadUrl, isSeasonPack, isCompleteSeries
    }
}

nonisolated struct GrabTokenBody: Encodable, Sendable {
    let token: String
}

nonisolated struct GrabUrlBody: Encodable, Sendable {
    let downloadUrl: String
    let releaseTitle: String
    let episodeId: Int?
}

// MARK: - Downloads / activity / calendar

nonisolated struct DownloadsResponse: Decodable, Sendable {
    let items: [DownloadHistoryItem]
}

nonisolated struct DownloadHistoryItem: Decodable, Identifiable, Sendable {
    let id: Int
    let releaseTitle: String
    let indexer: String?
    let grabbedAt: String
    let completedAt: String?
    let failed: Bool
    let episodeId: Int?
    let failReason: String?
    let postProcessError: String?
    let live: LiveDownload?
    let aiPicked: Bool?
}

nonisolated struct LiveDownload: Decodable, Sendable {
    let progress: Double // 0...1
    let downloadSpeed: Double // bytes/s
    let etaSeconds: Int?
    let state: String
}

nonisolated struct SpeedResponse: Decodable, Sendable {
    let enabled: Bool
    let connected: Bool
    let dlSpeed: Double
    let ulSpeed: Double
}

nonisolated struct ActivityFeedResponse: Decodable, Sendable {
    let activities: [ActivityRecord]
    let hasMore: Bool?
}

nonisolated struct ActivityRecord: Decodable, Sendable {
    let type: String?
    let service: String?
    let completedAt: String?
    let releaseTitle: String?
    let message: String?
    let success: Bool?
}

nonisolated struct UpcomingResponse: Decodable, Sendable {
    let enabled: Bool
    let items: [UpcomingItem]
}

nonisolated struct UpcomingItem: Decodable, Identifiable, Sendable {
    let id: String // "${media_type}-${tmdb_id}…"
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

nonisolated struct QualityProfile: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String
    let minResolution: Int?
    let cutoffResolution: Int?
    let maxSizeGb: Double?
    let minSeeders: Int?
    let requireHdr: Bool?
    let preferHdr: Bool?
}

nonisolated struct QualityProfilesResponse: Decodable, Sendable {
    let profiles: [QualityProfile]
}

nonisolated struct Indexer: Decodable, Identifiable, Sendable {
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

nonisolated struct IndexersResponse: Decodable, Sendable {
    let indexers: [Indexer]
}

nonisolated struct DownloadClientIntegration: Decodable, Sendable {
    let enabled: Bool
    let clientType: String?
    let websiteUrl: String?
    let username: String?
    let passwordSet: Bool?
    let label: String?
    let savePath: String?
}

nonisolated struct DownloadClientResponse: Decodable, Sendable {
    let integration: DownloadClientIntegration
}

nonisolated struct AdminUser: Decodable, Identifiable, Sendable {
    let id: String
    let email: String
    let firstName: String?
    let lastName: String?
    let isAdmin: Bool
    let locale: String?
    let createdAt: String?
    let lastLogin: String?
}

nonisolated struct AdminUsersResponse: Decodable, Sendable {
    let success: Bool?
    let users: [AdminUser]
}

nonisolated struct SystemVersion: Decodable, Sendable {
    let version: String
}

nonisolated struct SessionUser: Decodable, Sendable {
    let email: String?
    let name: String?
    let firstName: String?
    let lastName: String?
    let isAdmin: Bool?
    let notificationPreferences: [String: Bool]?
}

nonisolated struct SessionResponse: Decodable, Sendable {
    let user: SessionUser?
}

nonisolated struct ApproveRequestBody: Encodable, Sendable {
    let qualityProfileId: Int
}

nonisolated struct DenyRequestBody: Encodable, Sendable {
    let denyReason: String?
}

nonisolated struct NotificationPrefsBody: Encodable, Sendable {
    let notificationPreferences: [String: Bool]
}

// MARK: - Books detail / editions / files

nonisolated struct BookDetailResponse: Decodable, Sendable {
    let item: BookDetailItem
}

nonisolated struct BookDetailItem: Decodable, Identifiable, Sendable {
    let id: Int
    let title: String
    let subtitle: String?
    let overview: String?
    let coverUrl: String?
    let authors: [String]
    let language: String
    let publishedYear: Int?
    let publishedDate: String?
    let seriesName: String?
    let seriesPosition: Int?
    let narrators: [String]
    let genres: [String]
    let publisher: String?
    let pageCount: Int?
    let rating: Double?
    let ratingCount: Int?
    let isbn13: String?
    let editions: [BookEditionDetail]
}

nonisolated struct BookEditionDetail: Decodable, Identifiable, Sendable {
    let id: Int
    let kind: String
    let status: String
    let monitored: Bool
    let durationSecs: Double?
    let totalSizeBytes: String?
    let fileCount: Int
    let bestFormat: String?
    let narrators: [String]
}

nonisolated struct BookEditionFilesPayload: Decodable, Sendable {
    let editionId: Int
    let kind: String
    let files: [BookEditionFile]
}

nonisolated struct BookEditionFile: Decodable, Identifiable, Sendable {
    let id: Int
    let fileName: String
    let filePath: String
    let contentUrl: String?
    let sizeBytes: String
    let format: String
    let durationSecs: Double?
    let audioBitrate: Int?
    let audioCodec: String?
    let isRetail: Bool
    let releaseGroup: String?
    let languageTags: [String]
    let scannedAt: String
}

// MARK: - Book editions: add + release search + grab

nonisolated struct BookRelease: Decodable, Identifiable, Sendable {
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
    var id: String {
        guid
    }
}

nonisolated struct BookReleasesResponse: Decodable, Sendable {
    let releases: [BookRelease]
}

nonisolated struct CreateBookEditionBody: Encodable, Sendable {
    let kind: String // "audiobook" | "ebook"
    let monitored: Bool
}

nonisolated struct BookGrabBody: Encodable, Sendable {
    let releaseTitle: String
    let downloadUrl: String?
    let magnetUrl: String?
    let indexer: String?
}

// MARK: - Home / dashboard widgets

nonisolated struct NowPlayingResponse: Decodable, Sendable {
    let enabled: Bool
    let sessions: [NowPlayingSession]?
}

nonisolated struct NowPlayingSession: Decodable, Identifiable, Sendable {
    let sessionId: String
    let user: String?
    let device: String?
    let title: String?
    let posterUrl: String?
    let progressPct: Double?
    let paused: Bool?
    var id: String {
        sessionId
    }
}

nonisolated struct LibraryAttentionResponse: Decodable, Sendable {
    let items: [AttentionItem]
}

nonisolated struct AttentionItem: Decodable, Identifiable, Sendable {
    let id: Int
    let kind: String?
    let mediaId: Int?
    let mediaTitle: String?
    let mediaType: String?
    let detail: String?
}

nonisolated struct RssStatusResponse: Decodable, Sendable {
    let lastRun: RssRun?
    let nextRunAt: String?
}

nonisolated struct RssRun: Decodable, Sendable {
    let status: String?
    let completedAt: String?
    let releasesFound: Int?
    let releasesGrabbed: Int?
    let releasesGrabbedByAi: Int?
    let error: String?
}

// MARK: - APNs device registration

nonisolated struct ApnsDeviceInfo: Encodable, Sendable {
    let deviceName: String?
    let osVersion: String?
    let appVersion: String?
    let bundleId: String?
}

nonisolated struct ApnsRegisterBody: Encodable, Sendable {
    let deviceToken: String
    let deviceInfo: ApnsDeviceInfo
}

// MARK: - SSO / OAuth providers

nonisolated struct SsoProvider: Decodable, Identifiable, Sendable {
    let slug: String
    let name: String
    let iconUrl: String?
    var id: String {
        slug
    }
}

nonisolated struct SsoProvidersResponse: Decodable, Sendable {
    let providers: [SsoProvider]
}
