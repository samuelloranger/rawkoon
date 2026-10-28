import Foundation

// `GET /api/admin/library-health`: the latest library health run, for System > Health.

nonisolated struct LibraryHealthSummary: Decodable, Sendable {
    let totalIssues: Int?
    let downloadedMediaWithoutFiles: Int?
    let downloadedEpisodesWithoutFiles: Int?
    let missingFilePaths: Int?
    let downloadedBookEditionsWithoutFiles: Int?
    let missingBookFilePaths: Int?
    let staleTmdbStatuses: Int?
    let episodeNumberMismatches: Int?
    let episodeDurationMismatches: Int?
}

nonisolated struct LibraryHealthIssue: Decodable, Sendable {
    let kind: String?
    let mediaId: Int?
    let bookId: Int?
    let title: String?
    let detail: String
    /// Sent back to ignore the issue; absent on servers that can't ignore issues.
    let key: String?
}

nonisolated struct LibraryHealthLog: Decodable, Sendable {
    let status: String
    let trigger: String?
    let startedAt: String?
    let completedAt: String?
    let summary: LibraryHealthSummary?
    let issues: [LibraryHealthIssue]?
    let warnings: [String]?
    let error: String?
    /// Issues this run found that the admin ignored; `issues` and `summary` leave them out.
    let ignoredCount: Int?

    var issueCount: Int {
        summary?.totalIssues ?? issues?.count ?? 0
    }
}

nonisolated struct LibraryHealthResponse: Decodable, Sendable {
    let latest: LibraryHealthLog?
}

/// `GET /api/admin/library-health/ignores`: issues the admin chose to stop counting.
nonisolated struct LibraryHealthIgnore: Decodable, Identifiable, Sendable {
    let id: Int
    let issueKey: String
    let kind: String
    let title: String?
    let detail: String
    let createdAt: String?
}

nonisolated struct LibraryHealthIgnoresResponse: Decodable, Sendable {
    let ignores: [LibraryHealthIgnore]
}
