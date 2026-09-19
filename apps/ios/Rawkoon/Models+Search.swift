import Foundation

// Requests, interactive release search, AI pick/blocklist, downloads/activity DTOs. Split out of Models.swift to stay under the file_length lint
// threshold (spec §4.2). Pure data types, no behaviour.

// MARK: - Requests

nonisolated struct MediaRequest: Decodable, Identifiable, Sendable {
    let id: Int
    /// Null for a "book" request — books key off googleVolumeId instead.
    let tmdbId: Int?
    let type: String // "movie" | "show" | "book"
    let title: String
    /// Book requests only: display author line.
    let author: String?
    let posterUrl: String?
    let year: Int?
    let status: String // pending | approved | denied
    let requestedBy: RequestedBy?
    /// Book requests only: the volume being requested.
    let googleVolumeId: String?
    /// Book requests only: profile chosen at approval.
    let bookQualityProfileId: Int?
    /// Book requests only: set once the request is approved and the book exists.
    let libraryBookId: Int?
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
    /// Movie/show requests only; nil for a "book" request.
    let tmdbId: Int?
    let type: String // "movie" | "show" | "book" (NOT "tv")
    let title: String
    let posterUrl: String?
    let year: Int?
    /// Book requests only.
    let googleVolumeId: String?
    /// Book requests only.
    let author: String?
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
    let source: String?
    let parsedQuality: ParsedQuality?
    let qualityRejectionReasons: [String]?
    let scoreBreakdown: ScoreBreakdown?

    var id: String {
        guid
    }

    /// `.convertFromSnakeCase` maps most keys; only `protocol` (a Swift keyword)
    /// needs an explicit key. Raw values are the POST-conversion camelCase forms.
    enum CodingKeys: String, CodingKey {
        case guid, title, indexer, indexerId, languages, age, seeders, leechers, rejected, rejectionReason, freeleech, qualityScore
        case protocolType = "protocol"
        case sizeBytes, infoURL = "infoUrl", downloadToken, downloadUrl, isSeasonPack, isCompleteSeries
        case source, parsedQuality, qualityRejectionReasons, scoreBreakdown
    }
}

/// Server-parsed quality of a release, decoded straight from the wire — the app
/// no longer re-derives quality by keyword-scanning the title.
nonisolated struct ParsedQuality: Codable, Sendable {
    let resolution: Int?
    let source: String?
    let codec: String?
    let hdr: String?
}

/// One line of the server's release-scoring breakdown. `params` is intentionally
/// not decoded — labels are static English (see `ScoreComponentLabels`) and
/// decoding a heterogeneous param bag would only make decode fragile.
nonisolated struct ScoreComponent: Decodable, Sendable, Identifiable {
    let code: String
    let value: Int

    var id: String {
        code
    }
}

nonisolated struct ScoreBreakdown: Decodable, Sendable {
    let rejected: Bool
    let total: Int?
    let components: [ScoreComponent]
    let matchedFormats: [String]
}

nonisolated struct GrabTokenBody: Encodable, Sendable {
    let token: String
}

nonisolated struct GrabUrlBody: Encodable, Sendable {
    let downloadUrl: String
    let releaseTitle: String
    let episodeId: Int?
    let season: Int?
    // Enriched to match the web grab: the server records these on the download
    // history so a grab from iOS is no longer lossier than one from the browser.
    let indexer: String?
    let qualityParsed: ParsedQuality?
    let sizeBytes: Int?
    let isUpgrade: Bool?
}

// MARK: - AI pick / blocklist (interactive search)

nonisolated struct AiPickMediaContext: Encodable, Sendable {
    let title: String
    let year: Int?
    let type: String // "movie" | "tv"
}

nonisolated struct AiPickCandidate: Encodable, Sendable {
    let key: String // release guid
    let title: String
    let sizeBytes: Int?
    let seeders: Int?
    let score: Double?
}

nonisolated struct AiPickRequest: Encodable, Sendable {
    let mediaContext: AiPickMediaContext
    let releases: [AiPickCandidate]
}

nonisolated struct AiPick: Decodable, Sendable {
    let releaseKey: String
    let reasoning: String
}

nonisolated struct BlocklistBody: Encodable, Sendable {
    let releaseTitle: String
    let indexer: String?
    let mediaId: Int?
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
    let postProcessDestinationPath: String?
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
    let availableServices: [String]?
    let availableTypes: [String]?
    let total: Int?
}

nonisolated struct ActivityRecord: Decodable, Sendable {
    let id: Int?
    let type: String?
    let service: String?
    let completedAt: String?
    let releaseTitle: String?
    let message: String?
    let success: Bool?
    let jobName: String?
    let fromVersion: String?
    let toVersion: String?
    let integrationType: String?
    let reason: String?
    let durationMs: Int?
    let eventTitle: String?
    let grabSource: String?
    let aiPicked: Bool?
    let username: String?
    let taskName: String?
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

    /// Short, locale-aware release/air date ("Sep 12"), or nil when absent or
    /// unparseable. The API sends day-only ISO strings; parse in the current
    /// zone so the shown calendar day matches the server's.
    var displayDate: String? {
        guard let releaseDate else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        parser.timeZone = .current
        guard let date = parser.date(from: releaseDate) else { return nil }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// `S2 E5` for a single upcoming episode; nil for movies or for days that
    /// group several episodes (season/episode arrive null then).
    var episodeLabel: String? {
        guard mediaType == "tv", let seasonNumber, let episodeNumber else {
            return nil
        }
        return "S\(seasonNumber) E\(episodeNumber)"
    }
}
