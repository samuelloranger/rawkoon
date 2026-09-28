import Foundation
#if !targetEnvironment(macCatalyst)
    import ActivityKit
#endif

/// The app writes a compact, account-scoped copy of the three Home widget feeds.
/// The extension never receives an auth token or makes requests to a private server.
nonisolated struct WidgetMedia: Codable, Sendable {
    let title: String
    let detail: String
    let artwork: Data?
    /// The poster URL the artwork came from, so an unchanged poster is not downloaded again.
    var artworkKey: String?
}

nonisolated struct WidgetListening: Codable, Sendable {
    let weekSeconds: Double
    let todaySeconds: Double
    let days: [Double]
}

nonisolated struct WidgetSuggestion: Codable, Sendable {
    let media: WidgetMedia
    let personalized: Bool
}

/// A library title the What to watch widget can put forward, with what a tap needs to open it.
nonisolated struct WidgetWatchPick: Codable, Sendable {
    let libraryId: Int
    let tmdbId: Int
    let mediaType: String
    let media: WidgetMedia

    var url: URL? {
        var components = URLComponents()
        components.scheme = "rawkoon"
        components.host = "media"
        components.queryItems = [
            URLQueryItem(name: "library", value: String(libraryId)),
            URLQueryItem(name: "tmdb", value: String(tmdbId)),
            URLQueryItem(name: "type", value: mediaType),
            URLQueryItem(name: "title", value: media.title),
        ]
        return components.url
    }
}

nonisolated struct WidgetSnapshot: Codable, Sendable {
    var updatedAt: Date
    var listening: WidgetListening?
    var recent: [WidgetMedia]
    var suggestion: WidgetSuggestion?
    var suggestionDay: Date?
    /// Optional so a snapshot written before this widget existed still decodes.
    var watch: [WidgetWatchPick]?
    var watchRolledAt: Date?

    static var empty: WidgetSnapshot {
        WidgetSnapshot(updatedAt: .distantPast, listening: nil, recent: [], suggestion: nil, suggestionDay: nil)
    }

    static let watchSlot: TimeInterval = 6 * 60 * 60

    /// The pick for the six-hour slot holding `date`; the pool rotates even when the app stays closed.
    func watchPick(at date: Date) -> WidgetWatchPick? {
        guard let pool = watch, !pool.isEmpty else { return nil }
        let slot = Int(date.timeIntervalSince1970 / Self.watchSlot)
        return pool[slot % pool.count]
    }
}

nonisolated enum WidgetSnapshotStore {
    static let group = "group.cloud.samlo.rawkoon"
    private static let key = "home-widget-snapshot-v1"

    static func read() -> WidgetSnapshot {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
        else { return .empty }
        return snapshot
    }

    @discardableResult
    static func write(_ snapshot: WidgetSnapshot) -> Bool {
        guard let defaults = UserDefaults(suiteName: group),
              let data = try? JSONEncoder().encode(snapshot) else { return false }
        defaults.set(data, forKey: key)
        return true
    }

    static func clear() {
        UserDefaults(suiteName: group)?.removeObject(forKey: key)
    }
}

#if !targetEnvironment(macCatalyst)
    nonisolated struct ReencodeActivityAttributes: ActivityAttributes {
        nonisolated struct ContentState: Codable, Hashable {
            let progress: Double
            let step: String
            let etaSeconds: Int?
            let status: String
        }

        let jobId: Int
        let title: String
        let codec: String
    }

    nonisolated struct SleepActivityAttributes: ActivityAttributes {
        nonisolated struct ContentState: Codable, Hashable {
            let remainingSeconds: Double
            let measuredAt: Date
            let isPlaying: Bool
            let chapterTitle: String?
        }

        let bookTitle: String
    }
#endif
