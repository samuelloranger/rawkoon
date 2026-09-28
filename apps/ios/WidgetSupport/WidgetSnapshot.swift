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

nonisolated struct WidgetSnapshot: Codable, Sendable {
    var updatedAt: Date
    var listening: WidgetListening?
    var recent: [WidgetMedia]
    var suggestion: WidgetSuggestion?
    var suggestionDay: Date?

    static var empty: WidgetSnapshot {
        WidgetSnapshot(updatedAt: .distantPast, listening: nil, recent: [], suggestion: nil, suggestionDay: nil)
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
