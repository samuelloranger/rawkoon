import Foundation
import RawkoonKit

/// Body for the auto-grab keys of `PATCH /api/library/post-processing/settings`.
nonisolated struct UpdateAutoGrabBody: Encodable, Sendable {
    // Nil keys are omitted, so each control saves only its own field.
    var searchOnAdd: Bool?
    var releaseCheckCron: String?
    var rssPollIntervalMinutes: Int?
}

private nonisolated struct GrabPendingBody: Encodable, Sendable {
    let targetKey: String
}

extension APIClient {
    func autoGrabSettings() async throws -> AutoGrabSettings {
        let response: AutoGrabSettingsResponse = try await get("/api/library/post-processing/settings")
        return response.settings
    }

    func updateAutoGrab(_ body: UpdateAutoGrabBody) async throws {
        try await patchExpectOK("/api/library/post-processing/settings", body: body)
    }

    func grabReadiness(refresh: Bool = false) async throws -> [GrabReadinessCheck] {
        let response: GrabReadinessResponse = try await get(
            "/api/library/post-processing/grab-readiness",
            query: ["refresh": refresh ? "1" : nil]
        )
        return response.checks
    }

    func pendingReleases() async throws -> [PendingRelease] {
        let response: PendingReleasesResponse = try await get("/api/downloads/pending-releases")
        return response.items
    }

    func grabPendingNow(targetKey: String) async throws -> GrabPendingReleaseResponse {
        try await post("/api/downloads/pending-releases/grab-now", body: GrabPendingBody(targetKey: targetKey))
    }
}
