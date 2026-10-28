import Foundation

extension APIClient {
    func libraryHealth() async throws -> LibraryHealthResponse {
        try await get("/api/admin/library-health", query: ["limit": "1"])
    }

    func libraryHealthIgnores() async throws -> [LibraryHealthIgnore] {
        let response: LibraryHealthIgnoresResponse = try await get("/api/admin/library-health/ignores")
        return response.ignores
    }

    func ignoreLibraryHealthIssue(key: String) async throws {
        try await postExpectOK("/api/admin/library-health/ignores", body: IgnoreHealthIssueBody(issueKey: key))
    }

    func restoreLibraryHealthIssue(id: Int) async throws {
        try await deleteExpectOK("/api/admin/library-health/ignores/\(id)")
    }
}

private nonisolated struct IgnoreHealthIssueBody: Encodable, Sendable {
    let issueKey: String

    enum CodingKeys: String, CodingKey {
        case issueKey = "issue_key"
    }
}
