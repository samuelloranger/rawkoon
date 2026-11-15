import Foundation

// Notification channel, post-processing, migration, and book settings DTOs.

// MARK: Notification channels (per-user CRUD — spec §5 Phase 4)

/// A scalar JSON value for heterogeneous channel config.
nonisolated enum JSONValue: Codable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let d = try? c.decode(Double.self) {
            self = .number(d)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case let .string(s): try c.encode(s)
        case let .number(n): try c.encode(n)
        case let .bool(b): try c.encode(b)
        case .null: try c.encodeNil()
        }
    }

    var stringValue: String {
        switch self {
        case let .string(s): s
        case let .number(n): n == n.rounded() ? String(Int(n)) : String(n)
        case let .bool(b): b ? "true" : "false"
        case .null: ""
        }
    }
}

nonisolated struct NotificationChannelDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let type: String
    let label: String?
    let enabled: Bool
    let config: [String: JSONValue]?
}

nonisolated struct NotificationChannelsResponse: Decodable, Sendable {
    let channels: [NotificationChannelDTO]
}

nonisolated struct CreateChannelBody: Encodable, Sendable {
    let type: String
    let label: String
    let config: [String: JSONValue]
}

nonisolated struct UpdateChannelBody: Encodable, Sendable {
    let label: String?
    let enabled: Bool?
    let config: [String: JSONValue]?
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
    let defaultSeasonMode: String?
    let defaultMonitorNewSeasons: Bool?
    let searchOnAdd: Bool?
    let activeIndexerManager: String?
    let booksLibraryPath: String?
    let audiobooksLibraryPath: String?
    let bookTemplate: String?
    let audiobookTemplate: String?
    let defaultBookQualityProfileId: Int?
    let seedSweepEnabled: Bool?
    let privateSeedRatio: Double?
    let publicSeedTimeMins: Int?
    let privateSeedTimeMins: Int?
    let blockedExtensions: [String]?
    let minFreeSpaceGb: Int?
}

nonisolated struct PostProcessingSettingsResponseDTO: Decodable, Sendable {
    let settings: PostProcessingSettingsDTO
}

