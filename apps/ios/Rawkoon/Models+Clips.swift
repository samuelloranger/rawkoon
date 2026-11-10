import Foundation

nonisolated struct ClipSettings: Decodable, Sendable, Equatable {
    var enabled: Bool
    var paused: Bool
}

nonisolated struct ClipSettingsPatch: Encodable, Sendable {
    var enabled: Bool?
    var paused: Bool?
}

nonisolated struct ClipRunningItem: Decodable, Sendable {
    let clipId: Int
    let kind: String
    let title: String
    let seasonNumber: Int?
}

nonisolated struct ClipFailedItem: Decodable, Sendable, Identifiable {
    let clipId: Int
    let kind: String
    let title: String
    let seasonNumber: Int?
    let error: String?

    var id: Int {
        clipId
    }
}

nonisolated struct ClipProgress: Decodable, Sendable {
    let settings: ClipSettings
    let done: Int
    let left: Int
    let failed: Int
    let totalBytes: Int64
    let running: ClipRunningItem?
    let etaSeconds: Int?
    let failedItems: [ClipFailedItem]
}

nonisolated struct ClipRetryResponse: Decodable, Sendable {
    let retried: Int
}

nonisolated struct ClipDeleteAllResponse: Decodable, Sendable {
    let deletedFiles: Int
    let freedBytes: Int64
}
