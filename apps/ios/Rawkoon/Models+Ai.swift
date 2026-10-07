import Foundation
import SwiftUI

// AI usage ledger models. Wire shapes mirror `apps/shared/src/types/ai.ts`; the
// shared `mediaDecoder` maps snake_case keys onto these camelCase names.

/// The places AI may pick a release. Raw values are the wire names.
nonisolated enum AiFeature: String, CaseIterable, Identifiable, Sendable {
    case releasePickRss = "release_pick_rss"
    case releasePickInteractive = "release_pick_interactive"
    case releasePickSearch = "release_pick_search"
    case bookReleasePick = "book_release_pick"

    var id: String {
        rawValue
    }

    /// Short name used in stats and history.
    var title: LocalizedStringKey {
        switch self {
        case .releasePickRss: "Auto-grab (RSS)"
        case .releasePickInteractive: "Interactive search pick"
        case .releasePickSearch: "Automatic search"
        case .bookReleasePick: "Book release pick"
        }
    }

    /// Wording on the settings switch.
    var toggleTitle: LocalizedStringKey {
        switch self {
        case .releasePickRss: "RSS auto-grab"
        case .releasePickInteractive: "Interactive search suggestion"
        case .releasePickSearch: "Scheduled & upgrade searches"
        case .bookReleasePick: "Book grabs"
        }
    }
}

/// Per-feature switches. A missing key means the feature is on.
nonisolated struct AiFeatureToggles: Codable, Equatable, Sendable {
    var releasePickRss: Bool?
    var releasePickInteractive: Bool?
    var releasePickSearch: Bool?
    var bookReleasePick: Bool?

    func isOn(_ feature: AiFeature) -> Bool {
        value(for: feature) != false
    }

    mutating func set(_ feature: AiFeature, on: Bool) {
        switch feature {
        case .releasePickRss: releasePickRss = on
        case .releasePickInteractive: releasePickInteractive = on
        case .releasePickSearch: releasePickSearch = on
        case .bookReleasePick: bookReleasePick = on
        }
    }

    /// Every feature spelled out, so a save never leaves one to the server's default.
    var explicit: AiFeatureToggles {
        var copy = self
        for feature in AiFeature.allCases {
            copy.set(feature, on: isOn(feature))
        }
        return copy
    }

    private func value(for feature: AiFeature) -> Bool? {
        switch feature {
        case .releasePickRss: releasePickRss
        case .releasePickInteractive: releasePickInteractive
        case .releasePickSearch: releasePickSearch
        case .bookReleasePick: bookReleasePick
        }
    }
}

nonisolated enum AiCallStatus: String, CaseIterable, Identifiable, Sendable {
    case ok
    case invalidPick = "invalid_pick"
    case rateLimited = "rate_limited"
    case error
    case budgetSkipped = "budget_skipped"

    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .ok: "OK"
        case .invalidPick: "Invalid pick"
        case .rateLimited: "Rate limited"
        case .error: "Error"
        case .budgetSkipped: "Budget skipped"
        }
    }
}

/// Display names for the wire `trigger` values.
nonisolated enum AiTrigger {
    static func title(_ trigger: String?) -> LocalizedStringKey {
        switch trigger {
        case "rss": "RSS"
        case "scheduled": "Scheduled search"
        case "upgrade": "Upgrade"
        case "interactive": "Interactive search"
        case "manual_search": "Manual search"
        default: "Unknown"
        }
    }
}

nonisolated enum AiStatsPeriod: Int, CaseIterable, Identifiable, Sendable {
    case week = 7
    case month = 30
    case quarter = 90
    case year = 365

    var id: Int {
        rawValue
    }

    var title: LocalizedStringKey {
        "\(rawValue) days"
    }
}