/// Media subset of the shared post-processing row. Custom `encode(to:)` emits
/// explicit JSON null for cleared paths (a synthesized encoder would omit
/// nil and keep the old value). Sends only the Folders & import keys; the seed
/// rules, the active indexer manager and the default profiles belong to other screens.
nonisolated struct UpdateMediaSettingsBody: Encodable, Sendable {
    var postProcessingEnabled: Bool
    var moviesLibraryPath: String?
    var showsLibraryPath: String?
    var downloadsPath: String?
    var fileOperation: String
    var movieTemplate: String
    var episodeTemplate: String
    var activeIndexerManager: String?
    var defaultMovieQualityProfileId: Int?
    var defaultShowQualityProfileId: Int?
    /// Omitted when nil so an older server keeps its value.
    var minFreeSpaceGb: Int?

    enum CodingKeys: String, CodingKey {
        case postProcessingEnabled, moviesLibraryPath, showsLibraryPath, downloadsPath
        case fileOperation, movieTemplate, episodeTemplate
        case activeIndexerManager, defaultMovieQualityProfileId, defaultShowQualityProfileId
        case minFreeSpaceGb
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
        // The manager, the default profiles and the free-space floor are owned by other screens
        // (Indexers, Defaults, After download), so this one leaves them alone.
        try c.encodeIfPresent(activeIndexerManager, forKey: .activeIndexerManager)
        try c.encodeIfPresent(defaultMovieQualityProfileId, forKey: .defaultMovieQualityProfileId)
        try c.encodeIfPresent(defaultShowQualityProfileId, forKey: .defaultShowQualityProfileId)
        try c.encodeIfPresent(minFreeSpaceGb, forKey: .minFreeSpaceGb)
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
    let kind: String?
    let allowedFormats: [String]?
    let cutoffFormat: String?
    let preferRetail: Bool?
    let maxSizeMb: Int?
    let minSeeders: Int?
    let minAudioBitrate: Int?
    let preferredLanguages: [String]?
    let prioritizedTrackers: [String]?
    let preferTrackerOverQuality: Bool?
}

nonisolated struct BookQualityProfilesResponse: Decodable, Sendable {
    let profiles: [BookQualityProfile]
}

/// Create/update body for a book quality profile. Custom `encode(to:)` sends
/// explicit null for the nullable fields (cutoff, max size, min bitrate).
nonisolated struct SaveBookQualityProfileBody: Encodable, Sendable {
    var name: String
    var kind: String
    var allowedFormats: [String]
    var cutoffFormat: String?
    var preferRetail: Bool
    var maxSizeMb: Int?
    var minSeeders: Int
    var minAudioBitrate: Int?
    var preferredLanguages: [String]
    var prioritizedTrackers: [String]
    var preferTrackerOverQuality: Bool

    enum CodingKeys: String, CodingKey {
        case name, kind, allowedFormats, cutoffFormat, preferRetail, maxSizeMb
        case minSeeders, minAudioBitrate, preferredLanguages, prioritizedTrackers, preferTrackerOverQuality
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(kind, forKey: .kind)
        try c.encode(allowedFormats, forKey: .allowedFormats)
        try c.encode(cutoffFormat, forKey: .cutoffFormat)
        try c.encode(preferRetail, forKey: .preferRetail)
        try c.encode(maxSizeMb, forKey: .maxSizeMb)
        try c.encode(minSeeders, forKey: .minSeeders)
        try c.encode(minAudioBitrate, forKey: .minAudioBitrate)
        try c.encode(preferredLanguages, forKey: .preferredLanguages)
        try c.encode(prioritizedTrackers, forKey: .prioritizedTrackers)
        try c.encode(preferTrackerOverQuality, forKey: .preferTrackerOverQuality)
    }
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

    enum CodingKeys: String, CodingKey {
        case booksLibraryPath, audiobooksLibraryPath, bookTemplate, audiobookTemplate
        case defaultBookQualityProfileId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(booksLibraryPath, forKey: .booksLibraryPath)
        try c.encode(audiobooksLibraryPath, forKey: .audiobooksLibraryPath)
        try c.encode(bookTemplate, forKey: .bookTemplate)
        try c.encode(audiobookTemplate, forKey: .audiobookTemplate)
        // The default profile lives on the Defaults screen, which sends it.
        try c.encodeIfPresent(defaultBookQualityProfileId, forKey: .defaultBookQualityProfileId)
    }
}

/// The three default quality profiles (movie, show, book). Explicit JSON null so "None" persists.
nonisolated struct UpdateDefaultProfilesBody: Encodable, Sendable {
    var defaultMovieQualityProfileId: Int?
    var defaultShowQualityProfileId: Int?
    var defaultBookQualityProfileId: Int?

    enum CodingKeys: String, CodingKey {
        case defaultMovieQualityProfileId, defaultShowQualityProfileId, defaultBookQualityProfileId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(defaultMovieQualityProfileId, forKey: .defaultMovieQualityProfileId)
        try c.encode(defaultShowQualityProfileId, forKey: .defaultShowQualityProfileId)
        try c.encode(defaultBookQualityProfileId, forKey: .defaultBookQualityProfileId)
    }
}

nonisolated struct ApproveRequestBody: Encodable, Sendable {
    let qualityProfileId: Int
    /// Show requests only; all nil keeps what the requester chose.
    var seasonMode: String?
    var seasons: [Int]?
    var monitorNewSeasons: Bool?
}

nonisolated struct DenyRequestBody: Encodable, Sendable {
    let denyReason: String?
}

nonisolated struct NotificationPrefsBody: Encodable, Sendable {
    let notificationPreferences: [String: Bool]
}
