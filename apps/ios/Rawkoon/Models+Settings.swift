import Foundation

// Settings / management-hub DTOs (profiles, integrations, channels, post-processing, arr import). Split out of Models.swift to stay under the file_length lint
// threshold (spec §4.2). Pure data types, no behaviour.

// MARK: - Management (settings hub)

nonisolated struct AssignedCustomFormat: Decodable, Sendable {
    let customFormatId: Int?
    let name: String?
    let score: Int?
    let required: Bool?
    let forbidden: Bool?
}

nonisolated struct QualityProfile: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String
    let minResolution: Int?
    let cutoffResolution: Int?
    let maxSizeGb: Double?
    let minSeeders: Int?
    let requireHdr: Bool?
    let preferHdr: Bool?
    let preferredSources: [String]?
    let preferredCodecs: [String]?
    let preferredLanguages: [String]?
    let preferredSearchLanguage: String?
    let prioritizedTrackers: [String]?
    let preferTrackerOverQuality: Bool?
    let customFormats: [AssignedCustomFormat]?
}

nonisolated struct QualityProfilesResponse: Decodable, Sendable {
    let profiles: [QualityProfile]
}

// MARK: Quality profile CRUD (spec §5 Phase 4)

nonisolated struct CustomFormatAssignmentBody: Encodable, Sendable {
    let customFormatId: Int
    let score: Int
    let required: Bool
    let forbidden: Bool
}

/// Create/update body for a quality profile. Custom `encode(to:)` sends explicit
/// null for the nullable fields (cutoff, search language, max size).
nonisolated struct SaveQualityProfileBody: Encodable, Sendable {
    var name: String
    var minResolution: Int
    var cutoffResolution: Int?
    var preferredSources: [String]
    var preferredCodecs: [String]
    var preferredLanguages: [String]
    var preferredSearchLanguage: String?
    var prioritizedTrackers: [String]
    var preferTrackerOverQuality: Bool
    var maxSizeGb: Double?
    var requireHdr: Bool
    var preferHdr: Bool
    var minSeeders: Int
    var customFormats: [CustomFormatAssignmentBody]

    enum CodingKeys: String, CodingKey {
        case name, minResolution, cutoffResolution, preferredSources, preferredCodecs
        case preferredLanguages, preferredSearchLanguage, prioritizedTrackers
        case preferTrackerOverQuality, maxSizeGb, requireHdr, preferHdr, minSeeders, customFormats
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(minResolution, forKey: .minResolution)
        try c.encode(cutoffResolution, forKey: .cutoffResolution)
        try c.encode(preferredSources, forKey: .preferredSources)
        try c.encode(preferredCodecs, forKey: .preferredCodecs)
        try c.encode(preferredLanguages, forKey: .preferredLanguages)
        try c.encode(preferredSearchLanguage, forKey: .preferredSearchLanguage)
        try c.encode(prioritizedTrackers, forKey: .prioritizedTrackers)
        try c.encode(preferTrackerOverQuality, forKey: .preferTrackerOverQuality)
        try c.encode(maxSizeGb, forKey: .maxSizeGb)
        try c.encode(requireHdr, forKey: .requireHdr)
        try c.encode(preferHdr, forKey: .preferHdr)
        try c.encode(minSeeders, forKey: .minSeeders)
        try c.encode(customFormats, forKey: .customFormats)
    }
}

// MARK: Custom formats (read — spec §5 Phase 4)

/// A custom-format condition, decoded for editing. The heterogeneous `value`
/// (string / number / [number] / bool) is normalized to a string.
nonisolated struct FormatConditionDTO: Decodable, Sendable {
    let type: String
    let op: String
    let stringValue: String
    let negate: Bool

    enum CodingKeys: String, CodingKey {
        case type
        case op = "operator"
        case value
        case negate
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        op = try c.decode(String.self, forKey: .op)
        negate = (try? c.decodeIfPresent(Bool.self, forKey: .negate)) ?? false
        if let s = try? c.decodeIfPresent(String.self, forKey: .value) {
            stringValue = s
        } else if let d = try? c.decodeIfPresent(Double.self, forKey: .value) {
            stringValue = FormatConditionDTO.number(d)
        } else if let arr = try? c.decodeIfPresent([Double].self, forKey: .value) {
            stringValue = arr.map(FormatConditionDTO.number).joined(separator: ",")
        } else if let b = try? c.decodeIfPresent(Bool.self, forKey: .value) {
            stringValue = b ? "true" : "false"
        } else {
            stringValue = ""
        }
    }

    static func number(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}

nonisolated struct CustomFormatDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String
    let conditions: [FormatConditionDTO]?
}

