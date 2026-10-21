import Foundation

// Models and rules behind Settings > Automatic grabbing. Decoded with
// `convertFromSnakeCase`, like the rest of the API.

public enum GrabReadinessStatus: String, Decodable, Sendable {
    case ok, warn, error
}

/// Where a failing check is fixed.
public enum GrabReadinessFix: Equatable, Sendable {
    case indexerManager
    case downloadClient
    case defaultProfiles
    case qualityProfiles
}

public struct GrabReadinessCheck: Decodable, Equatable, Sendable, Identifiable {
    public struct Params: Decodable, Equatable, Sendable {
        public struct ProfileRef: Decodable, Equatable, Sendable {
            public let id: Int
            public let name: String
        }

        public var manager: String?
        public var indexers: Int?
        public var reason: String?
        public var clientType: String?
        public var profileName: String?
        public var watched: Int?
        public var total: Int?
        public var profiles: [ProfileRef]?
        public var enabled: Bool?

        public init(
            manager: String? = nil, indexers: Int? = nil, reason: String? = nil, clientType: String? = nil,
            profileName: String? = nil, watched: Int? = nil, total: Int? = nil,
            profiles: [ProfileRef]? = nil, enabled: Bool? = nil
        ) {
            self.manager = manager
            self.indexers = indexers
            self.reason = reason
            self.clientType = clientType
            self.profileName = profileName
            self.watched = watched
            self.total = total
            self.profiles = profiles
            self.enabled = enabled
        }
    }

    /// Unknown ids from a newer server decode fine and are skipped by the list.
    public let id: String
    public let status: GrabReadinessStatus
    public let params: Params

    public init(id: String, status: GrabReadinessStatus, params: Params = Params()) {
        self.id = id
        self.status = status
        self.params = params
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decode(GrabReadinessStatus.self, forKey: .status)
        params = (try? c.decode(Params.self, forKey: .params)) ?? Params()
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, params
    }

    public static let knownIds: Set<String> = [
        "indexer_manager", "download_client", "default_movie_profile", "default_show_profile",
        "rss_indexers", "profiles_without_maximum", "search_on_add",
    ]

    /// The settings page that fixes this check, nil when it is fine or has no fix.
    public var fix: GrabReadinessFix? {
        guard status != .ok else { return nil }
        switch id {
        case "indexer_manager": return .indexerManager
        case "download_client": return .downloadClient
        case "default_movie_profile", "default_show_profile": return .defaultProfiles
        case "profiles_without_maximum": return .qualityProfiles
        case "rss_indexers": return .indexerManager
        default: return nil
        }
    }
}

public struct GrabReadinessResponse: Decodable, Equatable, Sendable {
    public let checks: [GrabReadinessCheck]

    public init(checks: [GrabReadinessCheck]) {
        self.checks = checks
    }
}

public enum GrabReadiness {
    /// The checks this client knows how to word, in server order.
    public static func visible(_ checks: [GrabReadinessCheck]) -> [GrabReadinessCheck] {
        checks.filter { GrabReadinessCheck.knownIds.contains($0.id) }
    }

    public static func problemCount(_ checks: [GrabReadinessCheck]) -> Int {
        visible(checks).filter { $0.status != .ok }.count
    }
}

/// The auto-grab slice of `GET /api/library/post-processing/settings`.
public struct AutoGrabSettings: Decodable, Equatable, Sendable {
    public let searchOnAdd: Bool?
    public let releaseCheckCron: String?
    public let rssPollIntervalMinutes: Int?
    public let activeIndexerManager: String?

    public init(
        searchOnAdd: Bool?,
        releaseCheckCron: String?,
        rssPollIntervalMinutes: Int? = nil,
        activeIndexerManager: String? = nil
    ) {
        self.searchOnAdd = searchOnAdd
        self.releaseCheckCron = releaseCheckCron
        self.rssPollIntervalMinutes = rssPollIntervalMinutes
        self.activeIndexerManager = activeIndexerManager
    }
}

/// Mirrors `RSS_POLL_INTERVAL_MINUTES` in `@rawkoon/shared/utils`.
public enum RssPollInterval {
    public static let options = [5, 10, 15, 30, 60]
    public static let defaultMinutes = 15

    /// An interval the server no longer offers reads as the default, as the server does.
    public static func normalized(_ minutes: Int?) -> Int {
        guard let minutes, options.contains(minutes) else { return defaultMinutes }
        return minutes
    }
}

public struct AutoGrabSettingsResponse: Decodable, Equatable, Sendable {
    public let settings: AutoGrabSettings
}

/// A target whose automatic grab is held back by its quality profile's delay.
public struct PendingRelease: Decodable, Equatable, Sendable, Identifiable {
    public let targetKey: String
    public let mediaId: Int
    public let mediaTitle: String
    public let season: Int?
    public let episode: Int?
    public let releaseTitle: String
    public let candidateCount: Int
    public let grabAfter: String

    public var id: String {
        targetKey
    }

    public init(
        targetKey: String, mediaId: Int, mediaTitle: String, season: Int? = nil, episode: Int? = nil,
        releaseTitle: String, candidateCount: Int, grabAfter: String
    ) {
        self.targetKey = targetKey
        self.mediaId = mediaId
        self.mediaTitle = mediaTitle
        self.season = season
        self.episode = episode
        self.releaseTitle = releaseTitle
        self.candidateCount = candidateCount
        self.grabAfter = grabAfter
    }

    /// "S01E02", "Season 1" style code for an episode target, nil for a movie or whole show.
    public var episodeCode: String? {
        guard let season else { return nil }
        let s = String(format: "S%02d", season)
        guard let episode else { return s }
        return s + String(format: "E%02d", episode)
    }

    public var grabAfterDate: Date? {
        PendingRelease.parse(grabAfter)
    }

    private static func parse(_ value: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) {
            return date
        }
        return ISO8601DateFormatter().date(from: value)
    }
}

public struct PendingReleasesResponse: Decodable, Equatable, Sendable {
    public let items: [PendingRelease]

    public init(items: [PendingRelease]) {
        self.items = items
    }
}

public enum GrabPendingReason: String, Decodable, Sendable {
    case notWanted = "not_wanted"
    case alreadyActive = "already_active"
    case noSpace = "no_space"
    case allFailed = "all_failed"
}

public struct GrabPendingReleaseResponse: Decodable, Equatable, Sendable {
    public let grabbed: Bool
    /// A reason this client does not know decodes as nil rather than failing the call.
    public let reason: GrabPendingReason?

    public init(grabbed: Bool, reason: GrabPendingReason?) {
        self.grabbed = grabbed
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey {
        case grabbed, reason
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        grabbed = try c.decode(Bool.self, forKey: .grabbed)
        reason = (try? c.decodeIfPresent(String.self, forKey: .reason)).flatMap(\.self).flatMap(GrabPendingReason.init(rawValue:))
    }
}