nonisolated struct AiUsageMetrics: Decodable, Sendable {
    let calls: Int
    let ok: Int
    let invalidPick: Int
    let rateLimited: Int
    let error: Int
    let budgetSkipped: Int
    let agreementChecked: Int
    let agreementRate: Double?
    let successRate: Double
    let inputTokens: Int
    let outputTokens: Int
    let totalTokens: Int
    let avgDurationMs: Double?
    let p50DurationMs: Double?
    let p95DurationMs: Double?
    let estimatedCost: Double?
}

/// A metrics row plus the dimension it is grouped by; the server flattens both
/// into one object, so the metrics decode from the same container.
nonisolated struct AiFeatureStats: Decodable, Sendable, Identifiable {
    let feature: String
    let metrics: AiUsageMetrics

    var id: String {
        feature
    }

    private enum CodingKeys: String, CodingKey { case feature }

    init(from decoder: Decoder) throws {
        feature = try decoder.container(keyedBy: CodingKeys.self).decode(String.self, forKey: .feature)
        metrics = try AiUsageMetrics(from: decoder)
    }
}

nonisolated struct AiTriggerStats: Decodable, Sendable, Identifiable {
    let trigger: String?
    let metrics: AiUsageMetrics

    var id: String {
        trigger ?? ""
    }

    private enum CodingKeys: String, CodingKey { case trigger }

    init(from decoder: Decoder) throws {
        trigger = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent(String.self, forKey: .trigger)
        metrics = try AiUsageMetrics(from: decoder)
    }
}

nonisolated struct AiModelStats: Decodable, Sendable, Identifiable {
    let model: String
    let metrics: AiUsageMetrics

    var id: String {
        model
    }

    private enum CodingKeys: String, CodingKey { case model }

    init(from decoder: Decoder) throws {
        model = try decoder.container(keyedBy: CodingKeys.self).decode(String.self, forKey: .model)
        metrics = try AiUsageMetrics(from: decoder)
    }
}

nonisolated struct AiDailyStats: Decodable, Sendable, Identifiable {
    /// YYYY-MM-DD (UTC).
    let date: String
    let calls: Int
    let errors: Int
    let rateLimited: Int
    let budgetSkipped: Int
    let totalTokens: Int
    let estimatedCost: Double?

    var id: String {
        date
    }
}

nonisolated struct AiGrabOutcome: Decodable, Sendable {
    let total: Int
    let completed: Int
    let failed: Int
    let active: Int
}

nonisolated struct AiGrabs: Decodable, Sendable {
    let ai: AiGrabOutcome
    let classic: AiGrabOutcome
}

nonisolated struct AiStatsResponse: Decodable, Sendable {
    let days: Int
    let totals: AiUsageMetrics
    let byFeature: [AiFeatureStats]
    let byModel: [AiModelStats]
    let byTrigger: [AiTriggerStats]
    let daily: [AiDailyStats]
    let grabs: AiGrabs
    let pricesConfigured: Bool
    let todaySpend: Double?
    let dailyBudgetUsd: Double?
}

nonisolated struct AiCallEntry: Decodable, Sendable, Identifiable {
    let id: Int
    let feature: String
    let model: String
    let structured: Bool
    let status: String
    let trigger: String?
    let classicTitle: String?
    let agreedWithClassic: Bool?
    let error: String?
    let inputTokens: Int?
    let outputTokens: Int?
    let totalTokens: Int?
    let durationMs: Double
    let estimatedCost: Double?
    let mediaId: Int?
    let mediaTitle: String?
    let mediaType: String?
    let bookId: Int?
    let bookEditionId: Int?
    let bookTitle: String?
    let pickedTitle: String?
    let reasoning: String?
    let createdAt: String

    /// The library item or book the call was about, if any.
    var targetTitle: String? {
        mediaTitle ?? bookTitle
    }

    var date: Date? {
        APIClient.parseISO8601(createdAt)
    }
}

nonisolated struct AiCallsResponse: Decodable, Sendable {
    let calls: [AiCallEntry]
    let total: Int
    let page: Int
    let pageSize: Int
}
