import Foundation

extension APIClient {
    func seedingPreview() async throws -> SeedingPreviewDTO {
        try await get("/api/downloads/seeding", query: ["preview": "1"])
    }

    func seedRules() async throws -> SeedRulesResponseDTO {
        try await get("/api/downloads/seed-rules")
    }

    func saveSeedRule(indexer: String, _ body: UpsertSeedRuleBody) async throws {
        try await putExpectOK("/api/downloads/seed-rules/\(Self.pathSegment(indexer))", body: body)
    }

    func deleteSeedRule(indexer: String) async throws {
        try await deleteExpectOK("/api/downloads/seed-rules/\(Self.pathSegment(indexer))")
    }

    func updateSeedSettings(_ body: UpdateSeedSettingsBody) async throws {
        try await patchExpectOK("/api/library/post-processing/settings", body: body)
    }

    /// Indexer names carry spaces and slashes, so escape everything but unreserved characters.
    private static func pathSegment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? value
    }
}
