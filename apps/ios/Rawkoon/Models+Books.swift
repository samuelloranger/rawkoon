import Foundation

// Listening stats, system features, and book detail/edition/file DTOs. Split out of Models.swift to stay under the file_length lint
// threshold (spec §4.2). Pure data types, no behaviour.

// MARK: - Listening stats / system features

nonisolated struct SystemFeatures: Decodable, Sendable {
    let booksEnabled: Bool
}

nonisolated struct ListeningSeriesStat: Decodable, Sendable, Identifiable {
    var id: String {
        name
    }

    let name: String
    let booksTotal: Int
    let booksFinished: Int
    let percent: Int
    let currentTitle: String?
}

nonisolated struct ListeningWeekDay: Decodable, Sendable, Identifiable {
    var id: String {
        day
    }

    let day: String
    let seconds: Double
}

nonisolated struct ListeningStats: Decodable, Sendable {
    let timezone: String
    let todaySecs: Double
    let weekSecs: Double
    let streakDays: Int
    let since: String?
    let week: [ListeningWeekDay]
    let series: [ListeningSeriesStat]
}

// MARK: - Books detail / editions / files

nonisolated struct BookDetailResponse: Decodable, Sendable {
    let item: BookDetailItem
}

nonisolated struct BookDetailItem: Decodable, Identifiable, Sendable {
    let id: Int
    let title: String
    let subtitle: String?
    let overview: String?
    let coverUrl: String?
    let authors: [String]
    let language: String
    let publishedYear: Int?
    let publishedDate: String?
    let seriesName: String?
    let seriesPosition: Int?
    let narrators: [String]
    let genres: [String]
    let publisher: String?
    let pageCount: Int?
    let rating: Double?
    let ratingCount: Int?
    let isbn13: String?
    let readAt: String?
    let editions: [BookEditionDetail]
}

nonisolated struct BookEditionDetail: Decodable, Identifiable, Sendable {
    let id: Int
    let kind: String
    let status: String
    let monitored: Bool
    let durationSecs: Double?
    let totalSizeBytes: String?
    let fileCount: Int
    let bestFormat: String?
    let narrators: [String]
}

nonisolated struct BookEditionFilesPayload: Decodable, Sendable {
    let editionId: Int
    let kind: String
    let files: [BookEditionFile]
}

nonisolated struct BookEditionFile: Codable, Identifiable, Sendable {
    let id: Int
    let fileName: String
    let filePath: String
    let contentUrl: String?
    let sizeBytes: String
    let format: String
    let durationSecs: Double?
    let audioBitrate: Int?
    let audioCodec: String?
    let isRetail: Bool
    let releaseGroup: String?
    let languageTags: [String]
    let scannedAt: String
}

// MARK: - Book editions: add + release search + grab

nonisolated struct BookRelease: Decodable, Identifiable, Sendable {
    let guid: String
    let title: String
    let indexer: String?
    let sizeBytes: Int?
    let seeders: Int?
    let age: Int?
    let downloadUrl: String?
    let magnetUrl: String?
    let format: String?
    let audioBitrate: Int?
    let language: String?
    let isRetail: Bool?
    let score: Double?
    let rejected: Bool?
    let rejections: [String]?
    var id: String {
        guid
    }
}

nonisolated struct BookReleasesResponse: Decodable, Sendable {
    let releases: [BookRelease]
}

nonisolated struct CreateBookEditionBody: Encodable, Sendable {
    let kind: String // "audiobook" | "ebook"
    let monitored: Bool
}

nonisolated struct BookGrabBody: Encodable, Sendable {
    let releaseTitle: String
    let downloadUrl: String?
    let magnetUrl: String?
    let indexer: String?
}
