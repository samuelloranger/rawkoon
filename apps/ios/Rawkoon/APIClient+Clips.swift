import Foundation

extension APIClient {
    func clipProgress() async throws -> ClipProgress {
        try await get("/api/clips/progress")
    }

    func updateClipSettings(_ changes: ClipSettingsPatch) async throws -> ClipSettings {
        try await put("/api/clips/settings", body: changes)
    }

    func retryFailedClips() async throws -> ClipRetryResponse {
        nonisolated struct Empty: Encodable {}
        return try await post("/api/clips/retry", body: Empty())
    }

    func deleteAllClips() async throws -> ClipDeleteAllResponse {
        nonisolated struct Empty: Encodable {}
        return try await post("/api/clips/delete-all", body: Empty())
    }
}
