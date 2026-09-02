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

// MARK: Notification devices (roster — spec §5 Phase 1)

nonisolated struct ApnsDeviceDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let deviceName: String?
    let osVersion: String?
    let appVersion: String?
    let createdAt: String?
}

nonisolated struct ApnsDevicesResponse: Decodable, Sendable {
    let devices: [ApnsDeviceDTO]
}

nonisolated struct WebPushDeviceDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let endpoint: String?
    let deviceName: String?
    let osName: String?
    let osVersion: String?
    let browserName: String?
    let browserVersion: String?
    let platform: String?
    let createdAt: String?
}

nonisolated struct WebPushDevicesResponse: Decodable, Sendable {
    let devices: [WebPushDeviceDTO]
}

// MARK: General app settings (spec §5 Phase 2)

nonisolated struct AppSettingsDTO: Decodable, Sendable {
    let countryCode: String
    let upcomingWindowMonths: Int
    let upcomingLanguages: String
    let booksEnabled: Bool?
}

nonisolated struct AppSettingsResponseDTO: Decodable, Sendable {
    let settings: AppSettingsDTO
}

nonisolated struct UpdateGeneralSettingsBody: Encodable, Sendable {
    let countryCode: String?
    let upcomingWindowMonths: Int?
    let upcomingLanguages: String?
}

// MARK: Simple integrations (spec §5 Phase 2)
// The server returns api_key as "" (never the real secret) and treats an empty
// api_key on save as "keep the existing one" — so we always send it as a string.

nonisolated struct TmdbIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let popularityThreshold: Int?
}
nonisolated struct TmdbIntegrationResponse: Decodable, Sendable { let integration: TmdbIntegrationDTO }
nonisolated struct SaveTmdbBody: Encodable, Sendable {
    let enabled: Bool
    let apiKey: String
    let popularityThreshold: Int
}

nonisolated struct JellyfinIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let websiteUrl: String?
}
nonisolated struct JellyfinIntegrationResponse: Decodable, Sendable { let integration: JellyfinIntegrationDTO }
nonisolated struct SaveJellyfinBody: Encodable, Sendable {
    let enabled: Bool
    let websiteUrl: String
    let apiKey: String
}

nonisolated struct LocalAiIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let baseUrl: String?
    let model: String?
}
nonisolated struct LocalAiIntegrationResponse: Decodable, Sendable { let integration: LocalAiIntegrationDTO }
nonisolated struct SaveLocalAiBody: Encodable, Sendable {
    let enabled: Bool
    let baseUrl: String
    let model: String
}
nonisolated struct LocalAiTestResponse: Decodable, Sendable {
    let error: String?
    let models: [String]?
    let modelAvailable: Bool?
}

// MARK: Indexer managers — Prowlarr / Jackett (spec §5 Phase 2)

nonisolated struct IndexerManagerDTO: Decodable, Sendable {
    let enabled: Bool
    let websiteUrl: String?
    let rssIndexers: [String]?
}
nonisolated struct IndexerManagerResponse: Decodable, Sendable { let integration: IndexerManagerDTO }
nonisolated struct SaveIndexerManagerBody: Encodable, Sendable {
    let websiteUrl: String
    let apiKey: String
    let enabled: Bool
    let rssIndexers: [String]
}
nonisolated struct IndexerOptionDTO: Decodable, Sendable {
    let slug: String?
    let name: String?
}
nonisolated struct IndexerListResponse: Decodable, Sendable { let indexers: [IndexerOptionDTO] }

// MARK: Download client + hook (spec §5 Phase 2)

nonisolated struct DownloadClientConfigDTO: Decodable, Sendable {
    let enabled: Bool
    let clientType: String?
    let websiteUrl: String?
    let username: String?
    let passwordSet: Bool?
    let label: String?
    let savePath: String?
}
nonisolated struct DownloadClientEditResponse: Decodable, Sendable { let integration: DownloadClientConfigDTO }
nonisolated struct SaveDownloadClientBody: Encodable, Sendable {
    let clientType: String
    let websiteUrl: String
    let username: String
    let password: String
    let label: String
    let savePath: String
    let enabled: Bool
}
nonisolated struct DownloadClientTestResponse: Decodable, Sendable {
    let ok: Bool?
    let error: String?
}

