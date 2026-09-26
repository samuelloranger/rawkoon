import Foundation

nonisolated enum TranscodeCodec: String, Codable, Hashable, CaseIterable, Sendable { case hevc, av1 }
nonisolated enum TranscodeEncoder: String, Codable, Hashable, CaseIterable, Sendable { case software, vaapi }
nonisolated enum TranscodeMode: String, Codable, Hashable, Sendable { case quality, target }
nonisolated enum TranscodePreset: String, Codable, Hashable, CaseIterable, Sendable { case high, balanced, small }
nonisolated enum TranscodeSpeed: String, Codable, Hashable, CaseIterable, Sendable { case slower, `default`, faster }

/// The API sends `"keep"` or a height number.
nonisolated enum TranscodeResolution: Codable, Hashable, Sendable {
    case keep, p1080, p720

    var box: (width: Int, height: Int)? {
        switch self {
        case .keep: nil
        case .p1080: (1920, 1080)
        case .p720: (1280, 720)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let height = try? c.decode(Int.self) {
            self = height <= 720 ? .p720 : .p1080
        } else {
            self = .keep
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .keep: try c.encode("keep")
        case .p1080: try c.encode(1080)
        case .p720: try c.encode(720)
        }
    }
}

/// Wire keys are camelCase (the API validates them verbatim) — encode with the plain encoder.
nonisolated struct TranscodeJobSettings: Codable, Hashable, Sendable {
    var codec: TranscodeCodec = .hevc
    var encoder: TranscodeEncoder = .software
    var resolution: TranscodeResolution = .keep
    var mode: TranscodeMode = .quality
    var preset: TranscodePreset = .balanced
    var quality: Int?
    var speed: TranscodeSpeed = .default
    var targetVideoKbps: Int?
    var convertLosslessAudio = false
}

nonisolated struct TranscodeSelection: Encodable, Hashable, Sendable {
    var fileIds: [Int]?
    var mediaId: Int?
    var season: Int?

    enum CodingKeys: String, CodingKey {
        case fileIds = "file_ids"
        case mediaId = "media_id"
        case season
    }
}

nonisolated struct TranscodeEstimateRequest: Encodable, Sendable {
    let selection: TranscodeSelection
    let settings: TranscodeJobSettings
    let refine: Bool
}

nonisolated struct TranscodeEnqueueRequest: Encodable, Sendable {
    let selection: TranscodeSelection
    let settings: TranscodeJobSettings
}

nonisolated struct TranscodeCombo: Decodable, Hashable, Sendable {
    let codec: TranscodeCodec
    let encoder: TranscodeEncoder
}

nonisolated struct TranscodeCapabilities: Decodable, Sendable {
    let combos: [TranscodeCombo]
    let deviceLabel: String?
    let vaapiUnavailableReason: String?

    func supports(_ codec: TranscodeCodec, _ encoder: TranscodeEncoder) -> Bool {
        combos.contains(TranscodeCombo(codec: codec, encoder: encoder))
    }
}

nonisolated struct TranscodeEstimateFile: Decodable, Identifiable, Sendable {
    let fileId: Int
    let title: String
    let sourceBytes: String
    let estimatedBytes: String
    let nlink: Int
    let durationSecs: Double
    var id: Int {
        fileId
    }
}

nonisolated struct TranscodeExcludedFile: Decodable, Identifiable, Sendable {
    let fileId: Int
    let title: String
    let reason: String
    var id: Int {
        fileId
    }
}

nonisolated struct TranscodeAudioChange: Decodable, Identifiable, Sendable {
    let label: String
    let to: String
    var id: String {
        label
    }
}

nonisolated struct TranscodeEstimate: Decodable, Sendable {
    let files: [TranscodeEstimateFile]
    let excluded: [TranscodeExcludedFile]
    let totalSourceBytes: String
    let totalEstimatedBytes: String
    let totalDurationSecs: Double
    let totalAudioBytes: String
    let rangePct: Int
    let freesNowBytes: String
    let freesAfterSeedingBytes: String
    let temporaryGrowthBytes: String
    let etaSecs: Int
    let source: String
    let refinedFiles: Int
    let refinedClips: Int
    let audioChanges: [TranscodeAudioChange]
    let sourceHeight: Int?
    let sourceWidth: Int?
}

nonisolated struct TranscodeEnqueueResponse: Decodable, Sendable {
    let batchId: String
    let count: Int
}

nonisolated struct TranscodeLiveProgress: Decodable, Sendable {
    let progress: Double
    let fps: Double?
    let speed: Double?
    let etaSecs: Int?
    let currentBytes: String?
}

nonisolated struct TranscodeJob: Decodable, Identifiable, Sendable {
    let id: Int
    let mediaFileId: Int?
    let mediaId: Int?
    let batchId: String
    let title: String
    let position: Double
    let status: String
    let step: String?
    let settings: TranscodeJobSettings
    let sourceBytes: String
    let estimatedBytes: String?
    let outputBytes: String?
    let sourceNlink: Int?
    let progress: Double?
    let ssimAvg: Double?
    let ssimMin: Double?
    let error: String?
    let createdAt: String
    let startedAt: String?
    let finishedAt: String?
    let posterUrl: String?
    let live: TranscodeLiveProgress?
}

nonisolated struct TranscodeJobsResponse: Decodable, Sendable {
    let jobs: [TranscodeJob]
}

nonisolated struct TranscodeQueueSettings: Decodable, Sendable, Equatable {
    let paused: Bool
    let windowEnabled: Bool
    let windowStart: String
    let windowEnd: String
    let ssimThreshold: Double
    let ssimClipMin: Double
    let cpuThreads: Int?
}

/// PATCH body: only set fields are sent; `cpuThreads: .some(nil)` sends null (back to auto).
nonisolated struct TranscodeSettingsPatch: Encodable, Sendable {
    var paused: Bool?
    var windowEnabled: Bool?
    var windowStart: String?
    var windowEnd: String?
    var ssimThreshold: Double?
    var ssimClipMin: Double?
    var cpuThreads: Int??

    enum CodingKeys: String, CodingKey {
        case paused, windowEnabled, windowStart, windowEnd, ssimThreshold, ssimClipMin, cpuThreads
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(paused, forKey: .paused)
        try c.encodeIfPresent(windowEnabled, forKey: .windowEnabled)
        try c.encodeIfPresent(windowStart, forKey: .windowStart)
        try c.encodeIfPresent(windowEnd, forKey: .windowEnd)
        try c.encodeIfPresent(ssimThreshold, forKey: .ssimThreshold)
        try c.encodeIfPresent(ssimClipMin, forKey: .ssimClipMin)
        if let threads = cpuThreads {
            if let value = threads {
                try c.encode(value, forKey: .cpuThreads)
            } else {
                try c.encodeNil(forKey: .cpuThreads)
            }
        }
    }
}

nonisolated struct TranscodeSummary: Decodable, Sendable {
    let show: Bool
    let state: String
    let windowStart: String
    let current: TranscodeJob?
    let next: [TranscodeJob]
    let queuedCount: Int
    let queuedSourceBytes: String
    let queuedEtaSecs: Int
    // convertFromSnakeCase capitalises the digit segment: saved_bytes_30d → savedBytes30D.
    let savedBytes30D: String
    let doneCount30D: Int
    let freesAfterSeedingBytes: String
    let failedCount: Int
}