nonisolated struct CustomFormatsResponse: Decodable, Sendable {
    let customFormats: [CustomFormatDTO]
}

/// One condition, encoded with its value shaped by type/operator (numeric types
/// send a number, `between` an array, `is_true` no value, else a string).
nonisolated struct ConditionEncodable: Encodable, Sendable {
    let type: String
    let op: String
    let stringValue: String
    let negate: Bool

    static let numericTypes: Set<String> = ["resolution", "seeders", "size_range"]

    enum CodingKeys: String, CodingKey {
        case type
        case op = "operator"
        case value
        case negate
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(op, forKey: .op)
        try c.encode(negate, forKey: .negate)
        if op == "is_true" {
            return
        } else if op == "between" {
            let parts = stringValue.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            try c.encode(parts, forKey: .value)
        } else if Self.numericTypes.contains(type) {
            try c.encode(Double(stringValue) ?? 0, forKey: .value)
        } else {
            try c.encode(stringValue, forKey: .value)
        }
    }
}

nonisolated struct SaveCustomFormatBody: Encodable, Sendable {
    let name: String
    let conditions: [ConditionEncodable]
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

// MARK: Users admin + invitations (spec §5 Phase 5)

nonisolated struct SetRoleBody: Encodable, Sendable { let isAdmin: Bool }
nonisolated struct ResetPasswordBody: Encodable, Sendable { let newPassword: String }
nonisolated struct CreateUserBody: Encodable, Sendable {
    let email: String
    let password: String
    let firstName: String?
    let lastName: String?
    let locale: String
    let isAdmin: Bool
}

nonisolated struct CreateInvitationBody: Encodable, Sendable {
    let email: String
    let locale: String
    let isAdmin: Bool
}

nonisolated struct TokenResponse: Decodable, Sendable { let token: String? }
nonisolated struct InvitationDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let email: String
    let status: String
    let isAdmin: Bool?
    let createdAt: String?
    let expiresAt: String?
}

nonisolated struct InvitationsResponse: Decodable, Sendable { let invitations: [InvitationDTO] }

// MARK: Sessions + web-push + API keys + blocklist (spec §5 Phase 5)

nonisolated struct SessionDeviceDTO: Decodable, Sendable { let browser: String?; let os: String? }
nonisolated struct AdminSessionDTO: Decodable, Identifiable, Sendable {
    let id: String
    let userId: String?
    let userEmail: String?
    let userName: String?
    let expiresAt: String?
    let createdAt: String?
    let ipAddress: String?
    let device: SessionDeviceDTO?
}

nonisolated struct AdminSessionsResponse: Decodable, Sendable { let sessions: [AdminSessionDTO] }

nonisolated struct AdminWebPushDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let userEmail: String?
    let userName: String?
    let endpoint: String?
    let deviceName: String?
    let createdAt: String?
}

nonisolated struct AdminWebPushResponse: Decodable, Sendable { let subscriptions: [AdminWebPushDTO] }

nonisolated struct ApiKeyDTO: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let start: String?
    let lastUsed: String?
    let expiresAt: String?
    let createdAt: String?
}

nonisolated struct ApiKeysResponse: Decodable, Sendable { let apiKeys: [ApiKeyDTO] }
nonisolated struct CreateApiKeyBody: Encodable, Sendable {
    let name: String
    let expiresInDays: Int?
}

nonisolated struct CreateApiKeyResponse: Decodable, Sendable { let key: String? }

nonisolated struct BlocklistEntryDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let releaseTitle: String?
    let indexer: String?
    let reason: String?
    let blockedAt: String?
}

nonisolated struct BlocklistResponse: Decodable, Sendable { let entries: [BlocklistEntryDTO] }

// MARK: SSO / OIDC providers CRUD (spec §5 Phase 5)

nonisolated struct OidcProviderDTO: Decodable, Identifiable, Sendable {
    let id: String
    let slug: String
    let name: String
    let discoveryUrl: String?
    let clientId: String?
    let clientSecretSet: Bool?
    let enabled: Bool
    let iconUrl: String?
}

nonisolated struct OidcProvidersResponse: Decodable, Sendable { let providers: [OidcProviderDTO] }

// MARK: Releases + jobs (spec §5 Phase 5 + Appendix B)