/// Download-client hook speaks camelCase on the wire — decode/encode with the
/// plain-casing helpers (no snake conversion).
nonisolated struct HookConfigDTO: Decodable, Sendable {
    let status: String?
    let callbackUrl: String?
    let autoConfigure: Bool?
    let activeHookedSecs: Int?
}
nonisolated struct SaveHookBody: Encodable, Sendable {
    let callbackUrl: String?
    let autoConfigure: Bool?
    let activeHookedSecs: Int?
}

// MARK: Books providers — Audnexus / Google Books (spec §5 Phase 2)

nonisolated struct AudnexusIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let baseUrl: String?
    let region: String?
}
nonisolated struct AudnexusIntegrationResponse: Decodable, Sendable { let integration: AudnexusIntegrationDTO }
nonisolated struct SaveAudnexusBody: Encodable, Sendable {
    let enabled: Bool
    let baseUrl: String
    let region: String
}
nonisolated struct AudnexusTestBody: Encodable, Sendable {
    let baseUrl: String
    let region: String
}

nonisolated struct GoogleBooksIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let hasApiKey: Bool?
}
nonisolated struct GoogleBooksIntegrationResponse: Decodable, Sendable { let integration: GoogleBooksIntegrationDTO }
nonisolated struct SaveGoogleBooksBody: Encodable, Sendable {
    let apiKey: String?
    let enabled: Bool
}
nonisolated struct GoogleBooksTestBody: Encodable, Sendable {
    let apiKey: String?
}

nonisolated struct IntegrationTestResponse: Decodable, Sendable {
    let success: Bool?
    let error: String?
}

// MARK: Post-processing settings (media + books share this row — spec §5 Phase 3)

nonisolated struct PostProcessingSettingsDTO: Decodable, Sendable {
    let moviesLibraryPath: String?
    let showsLibraryPath: String?
    let downloadsPath: String?
    let fileOperation: String?
    let movieTemplate: String?
    let episodeTemplate: String?
    let minSeedRatio: Double?
    let postProcessingEnabled: Bool?
    let defaultMovieQualityProfileId: Int?
    let defaultShowQualityProfileId: Int?
    let activeIndexerManager: String?
    let booksLibraryPath: String?
    let audiobooksLibraryPath: String?
    let bookTemplate: String?
    let audiobookTemplate: String?
    let defaultBookQualityProfileId: Int?
    let audiobookshelfUrl: String?
    let audiobookshelfAudiobookLibraryId: String?
    let audiobookshelfEbookLibraryId: String?
}
nonisolated struct PostProcessingSettingsResponseDTO: Decodable, Sendable {
    let settings: PostProcessingSettingsDTO
}

/// Media subset of the shared post-processing row. Custom `encode(to:)` emits
/// explicit JSON null for cleared paths/ids (a synthesized encoder would omit
/// nil and keep the old value). Sends only media keys.
nonisolated struct UpdateMediaSettingsBody: Encodable, Sendable {
    var postProcessingEnabled: Bool
    var moviesLibraryPath: String?
    var showsLibraryPath: String?
    var downloadsPath: String?
    var fileOperation: String
    var movieTemplate: String
    var episodeTemplate: String
    var minSeedRatio: Double
    var activeIndexerManager: String?
    var defaultMovieQualityProfileId: Int?
    var defaultShowQualityProfileId: Int?

    enum CodingKeys: String, CodingKey {
        case postProcessingEnabled, moviesLibraryPath, showsLibraryPath, downloadsPath
        case fileOperation, movieTemplate, episodeTemplate, minSeedRatio
        case activeIndexerManager, defaultMovieQualityProfileId, defaultShowQualityProfileId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(postProcessingEnabled, forKey: .postProcessingEnabled)
        try c.encode(moviesLibraryPath, forKey: .moviesLibraryPath)
        try c.encode(showsLibraryPath, forKey: .showsLibraryPath)
        try c.encode(downloadsPath, forKey: .downloadsPath)
        try c.encode(fileOperation, forKey: .fileOperation)
        try c.encode(movieTemplate, forKey: .movieTemplate)
        try c.encode(episodeTemplate, forKey: .episodeTemplate)
        try c.encode(minSeedRatio, forKey: .minSeedRatio)
        try c.encode(activeIndexerManager, forKey: .activeIndexerManager)
        try c.encode(defaultMovieQualityProfileId, forKey: .defaultMovieQualityProfileId)
        try c.encode(defaultShowQualityProfileId, forKey: .defaultShowQualityProfileId)
    }
}

