import Foundation

// Device, integration, and book discovery DTOs.

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
    /// USD per million tokens, used to estimate cost; nil when unset.
    let inputPricePerMillion: Double?
    let outputPricePerMillion: Double?
    /// USD; nil means no budget.
    let dailyBudgetUsd: Double?
    /// A missing key means the feature is on.
    let features: AiFeatureToggles?
}

nonisolated struct AiProviderIntegrationResponse: Decodable, Sendable { let integration: AiProviderIntegrationDTO }
nonisolated struct SaveAiProviderBody: Encodable, Sendable {
    let enabled: Bool
    let baseUrl: String
    let model: String
    /// Blank keeps the stored key (server behavior); encodes as `api_key`.
    let apiKey: String
    /// A cleared field is sent as an explicit null: the server keeps a stored value
    /// when the key is absent, so only null actually clears it.
    let inputPricePerMillion: Double?
    let outputPricePerMillion: Double?
    let dailyBudgetUsd: Double?
    let features: AiFeatureToggles

    private enum CodingKeys: String, CodingKey {
        case enabled, baseUrl, model, apiKey, inputPricePerMillion, outputPricePerMillion, dailyBudgetUsd, features
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(baseUrl, forKey: .baseUrl)
        try container.encode(model, forKey: .model)
        try container.encode(apiKey, forKey: .apiKey)
        try container.encode(inputPricePerMillion, forKey: .inputPricePerMillion)
        try container.encode(outputPricePerMillion, forKey: .outputPricePerMillion)
        try container.encode(dailyBudgetUsd, forKey: .dailyBudgetUsd)
        try container.encode(features.explicit, forKey: .features)
    }
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
    let request: BookRequestState?

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