nonisolated struct GithubReleaseDTO: Decodable, Identifiable, Sendable {
    let tagName: String
    let name: String?
    let publishedAt: String?
    var id: String {
        tagName
    }
}

nonisolated struct ReleaseSyncDTO: Decodable, Sendable {
    let repoFullName: String?
    let lastSyncedAt: String?
    let lastError: String?
}

nonisolated struct ReleasesResponse: Decodable, Sendable {
    let releases: [GithubReleaseDTO]
    let sync: ReleaseSyncDTO?
}

nonisolated struct TriggerActionBody: Encodable, Sendable { let action: String }

// MARK: Profile (spec §5 Phase 5)

nonisolated struct UpdateProfileBody: Encodable, Sendable {
    let firstName: String?
    let lastName: String?
}

nonisolated struct ChangePasswordBody: Encodable, Sendable {
    let currentPassword: String
    let newPassword: String
}

nonisolated struct CreateOidcBody: Encodable, Sendable {
    let slug: String
    let name: String
    let discoveryUrl: String
    let clientId: String
    let clientSecret: String
    let enabled: Bool
    let iconUrl: String?
}

nonisolated struct UpdateOidcBody: Encodable, Sendable {
    let name: String
    let discoveryUrl: String
    let clientId: String
    let clientSecret: String?
    let enabled: Bool
    let iconUrl: String?
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

nonisolated struct AiProviderIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let baseUrl: String?
    let model: String?
    let hasApiKey: Bool?
}

nonisolated struct AiProviderIntegrationResponse: Decodable, Sendable { let integration: AiProviderIntegrationDTO }
nonisolated struct SaveAiProviderBody: Encodable, Sendable {
    let enabled: Bool
    let baseUrl: String
    let model: String
    /// Blank keeps the stored key (server behavior); encodes as `api_key`.
    let apiKey: String
}

nonisolated struct FanartIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let apiKeySet: Bool?
}

nonisolated struct FanartIntegrationResponse: Decodable, Sendable { let integration: FanartIntegrationDTO }
nonisolated struct SaveFanartBody: Encodable, Sendable {
    let enabled: Bool
    /// Blank keeps the stored key; encodes as `api_key`. Server 400s if enabling
    /// with no key ever stored.
    let apiKey: String
}

nonisolated struct AiProviderTestResponse: Decodable, Sendable {
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

nonisolated struct NytBooksIntegrationDTO: Decodable, Sendable {
    let enabled: Bool
    let hasApiKey: Bool?
}

nonisolated struct NytBooksIntegrationResponse: Decodable, Sendable { let integration: NytBooksIntegrationDTO }
nonisolated struct SaveNytBooksBody: Encodable, Sendable {
    let apiKey: String?
    let enabled: Bool
}

nonisolated struct NytBooksTestBody: Encodable, Sendable {
    let apiKey: String?
}

nonisolated struct IntegrationTestResponse: Decodable, Sendable {
    let success: Bool?
    let error: String?
}

// MARK: Book discovery (Explore — ranked bestseller lists)

nonisolated struct BookDiscoveryBook: Decodable, Sendable, Identifiable {
    let rank: Int
    let title: String
    let isbn13: String?
    let coverUrl: String?
    let sourceUrl: String?
    let author: String?
    let overview: String?
    let publishedYear: Int?
    let volumeId: String?
    let alreadyInLibrary: Bool

    var id: String {
        "\(rank)-\(isbn13 ?? title)"
    }
}

nonisolated struct BookDiscoveryList: Decodable, Sendable, Identifiable, Hashable {
    let id: String
    let label: String
}

nonisolated struct BookDiscoveryResponse: Decodable, Sendable {
    let source: String
    let list: String
    let items: [BookDiscoveryBook]
}

nonisolated struct BookDiscoverySourceDTO: Decodable, Sendable, Identifiable {
    let id: String
    let label: String
    let lists: [BookDiscoveryList]
}

nonisolated struct BookDiscoverySourcesResponse: Decodable, Sendable {
    let sources: [BookDiscoverySourceDTO]
}

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
    let activeIndexerManager: String?
    let booksLibraryPath: String?
    let audiobooksLibraryPath: String?
    let bookTemplate: String?
    let audiobookTemplate: String?
    let defaultBookQualityProfileId: Int?
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
        try c.encode(defaultBookQualityProfileId, forKey: .defaultBookQualityProfileId)
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