nonisolated struct ScanBody: Encodable, Sendable {
    let path: String
    let type: String?
}
nonisolated struct ScanResultDTO: Decodable, Sendable {
    let matched: Int
    let unmatched: [String]
}
nonisolated struct ReindexStartResponse: Decodable, Sendable {
    let jobId: String?
}
nonisolated struct ReindexProgressDTO: Decodable, Sendable {
    let current: Int?
    let total: Int?
    let updated: Int?
    let skipped: Int?
    let errors: Int?
    let currentFile: String?
}
nonisolated struct ReindexStatusDTO: Decodable, Sendable {
    let jobId: String?
    let state: String?
    let progress: ReindexProgressDTO?
    let error: String?
}

// MARK: Arr import (Radarr/Sonarr migration — spec §5 Phase 3)

nonisolated struct MigrateBody: Encodable, Sendable {
    let source: String
    let radarrUrl: String?
    let radarrApiKey: String?
    let sonarrUrl: String?
    let sonarrApiKey: String?
}
nonisolated struct MigrateStartResponse: Decodable, Sendable {
    let jobId: String?
}
nonisolated struct MigrateProgressDTO: Decodable, Sendable {
    let current: Int?
    let total: Int?
    let imported: Int?
    let failed: Int?
    let currentTitle: String?
}
nonisolated struct MigrateStatusDTO: Decodable, Sendable {
    let jobId: String?
    let state: String?
    let progress: MigrateProgressDTO?
    let error: String?
}

// MARK: Books settings (non-CRUD — spec §5 Phase 3)

nonisolated struct BookQualityProfile: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String
}
nonisolated struct BookQualityProfilesResponse: Decodable, Sendable {
    let profiles: [BookQualityProfile]
}

nonisolated struct BooksEnabledBody: Encodable, Sendable {
    let booksEnabled: Bool
}

nonisolated struct MetadataSourcesResponse: Decodable, Sendable {
    let order: [String]
}
nonisolated struct MetadataSourcesBody: Encodable, Sendable {
    let order: [String]
}

/// Book subset of the shared post-processing row. Explicit JSON null for cleared
/// strings/ids so blanks persist (spec §5 Phase 3, B5).
nonisolated struct UpdateBookFilesBody: Encodable, Sendable {
    var booksLibraryPath: String?
    var audiobooksLibraryPath: String?
    var bookTemplate: String
    var audiobookTemplate: String
    var defaultBookQualityProfileId: Int?
    var audiobookshelfUrl: String?
    var audiobookshelfAudiobookLibraryId: String?
    var audiobookshelfEbookLibraryId: String?

    enum CodingKeys: String, CodingKey {
        case booksLibraryPath, audiobooksLibraryPath, bookTemplate, audiobookTemplate
        case defaultBookQualityProfileId, audiobookshelfUrl
        case audiobookshelfAudiobookLibraryId, audiobookshelfEbookLibraryId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(booksLibraryPath, forKey: .booksLibraryPath)
        try c.encode(audiobooksLibraryPath, forKey: .audiobooksLibraryPath)
        try c.encode(bookTemplate, forKey: .bookTemplate)
        try c.encode(audiobookTemplate, forKey: .audiobookTemplate)
        try c.encode(defaultBookQualityProfileId, forKey: .defaultBookQualityProfileId)
        try c.encode(audiobookshelfUrl, forKey: .audiobookshelfUrl)
        try c.encode(audiobookshelfAudiobookLibraryId, forKey: .audiobookshelfAudiobookLibraryId)
        try c.encode(audiobookshelfEbookLibraryId, forKey: .audiobookshelfEbookLibraryId)
    }
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
